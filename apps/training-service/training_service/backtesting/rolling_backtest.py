"""Rolling window out-of-sample VaR backtesting engine.

Algorithm
---------
For each day t in the out-of-sample period [T_train, T_end):

    1. Training window  : returns[t - lookback_days : t]
    2. Fit model on training window → predict VaR(t)
    3. Realised return  : returns[t]
    4. Violation        : 1 if returns[t] < -VaR(t) else 0

Collect the full hit sequence, then run Kupiec + Christoffersen tests.

Supported model types
---------------------
- "garch"      : GARCH(1,1) with Normal innovations (fast, parametric)
- "montecarlo" : Monte Carlo GBM (slower, empirical distribution)
- "historical" : Historical simulation — empirical quantile of training window
                 (no model fitting, fastest, useful as baseline)

Performance note
----------------
Rolling GARCH over 60 test days with lookback=252 means 60 model fits.
Each fit takes ~0.1–0.3 s → total ~6–18 s. This is acceptable for an
async background task but would be too slow for a synchronous HTTP response.
The endpoint in routes.py runs this in a thread pool.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from ..models.garch import GARCHParams, train_garch
from ..models.montecarlo import MonteCarloParams, run_monte_carlo
from .christoffersen import ChristoffersenResult, christoffersen_test
from .kupiec import KupiecResult, kupiec_test

logger = logging.getLogger(__name__)

ModelType = Literal["garch", "montecarlo", "historical"]


# ---------------------------------------------------------------------------
# Per-day prediction result
# ---------------------------------------------------------------------------

@dataclass
class DayResult:
    """VaR prediction and realised outcome for a single out-of-sample day."""
    t: int              # index into the full returns array
    var_predicted: float
    realised_return: float
    violation: int      # 1 if realised_return < -var_predicted else 0


# ---------------------------------------------------------------------------
# Full backtest result
# ---------------------------------------------------------------------------

@dataclass
class RollingBacktestResult:
    """Aggregated result of a rolling window backtest."""
    model_type: str
    alpha: float
    lookback_days: int
    test_days: int

    # Per-day detail
    day_results: list[DayResult] = field(default_factory=list)

    # Aggregate counts
    violations: int = 0
    total_obs: int = 0
    violation_rate: float = 0.0
    expected_rate: float = 0.0

    # Statistical tests
    kupiec: KupiecResult | None = None
    christoffersen: ChristoffersenResult | None = None

    # Decision
    status: str = "UNKNOWN"   # OK | WARN | CRIT

    def hit_sequence(self) -> list[int]:
        """Return the binary hit sequence (1 = violation, 0 = no violation)."""
        return [d.violation for d in self.day_results]

    def var_series(self) -> list[float]:
        """Return the sequence of predicted VaR values."""
        return [d.var_predicted for d in self.day_results]

    def return_series(self) -> list[float]:
        """Return the sequence of realised returns."""
        return [d.realised_return for d in self.day_results]


# ---------------------------------------------------------------------------
# Status classification
# ---------------------------------------------------------------------------

def _classify_status(kupiec_pvalue: float, cc_pvalue: float) -> str:
    """Classify backtest status based on p-values.

    Decision thresholds (from §17 of the architecture plan):
        p-value > 0.05  → OK   (model is well-calibrated)
        0.01 < p ≤ 0.05 → WARN (monitor closely)
        p ≤ 0.01        → CRIT (trigger retraining)

    We use the *minimum* of the two p-values (most conservative).
    """
    p = min(kupiec_pvalue, cc_pvalue)
    if p > 0.05:
        return "OK"
    elif p > 0.01:
        return "WARN"
    else:
        return "CRIT"


# ---------------------------------------------------------------------------
# Single-day VaR predictors
# ---------------------------------------------------------------------------

def _predict_var_garch(
    train_returns: np.ndarray,
    alpha: float,
    horizon_days: int,
    garch_params: GARCHParams,
) -> float:
    """Fit GARCH on train_returns and return 1-step-ahead VaR."""
    try:
        result = train_garch(
            train_returns,
            alpha=alpha,
            horizon_days=horizon_days,
            garch_params=garch_params,
        )
        return result.var
    except Exception as exc:
        logger.warning("GARCH fit failed on rolling window: %s — using NaN", exc)
        return float("nan")


def _predict_var_montecarlo(
    train_returns: np.ndarray,
    alpha: float,
    horizon_days: int,
    mc_params: MonteCarloParams,
) -> float:
    """Run Monte Carlo on train_returns and return simulated VaR."""
    try:
        result = run_monte_carlo(
            train_returns,
            alpha=alpha,
            horizon_days=horizon_days,
            mc_params=mc_params,
        )
        return result.var
    except Exception as exc:
        logger.warning("Monte Carlo failed on rolling window: %s — using NaN", exc)
        return float("nan")


def _predict_var_historical(
    train_returns: np.ndarray,
    alpha: float,
) -> float:
    """Historical simulation: empirical quantile of training window."""
    if len(train_returns) < 10:
        return float("nan")
    q = float(np.quantile(train_returns, 1.0 - alpha))
    return -q  # positive loss number


# ---------------------------------------------------------------------------
# Main rolling engine
# ---------------------------------------------------------------------------

def run_rolling_backtest(
    returns: np.ndarray,
    model_type: ModelType,
    alpha: float = 0.99,
    lookback_days: int = 252,
    test_days: int = 60,
    horizon_days: int = 1,
    n_simulations: int = 1_000,
    significance: float = 0.05,
) -> RollingBacktestResult:
    """Run a rolling window out-of-sample VaR backtest.

    Args:
        returns:       Full 1-D array of daily portfolio returns (chronological).
        model_type:    "garch" | "montecarlo" | "historical".
        alpha:         VaR confidence level (e.g. 0.99).
        lookback_days: Size of the rolling training window.
        test_days:     Number of out-of-sample days to evaluate.
                       Must satisfy: lookback_days + test_days ≤ len(returns).
        horizon_days:  Forecast horizon (days). Typically 1 for daily VaR.
        n_simulations: Number of MC simulations per day (only for montecarlo).
        significance:  Significance level for statistical tests.

    Returns:
        RollingBacktestResult with per-day detail and statistical test results.

    Raises:
        ValueError: If there are insufficient observations.
    """
    n = len(returns)
    required = lookback_days + test_days
    if n < required:
        raise ValueError(
            f"Insufficient data: need {required} observations "
            f"(lookback={lookback_days} + test={test_days}), got {n}."
        )

    logger.info(
        "Rolling backtest: model=%s  alpha=%.4f  lookback=%d  test=%d  n=%d",
        model_type, alpha, lookback_days, test_days, n,
    )

    # Use the last (lookback_days + test_days) observations so the backtest
    # always uses the most recent data available.
    returns_window = returns[-(lookback_days + test_days):]

    # Pre-build model parameters once (reused across all rolling windows)
    garch_params = GARCHParams(p=1, q=1, dist="normal", mean="Zero")
    # Use a smaller n_simulations for speed in rolling mode; caller can override
    mc_params = MonteCarloParams(n_simulations=n_simulations, seed=42)

    day_results: list[DayResult] = []

    for i in range(test_days):
        # Training window: [i, i + lookback_days)
        train_slice = returns_window[i : i + lookback_days]
        # Out-of-sample observation: index i + lookback_days
        oos_idx = i + lookback_days
        realised = float(returns_window[oos_idx])

        # Predict VaR
        if model_type == "garch":
            var_pred = _predict_var_garch(train_slice, alpha, horizon_days, garch_params)
        elif model_type == "montecarlo":
            var_pred = _predict_var_montecarlo(train_slice, alpha, horizon_days, mc_params)
        elif model_type == "historical":
            var_pred = _predict_var_historical(train_slice, alpha)
        else:
            raise ValueError(f"Unknown model_type: {model_type!r}")

        # Determine violation (skip NaN predictions — treat as no violation)
        if np.isnan(var_pred):
            logger.warning("Day %d: VaR prediction is NaN — skipping", i)
            continue

        violation = 1 if realised < -var_pred else 0

        day_results.append(DayResult(
            t=oos_idx,
            var_predicted=var_pred,
            realised_return=realised,
            violation=violation,
        ))

        if (i + 1) % 10 == 0 or i == test_days - 1:
            logger.debug(
                "Rolling backtest progress: %d/%d  violations so far: %d",
                i + 1, test_days, sum(d.violation for d in day_results),
            )

    total_obs = len(day_results)
    violations = sum(d.violation for d in day_results)
    violation_rate = violations / total_obs if total_obs > 0 else 0.0
    expected_rate = 1.0 - alpha

    logger.info(
        "Rolling backtest complete: violations=%d/%d  rate=%.4f  expected=%.4f",
        violations, total_obs, violation_rate, expected_rate,
    )

    # Statistical tests (require at least 2 observations)
    kupiec_result: KupiecResult | None = None
    cc_result: ChristoffersenResult | None = None
    status = "UNKNOWN"

    if total_obs >= 2:
        kupiec_result = kupiec_test(violations, total_obs, alpha, significance)
        hit_seq = [d.violation for d in day_results]
        cc_result = christoffersen_test(hit_seq, alpha, significance)
        status = _classify_status(kupiec_result.p_value, cc_result.p_value_cc)
    else:
        logger.warning(
            "Too few valid observations (%d) for statistical tests — skipping",
            total_obs,
        )

    return RollingBacktestResult(
        model_type=model_type,
        alpha=alpha,
        lookback_days=lookback_days,
        test_days=test_days,
        day_results=day_results,
        violations=violations,
        total_obs=total_obs,
        violation_rate=violation_rate,
        expected_rate=expected_rate,
        kupiec=kupiec_result,
        christoffersen=cc_result,
        status=status,
    )
