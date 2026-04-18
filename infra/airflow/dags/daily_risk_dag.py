"""
Daily Risk Pipeline DAG — schedule: 06:00 UTC every day.

Pipeline steps (in order):
  1. health_checks          — verify all services are up
  2. ingest_market_data     — POST /api/market-data/ingest/all  (Market Data Service)
  3. train_models           — POST /api/risk/train              (Training Service)
  4. poll_training          — GET  /api/risk/train/status/{id}  (poll until done)
  5. run_inference          — POST /api/risk/predict            (Inference Service, all portfolios)
  6. verify_results         — sanity-check that risk_results rows were written

Environment variables (set in docker-compose for Airflow):
  MARKET_DATA_SERVICE_URL   default: http://market-data-service:8083
  TRAINING_SERVICE_URL      default: http://training-service:8084
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
# Service base URLs
# ---------------------------------------------------------------------------

def _mds_url() -> str:
    return os.environ.get("MARKET_DATA_SERVICE_URL", "http://market-data-service:8083").rstrip("/")

def _training_url() -> str:
    return os.environ.get("TRAINING_SERVICE_URL", "http://training-service:8084").rstrip("/")

def _inference_url() -> str:
    return os.environ.get("INFERENCE_SERVICE_URL", "http://inference-service:8085").rstrip("/")


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _get(url: str, timeout: int = 30) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post(url: str, body: dict[str, Any], timeout: int = 1200) -> dict[str, Any]:
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


def _check_health(url: str, service: str) -> None:
    try:
        resp = _get(f"{url}/health", timeout=15)
        log.info("%s health: %s", service, resp)
    except Exception as exc:
        raise RuntimeError(f"{service} health check failed: {exc}") from exc


# ---------------------------------------------------------------------------
# Task callables
# ---------------------------------------------------------------------------

def health_checks() -> None:
    """Verify all three services respond to /health before starting the pipeline."""
    _check_health(_mds_url(), "market-data-service")
    _check_health(_training_url(), "training-service")
    _check_health(_inference_url(), "inference-service")
    log.info("All service health checks passed.")


def ingest_market_data(**context) -> None:
    """Trigger full ingestion across all configured data sources."""
    url = f"{_mds_url()}/api/market-data/ingest/all"
    log.info("Triggering ingest/all at %s", url)
    result = _post(url, {})
    log.info("Ingest result: %s", result)
    # Push result to XCom so downstream tasks can inspect it
    context["ti"].xcom_push(key="ingest_result", value=result)


def train_models(**context) -> None:
    """Trigger training for all model types (GARCH + Monte Carlo)."""
    url = f"{_training_url()}/api/risk/train"
    payload = {
        "symbols": ["AAPL", "MSFT", "GOOGL", "SBER", "GAZP"],
        "model_type": "all",
        "alpha": 0.99,
        "horizon_days": 1,
        "lookback_days": 252,
        "n_simulations": 10000,
    }
    log.info("Triggering training at %s with payload %s", url, payload)
    result = _post(url, payload, timeout=30)
    job_id = result.get("job_id")
    if not job_id:
        raise RuntimeError(f"Training service did not return a job_id: {result}")
    log.info("Training job queued: job_id=%s", job_id)
    context["ti"].xcom_push(key="training_job_id", value=job_id)


def poll_training(**context) -> None:
    """Poll training job status until completed or failed (max 30 min)."""
    job_id = context["ti"].xcom_pull(task_ids="train_models", key="training_job_id")
    if not job_id:
        raise RuntimeError("No training job_id found in XCom")

    url = f"{_training_url()}/api/risk/train/status/{job_id}"
    max_wait_seconds = 1800  # 30 minutes
    poll_interval = 30       # check every 30 seconds
    elapsed = 0

    while elapsed < max_wait_seconds:
        result = _get(url, timeout=30)
        status = result.get("status", "unknown")
        log.info("Training job %s status: %s (elapsed %ds)", job_id, status, elapsed)

        if status == "completed":
            results = result.get("results", [])
            log.info("Training completed with %d model results", len(results))
            for r in results:
                log.info(
                    "  model=%s  version=%s  VaR=%.4f  CVaR=%.4f  status=%s",
                    r.get("model_name"), r.get("model_version"),
                    r.get("var", 0), r.get("cvar", 0), r.get("status"),
                )
            context["ti"].xcom_push(key="training_results", value=results)
            return

        if status == "failed":
            error = result.get("message", "unknown error")
            raise RuntimeError(f"Training job {job_id} failed: {error}")

        time.sleep(poll_interval)
        elapsed += poll_interval

    raise RuntimeError(f"Training job {job_id} timed out after {max_wait_seconds}s")


def run_inference(**context) -> None:
    """Run risk inference for all active portfolios.

    Fetches portfolio list from the portfolio service (via inference service
    health endpoint to discover available models), then calls predict for each.
    """
    url = f"{_inference_url()}/api/risk/predict"

    # Check which models are loaded
    health = _get(f"{_inference_url()}/api/risk/predict/health", timeout=15)
    loaded_models = health.get("loaded_models", [])
    log.info("Inference service loaded models: %s", loaded_models)

    # Determine best available method
    if "garch" in loaded_models:
        method = "garch"
    elif "montecarlo" in loaded_models:
        method = "montecarlo"
    else:
        method = "historical"
    log.info("Using inference method: %s", method)

    # Fetch active portfolios from portfolio service
    portfolio_service_url = os.environ.get(
        "PORTFOLIO_SERVICE_URL", "http://portfolio-service:8082"
    ).rstrip("/")
    try:
        portfolios_resp = _get(f"{portfolio_service_url}/api/portfolios", timeout=30)
        portfolios = portfolios_resp if isinstance(portfolios_resp, list) else portfolios_resp.get("portfolios", [])
    except Exception as exc:
        log.warning("Could not fetch portfolios: %s — using portfolio_id=1 as fallback", exc)
        portfolios = [{"id": 1}]

    if not portfolios:
        log.warning("No portfolios found, skipping inference")
        return

    results = []
    errors = []
    for portfolio in portfolios:
        pid = portfolio.get("id") or portfolio.get("portfolio_id")
        if pid is None:
            continue
        payload = {
            "portfolio_id": pid,
            "method": method,
            "alpha": 0.99,
            "horizon_days": 1,
        }
        try:
            result = _post(url, payload, timeout=120)
            log.info(
                "Portfolio %d: VaR=%.4f  CVaR=%.4f  vol=%.4f  method=%s",
                pid, result.get("var", 0), result.get("cvar", 0),
                result.get("volatility", 0), result.get("method"),
            )
            results.append(result)
        except Exception as exc:
            log.error("Inference failed for portfolio %d: %s", pid, exc)
            errors.append({"portfolio_id": pid, "error": str(exc)})

    log.info("Inference complete: %d succeeded, %d failed", len(results), len(errors))
    context["ti"].xcom_push(key="inference_results", value=results)
    context["ti"].xcom_push(key="inference_errors", value=errors)

    if errors and not results:
        raise RuntimeError(f"All inference calls failed: {errors}")


def verify_results(**context) -> None:
    """Sanity-check: confirm inference results were produced and log a summary."""
    results = context["ti"].xcom_pull(task_ids="run_inference", key="inference_results") or []
    errors = context["ti"].xcom_pull(task_ids="run_inference", key="inference_errors") or []

    log.info("=== Daily Risk Pipeline Summary ===")
    log.info("Portfolios processed: %d", len(results))
    log.info("Portfolios failed:    %d", len(errors))

    for r in results:
        log.info(
            "  portfolio_id=%-4d  method=%-12s  VaR=%8.4f  CVaR=%8.4f  vol=%8.4f",
            r.get("portfolio_id"), r.get("method"),
            r.get("var", 0), r.get("cvar", 0), r.get("volatility", 0),
        )

    if errors:
        log.warning("Failed portfolios: %s", errors)

    if not results:
        raise RuntimeError("No risk results were produced — pipeline may have failed silently")

    log.info("=== Pipeline completed successfully ===")


# ---------------------------------------------------------------------------
# DAG definition
# ---------------------------------------------------------------------------

default_args = {
    "owner": "riskops",
    "depends_on_past": False,
    "email_on_failure": False,
    "email_on_retry": False,
    "retries": 1,
    "retry_delay": timedelta(minutes=10),
}

with DAG(
    dag_id="riskops_daily_risk_pipeline",
    default_args=default_args,
    description=(
        "Daily risk pipeline: ingest market data → train models → "
        "run inference → verify results. Runs at 06:00 UTC."
    ),
    schedule="0 6 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["riskops", "daily", "risk-pipeline"],
) as dag:

    t_health = PythonOperator(
        task_id="health_checks",
        python_callable=health_checks,
        execution_timeout=timedelta(minutes=2),
    )

    t_ingest = PythonOperator(
        task_id="ingest_market_data",
        python_callable=ingest_market_data,
        execution_timeout=timedelta(minutes=30),
    )

    t_train = PythonOperator(
        task_id="train_models",
        python_callable=train_models,
        execution_timeout=timedelta(minutes=5),
    )

    t_poll = PythonOperator(
        task_id="poll_training",
        python_callable=poll_training,
        execution_timeout=timedelta(minutes=35),
    )

    t_infer = PythonOperator(
        task_id="run_inference",
        python_callable=run_inference,
        execution_timeout=timedelta(minutes=15),
    )

    t_verify = PythonOperator(
        task_id="verify_results",
        python_callable=verify_results,
        execution_timeout=timedelta(minutes=2),
    )

    # Pipeline: health → ingest → train → poll → infer → verify
    t_health >> t_ingest >> t_train >> t_poll >> t_infer >> t_verify
