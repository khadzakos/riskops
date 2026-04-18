"""FastAPI routes for the Inference Service.

Endpoints:
  POST /api/risk/predict          — compute risk metrics for a portfolio
  GET  /api/risk/predict/health   — model health check (which models are loaded)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..config import get_settings
from ..db import get_engine
from ..models.loader import get_registry
from ..models.predictor import PredictionResult, predict

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class PredictRequest(BaseModel):
    portfolio_id: int = Field(..., description="Portfolio ID to compute risk for")
    method: Literal["historical", "garch", "montecarlo"] = Field(
        "garch",
        description="Prediction method: historical | garch | montecarlo",
    )
    alpha: float = Field(
        0.99,
        ge=0.5,
        le=0.9999,
        description="VaR confidence level (e.g. 0.99 = 99%)",
    )
    horizon_days: int = Field(
        1,
        ge=1,
        le=252,
        description="Forecast horizon in trading days",
    )


class PredictResponse(BaseModel):
    portfolio_id: int
    asof_date: str
    method: str
    alpha: float
    horizon_days: int
    var: float
    cvar: float
    volatility: float
    max_drawdown: Optional[float] = None
    sharpe_ratio: Optional[float] = None
    sortino_ratio: Optional[float] = None
    beta_to_benchmark: Optional[float] = None
    model_version: str
    computed_at: str


class ModelHealthResponse(BaseModel):
    status: str
    loaded_models: list[str]
    fallback_available: bool


# ---------------------------------------------------------------------------
# DB persistence
# ---------------------------------------------------------------------------

def _store_risk_results(result: PredictionResult) -> None:
    """Persist VaR, CVaR, volatility and additional risk metrics into the risk_results table."""
    engine = get_engine()
    candidate_rows = [
        ("var",          result.var),
        ("cvar",         result.cvar),
        ("volatility",   result.volatility),
        ("max_drawdown", result.max_drawdown),
        ("sharpe_ratio", result.sharpe_ratio),
        ("sortino_ratio",result.sortino_ratio),
    ]
    # Filter out metrics that were not computed (None values)
    rows = [(metric, value) for metric, value in candidate_rows if value is not None]
    with engine.begin() as conn:
        for metric, value in rows:
            conn.execute(
                text(
                    """
                    INSERT INTO risk_results
                        (portfolio_id, asof_date, horizon_days, alpha, method, metric, value, model_version)
                    VALUES
                        (:portfolio_id, :asof_date, :horizon_days, :alpha, :method, :metric, :value, :model_version)
                    """
                ),
                {
                    "portfolio_id": result.portfolio_id,
                    "asof_date": result.asof_date.isoformat(),
                    "horizon_days": result.horizon_days,
                    "alpha": result.alpha,
                    "method": result.method,
                    "metric": metric,
                    "value": value,
                    "model_version": result.model_version,
                },
            )
    logger.info(
        "Stored risk results: portfolio=%d  method=%s  VaR=%.6f  CVaR=%.6f  metrics=%s",
        result.portfolio_id, result.method, result.var, result.cvar,
        [m for m, _ in rows],
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/api/risk/predict", response_model=PredictResponse)
async def predict_risk(req: PredictRequest) -> PredictResponse:
    """Compute VaR, CVaR, and volatility for a portfolio.

    Uses the loaded ML model (GARCH or Monte Carlo) if available,
    falls back to historical simulation otherwise.
    """
    cfg = get_settings()
    registry = get_registry()

    try:
        result: PredictionResult = predict(
            portfolio_id=req.portfolio_id,
            method=req.method,
            registry=registry,
            alpha=req.alpha,
            horizon_days=req.horizon_days,
            lookback_days=cfg.default_lookback_days,
            n_simulations=cfg.monte_carlo_simulations,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during prediction: %s", exc)
        raise HTTPException(status_code=500, detail="Internal prediction error") from exc

    # Persist to DB (non-blocking — log error but don't fail the request)
    try:
        _store_risk_results(result)
    except Exception as exc:
        logger.error("Failed to store risk results in DB: %s", exc)

    return PredictResponse(
        portfolio_id=result.portfolio_id,
        asof_date=result.asof_date.isoformat(),
        method=result.method,
        alpha=result.alpha,
        horizon_days=result.horizon_days,
        var=result.var,
        cvar=result.cvar,
        volatility=result.volatility,
        max_drawdown=result.max_drawdown,
        sharpe_ratio=result.sharpe_ratio,
        sortino_ratio=result.sortino_ratio,
        beta_to_benchmark=result.beta_to_benchmark,
        model_version=result.model_version,
        computed_at=result.computed_at.isoformat(),
    )


@router.get("/api/risk/predict/health", response_model=ModelHealthResponse)
async def model_health() -> ModelHealthResponse:
    """Return which ML models are currently loaded in memory."""
    registry = get_registry()
    loaded = registry.loaded_types()
    return ModelHealthResponse(
        status="ok" if loaded else "degraded",
        loaded_models=loaded,
        fallback_available=True,  # historical simulation always available
    )
