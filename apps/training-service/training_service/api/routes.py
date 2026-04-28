"""FastAPI routes for the Training Service.

Endpoints:
  POST /api/risk/train              — trigger model training (async background task)
  GET  /api/risk/train/status/{id}  — get training run status from Postgres training_jobs
  GET  /api/risk/train/run/{run_id} — get MLflow run details by run_id
  GET  /api/risk/models             — list registered models from model_registry
  POST /api/risk/backtest           — run rolling window out-of-sample VaR backtest
"""
from __future__ import annotations

import json
import logging
import math
import time
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import mlflow
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..backtesting import (
    BacktestReport,
    build_report,
    log_backtest_to_mlflow,
    run_rolling_backtest,
)
from ..config import get_settings
from ..db import get_engine
from ..pipelines.train import TrainRequest, TrainResult, load_returns, build_portfolio_returns, run_training

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/risk")

# Thread pool for background training (keeps FastAPI responsive)
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="trainer")


# ---------------------------------------------------------------------------
# Market-data auto-ingest helper
# ---------------------------------------------------------------------------

def _trigger_market_data_ingest(symbols: list[str], total_needed: int = 312) -> bool:
    """POST to market-data-service to ingest historical data for *symbols*.

    Calls the per-symbol ingest endpoint for each symbol with a date_from that
    covers *total_needed* trading days (×1.5 calendar-day buffer for weekends /
    holidays).  Returns True if at least one call succeeded (HTTP 2xx), False on
    any network / timeout error.  Failures are non-fatal — the caller will
    re-check data availability and raise 422 if still insufficient.
    """
    cfg = get_settings()
    market_data_url = getattr(cfg, "market_data_service_url", "http://market-data-service:8083")

    # Convert trading days to calendar days with a 1.5× buffer (weekends + holidays)
    calendar_days = math.ceil(total_needed * 1.5)
    date_from = (datetime.now(tz=timezone.utc) - timedelta(days=calendar_days)).strftime("%Y-%m-%d")

    succeeded = False
    for symbol in symbols:
        url = f"{market_data_url}/api/market-data/ingest"
        body = json.dumps({
            "source": "yahoo",
            "symbols": [symbol],
            "date_from": date_from,
        }).encode()
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                if resp.status < 300:
                    succeeded = True
                    logger.info(
                        "Auto-ingest triggered for %s (date_from=%s) → HTTP %d",
                        symbol, date_from, resp.status,
                    )
        except Exception as exc:
            logger.warning("Auto-ingest request failed for %s: %s", symbol, exc)
    # Give the ingest pipeline a moment to write rows before we re-query
    if succeeded:
        time.sleep(2)
    return succeeded


# ---------------------------------------------------------------------------
# Postgres job state helpers
# ---------------------------------------------------------------------------

def _job_create(job_id: str, req: TrainRequest) -> None:
    """Insert a new training job row in Postgres (status=queued)."""
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO training_jobs
                    (job_id, status, model_type, symbols, alpha, horizon_days,
                     lookback_days, n_simulations, created_at, updated_at)
                VALUES
                    (:job_id, 'queued', :model_type, :symbols, :alpha,
                     :horizon_days, :lookback_days, :n_simulations,
                     NOW(), NOW())
                """
            ),
            {
                "job_id": job_id,
                "model_type": req.model_type,
                "symbols": req.symbols,
                "alpha": req.alpha,
                "horizon_days": req.horizon_days,
                "lookback_days": req.lookback_days,
                "n_simulations": req.n_simulations,
            },
        )


def _job_set_running(job_id: str) -> None:
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE training_jobs SET status='running', updated_at=NOW() WHERE job_id=:job_id"
            ),
            {"job_id": job_id},
        )


def _job_set_completed(job_id: str, results: list[dict]) -> None:
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE training_jobs
                SET status='completed', results=cast(:results as jsonb), updated_at=NOW()
                WHERE job_id=:job_id
                """
            ),
            {"job_id": job_id, "results": json.dumps(results)},
        )


