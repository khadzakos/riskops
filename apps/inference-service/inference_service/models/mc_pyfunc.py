"""MLflow pyfunc wrapper for the Monte Carlo GBM model — Inference Service copy.

This file is a copy of apps/training-service/training_service/models/mc_pyfunc.py.
It must be kept in sync so that mlflow.pyfunc.load_model() can unpickle the
MonteCarloModel class when the Inference Service loads a trained MC model.

MLflow serialises the PythonModel subclass by pickling it. When the Inference
Service calls mlflow.pyfunc.load_model(), Python needs to be able to import
the class from its original module path. Since the training and inference
services are separate containers, we keep an identical copy here.

The canonical source of truth is apps/training-service/training_service/models/mc_pyfunc.py.
"""
from __future__ import annotations

import logging
from typing import Any

import mlflow.pyfunc
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

_DEFAULT_N_SIMS = 10_000
_DEFAULT_HORIZON = 1
_DEFAULT_ALPHA = 0.99


class MonteCarloModel(mlflow.pyfunc.PythonModel):
    """MLflow pyfunc model that runs GBM Monte Carlo simulation.

    Stores fitted GBM parameters (mu, sigma) estimated from historical
    portfolio returns at training time. At inference time re-runs the
    simulation with the stored parameters.

    Attributes:
        mu:    Daily GBM drift (log-return mean + 0.5*sigma^2).
        sigma: Daily GBM volatility (std of log-returns).
        seed:  Random seed for reproducibility (None = random).
    """

    def __init__(self, mu: float, sigma: float, seed: int | None = 42) -> None:
        self.mu = mu
        self.sigma = sigma
        self.seed = seed

    def predict(self, context: Any, model_input: pd.DataFrame) -> pd.DataFrame:
        """Run Monte Carlo simulation and return risk metrics.

        Args:
            context:     MLflow context (unused).
            model_input: DataFrame with optional columns:
                         n_simulations, horizon_days, alpha.

        Returns:
            DataFrame with columns: var, cvar, volatility, method.
        """
        results = []
        for _, row in model_input.iterrows():
            n_sims = int(row.get("n_simulations", _DEFAULT_N_SIMS))
            horizon = int(row.get("horizon_days", _DEFAULT_HORIZON))
            alpha = float(row.get("alpha", _DEFAULT_ALPHA))

            var, cvar, vol = self._run_simulation(n_sims, horizon, alpha)
            results.append({
                "var": var,
                "cvar": cvar,
                "volatility": vol,
                "method": "montecarlo",
            })

        return pd.DataFrame(results)

    def _run_simulation(
        self,
        n_simulations: int,
        horizon_days: int,
        alpha: float,
    ) -> tuple[float, float, float]:
        """Run GBM simulation and return (var, cvar, annualised_vol)."""
        rng = np.random.default_rng(self.seed)

        dt = 1.0
        drift = (self.mu - 0.5 * self.sigma ** 2) * dt
        diffusion = self.sigma * np.sqrt(dt)

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

        return var, cvar, vol

    @classmethod
    def from_returns(
        cls,
        returns: np.ndarray,
        seed: int | None = 42,
    ) -> "MonteCarloModel":
        """Estimate GBM parameters from historical returns."""
        sigma = float(np.std(returns, ddof=1))
        mu = float(np.mean(returns)) + 0.5 * sigma ** 2
        return cls(mu=mu, sigma=sigma, seed=seed)
