"""Additional risk metrics for portfolio analysis.

Implements industry-standard risk metrics recommended for RiskOps:
  - Max Drawdown      — maximum peak-to-trough loss
  - Sharpe Ratio      — annualised return per unit of total risk
  - Sortino Ratio     — annualised return per unit of downside risk
  - Beta              — portfolio sensitivity to a benchmark
  - Correlation Matrix — pairwise correlations between assets

All functions operate on 1-D numpy arrays of daily simple returns
(e.g. -0.02 = -2% daily loss) unless stated otherwise.

References:
  - Sharpe (1994): "The Sharpe Ratio"
  - Sortino & van der Meer (1991): "Downside Risk"
  - Standard portfolio theory for Beta and Max Drawdown
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Trading days per year — used for annualisation
_TRADING_DAYS = 252


# ---------------------------------------------------------------------------
# Individual metric functions
# ---------------------------------------------------------------------------

def max_drawdown(returns: np.ndarray) -> float:
    """Maximum peak-to-trough loss in the return series.

    Args:
        returns: 1-D array of daily simple returns.

    Returns:
        Negative float (e.g. -0.43 means 43% drawdown).
        Returns 0.0 if the series is empty or has no drawdown.
    """
    if len(returns) == 0:
        return 0.0

    cumulative = np.cumprod(1.0 + returns)
    running_max = np.maximum.accumulate(cumulative)
    # Avoid division by zero if running_max contains zeros
    with np.errstate(invalid="ignore", divide="ignore"):
        drawdown = np.where(running_max > 0, (cumulative - running_max) / running_max, 0.0)
    return float(drawdown.min())


def sharpe_ratio(
    returns: np.ndarray,
    risk_free_rate: float = 0.0,
) -> float:
    """Annualised Sharpe ratio.

    Sharpe = (mean_excess_return / std_excess_return) * sqrt(252)

    Args:
        returns:        1-D array of daily simple returns.
        risk_free_rate: Annual risk-free rate (e.g. 0.04 = 4%).
                        Converted to daily: rf_daily = rf_annual / 252.

    Returns:
        Annualised Sharpe ratio. Returns NaN if std is zero.
    """
    if len(returns) < 2:
        return float("nan")

    rf_daily = risk_free_rate / _TRADING_DAYS
    excess = returns - rf_daily
    std = float(np.std(excess, ddof=1))
    if std == 0.0:
        return float("nan")
    return float(np.mean(excess) / std * np.sqrt(_TRADING_DAYS))


def sortino_ratio(
    returns: np.ndarray,
    risk_free_rate: float = 0.0,
) -> float:
    """Annualised Sortino ratio (penalises only downside volatility).

    Sortino = (mean_excess_return / downside_std) * sqrt(252)

    Downside std uses only returns below the risk-free rate (MAR = rf_daily).

    Args:
        returns:        1-D array of daily simple returns.
        risk_free_rate: Annual risk-free rate.

    Returns:
        Annualised Sortino ratio. Returns NaN if downside std is zero.
    """
    if len(returns) < 2:
        return float("nan")

    rf_daily = risk_free_rate / _TRADING_DAYS
    excess = returns - rf_daily
    downside = excess[excess < 0.0]

    if len(downside) == 0:
        # No negative excess returns — infinite Sortino (perfect upside)
        return float("inf")

    downside_std = float(np.sqrt(np.mean(downside ** 2)))
    if downside_std == 0.0:
        return float("nan")

    return float(np.mean(excess) / downside_std * np.sqrt(_TRADING_DAYS))


def beta(
    portfolio_returns: np.ndarray,
    benchmark_returns: np.ndarray,
) -> float:
    """Portfolio beta relative to a benchmark.

    Beta = Cov(portfolio, benchmark) / Var(benchmark)

    Args:
        portfolio_returns:  1-D array of daily portfolio returns.
        benchmark_returns:  1-D array of daily benchmark returns.
                            Must be the same length as portfolio_returns.

    Returns:
        Beta coefficient. Returns NaN if benchmark variance is zero or
        arrays have different lengths.
    """
    if len(portfolio_returns) != len(benchmark_returns):
        logger.warning(
            "beta(): portfolio (%d) and benchmark (%d) have different lengths",
            len(portfolio_returns), len(benchmark_returns),
        )
        return float("nan")

    if len(portfolio_returns) < 2:
        return float("nan")

    var_bench = float(np.var(benchmark_returns, ddof=1))
    if var_bench == 0.0:
        return float("nan")

    cov = float(np.cov(portfolio_returns, benchmark_returns, ddof=1)[0, 1])
    return cov / var_bench


def correlation_matrix(
    returns_df: pd.DataFrame,
) -> pd.DataFrame:
    """Pairwise Pearson correlation matrix between assets.

    Args:
        returns_df: DataFrame with shape (T, N) where columns are asset symbols
                    and rows are daily returns.

    Returns:
        (N × N) correlation DataFrame.
    """
    return returns_df.corr(method="pearson")


# ---------------------------------------------------------------------------
# Composite result dataclass
# ---------------------------------------------------------------------------

@dataclass
class RiskMetrics:
    """All computed risk metrics for a portfolio / return series."""

    # Core VaR metrics (passed in from GARCH/MC/Historical)
    var: float
    cvar: float
    volatility: float   # annualised

    # Additional metrics
    max_drawdown: float         # negative number (e.g. -0.43)
    sharpe_ratio: float         # annualised
    sortino_ratio: float        # annualised
    beta_to_benchmark: Optional[float] = None   # None if no benchmark provided

    # Metadata
    n_observations: int = 0
    risk_free_rate: float = 0.0

    def to_dict(self) -> dict:
        """Serialise to a flat dict suitable for MLflow logging."""
        d = {
            "var": self.var,
            "cvar": self.cvar,
            "volatility": self.volatility,
            "max_drawdown": self.max_drawdown,
            "sharpe_ratio": self.sharpe_ratio,
            "sortino_ratio": self.sortino_ratio,
            "n_observations": self.n_observations,
            "risk_free_rate": self.risk_free_rate,
        }
        if self.beta_to_benchmark is not None:
            d["beta_to_benchmark"] = self.beta_to_benchmark
        return d


# ---------------------------------------------------------------------------
# Convenience: compute all metrics at once
# ---------------------------------------------------------------------------

def compute_all(
    returns: np.ndarray,
    var: float,
    cvar: float,
    volatility: float,
    benchmark_returns: Optional[np.ndarray] = None,
    risk_free_rate: float = 0.0,
) -> RiskMetrics:
    """Compute all additional risk metrics and bundle with core VaR metrics.

    Args:
        returns:           1-D array of daily portfolio returns.
        var:               Pre-computed VaR (positive loss number).
        cvar:              Pre-computed CVaR (positive loss number).
        volatility:        Pre-computed annualised volatility.
        benchmark_returns: Optional 1-D array of benchmark daily returns
                           (same length as returns). Used for Beta.
        risk_free_rate:    Annual risk-free rate for Sharpe/Sortino.

    Returns:
        RiskMetrics dataclass with all metrics populated.
    """
    mdd = max_drawdown(returns)
    sharpe = sharpe_ratio(returns, risk_free_rate)
    sortino = sortino_ratio(returns, risk_free_rate)

    beta_val: Optional[float] = None
    if benchmark_returns is not None and len(benchmark_returns) == len(returns):
        beta_val = beta(returns, benchmark_returns)

    logger.info(
        "Risk metrics: VaR=%.4f  CVaR=%.4f  vol=%.4f  MDD=%.4f  Sharpe=%.3f  Sortino=%.3f  Beta=%s",
        var, cvar, volatility, mdd, sharpe, sortino,
        f"{beta_val:.3f}" if beta_val is not None else "N/A",
    )

    return RiskMetrics(
        var=var,
        cvar=cvar,
        volatility=volatility,
        max_drawdown=mdd,
        sharpe_ratio=sharpe,
        sortino_ratio=sortino,
        beta_to_benchmark=beta_val,
        n_observations=len(returns),
        risk_free_rate=risk_free_rate,
    )
