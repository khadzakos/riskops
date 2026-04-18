"""Risk prediction engine for the Inference Service.

Supports three methods:
  1. garch      — uses the loaded ARCHModelResult to forecast conditional volatility,
                  then derives parametric VaR/CVaR.
  2. montecarlo — calls the loaded mlflow.pyfunc MonteCarloModel.predict().
  3. historical — non-parametric empirical quantile from processed_returns (fallback).

All methods return a unified PredictionResult dataclass that includes both core
VaR metrics and additional risk metrics (Max Drawdown, Sharpe, Sortino, Beta).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats
from sqlalchemy import text

from ..db import get_engine
from .loader import LoadedModel, ModelRegistry


# ---------------------------------------------------------------------------
# Additional risk metrics (inline — avoids cross-service import)
# ---------------------------------------------------------------------------

_TRADING_DAYS = 252


def _max_drawdown(returns: np.ndarray) -> float:
    if len(returns) == 0:
        return 0.0
    cumulative = np.cumprod(1.0 + returns)
    running_max = np.maximum.accumulate(cumulative)
    with np.errstate(invalid="ignore", divide="ignore"):
        drawdown = np.where(running_max > 0, (cumulative - running_max) / running_max, 0.0)
    return float(drawdown.min())


def _sharpe_ratio(returns: np.ndarray, risk_free_rate: float = 0.0) -> Optional[float]:
    if len(returns) < 2:
        return None
    rf_daily = risk_free_rate / _TRADING_DAYS
    excess = returns - rf_daily
    std = float(np.std(excess, ddof=1))
    if std == 0.0:
        return None
    return float(np.mean(excess) / std * np.sqrt(_TRADING_DAYS))


def _sortino_ratio(returns: np.ndarray, risk_free_rate: float = 0.0) -> Optional[float]:
    if len(returns) < 2:
        return None
    rf_daily = risk_free_rate / _TRADING_DAYS
    excess = returns - rf_daily
    downside = excess[excess < 0.0]
    if len(downside) == 0:
        return None
    downside_std = float(np.sqrt(np.mean(downside ** 2)))
    if downside_std == 0.0:
        return None
    return float(np.mean(excess) / downside_std * np.sqrt(_TRADING_DAYS))

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclass
class PredictionResult:
    portfolio_id: int
    asof_date: date
    method: str           # historical | garch | montecarlo
    alpha: float
    horizon_days: int
    var: float            # positive loss number
    cvar: float           # positive loss number
    volatility: float     # annualised
    model_version: str
    max_drawdown: Optional[float] = None
    sharpe_ratio: Optional[float] = None
    sortino_ratio: Optional[float] = None
    beta_to_benchmark: Optional[float] = None
    computed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Data loading helpers
# ---------------------------------------------------------------------------

def _load_portfolio_returns(
    portfolio_id: int,
    lookback_days: int = 252,
) -> tuple[np.ndarray, list[str]]:
    """Load equal-weighted portfolio returns from processed_returns.

    Returns (portfolio_returns_1d, symbols_list).
    """
    engine = get_engine()
    with engine.connect() as conn:
        # Get portfolio positions
        positions_df = pd.read_sql(
            text(
                """
                SELECT symbol, weight
                FROM portfolio_positions
                WHERE portfolio_id = :pid
                ORDER BY symbol
                """
            ),
            conn,
            params={"pid": portfolio_id},
        )

        if positions_df.empty:
            raise ValueError(f"Portfolio {portfolio_id} has no positions")

        symbols = positions_df["symbol"].tolist()
        weights = positions_df["weight"].astype(float).values
        weights = weights / weights.sum()  # normalise

        # Load returns for those symbols
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
        raise RuntimeError(
            f"No processed_returns found for portfolio {portfolio_id} symbols: {symbols}. "
            "Run market data ingestion first."
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

    # Align weights to pivot column order
    col_symbols = list(pivot.columns)
    w = np.array([
        weights[symbols.index(s)] if s in symbols else 0.0
        for s in col_symbols
    ], dtype=float)
    total = w.sum()
    if total <= 0:
        raise ValueError("Sum of portfolio weights is zero")
    w = w / total

    port_rets = (pivot.values @ w).astype(float)
    return port_rets, col_symbols


# ---------------------------------------------------------------------------
# Historical simulation (fallback)
# ---------------------------------------------------------------------------

def predict_historical(
    portfolio_id: int,
    alpha: float = 0.99,
    horizon_days: int = 1,
    lookback_days: int = 252,
) -> PredictionResult:
    """Non-parametric VaR/CVaR from empirical return distribution."""
    port_rets, _ = _load_portfolio_returns(portfolio_id, lookback_days)

    # Scale to horizon (square-root-of-time approximation for simple returns)
    if horizon_days > 1:
        port_rets = port_rets * np.sqrt(horizon_days)

    var_quantile = np.quantile(port_rets, 1.0 - alpha)
    var = float(-var_quantile)
    tail = port_rets[port_rets <= var_quantile]
    cvar = float(-tail.mean()) if len(tail) > 0 else var
    vol = float(np.std(port_rets, ddof=1) * np.sqrt(252 / horizon_days))

    mdd = _max_drawdown(port_rets)
    sharpe = _sharpe_ratio(port_rets)
    sortino = _sortino_ratio(port_rets)

    logger.info(
        "Historical prediction: portfolio=%d  VaR=%.6f  CVaR=%.6f  vol=%.4f  MDD=%.4f  Sharpe=%.3f",
        portfolio_id, var, cvar, vol, mdd, sharpe or float("nan"),
    )

    return PredictionResult(
        portfolio_id=portfolio_id,
        asof_date=date.today(),
        method="historical",
        alpha=alpha,
        horizon_days=horizon_days,
        var=var,
        cvar=cvar,
        volatility=vol,
        max_drawdown=mdd,
        sharpe_ratio=sharpe,
        sortino_ratio=sortino,
        model_version="historical-v1",
    )


# ---------------------------------------------------------------------------
# GARCH prediction
# ---------------------------------------------------------------------------

def predict_garch(
    portfolio_id: int,
    model: LoadedModel,
    alpha: float = 0.99,
    horizon_days: int = 1,
    lookback_days: int = 252,
) -> PredictionResult:
    """Parametric VaR/CVaR using the loaded GARCH model's conditional volatility forecast."""
    arch_result = model.artifact  # ARCHModelResult from arch library

    # 1-step-ahead conditional volatility forecast (in percentage points)
    forecast = arch_result.forecast(horizon=horizon_days, reindex=False)
    cond_var_pct = float(forecast.variance.iloc[-1, horizon_days - 1])
    cond_vol_pct = np.sqrt(cond_var_pct)
    cond_vol = cond_vol_pct / 100.0  # back to decimal

    # Annualised volatility
    vol_annualised = cond_vol * np.sqrt(252)

    # Parametric VaR/CVaR — Normal distribution
    z_alpha = stats.norm.ppf(1.0 - alpha)
    var = float(-z_alpha * cond_vol)
    pdf_z = stats.norm.pdf(z_alpha)
    cvar = float(pdf_z / (1.0 - alpha) * cond_vol)

    # Additional metrics from historical returns (needed for MDD, Sharpe, Sortino)
    port_rets, _ = _load_portfolio_returns(portfolio_id, lookback_days)
    mdd = _max_drawdown(port_rets)
    sharpe = _sharpe_ratio(port_rets)
    sortino = _sortino_ratio(port_rets)

    logger.info(
        "GARCH prediction: portfolio=%d  VaR=%.6f  CVaR=%.6f  vol=%.4f  MDD=%.4f  Sharpe=%.3f  model_v=%s",
        portfolio_id, var, cvar, vol_annualised, mdd, sharpe or float("nan"), model.model_version,
    )

    return PredictionResult(
        portfolio_id=portfolio_id,
        asof_date=date.today(),
        method="garch",
        alpha=alpha,
        horizon_days=horizon_days,
        var=var,
        cvar=cvar,
        volatility=vol_annualised,
        max_drawdown=mdd,
        sharpe_ratio=sharpe,
        sortino_ratio=sortino,
        model_version=f"garch-v{model.model_version}",
    )


