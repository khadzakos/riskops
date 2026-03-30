"""Monte Carlo simulation for portfolio VaR/CVaR using Geometric Brownian Motion.

Simulates N future price paths for each asset, computes portfolio P&L distribution,
and derives VaR/CVaR from the empirical distribution of simulated returns.
"""
from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field
from typing import Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class MonteCarloParams:
    """Hyper-parameters for Monte Carlo simulation."""
    n_simulations: int = 10_000
    seed: Optional[int] = 42


@dataclass
class MonteCarloResult:
    """Output of a Monte Carlo training run."""
    # Risk metrics
    var: float          # Value-at-Risk (positive number, loss)
    cvar: float         # Conditional VaR / Expected Shortfall
    volatility: float   # Portfolio annualised volatility

    # Simulation statistics
    mean_return: float
    std_return: float
    n_simulations: int

    # Serialisable params/metrics for MLflow
    params: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)

    # Simulated returns array (kept for plotting)
    simulated_returns: Optional[np.ndarray] = None

    def to_mlflow_params(self) -> dict:
        return self.params

    def to_mlflow_metrics(self) -> dict:
        return self.metrics


def _estimate_gbm_params(returns: np.ndarray) -> tuple[float, float]:
    """Estimate GBM drift (mu) and volatility (sigma) from historical returns.

    Uses MLE: mu = mean(r) + 0.5*sigma^2, sigma = std(r).
    Returns daily mu and sigma.
    """
    sigma = float(np.std(returns, ddof=1))
    mu = float(np.mean(returns)) + 0.5 * sigma ** 2
    return mu, sigma


def _estimate_covariance(returns_matrix: np.ndarray) -> np.ndarray:
    """Estimate covariance matrix from a (T x N) returns matrix."""
    return np.cov(returns_matrix.T, ddof=1)


def run_monte_carlo(
    returns: np.ndarray,
    alpha: float = 0.99,
    horizon_days: int = 1,
    weights: Optional[np.ndarray] = None,
    mc_params: Optional[MonteCarloParams] = None,
) -> MonteCarloResult:
    """Run Monte Carlo simulation on portfolio returns.

    Supports both single-asset (1-D returns) and multi-asset (2-D returns matrix).

    Args:
        returns: Either 1-D array of portfolio returns, or 2-D (T × N) matrix of
                 individual asset returns. If 2-D, *weights* must be provided.
        alpha: Confidence level for VaR (e.g. 0.99).
        horizon_days: Forecast horizon in trading days.
        weights: Portfolio weights (N,) for multi-asset case. Must sum to 1.
        mc_params: Simulation hyper-parameters.

    Returns:
        MonteCarloResult with simulated risk metrics.
    """
    if mc_params is None:
        mc_params = MonteCarloParams()

    rng = np.random.default_rng(mc_params.seed)

    if returns.ndim == 1:
        # Single-asset / pre-aggregated portfolio returns
        if len(returns) < 30:
            raise ValueError(f"Need at least 30 return observations, got {len(returns)}")
        mu, sigma = _estimate_gbm_params(returns)
        simulated = _simulate_gbm_1d(mu, sigma, horizon_days, mc_params.n_simulations, rng)
    else:
        # Multi-asset: returns is (T × N)
        if returns.shape[0] < 30:
            raise ValueError(f"Need at least 30 return observations, got {returns.shape[0]}")
        n_assets = returns.shape[1]
        if weights is None:
            weights = np.ones(n_assets) / n_assets
        weights = np.asarray(weights, dtype=float)
        weights = weights / weights.sum()

        simulated = _simulate_gbm_multiasset(returns, weights, horizon_days, mc_params.n_simulations, rng)

    # Risk metrics from empirical distribution
    var_quantile = np.quantile(simulated, 1.0 - alpha)  # negative number (loss)
    var = float(-var_quantile)
    tail = simulated[simulated <= var_quantile]
    cvar = float(-tail.mean()) if len(tail) > 0 else var

    vol_annualised = float(np.std(simulated, ddof=1) * np.sqrt(252 / horizon_days))
    mean_ret = float(np.mean(simulated))
    std_ret = float(np.std(simulated, ddof=1))

    logger.info(
        "Monte Carlo: n=%d  VaR(%.0f%%)=%.6f  CVaR=%.6f  vol=%.4f",
        mc_params.n_simulations, alpha * 100, var, cvar, vol_annualised,
    )

    params = {
        "model_type": "montecarlo",
        "n_simulations": mc_params.n_simulations,
        "alpha": alpha,
        "horizon_days": horizon_days,
        "n_observations": int(returns.shape[0]),
        "seed": mc_params.seed if mc_params.seed is not None else -1,
    }
    metrics = {
        "var": var,
        "cvar": cvar,
        "volatility": vol_annualised,
        "mean_simulated_return": mean_ret,
        "std_simulated_return": std_ret,
    }

    return MonteCarloResult(
        var=var,
        cvar=cvar,
        volatility=vol_annualised,
        mean_return=mean_ret,
        std_return=std_ret,
        n_simulations=mc_params.n_simulations,
        params=params,
        metrics=metrics,
        simulated_returns=simulated,
    )


