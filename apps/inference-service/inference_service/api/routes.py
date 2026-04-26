"""FastAPI routes for the Inference Service.

Endpoints:
  POST /api/risk/predict              — compute risk metrics for a portfolio
  GET  /api/risk/predict/health       — model health check (which models are loaded)
  GET  /api/risk/scenarios            — list available stress scenarios
  POST /api/risk/scenarios/run        — run a stress test scenario
  GET  /api/risk/correlation          — pairwise correlation matrix for portfolio assets
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..config import get_settings
from ..db import get_engine
from ..models.loader import get_registry
from ..models.predictor import PredictionResult, predict
from ..scenarios import SCENARIOS, StressRequest, StressResult, run_scenario

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
# DB persistence — risk results
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
# DB persistence — stress test results
# ---------------------------------------------------------------------------

def _store_stress_results(result: StressResult, req: StressRequest) -> None:
    """Persist stress test results into the stress_test_results table."""
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO stress_test_results (
                    portfolio_id, scenario_id, scenario_name, scenario_type,
                    stressed_var, stressed_cvar, max_drawdown, worst_day,
                    p10_return, p1_return, mean_return, n_observations,
                    alpha, vol_multiplier, corr_shock, n_simulations,
                    lookback_days, description, computed_at
                ) VALUES (
                    :portfolio_id, :scenario_id, :scenario_name, :scenario_type,
                    :stressed_var, :stressed_cvar, :max_drawdown, :worst_day,
                    :p10_return, :p1_return, :mean_return, :n_observations,
                    :alpha, :vol_multiplier, :corr_shock, :n_simulations,
                    :lookback_days, :description, :computed_at
                )
                """
            ),
            {
                "portfolio_id": result.portfolio_id,
                "scenario_id": result.scenario_id,
                "scenario_name": result.scenario_name,
                "scenario_type": result.scenario_type,
                "stressed_var": result.stressed_var,
                "stressed_cvar": result.stressed_cvar,
                "max_drawdown": result.max_drawdown,
                "worst_day": result.worst_day,
                "p10_return": result.p10_return,
                "p1_return": result.p1_return,
                "mean_return": result.mean_return,
                "n_observations": result.n_observations,
                "alpha": req.alpha,
                "vol_multiplier": req.vol_multiplier,
                "corr_shock": req.corr_shock,
                "n_simulations": req.n_simulations,
                "lookback_days": req.lookback_days,
                "description": result.description,
                "computed_at": result.computed_at,
            },
        )
    logger.info(
        "Stored stress test result: portfolio=%d  scenario=%s  stressed_VaR=%.6f  stressed_CVaR=%.6f",
        result.portfolio_id, result.scenario_id, result.stressed_var, result.stressed_cvar,
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


# ---------------------------------------------------------------------------
# Correlation matrix endpoint
# ---------------------------------------------------------------------------

class CorrelationMatrixResponse(BaseModel):
    portfolio_id: int
    symbols: list[str]
    matrix: list[list[float]]
    lookback_days: int
    computed_at: str


@router.get("/api/risk/correlation", response_model=CorrelationMatrixResponse)
async def get_correlation_matrix(
    portfolio_id: int,
    lookback_days: int = 252,
) -> CorrelationMatrixResponse:
    """Compute pairwise Pearson correlation matrix for all assets in a portfolio.

    Loads the last ``lookback_days`` of processed returns for each position
    in the portfolio and returns the full N×N correlation matrix.

    Args:
        portfolio_id:  Portfolio ID.
        lookback_days: Number of trading days to use (default 252 = 1 year).

    Returns:
        CorrelationMatrixResponse with symbols list and N×N matrix.
    """
    import numpy as np
    import pandas as pd

    engine = get_engine()

    with engine.connect() as conn:
        # Get portfolio positions
        sym_rows = conn.execute(
            text(
                """
                SELECT symbol FROM portfolio_positions
                WHERE portfolio_id = :pid
                ORDER BY symbol
                """
            ),
            {"pid": portfolio_id},
        ).fetchall()

        if not sym_rows:
            raise HTTPException(
                status_code=404,
                detail=f"Portfolio {portfolio_id} has no positions",
            )

        symbols = [r[0] for r in sym_rows]

        # Load returns for all symbols
        returns_df = pd.read_sql(
            text(
                """
                SELECT symbol, price_date, ret
                FROM processed_returns
                WHERE symbol = ANY(:symbols)
                ORDER BY symbol, price_date ASC
                """
            ),
            conn,
            params={"symbols": symbols},
        )

    if returns_df.empty:
        raise HTTPException(
            status_code=422,
            detail=(
                f"No processed_returns found for portfolio {portfolio_id} "
                f"symbols: {symbols}. Run market data ingestion first."
            ),
        )

    returns_df["ret"] = returns_df["ret"].astype(float)

    # Keep last lookback_days per symbol
    returns_df = (
        returns_df.groupby("symbol", group_keys=False)
        .apply(lambda g: g.tail(lookback_days))
        .reset_index(drop=True)
    )

    # Pivot to (T × N) matrix, drop rows with any NaN
    pivot = returns_df.pivot(index="price_date", columns="symbol", values="ret").dropna()

    if pivot.shape[0] < 2:
        raise HTTPException(
            status_code=422,
            detail="Insufficient overlapping return data to compute correlations.",
        )

    col_symbols = list(pivot.columns)
    corr = pivot.corr(method="pearson")

    # Convert to nested list of floats (handle NaN → 0.0)
    matrix = [
        [float(corr.iloc[i, j]) if not np.isnan(corr.iloc[i, j]) else 0.0
         for j in range(len(col_symbols))]
        for i in range(len(col_symbols))
    ]

    logger.info(
        "Correlation matrix computed: portfolio=%d  symbols=%s  shape=%dx%d",
        portfolio_id, col_symbols, len(col_symbols), len(col_symbols),
    )

    return CorrelationMatrixResponse(
        portfolio_id=portfolio_id,
        symbols=col_symbols,
        matrix=matrix,
        lookback_days=lookback_days,
        computed_at=datetime.now(timezone.utc).isoformat(),
    )


# ---------------------------------------------------------------------------
# Stress testing / scenario endpoints
# ---------------------------------------------------------------------------

class ScenarioInfo(BaseModel):
    id: str
    type: str
    name: str
    description: str
    # Parametric-only fields (None for historical)
    vol_multiplier: Optional[float] = None
    corr_shock: Optional[float] = None
    # Historical-only fields (None for parametric)
    period_start: Optional[str] = None
    period_end: Optional[str] = None


class ScenariosListResponse(BaseModel):
    scenarios: list[ScenarioInfo]
    total: int


class ScenarioRunRequest(BaseModel):
    portfolio_id: int = Field(..., description="Portfolio ID to stress-test")
    scenario_id: str = Field(
        ...,
        description=(
            "Scenario key: historical_2008 | historical_2020 | historical_1998 | "
            "parametric_mild | parametric_severe | custom"
        ),
    )
    # Optional overrides / custom scenario params
    vol_multiplier: Optional[float] = Field(
        None,
        ge=1.0,
        le=20.0,
        description="Volatility multiplier (required for custom, optional override for parametric)",
    )
    corr_shock: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Push pairwise correlations toward 1 (0 = no shock, 1 = perfect correlation)",
    )
    n_simulations: int = Field(
        50_000,
        ge=1_000,
        le=500_000,
        description="Number of Monte Carlo draws for the stressed P&L distribution",
    )
    alpha: float = Field(
        0.99,
        ge=0.9,
        le=0.9999,
        description="VaR confidence level",
    )
    lookback_days: int = Field(
        252,
        ge=30,
        le=2520,
        description="Historical window (days) used to estimate current portfolio μ/σ",
    )