# ---------------------------------------------------------------------------
# Monte Carlo prediction
# ---------------------------------------------------------------------------

def predict_montecarlo(
    portfolio_id: int,
    model: LoadedModel,
    alpha: float = 0.99,
    horizon_days: int = 1,
    lookback_days: int = 252,
    n_simulations: int = 10_000,
) -> PredictionResult:
    """VaR/CVaR from Monte Carlo GBM simulation using the loaded pyfunc model.

    The artifact is an mlflow.pyfunc.PyFuncModel (MonteCarloModel) that was
    trained on historical portfolio returns. We call pyfunc_model.predict()
    with the desired simulation parameters.

    Falls back to re-estimating GBM params from current portfolio returns if
    the artifact is not a pyfunc model (e.g. old JSON-format artifact).
    """
    import pandas as pd

    pyfunc_model = model.artifact  # mlflow.pyfunc.PyFuncModel

    # Build input DataFrame for the pyfunc model
    input_df = pd.DataFrame([{
        "n_simulations": n_simulations,
        "horizon_days": horizon_days,
        "alpha": alpha,
    }])

    try:
        output_df = pyfunc_model.predict(input_df)
        var = float(output_df["var"].iloc[0])
        cvar = float(output_df["cvar"].iloc[0])
        vol = float(output_df["volatility"].iloc[0])
    except Exception as exc:
        # Fallback: re-estimate from current portfolio returns
        logger.warning(
            "pyfunc predict() failed (%s) — falling back to re-estimation for portfolio %d",
            exc, portfolio_id,
        )
        port_rets, _ = _load_portfolio_returns(portfolio_id, lookback_days)
        sigma = float(np.std(port_rets, ddof=1))
        mu = float(np.mean(port_rets)) + 0.5 * sigma ** 2
        rng = np.random.default_rng(42)
        dt = 1.0
        drift = (mu - 0.5 * sigma ** 2) * dt
        diffusion = sigma * np.sqrt(dt)
        daily_log_returns = rng.normal(
            loc=drift, scale=diffusion, size=(n_simulations, horizon_days)
        )
        total_log_returns = daily_log_returns.sum(axis=1)
        simulated = np.exp(total_log_returns) - 1.0
        var_quantile = np.quantile(simulated, 1.0 - alpha)
        var = float(-var_quantile)
        tail = simulated[simulated <= var_quantile]
        cvar = float(-tail.mean()) if len(tail) > 0 else var
        vol = float(np.std(simulated, ddof=1) * np.sqrt(252 / horizon_days))

    # Additional metrics from historical returns
    port_rets_hist, _ = _load_portfolio_returns(portfolio_id, lookback_days)
    mdd = _max_drawdown(port_rets_hist)
    sharpe = _sharpe_ratio(port_rets_hist)
    sortino = _sortino_ratio(port_rets_hist)

    logger.info(
        "Monte Carlo prediction: portfolio=%d  n=%d  VaR=%.6f  CVaR=%.6f  vol=%.4f  MDD=%.4f  Sharpe=%.3f  model_v=%s",
        portfolio_id, n_simulations, var, cvar, vol, mdd, sharpe or float("nan"), model.model_version,
    )

    return PredictionResult(
        portfolio_id=portfolio_id,
        asof_date=date.today(),
        method="montecarlo",
        alpha=alpha,
        horizon_days=horizon_days,
        var=var,
        cvar=cvar,
        volatility=vol,
        max_drawdown=mdd,
        sharpe_ratio=sharpe,
        sortino_ratio=sortino,
        model_version=f"montecarlo-v{model.model_version}",
    )