def _simulate_gbm_1d(
    mu: float,
    sigma: float,
    horizon: int,
    n_sims: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Simulate GBM log-returns for a single asset over *horizon* days.

    Returns array of shape (n_sims,) with total log-returns over the horizon.
    """
    # Each simulation: sum of horizon daily log-returns
    # log-return ~ N((mu - 0.5*sigma^2)*dt, sigma^2*dt), dt=1 day
    dt = 1.0
    drift = (mu - 0.5 * sigma ** 2) * dt
    diffusion = sigma * np.sqrt(dt)
    # Shape: (n_sims, horizon)
    daily_log_returns = rng.normal(loc=drift, scale=diffusion, size=(n_sims, horizon))
    total_log_returns = daily_log_returns.sum(axis=1)
    # Convert log-return to simple return: e^r - 1
    return np.exp(total_log_returns) - 1.0


def _simulate_gbm_multiasset(
    returns: np.ndarray,
    weights: np.ndarray,
    horizon: int,
    n_sims: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Simulate correlated GBM paths for multiple assets using Cholesky decomposition.

    Args:
        returns: (T × N) historical returns matrix.
        weights: (N,) portfolio weights.
        horizon: Forecast horizon in days.
        n_sims: Number of simulations.
        rng: Random number generator.

    Returns:
        (n_sims,) array of simulated portfolio returns over the horizon.
    """
    n_assets = returns.shape[1]
    mu_vec = np.mean(returns, axis=0)
    cov_mat = _estimate_covariance(returns)

    # Cholesky decomposition for correlated sampling
    try:
        L = np.linalg.cholesky(cov_mat)
    except np.linalg.LinAlgError:
        # Fallback: add small regularisation if matrix is not positive definite
        cov_mat += np.eye(n_assets) * 1e-8
        L = np.linalg.cholesky(cov_mat)

    sigma_vec = np.sqrt(np.diag(cov_mat))
    drift_vec = mu_vec - 0.5 * sigma_vec ** 2  # daily drift

    # Simulate: (n_sims, horizon, n_assets)
    z = rng.standard_normal((n_sims, horizon, n_assets))
    # Apply Cholesky: correlated shocks
    corr_z = z @ L.T  # (n_sims, horizon, n_assets)

    daily_log_returns = drift_vec + corr_z  # broadcast drift
    total_log_returns = daily_log_returns.sum(axis=1)  # (n_sims, n_assets)
    asset_simple_returns = np.exp(total_log_returns) - 1.0  # (n_sims, n_assets)

    # Portfolio return = weighted sum of asset returns
    portfolio_returns = asset_simple_returns @ weights  # (n_sims,)
    return portfolio_returns


def plot_monte_carlo_distribution(result: MonteCarloResult, symbol: str = "portfolio") -> bytes:
    """Generate a return distribution plot and return PNG bytes for MLflow artifact logging."""
    if result.simulated_returns is None:
        raise ValueError("simulated_returns not available in result")

    sims = result.simulated_returns
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    fig.suptitle(f"Monte Carlo Simulation — {symbol} ({result.n_simulations:,} paths)", fontsize=13)

    # 1. Return distribution histogram
    ax = axes[0]
    ax.hist(sims, bins=100, density=True, color="steelblue", alpha=0.7, edgecolor="white")
    ax.axvline(-result.var, color="red", linewidth=1.5, linestyle="--", label=f"VaR = {result.var:.4f}")
    ax.axvline(-result.cvar, color="darkred", linewidth=1.5, linestyle=":", label=f"CVaR = {result.cvar:.4f}")
    ax.set_title("Simulated Return Distribution")
    ax.set_xlabel("Portfolio Return")
    ax.set_ylabel("Density")
    ax.legend()

    # 2. Cumulative distribution
    ax = axes[1]
    sorted_sims = np.sort(sims)
    cdf = np.arange(1, len(sorted_sims) + 1) / len(sorted_sims)
    ax.plot(sorted_sims, cdf, color="steelblue", linewidth=1)
    ax.axvline(-result.var, color="red", linewidth=1.5, linestyle="--", label=f"VaR = {result.var:.4f}")
    ax.axvline(-result.cvar, color="darkred", linewidth=1.5, linestyle=":", label=f"CVaR = {result.cvar:.4f}")
    ax.set_title("Cumulative Distribution")
    ax.set_xlabel("Portfolio Return")
    ax.set_ylabel("Probability")
    ax.legend()

    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100)
    plt.close(fig)
    buf.seek(0)
    return buf.read()
