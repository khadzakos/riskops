"""FastAPI routes for the Training Service.

Endpoints:
  POST /api/risk/train              — trigger model training (async background task)
  GET  /api/risk/train/status/{id}  — get training run status from Postgres training_jobs
  GET  /api/risk/train/run/{run_id} — get MLflow run details by run_id
  GET  /api/risk/models             — list registered models from model_registry
"""
from __future__ import annotations

import json
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Optional

import mlflow
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..config import get_settings
from ..db import get_engine
from ..pipelines.train import TrainRequest, TrainResult, run_training

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/risk")

# Thread pool for background training (keeps FastAPI responsive)
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="trainer")


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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ms_to_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
