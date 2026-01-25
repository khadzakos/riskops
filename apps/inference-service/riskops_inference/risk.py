from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class RiskMetrics:
    var: float
    cvar: float


def historical_var_cvar(portfolio_returns: np.ndarray, alpha: float) -> RiskMetrics:
    """
    Historical VaR/CVaR for a series of portfolio returns.

    Returns positive risk numbers (loss quantiles), i.e. VaR = -q_{1-alpha}.
    """
    if portfolio_returns.size < 5:
        raise ValueError("Not enough returns to compute VaR/CVaR (need >= 5)")
    if not (0.0 < alpha < 1.0):
        raise ValueError("alpha must be between 0 and 1")

    q = np.quantile(portfolio_returns, 1.0 - alpha)  # left tail quantile (usually negative)
    tail = portfolio_returns[portfolio_returns <= q]
    var = float(-q)
    cvar = float(-tail.mean()) if tail.size > 0 else var
    return RiskMetrics(var=var, cvar=cvar)