class ScenarioRunResponse(BaseModel):
    portfolio_id: int
    scenario_id: str
    scenario_name: str
    scenario_type: str
    # Stressed risk metrics
    stressed_var: float
    stressed_cvar: float
    max_drawdown: float
    worst_day: float
    p10_return: float
    p1_return: float
    mean_return: float
    # Metadata
    n_observations: int
    description: str
    computed_at: str


@router.get("/api/risk/scenarios", response_model=ScenariosListResponse)
async def list_scenarios() -> ScenariosListResponse:
    """Return the catalogue of built-in stress scenarios.

    Each entry describes either a **historical replay** scenario (with a
    crisis period) or a **parametric stress** scenario (with vol_multiplier
    and corr_shock).  Pass the ``id`` field to ``POST /api/risk/scenarios/run``.
    """
    items: list[ScenarioInfo] = []
    for sid, sdef in SCENARIOS.items():
        period = sdef.get("period")
        items.append(
            ScenarioInfo(
                id=sid,
                type=sdef["type"],
                name=sdef["name"],
                description=sdef.get("description", ""),
                vol_multiplier=sdef.get("vol_multiplier"),
                corr_shock=sdef.get("corr_shock"),
                period_start=period[0] if period else None,
                period_end=period[1] if period else None,
            )
        )
    return ScenariosListResponse(scenarios=items, total=len(items))


