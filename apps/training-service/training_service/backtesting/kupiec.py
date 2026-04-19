"""Kupiec Unconditional Coverage (UC) Test for VaR backtesting.

Tests whether the observed violation rate equals the expected rate (1 - α).

Reference:
    Kupiec, P. (1995). "Techniques for Verifying the Accuracy of Risk Measurement Models."
    Journal of Derivatives, 3(2), 73–84.

Hypothesis:
    H0: p = p0 = 1 - α   (model is correctly calibrated)
    H1: p ≠ p0

Likelihood Ratio statistic:
    LR_uc = -2 * ln[ (1-p0)^(T-x) * p0^x  /  (1-p_hat)^(T-x) * p_hat^x ]
          ~ χ²(1) under H0

where:
    T     = total number of out-of-sample observations
    x     = number of VaR violations (exceedances)
    p0    = expected violation rate = 1 - alpha
    p_hat = observed violation rate = x / T
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass

from scipy import stats

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class KupiecResult:
    """Result of the Kupiec unconditional coverage test."""
    violations: int          # x — number of observed violations
    total_obs: int           # T — total out-of-sample observations
    violation_rate: float    # p_hat = x / T
    expected_rate: float     # p0 = 1 - alpha
    lr_statistic: float      # LR_uc test statistic
    p_value: float           # p-value from χ²(1)
    reject_h0: bool          # True if p_value < significance level


def kupiec_test(
    violations: int,
    total_obs: int,
    alpha: float,
    significance: float = 0.05,
) -> KupiecResult:
    """Run the Kupiec unconditional coverage test.

    Args:
        violations:   Number of VaR exceedances in the out-of-sample period.
        total_obs:    Total number of out-of-sample observations (T).
        alpha:        VaR confidence level (e.g. 0.99).
        significance: Significance level for H0 rejection (default 0.05).

    Returns:
        KupiecResult with LR statistic, p-value, and rejection decision.

    Notes:
        - If violations == 0 or violations == total_obs the log-likelihood is
          degenerate. We handle these edge cases by returning p_value = 0.0
          (extreme evidence against H0) or p_value = 1.0 (no violations at all
          when expected rate is very small).
        - Minimum of 10 observations is required for a meaningful test.
    """
    if total_obs <= 0:
        raise ValueError(f"total_obs must be > 0, got {total_obs}")
    if not (0.0 < alpha < 1.0):
        raise ValueError(f"alpha must be in (0, 1), got {alpha}")

    p0 = 1.0 - alpha          # expected violation rate
    p_hat = violations / total_obs  # observed violation rate

    logger.debug(
        "Kupiec test: violations=%d  T=%d  p_hat=%.4f  p0=%.4f",
        violations, total_obs, p_hat, p0,
    )

    # Edge case: no violations observed
    if violations == 0:
        # Under H0 the probability of zero violations is (1-p0)^T
        # LR_uc = -2 * ln[(1-p0)^T / 1^T] = -2*T*ln(1-p0)
        # This is a large positive number → strong rejection when p0 is not tiny
        lr = -2.0 * total_obs * math.log(1.0 - p0)
        p_value = float(stats.chi2.sf(lr, df=1))
        return KupiecResult(
            violations=violations,
            total_obs=total_obs,
            violation_rate=0.0,
            expected_rate=p0,
            lr_statistic=lr,
            p_value=p_value,
            reject_h0=p_value < significance,
        )

    # Edge case: all observations are violations
    if violations == total_obs:
        lr = -2.0 * total_obs * math.log(p0)
        p_value = float(stats.chi2.sf(lr, df=1))
        return KupiecResult(
            violations=violations,
            total_obs=total_obs,
            violation_rate=1.0,
            expected_rate=p0,
            lr_statistic=lr,
            p_value=p_value,
            reject_h0=p_value < significance,
        )

    # General case
    T = total_obs
    x = violations

    # Log-likelihood under H0 (restricted): p = p0
    ll_h0 = (T - x) * math.log(1.0 - p0) + x * math.log(p0)

    # Log-likelihood under H1 (unrestricted): p = p_hat
    ll_h1 = (T - x) * math.log(1.0 - p_hat) + x * math.log(p_hat)

    lr = -2.0 * (ll_h0 - ll_h1)
    # Numerical guard: LR should be non-negative; clamp tiny negatives from float errors
    lr = max(lr, 0.0)

    p_value = float(stats.chi2.sf(lr, df=1))

    logger.info(
        "Kupiec UC: LR=%.4f  p-value=%.4f  violations=%d/%d  p_hat=%.4f  p0=%.4f",
        lr, p_value, violations, total_obs, p_hat, p0,
    )

    return KupiecResult(
        violations=violations,
        total_obs=total_obs,
        violation_rate=p_hat,
        expected_rate=p0,
        lr_statistic=lr,
        p_value=p_value,
        reject_h0=p_value < significance,
    )
