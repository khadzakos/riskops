"""FastAPI routes for the Training Service.

Endpoints:
  POST /api/risk/train              — trigger model training (async background task)
  GET  /api/risk/train/status/{id}  — get training run status from MLflow
  GET  /api/risk/models             — list registered models from MLflow + model_registry
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

import mlflow
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from ..config import get_settings
from ..pipelines.train import TrainRequest, TrainResult, run_training

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/risk")

# Thread pool for background training (keeps FastAPI responsive)
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="trainer")

# In-memory job registry (run_id → status dict).
# In production this would be backed by Redis or Postgres.
_jobs: dict[str, dict[str, Any]] = {}


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
    """Runs in a thread pool. Updates _jobs dict with progress."""
    _jobs[job_id] = {"status": "running", "results": []}
    try:
        results = run_training(req)
        _jobs[job_id] = {
            "status": "completed",
            "results": [
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
            ],
        }
        logger.info("Training job %s completed with %d results", job_id, len(results))
    except Exception as exc:
        logger.exception("Training job %s failed: %s", job_id, exc)
        _jobs[job_id] = {"status": "failed", "error": str(exc), "results": []}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/train", response_model=TrainResponse, status_code=202)
async def trigger_training(body: TrainRequestBody, background_tasks: BackgroundTasks) -> TrainResponse:
    """Trigger model training asynchronously.

    Returns immediately with a job_id. Poll GET /api/risk/train/status/{job_id}
    to check progress.
    """
    cfg = get_settings()

    req = TrainRequest(
        symbols=body.symbols,
        model_type=body.model_type,
        alpha=body.alpha,
        horizon_days=body.horizon_days,
        lookback_days=body.lookback_days,
        weights=body.weights,
        n_simulations=body.n_simulations,
    )

    # Generate a job ID (will be replaced by actual run_id once training starts)
    import uuid
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "queued", "results": []}

    # Submit to thread pool (non-blocking)
    background_tasks.add_task(_training_worker, job_id, req)

    logger.info("Queued training job %s: model_type=%s symbols=%s", job_id, body.model_type, body.symbols)

    return TrainResponse(
        job_id=job_id,
        status="queued",
        message=f"Training job {job_id} queued. Use GET /api/risk/train/status/{job_id} to poll.",
    )


@router.get("/train/status/{job_id}", response_model=TrainResponse)
async def get_training_status(job_id: str) -> TrainResponse:
    """Get the status of a training job by its job_id."""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return TrainResponse(
        job_id=job_id,
        status=job.get("status", "unknown"),
        message=job.get("error", ""),
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
    from sqlalchemy import text
    from ..db import get_engine

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
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
