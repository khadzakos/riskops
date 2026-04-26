"""
Orchestrate Market Data Service ingestion via its HTTP API.

Uses ``MARKET_DATA_SERVICE_URL`` (set in docker-compose for Airflow) as the
service base URL, defaulting to ``http://market-data-service:8083``.

DAG schedule:
  - Daily at 22:00 UTC: triggers daily refresh (previous trading day data)
  - On first run / manual trigger: triggers bulk historical ingestion (10 years)

Endpoints used:
  POST /api/market-data/ingest/bulk-historical        — 10-year historical load (async, 202)
  GET  /api/market-data/ingest/bulk-historical/status — poll for completion
  POST /api/market-data/ingest/daily-refresh          — previous trading day (async, 202)
  POST /api/market-data/ingest/all                    — all sources with default symbols
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.python import PythonOperator

_DEFAULT_MDS_URL = "http://market-data-service:8083"
_BULK_POLL_INTERVAL_S = 60   # poll every 60 seconds
_BULK_MAX_WAIT_S = 14400     # max 4 hours for bulk historical


def _base_url() -> str:
    return os.environ.get("MARKET_DATA_SERVICE_URL", _DEFAULT_MDS_URL).rstrip("/")


def _post(url: str, body: dict | None = None, timeout: int = 60) -> dict:
    """POST JSON to url, return parsed response body."""
    data = json.dumps(body or {}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {url} HTTP {e.code}: {detail}") from e


def _get(url: str, timeout: int = 30) -> dict:
    """GET url, return parsed response body."""
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GET {url} HTTP {e.code}: {detail}") from e


# ---------------------------------------------------------------------------
# Task functions
# ---------------------------------------------------------------------------

def check_market_data_health() -> None:
    url = f"{_base_url()}/health"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 200:
            raise RuntimeError(f"health check failed: HTTP {resp.status}")
    print("Market Data Service health check: OK")


def trigger_bulk_historical_ingest() -> None:
    """Trigger 10-year bulk historical ingestion for top 500 US + top 100 RU tickers.

    The endpoint returns 202 immediately; we poll the status endpoint until
    completion or timeout.
    """
    url = f"{_base_url()}/api/market-data/ingest/bulk-historical"
    status_url = f"{_base_url()}/api/market-data/ingest/bulk-historical/status"

    print("Triggering bulk historical ingestion...")
    resp = _post(url, timeout=30)
    print(f"Trigger response: {resp}")

    if resp.get("status") == "already_running":
        print("Bulk ingestion already running — waiting for it to complete...")
    elif resp.get("status") != "accepted":
        raise RuntimeError(f"Unexpected trigger response: {resp}")

    # Poll until complete
    elapsed = 0
    while elapsed < _BULK_MAX_WAIT_S:
        time.sleep(_BULK_POLL_INTERVAL_S)
        elapsed += _BULK_POLL_INTERVAL_S

        status = _get(status_url, timeout=30)
        running = status.get("running", False)
        last_run = status.get("last_run")

        print(f"[{elapsed}s] Bulk ingest status: running={running}, last_run={last_run}")

        if not running and last_run is not None:
            job_status = last_run.get("Status", "unknown")
            total_rows = last_run.get("TotalRowsIngested", 0)
            print(
                f"Bulk historical ingestion complete: status={job_status} "
                f"total_rows={total_rows} "
                f"us_ok={last_run.get('USSymbolsOK', 0)} "
                f"us_failed={last_run.get('USSymbolsFailed', 0)} "
                f"ru_ok={last_run.get('RUSymbolsOK', 0)} "
                f"ru_failed={last_run.get('RUSymbolsFailed', 0)}"
            )
            if job_status == "failed":
                raise RuntimeError(f"Bulk historical ingestion failed: {last_run}")
            return

    raise RuntimeError(
        f"Bulk historical ingestion did not complete within {_BULK_MAX_WAIT_S}s"
    )


def trigger_daily_refresh() -> None:
    """Trigger daily refresh for the previous trading day."""
    url = f"{_base_url()}/api/market-data/ingest/daily-refresh"
    print("Triggering daily refresh...")
    resp = _post(url, timeout=30)
    print(f"Daily refresh triggered: {resp}")
    # Daily refresh is fire-and-forget from the DAG perspective;
    # the service logs completion internally.


def trigger_ingest_all() -> None:
    """Trigger full ingestion across all sources with default symbols."""
    url = f"{_base_url()}/api/market-data/ingest/all"
    body = json.dumps({}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=1200) as resp:
            raw = resp.read().decode("utf-8")
            if resp.status != 200:
                raise RuntimeError(f"ingest/all failed: HTTP {resp.status} body={raw!r}")
            print(f"ingest/all complete: {raw[:500]}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ingest/all HTTP {e.code}: {detail}") from e


# ---------------------------------------------------------------------------
# DAG 1: Daily market data refresh (runs every day at 22:00 UTC)
# ---------------------------------------------------------------------------

default_args = {
    "owner": "riskops",
    "depends_on_past": False,
    "email_on_failure": False,
    "email_on_retry": False,
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
}

with DAG(
    dag_id="riskops_market_data_ingest",
    default_args=default_args,
    description="Daily market data refresh — previous trading day for all symbols in DB",
    schedule="0 22 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["riskops", "market-data", "daily"],
) as daily_dag:
    health_check = PythonOperator(
        task_id="market_data_health",
        python_callable=check_market_data_health,
    )
    daily_refresh = PythonOperator(
        task_id="daily_refresh",
        python_callable=trigger_daily_refresh,
    )
    ingest_all = PythonOperator(
        task_id="ingest_all_sources",
        python_callable=trigger_ingest_all,
    )
    health_check >> daily_refresh >> ingest_all


# ---------------------------------------------------------------------------
# DAG 2: Bulk historical ingestion (manual trigger / one-time on startup)
# ---------------------------------------------------------------------------

with DAG(
    dag_id="riskops_bulk_historical_ingest",
    default_args=default_args,
    description=(
        "One-time bulk historical ingestion: 10 years of data for "
        "top 500 US tickers (Yahoo Finance) + top 100 RU tickers (MOEX). "
        "Run manually on first deployment or after DB reset."
    ),
    schedule=None,  # manual trigger only
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["riskops", "market-data", "bulk", "historical"],
) as bulk_dag:
    bulk_health = PythonOperator(
        task_id="market_data_health",
        python_callable=check_market_data_health,
    )
    bulk_ingest = PythonOperator(
        task_id="bulk_historical_ingest",
        python_callable=trigger_bulk_historical_ingest,
        execution_timeout=timedelta(hours=5),
    )
    bulk_health >> bulk_ingest
