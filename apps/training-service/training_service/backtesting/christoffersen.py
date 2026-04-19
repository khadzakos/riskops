"""Christoffersen Conditional Coverage (CC) Test for VaR backtesting.

Extends the Kupiec UC test by additionally checking that violations are
*independent* (no clustering). A model that produces clustered violations
(e.g. several consecutive days of losses exceeding VaR) is mis-specified
even if the total violation count is correct.

Reference:
    Christoffersen, P. (1998). "Evaluating Interval Forecasts."
    International Economic Review, 39(4), 841–862.

Decomposition:
    LR_cc  = LR_uc + LR_ind   ~  χ²(2) under H0
    LR_ind = LR_cc - LR_uc    ~  χ²(1) under H0 (independence only)

Transition matrix notation:
    n_ij = number of days where state i is followed by state j
           (0 = no violation, 1 = violation)

    π_ij = n_ij / (n_i0 + n_i1)   — row-conditional transition probabilities

    π_01 = n_01 / (n_00 + n_01)   — P(violation | no violation yesterday)
    π_11 = n_11 / (n_10 + n_11)   — P(violation | violation yesterday)
    π    = (n_01 + n_11) / T      — unconditional violation rate

LR_ind = -2 * ln[ (1-π)^(n_00+n_10) * π^(n_01+n_11)
                  / (1-π_01)^n_00 * π_01^n_01 * (1-π_11)^n_10 * π_11^n_11 ]
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np
from scipy import stats

from .kupiec import KupiecResult, kupiec_test

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ChristoffersenResult:
    """Result of the Christoffersen conditional coverage test."""
    # Transition counts
    n_00: int   # no-violation → no-violation
    n_01: int   # no-violation → violation
    n_10: int   # violation → no-violation
    n_11: int   # violation → violation

    # Transition probabilities
    pi_01: float   # P(violation | no violation yesterday)
    pi_11: float   # P(violation | violation yesterday)
    pi_hat: float  # unconditional violation rate

    # Independence test component
    lr_ind: float    # LR_ind statistic ~ χ²(1)
    p_value_ind: float

    # Conditional coverage (UC + independence)
    lr_cc: float     # LR_cc = LR_uc + LR_ind ~ χ²(2)
    p_value_cc: float
    reject_h0: bool  # True if p_value_cc < significance

    # Embedded UC result for convenience
    kupiec: KupiecResult


def christoffersen_test(
    hit_sequence: Sequence[int],
    alpha: float,
    significance: float = 0.05,
) -> ChristoffersenResult:
    """Run the Christoffersen conditional coverage test.

    Args:
        hit_sequence: Binary sequence of length T where 1 = VaR violation
                      (return < -VaR) and 0 = no violation.
                      Must have at least 2 elements.
        alpha:        VaR confidence level (e.g. 0.99).
        significance: Significance level for H0 rejection (default 0.05).

    Returns:
        ChristoffersenResult with LR_ind, LR_cc, p-values, and transition counts.

    Notes:
        - Requires at least 2 observations to compute transitions.
        - If there are no transitions of a particular type (e.g. n_11 = 0),
          the log-likelihood term for that cell is treated as 0 (0 * log(0) = 0).
        - The UC component is computed via kupiec_test() for consistency.
    """
    hits = np.asarray(hit_sequence, dtype=int)
    T = len(hits)

    if T < 2:
        raise ValueError(f"Need at least 2 observations for Christoffersen test, got {T}")

    violations = int(hits.sum())

    # --- Kupiec UC component ---
    kupiec = kupiec_test(violations, T, alpha, significance)

    # --- Transition counts ---
    # Pairs (hits[t-1], hits[t]) for t = 1..T-1
    prev = hits[:-1]
    curr = hits[1:]

    n_00 = int(np.sum((prev == 0) & (curr == 0)))
    n_01 = int(np.sum((prev == 0) & (curr == 1)))
    n_10 = int(np.sum((prev == 1) & (curr == 0)))
    n_11 = int(np.sum((prev == 1) & (curr == 1)))

    logger.debug(
        "Christoffersen transitions: n_00=%d n_01=%d n_10=%d n_11=%d",
        n_00, n_01, n_10, n_11,
    )

    # --- Transition probabilities ---
    row0_total = n_00 + n_01
    row1_total = n_10 + n_11

    pi_01 = n_01 / row0_total if row0_total > 0 else 0.0
    pi_11 = n_11 / row1_total if row1_total > 0 else 0.0
    pi_hat = (n_01 + n_11) / (T - 1) if T > 1 else 0.0  # unconditional from transitions

    # --- LR_ind ---
    # Log-likelihood under H0 (independence): all rows use unconditional π_hat
    # Log-likelihood under H1 (dependence): rows use π_01 and π_11 respectively
    def _safe_log(p: float) -> float:
        """log(p) with 0*log(0) = 0 convention."""
        if p <= 0.0:
            return 0.0
        return math.log(p)

    # H0 (restricted — independence): L0 = (n_00+n_10)*log(1-π) + (n_01+n_11)*log(π)
    ll_ind_h0 = (
        (n_00 + n_10) * _safe_log(1.0 - pi_hat)
        + (n_01 + n_11) * _safe_log(pi_hat)
    )

    # H1 (unrestricted — Markov): L1 = n_00*log(1-π_01) + n_01*log(π_01)
    #                                     + n_10*log(1-π_11) + n_11*log(π_11)
    ll_ind_h1 = (
        n_00 * _safe_log(1.0 - pi_01)
        + n_01 * _safe_log(pi_01)
        + n_10 * _safe_log(1.0 - pi_11)
        + n_11 * _safe_log(pi_11)
    )

    lr_ind = -2.0 * (ll_ind_h0 - ll_ind_h1)
    lr_ind = max(lr_ind, 0.0)  # numerical guard

    p_value_ind = float(stats.chi2.sf(lr_ind, df=1))

    # --- LR_cc = LR_uc + LR_ind ---
    lr_cc = kupiec.lr_statistic + lr_ind
    lr_cc = max(lr_cc, 0.0)
    p_value_cc = float(stats.chi2.sf(lr_cc, df=2))

    logger.info(
        "Christoffersen CC: LR_uc=%.4f  LR_ind=%.4f  LR_cc=%.4f  "
        "p_uc=%.4f  p_ind=%.4f  p_cc=%.4f  π_01=%.4f  π_11=%.4f",
        kupiec.lr_statistic, lr_ind, lr_cc,
        kupiec.p_value, p_value_ind, p_value_cc,
        pi_01, pi_11,
    )

    return ChristoffersenResult(
        n_00=n_00,
        n_01=n_01,
        n_10=n_10,
        n_11=n_11,
        pi_01=pi_01,
        pi_11=pi_11,
        pi_hat=pi_hat,
        lr_ind=lr_ind,
        p_value_ind=p_value_ind,
        lr_cc=lr_cc,
        p_value_cc=p_value_cc,
        reject_h0=p_value_cc < significance,
        kupiec=kupiec,
    )
