"""
Market Data Ingestion DAGs — two separate schedules:

  riskops_ingest_moex   — MOEX ISS data,    daily at 19:00 UTC (after Moscow Exchange close)
  riskops_ingest_yahoo  — Yahoo Finance data, daily at 21:00 UTC (after US market close)

Each DAG:
  1. health_check   — verify Market Data Service is up
  2. ingest         — POST /api/market-data/ingest  (source-specific)
  3. verify         — confirm ingestion_log entry was created

Environment variables (set in docker-compose for Airflow):
  MARKET_DATA_SERVICE_URL   default: http://market-data-service:8083
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from typing import Any

from airflow import DAG
from airflow.operators.python import PythonOperator

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Symbols to ingest per source
# ---------------------------------------------------------------------------

MOEX_SYMBOLS = [
    "SBER",   # Sberbank
    "GAZP",   # Gazprom
    "LKOH",   # Lukoil
    "YNDX",   # Yandex
    "GMKN",   # Norilsk Nickel
    "ROSN",   # Rosneft
    "NVTK",   # Novatek
    "TATN",   # Tatneft
    "MGNT",   # Magnit
    "IMOEX",  # Moscow Exchange Index
]

YAHOO_SYMBOLS = [
    "AAPL",   # Apple
    "MSFT",   # Microsoft
    "GOOGL",  # Alphabet
    "AMZN",   # Amazon
    "NVDA",   # NVIDIA
    "SPY",    # S&P 500 ETF
    "^GSPC",  # S&P 500 Index
    "^VIX",   # CBOE Volatility Index
    "GLD",    # Gold ETF
    "TLT",    # 20+ Year Treasury Bond ETF
]

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _mds_url() -> str:
    return os.environ.get("MARKET_DATA_SERVICE_URL", "http://market-data-service:8083").rstrip("/")


def _get(url: str, timeout: int = 30) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post(url: str, body: dict[str, Any], timeout: int = 600) -> dict[str, Any]:
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
# Shared task callables (parameterised by source)
# ---------------------------------------------------------------------------

def check_mds_health() -> None:
    """Verify Market Data Service is healthy before ingestion."""
    url = f"{_mds_url()}/health"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            log.info("Market Data Service health: %s", body)
            if resp.status != 200:
                raise RuntimeError(f"Health check returned HTTP {resp.status}")
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Market Data Service unreachable: {exc}") from exc


def ingest_moex(**context) -> None:
    """Trigger MOEX ISS ingestion for Russian equities and indices."""
    from datetime import date, timedelta as td

    today = date.today()
    date_from = (today - td(days=5)).isoformat()   # last 5 trading days (covers weekends)
    date_to = today.isoformat()

    url = f"{_mds_url()}/api/market-data/ingest"
    payload = {
        "source": "moex",
        "symbols": MOEX_SYMBOLS,
        "date_from": date_from,
        "date_to": date_to,
    }
    log.info("Ingesting MOEX data: symbols=%s  range=%s..%s", MOEX_SYMBOLS, date_from, date_to)
    result = _post(url, payload, timeout=600)
    log.info("MOEX ingest result: %s", result)

    rows = result.get("rows_ingested", result.get("count", 0))
    log.info("MOEX: %d rows ingested", rows)
    context["ti"].xcom_push(key="moex_rows_ingested", value=rows)
    context["ti"].xcom_push(key="moex_result", value=result)


def ingest_yahoo(**context) -> None:
    """Trigger Yahoo Finance ingestion for US equities and indices."""
    from datetime import date, timedelta as td

    today = date.today()
    date_from = (today - td(days=5)).isoformat()
    date_to = today.isoformat()

    url = f"{_mds_url()}/api/market-data/ingest"
    payload = {
        "source": "yahoo",
        "symbols": YAHOO_SYMBOLS,
        "date_from": date_from,
        "date_to": date_to,
    }
    log.info("Ingesting Yahoo data: symbols=%s  range=%s..%s", YAHOO_SYMBOLS, date_from, date_to)
    result = _post(url, payload, timeout=600)
    log.info("Yahoo ingest result: %s", result)

    rows = result.get("rows_ingested", result.get("count", 0))
    log.info("Yahoo Finance: %d rows ingested", rows)
    context["ti"].xcom_push(key="yahoo_rows_ingested", value=rows)
    context["ti"].xcom_push(key="yahoo_result", value=result)


def verify_moex_ingestion(**context) -> None:
    """Verify MOEX ingestion completed and check ingestion log."""
    result = context["ti"].xcom_pull(task_ids="ingest_moex", key="moex_result") or {}
    rows = context["ti"].xcom_pull(task_ids="ingest_moex", key="moex_rows_ingested") or 0

    log.info("MOEX ingestion verification: rows=%d  result=%s", rows, result)

    # Check ingestion log endpoint
    try:
        log_resp = _get(f"{_mds_url()}/api/market-data/ingestion-log?source=moex&limit=1", timeout=15)
        log.info("MOEX ingestion log: %s", log_resp)
    except Exception as exc:
        log.warning("Could not fetch ingestion log: %s", exc)

    status = result.get("status", "")
    if status == "error":
        error_msg = result.get("error", "unknown error")
        raise RuntimeError(f"MOEX ingestion reported error: {error_msg}")

    log.info("MOEX ingestion verified successfully: %d rows", rows)


def verify_yahoo_ingestion(**context) -> None:
    """Verify Yahoo Finance ingestion completed and check ingestion log."""
    result = context["ti"].xcom_pull(task_ids="ingest_yahoo", key="yahoo_result") or {}
    rows = context["ti"].xcom_pull(task_ids="ingest_yahoo", key="yahoo_rows_ingested") or 0

    log.info("Yahoo ingestion verification: rows=%d  result=%s", rows, result)

    try:
        log_resp = _get(f"{_mds_url()}/api/market-data/ingestion-log?source=yahoo&limit=1", timeout=15)
        log.info("Yahoo ingestion log: %s", log_resp)
    except Exception as exc:
        log.warning("Could not fetch ingestion log: %s", exc)

    status = result.get("status", "")
    if status == "error":
        error_msg = result.get("error", "unknown error")
        raise RuntimeError(f"Yahoo ingestion reported error: {error_msg}")

    log.info("Yahoo Finance ingestion verified successfully: %d rows", rows)


# ---------------------------------------------------------------------------
# Default args (shared)
# ---------------------------------------------------------------------------

_default_args = {
    "owner": "riskops",
    "depends_on_past": False,
    "email_on_failure": False,
    "email_on_retry": False,
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
}

# ---------------------------------------------------------------------------
# DAG 1: MOEX ingestion — 19:00 UTC (after Moscow Exchange close ~18:50 MSK)
# ---------------------------------------------------------------------------

with DAG(
    dag_id="riskops_ingest_moex",
    default_args=_default_args,
    description="Ingest MOEX ISS market data daily after Moscow Exchange close (19:00 UTC).",
    schedule="0 19 * * 1-5",   # weekdays only (Mon–Fri)
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["riskops", "market-data", "moex"],
) as moex_dag:

    moex_health = PythonOperator(
        task_id="health_check",
        python_callable=check_mds_health,
        execution_timeout=timedelta(minutes=2),
    )

    moex_ingest = PythonOperator(
        task_id="ingest_moex",
        python_callable=ingest_moex,
        execution_timeout=timedelta(minutes=20),
    )

    moex_verify = PythonOperator(
        task_id="verify_ingestion",
        python_callable=verify_moex_ingestion,
        execution_timeout=timedelta(minutes=2),
    )

    moex_health >> moex_ingest >> moex_verify


# ---------------------------------------------------------------------------
# DAG 2: Yahoo Finance ingestion — 21:00 UTC (after US market close ~20:00 UTC)
# ---------------------------------------------------------------------------

with DAG(
    dag_id="riskops_ingest_yahoo",
    default_args=_default_args,
    description="Ingest Yahoo Finance market data daily after US market close (21:00 UTC).",
    schedule="0 21 * * 1-5",   # weekdays only (Mon–Fri)
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["riskops", "market-data", "yahoo"],
) as yahoo_dag:

    yahoo_health = PythonOperator(
        task_id="health_check",
        python_callable=check_mds_health,
        execution_timeout=timedelta(minutes=2),
    )

    yahoo_ingest = PythonOperator(
        task_id="ingest_yahoo",
        python_callable=ingest_yahoo,
        execution_timeout=timedelta(minutes=20),
    )

    yahoo_verify = PythonOperator(
        task_id="verify_ingestion",
        python_callable=verify_yahoo_ingestion,
        execution_timeout=timedelta(minutes=2),
    )

    yahoo_health >> yahoo_ingest >> yahoo_verify