# ---------------------------------------------------------------------------
# Unified predict entry point
# ---------------------------------------------------------------------------

def predict(
    portfolio_id: int,
    method: str,
    registry: ModelRegistry,
    alpha: float = 0.99,
    horizon_days: int = 1,
    lookback_days: int = 252,
    n_simulations: int = 10_000,
) -> PredictionResult:
    """Route prediction to the appropriate method.

    Falls back to historical simulation if the requested ML model is not loaded.

    Args:
        portfolio_id: ID of the portfolio to compute risk for.
        method: "historical" | "garch" | "montecarlo"
        registry: The global ModelRegistry instance.
        alpha: VaR confidence level (e.g. 0.99).
        horizon_days: Forecast horizon in trading days.
        lookback_days: How many days of returns to use.
        n_simulations: Number of MC paths (only for montecarlo method).

    Returns:
        PredictionResult with VaR, CVaR, volatility.
    """
    if method == "historical":
        return predict_historical(portfolio_id, alpha, horizon_days, lookback_days)

    if method == "garch":
        model = registry.get("garch")
        if model is None:
            logger.warning(
                "GARCH model not loaded — falling back to historical for portfolio %d",
                portfolio_id,
            )
            return predict_historical(portfolio_id, alpha, horizon_days, lookback_days)
        return predict_garch(portfolio_id, model, alpha, horizon_days, lookback_days)

    if method == "montecarlo":
        model = registry.get("montecarlo")
        if model is None:
            logger.warning(
                "Monte Carlo model not loaded — falling back to historical for portfolio %d",
                portfolio_id,
            )
            return predict_historical(portfolio_id, alpha, horizon_days, lookback_days)
        return predict_montecarlo(
            portfolio_id, model, alpha, horizon_days, lookback_days, n_simulations
        )

    raise ValueError(f"Unknown prediction method: {method!r}. Use historical|garch|montecarlo")
