"""
Training DAG — on-demand and scheduled model retraining.

Two modes of operation:
  1. Scheduled retraining  — runs daily at 22:00 UTC (after Yahoo ingestion at 21:00)
     DAG id: riskops_scheduled_training

  2. On-demand retraining  — triggered manually via Airflow UI or REST API
     DAG id: riskops_ondemand_training
     Accepts Airflow conf params:
       {
         "symbols":       ["AAPL", "MSFT", ...],   # optional, defaults to full universe
         "model_type":    "all",                    # garch | montecarlo | all
         "alpha":         0.99,
         "lookback_days": 252,
         "n_simulations": 10000
       }

Pipeline steps:
  1. health_check          — verify Training Service is up
  2. fetch_data_summary    — confirm processed_returns data exists (via MDS API)
  3. trigger_training      — POST /api/risk/train
  4. poll_training         — GET  /api/risk/train/status/{job_id}  (poll until done)
  5. evaluate_models       — GET  /api/risk/models  (log registered model versions)
  6. notify_inference      — POST /api/risk/predict/health  (confirm inference reloaded)

Environment variables (set in docker-compose for Airflow):
  TRAINING_SERVICE_URL      default: http://training-service:8084
  MARKET_DATA_SERVICE_URL   default: http://market-data-service:8083
  INFERENCE_SERVICE_URL     default: http://inference-service:8085
"""
from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from typing import Any

from airflow import DAG
from airflow.operators.python import PythonOperator

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default training universe
# ---------------------------------------------------------------------------

DEFAULT_SYMBOLS = [
    # US equities
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA",
    # Russian equities
    "SBER", "GAZP", "LKOH", "YNDX",
]

# ---------------------------------------------------------------------------
# Service URLs
# ---------------------------------------------------------------------------

def _training_url() -> str:
    return os.environ.get("TRAINING_SERVICE_URL", "http://training-service:8084").rstrip("/")

def _mds_url() -> str:
    return os.environ.get("MARKET_DATA_SERVICE_URL", "http://market-data-service:8083").rstrip("/")

def _inference_url() -> str:
    return os.environ.get("INFERENCE_SERVICE_URL", "http://inference-service:8085").rstrip("/")


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _get(url: str, timeout: int = 30) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GET {url} → HTTP {exc.code}: {detail}") from exc