def _job_set_failed(job_id: str, error: str) -> None:
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE training_jobs
                SET status='failed', error=:error, updated_at=NOW()
                WHERE job_id=:job_id
                """
            ),
            {"job_id": job_id, "error": error},
        )


def _job_get(job_id: str) -> Optional[dict[str, Any]]:
    """Fetch a job row from Postgres. Returns None if not found."""
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT job_id, status, model_type, results, error, created_at, updated_at
                FROM training_jobs
                WHERE job_id = :job_id
                """
            ),
            {"job_id": job_id},
        ).fetchone()
    if row is None:
        return None
    return {
        "job_id": row[0],
        "status": row[1],
        "model_type": row[2],
        "results": row[3],   # already a dict/list from JSONB
        "error": row[4],
        "created_at": str(row[5]),
        "updated_at": str(row[6]),
    }


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class TrainRequestBody(BaseModel):
    symbols: list[str] = Field(
        default=["AAPL", "MSFT"],
        description="List of ticker symbols to train on",
        min_length=1,
    )
    model_type: str = Field(
        default="all",
        description="Model type: garch | montecarlo | all",
        pattern="^(garch|montecarlo|all)$",
    )
    alpha: float = Field(default=0.99, ge=0.9, le=0.9999, description="VaR confidence level")
    horizon_days: int = Field(default=1, ge=1, le=30, description="Forecast horizon in days")
    lookback_days: int = Field(default=252, ge=30, le=2520, description="Historical lookback window")
    weights: Optional[dict[str, float]] = Field(
        default=None,
        description="Portfolio weights per symbol. If None, equal weights are used.",
    )
    n_simulations: int = Field(
        default=10_000, ge=1_000, le=100_000,
        description="Number of Monte Carlo simulations",
    )


class TrainResponse(BaseModel):
    job_id: str
    status: str
    message: str
    results: Optional[list[dict]] = None


class ModelInfo(BaseModel):
    model_name: str
    model_version: str
    mlflow_run_id: Optional[str]
    status: str
    metrics: Optional[dict]
    created_at: Optional[str]


class ModelsResponse(BaseModel):
    models: list[ModelInfo]
    total: int


class RunStatusResponse(BaseModel):
    run_id: str
    status: str
    metrics: Optional[dict] = None
    params: Optional[dict] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Backtest request / response schemas
# ---------------------------------------------------------------------------

class BacktestRequestBody(BaseModel):
    symbols: list[str] = Field(
        default=["AAPL", "MSFT"],
        description="List of ticker symbols to backtest",
        min_length=1,
    )
    model_type: str = Field(
        default="garch",
        description="Model type: garch | montecarlo | historical",
        pattern="^(garch|montecarlo|historical)$",
    )
    alpha: float = Field(default=0.99, ge=0.9, le=0.9999, description="VaR confidence level")
    lookback_days: int = Field(
        default=252, ge=30, le=2520,
        description="Rolling training window size (days)",
    )
    test_days: int = Field(
        default=60, ge=10, le=504,
        description="Number of out-of-sample days to evaluate",
    )
    horizon_days: int = Field(
        default=1, ge=1, le=30,
        description="VaR forecast horizon (days)",
    )
    n_simulations: int = Field(
        default=1_000, ge=100, le=10_000,
        description="Monte Carlo simulations per rolling step (only for montecarlo)",
    )
    weights: Optional[dict[str, float]] = Field(
        default=None,
        description="Portfolio weights per symbol. If None, equal weights are used.",
    )
    mlflow_run_id: Optional[str] = Field(
        default=None,
        description="Existing MLflow run_id to append backtest metrics to. "
                    "If None, a standalone run is created in riskops-backtest experiment.",
    )
    log_to_mlflow: bool = Field(
        default=True,
        description="Whether to log backtest results to MLflow.",
    )


class BacktestResponse(BaseModel):
    # Coverage
    violations: int
    total_obs: int
    violation_rate: float
    expected_rate: float
    # Kupiec UC test
    kupiec_lr: float
    kupiec_pvalue: float
    # Christoffersen CC test
    christoffersen_lr_ind: float
    christoffersen_lr_cc: float
    christoffersen_pvalue_ind: float
    christoffersen_pvalue_cc: float
    # Transition probabilities
    pi_01: float
    pi_11: float
    # Decision
    status: str   # OK | WARN | CRIT
    # Metadata
    model_type: str
    alpha: float
    lookback_days: int
    test_days: int
    mlflow_run_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Background training worker
