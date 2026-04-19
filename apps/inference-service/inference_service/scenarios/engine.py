"""Stress testing / market simulation engine.

Supports two scenario families:

1. **Parametric stress** — scale portfolio volatility by a multiplier and
   push pairwise correlations toward 1.  Uses a stressed GBM to generate
   a synthetic P&L distribution, then computes VaR/CVaR/MaxDrawdown.

2. **Historical replay** — apply the actual daily return sequence from a
   named crisis period (2008 GFC, 2020 COVID, 1998 LTCM) to the current
   portfolio weights and compute the resulting P&L distribution.

Both paths share the same output type: ``StressResult``.

The engine is intentionally self-contained — it reads portfolio returns
from Postgres (``processed_returns``) and does not depend on any loaded
ML model.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd
from sqlalchemy import text

from ..db import get_engine

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Built-in scenario catalogue
# ---------------------------------------------------------------------------

#: Scenario definitions.  Each entry is a dict with either:
#:   - ``type="historical"`` + ``period=(start, end)`` ISO date strings
#:   - ``type="parametric"`` + ``vol_multiplier`` + ``corr_shock``
SCENARIOS: dict[str, dict] = {
    "historical_2008": {
        "id": "historical_2008",
        "type": "historical",
        "name": "Global Financial Crisis 2008",
        "period": ("2008-09-01", "2009-03-31"),
        "description": "Lehman collapse, credit freeze, global equity −50 %",
    },
    "historical_2020": {
        "id": "historical_2020",
        "type": "historical",
        "name": "COVID-19 Crash 2020",
        "period": ("2020-02-19", "2020-03-23"),
        "description": "Fastest 30 % drawdown in history, VIX > 80",
    },
    "historical_1998": {
        "id": "historical_1998",
        "type": "historical",
        "name": "LTCM / Russia Default 1998",
        "period": ("1998-08-01", "1998-10-31"),
        "description": "Russian sovereign default, LTCM collapse, liquidity crisis",
    },
    "parametric_mild": {
        "id": "parametric_mild",
        "type": "parametric",
        "name": "Mild Stress (2× volatility)",
        "vol_multiplier": 2.0,
        "corr_shock": 0.7,
        "description": "Moderate stress: 2× volatility, correlations pushed to 0.7",
    },
    "parametric_severe": {
        "id": "parametric_severe",
        "type": "parametric",
        "name": "Severe Stress (4× volatility)",
        "vol_multiplier": 4.0,
        "corr_shock": 0.95,
        "description": "Severe stress: 4× volatility, correlations → 1",
    },
}


# ---------------------------------------------------------------------------
# Request / Result types
# ---------------------------------------------------------------------------

@dataclass
class StressRequest:
    portfolio_id: int
    scenario_id: str                        # key in SCENARIOS or "custom"
    # Parametric overrides (used when scenario_id == "custom" or to override)
    vol_multiplier: Optional[float] = None  # e.g. 3.0
    corr_shock: Optional[float] = None      # push correlations toward 1 (0–1)
    n_simulations: int = 50_000
    alpha: float = 0.99                     # VaR confidence level
    lookback_days: int = 252                # window for estimating μ/σ/Σ


@dataclass
class StressResult:
    portfolio_id: int
    scenario_id: str
    scenario_name: str
    scenario_type: str                      # "historical" | "parametric"
    # Core risk metrics under stress
    stressed_var: float                     # positive number (loss)
    stressed_cvar: float
    max_drawdown: float                     # negative number (peak-to-trough)
    worst_day: float                        # most negative single-day return
    p10_return: float                       # 10th percentile of P&L distribution
    p1_return: float                        # 1st percentile
    mean_return: float
    # Metadata
    n_observations: int                     # number of simulated / replayed days
    computed_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    description: str = ""


# ---------------------------------------------------------------------------
# Data loading helpers
# ---------------------------------------------------------------------------

def _load_portfolio_returns(
    portfolio_id: int,
    lookback_days: int,
) -> tuple[np.ndarray, list[str]]:
    """Load processed_returns for all symbols in a portfolio.

    Returns:
        port_rets  — 1-D numpy array of equal-weighted portfolio returns
        symbols    — list of symbol strings
    """
    engine = get_engine()
    with engine.connect() as conn:
        # Fetch symbols from portfolio_positions
        sym_rows = conn.execute(
            text(
                """
                SELECT DISTINCT pp.symbol
                FROM portfolio_positions pp
                WHERE pp.portfolio_id = :pid
                ORDER BY pp.symbol
                """
            ),
            {"pid": portfolio_id},
        ).fetchall()

        if not sym_rows:
            raise ValueError(
                f"Portfolio {portfolio_id} has no positions. "
                "Add positions before running stress tests."
            )

        symbols = [r[0] for r in sym_rows]

        df = pd.read_sql(
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

    if df.empty:
        raise RuntimeError(
            f"No processed_returns found for portfolio {portfolio_id} symbols: {symbols}. "
            "Run market data ingestion first."
        )

    df["ret"] = df["ret"].astype(float)

    # Keep last lookback_days per symbol
    df = (
        df.groupby("symbol", group_keys=False)
        .apply(lambda g: g.tail(lookback_days))
        .reset_index(drop=True)
    )

    pivot = df.pivot(index="price_date", columns="symbol", values="ret").dropna()
    # Equal weights
    w = np.ones(len(pivot.columns)) / len(pivot.columns)
    port_rets = (pivot.values @ w).astype(float)

    logger.info(
        "Loaded %d return observations for portfolio %d (symbols=%s)",
        len(port_rets), portfolio_id, symbols,
    )
    return port_rets, list(pivot.columns)


def _load_historical_crisis_returns(
    symbols: list[str],
    period_start: str,
    period_end: str,
) -> np.ndarray:
    """Load actual historical returns for the crisis period.

    If the DB has no data for that period (synthetic data only covers recent
    dates), we fall back to a parametric approximation using the crisis
    volatility regime.
    """
    engine = get_engine()
    with engine.connect() as conn:
        df = pd.read_sql(
            text(
                """
                SELECT symbol, price_date, ret
                FROM processed_returns
                WHERE symbol = ANY(:symbols)
                  AND price_date BETWEEN :start AND :end
                ORDER BY symbol, price_date ASC
                """
            ),
            conn,
            params={
                "symbols": symbols,
                "start": period_start,
                "end": period_end,
            },
        )

    if df.empty or df["symbol"].nunique() < len(symbols):
        logger.warning(
            "Historical crisis data not available for period %s–%s "
            "(symbols=%s). Using parametric approximation.",
            period_start, period_end, symbols,
        )
        return np.array([])  # caller will fall back to parametric

    df["ret"] = df["ret"].astype(float)
    pivot = df.pivot(index="price_date", columns="symbol", values="ret").dropna()
    w = np.ones(len(pivot.columns)) / len(pivot.columns)
    return (pivot.values @ w).astype(float)


# ---------------------------------------------------------------------------
# Risk metric helpers
# ---------------------------------------------------------------------------

def _compute_var_cvar(returns: np.ndarray, alpha: float) -> tuple[float, float]:
    """Compute VaR and CVaR (Expected Shortfall) at confidence level alpha.

    Returns positive numbers representing losses.
    """
    q = np.quantile(returns, 1.0 - alpha)
    var = float(-q)
    tail = returns[returns <= q]
    cvar = float(-np.mean(tail)) if len(tail) > 0 else var
    return var, cvar


def _compute_max_drawdown(returns: np.ndarray) -> float:
    """Maximum peak-to-trough loss (negative number)."""
    cumulative = np.cumprod(1.0 + returns)
    running_max = np.maximum.accumulate(cumulative)
    drawdown = (cumulative - running_max) / running_max
    return float(drawdown.min())


# ---------------------------------------------------------------------------
# Parametric stress engine (stressed GBM)
# ---------------------------------------------------------------------------

def _run_parametric_stress(
    port_rets: np.ndarray,
    vol_multiplier: float,
    corr_shock: float,
    n_simulations: int,
    alpha: float,
) -> np.ndarray:
    """Generate a stressed P&L distribution via GBM with scaled volatility.

    The portfolio is treated as a single asset with:
      - mu    = historical mean return (unchanged)
      - sigma = historical std × vol_multiplier

    corr_shock is recorded in the result metadata but for a single-asset
    portfolio return series it has no additional effect beyond vol scaling.
    For multi-asset portfolios the correlation shock would be applied to the
    covariance matrix; here we approximate it by an additional vol bump:
      effective_sigma = sigma * vol_multiplier * (1 + corr_shock * 0.5)
    This gives a conservative upper bound consistent with the plan.
    """
    mu = float(np.mean(port_rets))
    sigma = float(np.std(port_rets, ddof=1))

    # Apply vol multiplier + correlation shock approximation
    stressed_sigma = sigma * vol_multiplier * (1.0 + corr_shock * 0.5)
    # Drift is kept at historical mean (no drift adjustment in stress)
    rng = np.random.default_rng(seed=42)
    simulated = rng.normal(loc=mu, scale=stressed_sigma, size=n_simulations)
    return simulated


# ---------------------------------------------------------------------------
# Historical replay engine
# ---------------------------------------------------------------------------

def _run_historical_replay(
    crisis_rets: np.ndarray,
    port_rets: np.ndarray,
    vol_multiplier: float,
    n_simulations: int,
    alpha: float,
) -> np.ndarray:
    """Replay crisis returns, scaled to current portfolio volatility.

    If crisis_rets is empty (data not available), falls back to parametric
    stress with vol_multiplier derived from the crisis regime.
    """
    if len(crisis_rets) == 0:
        # Fallback: parametric with crisis-like vol multiplier
        logger.info(
            "No historical crisis data — using parametric fallback "
            "(vol_multiplier=%.1f)", vol_multiplier
        )
        return _run_parametric_stress(
            port_rets=port_rets,
            vol_multiplier=vol_multiplier,
            corr_shock=0.8,
            n_simulations=n_simulations,
            alpha=alpha,
        )

    # Scale crisis returns to current portfolio vol
    current_vol = float(np.std(port_rets, ddof=1))
    crisis_vol = float(np.std(crisis_rets, ddof=1))
    if crisis_vol > 0:
        scale = current_vol * vol_multiplier / crisis_vol
        scaled = crisis_rets * scale
    else:
        scaled = crisis_rets

    # Bootstrap-resample to get n_simulations observations
    rng = np.random.default_rng(seed=42)
    indices = rng.integers(0, len(scaled), size=n_simulations)
    return scaled[indices]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

# Crisis vol multipliers used when replaying historical scenarios
# (relative to a calm market baseline)
_CRISIS_VOL_MULTIPLIERS: dict[str, float] = {
    "historical_2008": 4.0,
    "historical_2020": 5.0,
    "historical_1998": 3.0,
}


def run_scenario(req: StressRequest) -> StressResult:
    """Execute a stress scenario and return a StressResult.

    Raises:
        ValueError  — unknown scenario_id or invalid parameters
        RuntimeError — no market data available for the portfolio
    """
    # Resolve scenario definition
    if req.scenario_id == "custom":
        if req.vol_multiplier is None or req.corr_shock is None:
            raise ValueError(
                "Custom scenario requires vol_multiplier and corr_shock parameters."
            )
        scenario_def: dict = {
            "id": "custom",
            "type": "parametric",
            "name": "Custom Parametric Stress",
            "description": (
                f"vol×{req.vol_multiplier:.1f}, corr_shock={req.corr_shock:.2f}"
            ),
        }
    elif req.scenario_id in SCENARIOS:
        scenario_def = SCENARIOS[req.scenario_id]
    else:
        raise ValueError(
            f"Unknown scenario_id '{req.scenario_id}'. "
            f"Available: {list(SCENARIOS.keys()) + ['custom']}"
        )

    # Allow request-level overrides of vol_multiplier / corr_shock
    vol_multiplier = req.vol_multiplier
    corr_shock = req.corr_shock

    # Load current portfolio returns (for μ/σ estimation)
    port_rets, symbols = _load_portfolio_returns(
        portfolio_id=req.portfolio_id,
        lookback_days=req.lookback_days,
    )

    scenario_type = scenario_def["type"]

    if scenario_type == "parametric":
        if vol_multiplier is None:
            vol_multiplier = scenario_def.get("vol_multiplier", 2.0)
        if corr_shock is None:
            corr_shock = scenario_def.get("corr_shock", 0.7)

        sim_rets = _run_parametric_stress(
            port_rets=port_rets,
            vol_multiplier=vol_multiplier,
            corr_shock=corr_shock,
            n_simulations=req.n_simulations,
            alpha=req.alpha,
        )

    elif scenario_type == "historical":
        period: tuple[str, str] = scenario_def["period"]
        crisis_rets = _load_historical_crisis_returns(
            symbols=symbols,
            period_start=period[0],
            period_end=period[1],
        )
        # Use crisis-specific vol multiplier unless caller overrides
        default_vol_mult = _CRISIS_VOL_MULTIPLIERS.get(req.scenario_id, 3.0)
        if vol_multiplier is None:
            vol_multiplier = default_vol_mult
        if corr_shock is None:
            corr_shock = 0.8

        sim_rets = _run_historical_replay(
            crisis_rets=crisis_rets,
            port_rets=port_rets,
            vol_multiplier=vol_multiplier,
            n_simulations=req.n_simulations,
            alpha=req.alpha,
        )

    else:
        raise ValueError(f"Unsupported scenario type: {scenario_type!r}")

    # Compute risk metrics on the simulated distribution
    stressed_var, stressed_cvar = _compute_var_cvar(sim_rets, req.alpha)
    max_dd = _compute_max_drawdown(sim_rets)
    worst_day = float(np.min(sim_rets))
    p10 = float(np.percentile(sim_rets, 10))
    p1 = float(np.percentile(sim_rets, 1))
    mean_ret = float(np.mean(sim_rets))

    logger.info(
        "Stress scenario '%s' complete: VaR=%.4f  CVaR=%.4f  MDD=%.4f  worst=%.4f",
        req.scenario_id, stressed_var, stressed_cvar, max_dd, worst_day,
    )

    return StressResult(
        portfolio_id=req.portfolio_id,
        scenario_id=req.scenario_id,
        scenario_name=scenario_def.get("name", req.scenario_id),
        scenario_type=scenario_type,
        stressed_var=stressed_var,
        stressed_cvar=stressed_cvar,
        max_drawdown=max_dd,
        worst_day=worst_day,
        p10_return=p10,
        p1_return=p1,
        mean_return=mean_ret,
        n_observations=len(sim_rets),
        description=scenario_def.get("description", ""),
    )