@router.post("/api/risk/scenarios/run", response_model=ScenarioRunResponse)
async def run_stress_scenario(body: ScenarioRunRequest) -> ScenarioRunResponse:
    """Run a stress test scenario for a portfolio.

    Supports two scenario families:

    * **Historical replay** (``historical_2008``, ``historical_2020``,
      ``historical_1998``) — applies actual crisis-period returns (scaled to
      current portfolio volatility) to produce a stressed P&L distribution.
      Falls back to a parametric approximation when the DB has no data for
      the crisis period (e.g. synthetic data only).

    * **Parametric stress** (``parametric_mild``, ``parametric_severe``,
      ``custom``) — scales portfolio volatility by ``vol_multiplier`` and
      pushes correlations toward 1 via ``corr_shock``, then simulates a
      GBM-based P&L distribution.

    Returns stressed VaR, CVaR, Max Drawdown, worst-day return, and
    percentile statistics of the simulated P&L distribution.
    Results are persisted to the stress_test_results table.
    """
    logger.info(
        "Stress scenario request: portfolio=%d  scenario=%s  alpha=%.4f  n_sim=%d",
        body.portfolio_id, body.scenario_id, body.alpha, body.n_simulations,
    )

    req = StressRequest(
        portfolio_id=body.portfolio_id,
        scenario_id=body.scenario_id,
        vol_multiplier=body.vol_multiplier,
        corr_shock=body.corr_shock,
        n_simulations=body.n_simulations,
        alpha=body.alpha,
        lookback_days=body.lookback_days,
    )

    try:
        result = run_scenario(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Stress scenario failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Stress scenario failed: {exc}") from exc

    # Persist stress test results to DB (non-blocking — log error but don't fail the request)
    try:
        _store_stress_results(result, req)
    except Exception as exc:
        logger.error("Failed to store stress test results in DB: %s", exc)

    return ScenarioRunResponse(
        portfolio_id=result.portfolio_id,
        scenario_id=result.scenario_id,
        scenario_name=result.scenario_name,
        scenario_type=result.scenario_type,
        stressed_var=result.stressed_var,
        stressed_cvar=result.stressed_cvar,
        max_drawdown=result.max_drawdown,
        worst_day=result.worst_day,
        p10_return=result.p10_return,
        p1_return=result.p1_return,
        mean_return=result.mean_return,
        n_observations=result.n_observations,
        description=result.description,
        computed_at=result.computed_at,
    )