# ---------------------------------------------------------------------------

def _training_worker(job_id: str, req: TrainRequest) -> None:
    """Runs in a thread pool. Persists progress to Postgres training_jobs table."""
    _job_set_running(job_id)
    try:
        results = run_training(req)
        serialised = [
            {
                "run_id": r.run_id,
                "model_type": r.model_type,
                "model_name": r.model_name,
                "model_version": r.model_version,
                "var": r.var,
                "cvar": r.cvar,
                "volatility": r.volatility,
                "status": r.status,
                "error": r.error,
            }
            for r in results
        ]
        _job_set_completed(job_id, serialised)
        logger.info("Training job %s completed with %d results", job_id, len(results))
    except Exception as exc:
        logger.exception("Training job %s failed: %s", job_id, exc)
        _job_set_failed(job_id, str(exc))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/train", response_model=TrainResponse, status_code=202)
async def trigger_training(body: TrainRequestBody, background_tasks: BackgroundTasks) -> TrainResponse:
    """Trigger model training asynchronously.

    Returns immediately with a job_id. Poll GET /api/risk/train/status/{job_id}
    to check progress. Job state is persisted in Postgres — survives restarts.
    """
    req = TrainRequest(
        symbols=body.symbols,
        model_type=body.model_type,
        alpha=body.alpha,
        horizon_days=body.horizon_days,
        lookback_days=body.lookback_days,
        weights=body.weights,
        n_simulations=body.n_simulations,
    )

    job_id = str(uuid.uuid4())

    # Persist job row before starting the background task
    _job_create(job_id, req)

    # Submit to thread pool (non-blocking)
    background_tasks.add_task(_training_worker, job_id, req)

    logger.info(
        "Queued training job %s: model_type=%s symbols=%s",
        job_id, body.model_type, body.symbols,
    )

    return TrainResponse(
        job_id=job_id,
        status="queued",
        message=f"Training job {job_id} queued. Use GET /api/risk/train/status/{job_id} to poll.",
    )


@router.get("/train/status/{job_id}", response_model=TrainResponse)
async def get_training_status(job_id: str) -> TrainResponse:
    """Get the status of a training job by its job_id (read from Postgres)."""
    job = _job_get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return TrainResponse(
        job_id=job_id,
        status=job["status"],
        message=job.get("error") or "",
        results=job.get("results"),
    )


@router.get("/train/run/{run_id}", response_model=RunStatusResponse)
async def get_run_status(run_id: str) -> RunStatusResponse:
    """Get MLflow run details by run_id."""
    cfg = get_settings()
    mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)

    try:
        client = mlflow.tracking.MlflowClient()
        run = client.get_run(run_id)
    except mlflow.exceptions.MlflowException as exc:
        raise HTTPException(status_code=404, detail=f"MLflow run {run_id} not found: {exc}") from exc

    info = run.info
    start_ms = info.start_time
    end_ms = info.end_time

    return RunStatusResponse(
        run_id=run_id,
        status=info.status,
        metrics=dict(run.data.metrics),
        params=dict(run.data.params),
        start_time=_ms_to_iso(start_ms) if start_ms else None,
        end_time=_ms_to_iso(end_ms) if end_ms else None,
    )


