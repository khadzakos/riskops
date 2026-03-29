"""
Orchestrate Market Data Service ingestion via its HTTP API.

Uses ``MARKET_DATA_SERVICE_URL`` (set in docker-compose for Airflow) as the
service base URL, defaulting to ``http://market-data-service:8083``.

Calls ``POST /api/market-data/ingest/all`` to run all registered collectors
(yahoo, moex, synthetic, credit_synthetic) with their default symbols.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.python import PythonOperator

_DEFAULT_MDS_URL = "http://market-data-service:8083"


def _base_url() -> str:
    return os.environ.get("MARKET_DATA_SERVICE_URL", _DEFAULT_MDS_URL).rstrip("/")


def check_market_data_health() -> None:
    url = f"{_base_url()}/health"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 200:
            raise RuntimeError(f"health check failed: HTTP {resp.status}")


def trigger_ingest_all() -> None:
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
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ingest/all HTTP {e.code}: {detail}") from e


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
    description="Trigger Market Data Service bulk ingestion (all sources)",
    schedule="0 22 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["riskops", "market-data"],
) as dag:
    health = PythonOperator(
        task_id="market_data_health",
        python_callable=check_market_data_health,
    )
    ingest = PythonOperator(
        task_id="ingest_all_sources",
        python_callable=trigger_ingest_all,
    )
    health >> ingest