def _post(url: str, body: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {url} → HTTP {exc.code}: {detail}") from exc


# ---------------------------------------------------------------------------
# Helpers to read DAG conf (on-demand params) with defaults
# ---------------------------------------------------------------------------

def _get_conf(context: dict, key: str, default: Any) -> Any:
    """Read a parameter from DAG run conf, falling back to default."""
    conf = context.get("dag_run") and context["dag_run"].conf or {}
    return conf.get(key, default)


# ---------------------------------------------------------------------------
# Task callables
# ---------------------------------------------------------------------------

def health_check(**context) -> None:
    """Verify Training Service is healthy."""
    url = f"{_training_url()}/health"
    try:
        resp = _get(url, timeout=15)
        log.info("Training Service health: %s", resp)
    except Exception as exc:
        raise RuntimeError(f"Training Service health check failed: {exc}") from exc


def fetch_data_summary(**context) -> None:
    """Confirm that processed_returns data is available for the target symbols.

    Calls Market Data Service /api/market-data/returns to check data availability.
    Logs a warning (but does not fail) if data is sparse — training will use
    whatever is available.
    """
    symbols = _get_conf(context, "symbols", DEFAULT_SYMBOLS)
    log.info("Checking data availability for symbols: %s", symbols)

    try:
        # Check returns endpoint for a sample symbol
        sample = symbols[0] if symbols else "AAPL"
        url = f"{_mds_url()}/api/market-data/returns?symbols={sample}&limit=10"
        resp = _get(url, timeout=30)
        count = len(resp) if isinstance(resp, list) else resp.get("count", 0)
        log.info("Returns data available for %s: %d rows", sample, count)
        if count == 0:
            log.warning(
                "No returns data found for %s — training will use synthetic fallback", sample
            )
    except Exception as exc:
        log.warning("Could not verify data availability: %s — proceeding anyway", exc)

    context["ti"].xcom_push(key="symbols", value=symbols)


def trigger_training(**context) -> None:
    """Submit a training job to the Training Service."""
    symbols = (
        context["ti"].xcom_pull(task_ids="fetch_data_summary", key="symbols")
        or _get_conf(context, "symbols", DEFAULT_SYMBOLS)
    )
    model_type   = _get_conf(context, "model_type",    "all")
    alpha        = _get_conf(context, "alpha",          0.99)
    lookback     = _get_conf(context, "lookback_days",  252)
    n_sims       = _get_conf(context, "n_simulations",  10000)

    url = f"{_training_url()}/api/risk/train"
    payload = {
        "symbols":       symbols,
        "model_type":    model_type,
        "alpha":         alpha,
        "horizon_days":  1,
        "lookback_days": lookback,
        "n_simulations": n_sims,
    }
    log.info("Triggering training: %s", payload)
    result = _post(url, payload, timeout=30)

    job_id = result.get("job_id")
    if not job_id:
        raise RuntimeError(f"Training service did not return a job_id: {result}")

    log.info("Training job queued: job_id=%s  status=%s", job_id, result.get("status"))
    context["ti"].xcom_push(key="job_id", value=job_id)
    context["ti"].xcom_push(key="model_type", value=model_type)


def poll_training(**context) -> None:
    """Poll training job until completed or failed (max 45 min)."""
    job_id = context["ti"].xcom_pull(task_ids="trigger_training", key="job_id")
    if not job_id:
        raise RuntimeError("No job_id found in XCom from trigger_training")

    url = f"{_training_url()}/api/risk/train/status/{job_id}"
    max_wait = 2700   # 45 minutes
    interval = 30     # poll every 30 seconds
    elapsed = 0

    log.info("Polling training job %s (max %ds, interval %ds)", job_id, max_wait, interval)

    while elapsed < max_wait:
        result = _get(url, timeout=30)
        status = result.get("status", "unknown")
        log.info("Job %s: status=%s  elapsed=%ds", job_id, status, elapsed)

        if status == "completed":
            results = result.get("results", [])
            log.info("Training completed — %d model(s) trained:", len(results))
            for r in results:
                log.info(
                    "  %-20s  version=%-8s  VaR=%8.4f  CVaR=%8.4f  status=%s",
                    r.get("model_name", "?"),
                    r.get("model_version", "?"),
                    r.get("var", 0.0),
                    r.get("cvar", 0.0),
                    r.get("status", "?"),
                )
            context["ti"].xcom_push(key="training_results", value=results)
            return

        if status == "failed":
            error = result.get("message", "unknown error")
            raise RuntimeError(f"Training job {job_id} failed: {error}")

        time.sleep(interval)
        elapsed += interval

    raise RuntimeError(f"Training job {job_id} timed out after {max_wait}s")


def evaluate_models(**context) -> None:
    """Fetch the model registry and log the latest registered model versions."""
    url = f"{_training_url()}/api/risk/models"
    try:
        resp = _get(url, timeout=30)
    except Exception as exc:
        log.warning("Could not fetch model registry: %s", exc)
        return

    models = resp.get("models", [])
    total = resp.get("total", len(models))
    log.info("Model registry: %d model(s) registered", total)

    production_models = [m for m in models if m.get("status") == "production"]
    staging_models    = [m for m in models if m.get("status") == "staging"]

    log.info("  Production: %d  |  Staging: %d", len(production_models), len(staging_models))

    for m in models[:10]:   # log up to 10 most recent
        metrics = m.get("metrics") or {}
        log.info(
            "  %-25s  v%-6s  status=%-12s  VaR=%s  CVaR=%s  created=%s",
            m.get("model_name", "?"),
            m.get("model_version", "?"),
            m.get("status", "?"),
            metrics.get("var", "n/a"),
            metrics.get("cvar", "n/a"),
            m.get("created_at", "?"),
        )

    context["ti"].xcom_push(key="production_model_count", value=len(production_models))


def notify_inference(**context) -> None:
    """Check that the Inference Service has picked up the new model.

    The Inference Service listens on the model.trained Kafka topic and
    hot-reloads models automatically. This step just verifies the health
    endpoint reflects the current state.
    """
    url = f"{_inference_url()}/api/risk/predict/health"
    try:
        resp = _get(url, timeout=15)
        loaded = resp.get("loaded_models", [])
        status = resp.get("status", "unknown")
        fallback = resp.get("fallback_available", False)
        log.info(
            "Inference Service: status=%s  loaded_models=%s  fallback=%s",
            status, loaded, fallback,
        )
        if status == "degraded" and not fallback:
            log.warning("Inference Service is degraded and has no fallback — check model loading")
        else:
            log.info("Inference Service is ready to serve predictions")
    except Exception as exc:
        log.warning("Could not reach Inference Service health endpoint: %s", exc)
        # Non-fatal: Kafka hot-reload may still be in progress


# ---------------------------------------------------------------------------
# Default args (shared)
# ---------------------------------------------------------------------------

_default_args = {
    "owner": "riskops",
    "depends_on_past": False,
    "email_on_failure": False,
    "email_on_retry": False,
    "retries": 1,
    "retry_delay": timedelta(minutes=10),
}

# ---------------------------------------------------------------------------
# DAG 1: Scheduled retraining — daily at 22:00 UTC
# (runs after Yahoo ingestion at 21:00 UTC, giving ~1h for data to settle)
# ---------------------------------------------------------------------------

with DAG(
    dag_id="riskops_scheduled_training",
    default_args=_default_args,
    description=(
        "Scheduled daily model retraining at 22:00 UTC. "
        "Runs after Yahoo Finance ingestion (21:00 UTC). "
        "Trains GARCH + Monte Carlo on the full symbol universe."
    ),
    schedule="0 22 * * 1-5",   # weekdays only
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["riskops", "training", "scheduled"],
) as scheduled_dag:

    s_health = PythonOperator(
        task_id="health_check",
        python_callable=health_check,
        execution_timeout=timedelta(minutes=2),
    )

    s_data = PythonOperator(
        task_id="fetch_data_summary",
        python_callable=fetch_data_summary,
        execution_timeout=timedelta(minutes=5),
    )

    s_train = PythonOperator(
        task_id="trigger_training",
        python_callable=trigger_training,
        execution_timeout=timedelta(minutes=5),
    )

    s_poll = PythonOperator(
        task_id="poll_training",
        python_callable=poll_training,
        execution_timeout=timedelta(minutes=50),
    )

    s_eval = PythonOperator(
        task_id="evaluate_models",
        python_callable=evaluate_models,
        execution_timeout=timedelta(minutes=5),
    )

    s_notify = PythonOperator(
        task_id="notify_inference",
        python_callable=notify_inference,
        execution_timeout=timedelta(minutes=2),
    )

    s_health >> s_data >> s_train >> s_poll >> s_eval >> s_notify


# ---------------------------------------------------------------------------
# DAG 2: On-demand retraining — triggered manually
#
# Trigger via Airflow UI: "Trigger DAG w/ config" and pass JSON conf:
#   {"symbols": ["AAPL","MSFT"], "model_type": "garch", "alpha": 0.99}
#
# Or via Airflow REST API:
#   POST /api/v1/dags/riskops_ondemand_training/dagRuns
#   {"conf": {"symbols": ["AAPL","MSFT"], "model_type": "all"}}
# ---------------------------------------------------------------------------

with DAG(
    dag_id="riskops_ondemand_training",
    default_args=_default_args,
    description=(
        "On-demand model retraining. Trigger manually via Airflow UI or REST API. "
        "Accepts conf: {symbols, model_type, alpha, lookback_days, n_simulations}."
    ),
    schedule=None,   # manual trigger only
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=3,   # allow concurrent on-demand runs
    tags=["riskops", "training", "on-demand"],
) as ondemand_dag:

    od_health = PythonOperator(
        task_id="health_check",
        python_callable=health_check,
        execution_timeout=timedelta(minutes=2),
    )

    od_data = PythonOperator(
        task_id="fetch_data_summary",
        python_callable=fetch_data_summary,
        execution_timeout=timedelta(minutes=5),
    )

    od_train = PythonOperator(
        task_id="trigger_training",
        python_callable=trigger_training,
        execution_timeout=timedelta(minutes=5),
    )

    od_poll = PythonOperator(
        task_id="poll_training",
        python_callable=poll_training,
        execution_timeout=timedelta(minutes=50),
    )

    od_eval = PythonOperator(
        task_id="evaluate_models",
        python_callable=evaluate_models,
        execution_timeout=timedelta(minutes=5),
    )

    od_notify = PythonOperator(
        task_id="notify_inference",
        python_callable=notify_inference,
        execution_timeout=timedelta(minutes=2),
    )

    od_health >> od_data >> od_train >> od_poll >> od_eval >> od_notify