@router.get("/models", response_model=ModelsResponse)
async def list_models() -> ModelsResponse:
    """List all registered models from the Postgres model_registry table."""
    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT model_name, model_version, mlflow_run_id, status, metrics, created_at
                FROM model_registry
                ORDER BY created_at DESC
                LIMIT 100
                """
            )
        ).fetchall()

    models = [
        ModelInfo(
            model_name=row[0],
            model_version=row[1],
            mlflow_run_id=row[2],
            status=row[3],
            metrics=row[4],
            created_at=str(row[5]) if row[5] else None,
        )
        for row in rows
    ]

    return ModelsResponse(models=models, total=len(models))


@router.post("/backtest", response_model=BacktestResponse)
async def run_backtest(body: BacktestRequestBody) -> BacktestResponse:
    """Run a rolling window out-of-sample VaR backtest.

    Loads historical returns from Postgres, builds a portfolio return series,
    then evaluates VaR predictions day-by-day on an out-of-sample window.
    Applies Kupiec (unconditional coverage) and Christoffersen (conditional
    coverage) statistical tests to assess model calibration.

    This endpoint is **synchronous** — it blocks until the backtest completes.
    For large test_days or montecarlo model_type, expect 5–30 seconds.

    Returns a BacktestResponse with violation counts, p-values, and a status
    classification: OK / WARN / CRIT.
    """
    logger.info(
        "Backtest request: model=%s  symbols=%s  alpha=%.4f  lookback=%d  test=%d",
        body.model_type, body.symbols, body.alpha, body.lookback_days, body.test_days,
    )

    # --- Load data (with auto-ingest fallback) ---
    total_needed = body.lookback_days + body.test_days

    try:
        returns_df = load_returns(body.symbols, lookback_days=total_needed)
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    port_rets = build_portfolio_returns(returns_df, weights=body.weights)

    if len(port_rets) < total_needed:
        logger.info(
            "Insufficient data for backtest (%d < %d). Triggering auto-ingest for %s.",
            len(port_rets), total_needed, body.symbols,
        )
        _trigger_market_data_ingest(body.symbols, total_needed=total_needed)

        # Reload after ingest
        try:
            returns_df = load_returns(body.symbols, lookback_days=total_needed)
        except RuntimeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        port_rets = build_portfolio_returns(returns_df, weights=body.weights)

    if len(port_rets) < total_needed:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Insufficient data: need {total_needed} observations "
                f"(lookback={body.lookback_days} + test={body.test_days}), "
                f"got {len(port_rets)}. Ingest more market data first."
            ),
        )

    # --- Run rolling backtest ---
    try:
        result = run_rolling_backtest(
            returns=port_rets,
            model_type=body.model_type,  # type: ignore[arg-type]
            alpha=body.alpha,
            lookback_days=body.lookback_days,
            test_days=body.test_days,
            horizon_days=body.horizon_days,
            n_simulations=body.n_simulations,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Backtest failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Backtest failed: {exc}") from exc

    # --- Build report ---
    report = build_report(result, symbols=body.symbols, mlflow_run_id=body.mlflow_run_id)

    # --- Optionally log to MLflow ---
    used_run_id: Optional[str] = None
    if body.log_to_mlflow:
        cfg = get_settings()
        import mlflow as _mlflow
        _mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
        try:
            used_run_id = log_backtest_to_mlflow(
                report=report,
                result=result,
                symbol=",".join(body.symbols),
                run_id=body.mlflow_run_id,
            )
        except Exception as exc:
            # MLflow logging failure must not break the API response
            logger.warning("MLflow logging failed (non-fatal): %s", exc)

    # --- Build response ---
    kupiec = result.kupiec
    cc = result.christoffersen

    return BacktestResponse(
        violations=result.violations,
        total_obs=result.total_obs,
        violation_rate=result.violation_rate,
        expected_rate=result.expected_rate,
        kupiec_lr=kupiec.lr_statistic if kupiec else float("nan"),
        kupiec_pvalue=kupiec.p_value if kupiec else float("nan"),
        christoffersen_lr_ind=cc.lr_ind if cc else float("nan"),
        christoffersen_lr_cc=cc.lr_cc if cc else float("nan"),
        christoffersen_pvalue_ind=cc.p_value_ind if cc else float("nan"),
        christoffersen_pvalue_cc=cc.p_value_cc if cc else float("nan"),
        pi_01=cc.pi_01 if cc else float("nan"),
        pi_11=cc.pi_11 if cc else float("nan"),
        status=result.status,
        model_type=result.model_type,
        alpha=result.alpha,
        lookback_days=result.lookback_days,
        test_days=result.test_days,
        mlflow_run_id=used_run_id,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ms_to_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
