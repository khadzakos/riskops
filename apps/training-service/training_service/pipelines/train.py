"""Training pipeline: fetch data → train models → log to MLflow → register models.

This module is the single entry point for all training runs. It is called:
  - By the FastAPI endpoint POST /api/risk/train
  - By the Kafka consumer when a market.data.ingested event arrives
"""
from __future__ import annotations

import json
import logging
import os
import pickle
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import mlflow
import mlflow.pyfunc
import numpy as np
import pandas as pd
from sqlalchemy import text

from ..config import get_settings
from ..db import get_engine
from ..metrics.risk_metrics import RiskMetrics, compute_all as compute_risk_metrics
from ..models.garch import GARCHParams, GARCHResult, plot_garch_diagnostics, train_garch
from ..models.mc_pyfunc import MonteCarloModel
from ..models.montecarlo import MonteCarloParams, MonteCarloResult, plot_monte_carlo_distribution, run_monte_carlo

logger = logging.getLogger(__name__)

def load_returns(
    symbols: list[str],
    lookback_days: int = 252,
) -> pd.DataFrame:
    """Load processed_returns from Postgres for the given symbols."""
    engine = get_engine()
    with engine.connect() as conn:
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
            f"No processed_returns found for symbols: {symbols}. "
            "Run market data ingestion first."
        )

    df["ret"] = df["ret"].astype(float)

    # Keep only the last lookback_days rows per symbol
    df = (
        df.groupby("symbol", group_keys=False)
        .apply(lambda g: g.tail(lookback_days))
        .reset_index(drop=True)
    )

    logger.info(
        "Loaded %d return rows for %d symbols (lookback=%d)",
        len(df), df["symbol"].nunique(), lookback_days,
    )
    return df


def build_portfolio_returns(
    returns_df: pd.DataFrame,
    weights: Optional[dict[str, float]] = None,
) -> np.ndarray:
    """Pivot returns into a portfolio return series.

    If *weights* is None, uses equal weights.
    Returns a 1-D numpy array of portfolio returns.
    """
    pivot = returns_df.pivot(index="price_date", columns="symbol", values="ret").dropna()
    symbols = list(pivot.columns)

    if weights is None:
        w = np.ones(len(symbols)) / len(symbols)
    else:
        w = np.array([weights.get(s, 0.0) for s in symbols], dtype=float)
        total = w.sum()
        if total <= 0:
            raise ValueError("Sum of weights must be > 0")
        w = w / total

    port_rets = pivot.values @ w
    return port_rets.astype(float)


# ---------------------------------------------------------------------------
# MLflow helpers
# ---------------------------------------------------------------------------

def _setup_mlflow() -> None:
    cfg = get_settings()
    mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
    os.environ.setdefault("MLFLOW_S3_ENDPOINT_URL", cfg.mlflow_s3_endpoint_url)
    os.environ.setdefault("AWS_ACCESS_KEY_ID", cfg.aws_access_key_id)
    os.environ.setdefault("AWS_SECRET_ACCESS_KEY", cfg.aws_secret_access_key)


def _register_model_in_db(
    model_name: str,
    model_version: str,
    mlflow_run_id: str,
    metrics: dict,
) -> None:
    """Upsert a row in the model_registry table."""
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO model_registry (model_name, model_version, mlflow_run_id, status, metrics)
                VALUES (:model_name, :model_version, :run_id, 'staging', cast(:metrics as jsonb))
                ON CONFLICT (model_name, model_version) DO UPDATE SET
                    mlflow_run_id = EXCLUDED.mlflow_run_id,
                    metrics = EXCLUDED.metrics,
                    created_at = NOW()
                """
            ),
            {
                "model_name": model_name,
                "model_version": model_version,
                "run_id": mlflow_run_id,
                "metrics": json.dumps(metrics),
            },
        )
    logger.info("Registered model %s v%s in model_registry", model_name, model_version)


# ---------------------------------------------------------------------------
# Training request / result types
# ---------------------------------------------------------------------------

@dataclass
class TrainRequest:
    symbols: list[str]
    model_type: str = "all"          # garch | montecarlo | all
    alpha: float = 0.99
    horizon_days: int = 1
    lookback_days: int = 252
    weights: Optional[dict[str, float]] = None
    n_simulations: int = 10_000


@dataclass
class TrainResult:
    run_id: str
    model_type: str
    model_name: str
    model_version: str
    var: float
    cvar: float
    volatility: float
    metrics: dict
    status: str = "completed"
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Individual model trainers
# ---------------------------------------------------------------------------

def _train_garch_pipeline(
    port_rets: np.ndarray,
    req: TrainRequest,
    experiment_name: str,
) -> TrainResult:
    """Train GARCH(1,1), log to MLflow, register model."""
    _setup_mlflow()
    mlflow.set_experiment(experiment_name)

    garch_params = GARCHParams(p=1, q=1, dist="normal", mean="Zero")
    result: GARCHResult = train_garch(
        port_rets,
        alpha=req.alpha,
        horizon_days=req.horizon_days,
        garch_params=garch_params,
    )

    run_name = f"garch-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    model_name = "riskops-garch"

    with mlflow.start_run(run_name=run_name) as run:
        run_id = run.info.run_id

        # Compute additional risk metrics (Max Drawdown, Sharpe, Sortino, Beta)
        extra_metrics = compute_risk_metrics(
            returns=port_rets,
            var=result.var,
            cvar=result.cvar,
            volatility=result.volatility,
        )

        # Log params and metrics (core + additional)
        mlflow.log_params({**result.to_mlflow_params(), "symbols": ",".join(req.symbols)})
        all_metrics = {**result.to_mlflow_metrics(), **extra_metrics.to_dict()}
        mlflow.log_metrics(all_metrics)

        # Log diagnostic plot
        plot_bytes = plot_garch_diagnostics(result, symbol=",".join(req.symbols))
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(plot_bytes)
            tmp_plot = f.name
        mlflow.log_artifact(tmp_plot, artifact_path="plots")
        os.unlink(tmp_plot)

        # Log risk report JSON (extended with additional metrics)
        report = {
            "model_type": "garch",
            "symbols": req.symbols,
            "alpha": req.alpha,
            "horizon_days": req.horizon_days,
            "var": result.var,
            "cvar": result.cvar,
            "volatility": result.volatility,
            "max_drawdown": extra_metrics.max_drawdown,
            "sharpe_ratio": extra_metrics.sharpe_ratio,
            "sortino_ratio": extra_metrics.sortino_ratio,
            "beta_to_benchmark": extra_metrics.beta_to_benchmark,
            "aic": result.aic,
            "bic": result.bic,
            "backtest_coverage_ratio": result.backtest_coverage_ratio,
            "trained_at": datetime.now(timezone.utc).isoformat(),
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(report, f, indent=2)
            tmp_report = f.name
        mlflow.log_artifact(tmp_report, artifact_path="reports")
        os.unlink(tmp_report)

        # Pickle and log the fitted arch model result
        with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False) as f:
            pickle.dump(result.fit_result, f)
            tmp_model = f.name
        mlflow.log_artifact(tmp_model, artifact_path="model")
        os.unlink(tmp_model)

        # Register model version in MLflow Model Registry
        model_version_str = _register_mlflow_model(run_id, model_name)

    # Register in Postgres model_registry (store all metrics including additional ones)
    _register_model_in_db(
        model_name=model_name,
        model_version=model_version_str,
        mlflow_run_id=run_id,
        metrics=all_metrics,
    )

    logger.info(
        "GARCH training complete: run_id=%s  VaR=%.6f  CVaR=%.6f  MDD=%.4f  Sharpe=%.3f",
        run_id, result.var, result.cvar,
        extra_metrics.max_drawdown, extra_metrics.sharpe_ratio,
    )

    return TrainResult(
        run_id=run_id,
        model_type="garch",
        model_name=model_name,
        model_version=model_version_str,
        var=result.var,
        cvar=result.cvar,
        volatility=result.volatility,
        metrics=all_metrics,
    )


def _train_montecarlo_pipeline(
    port_rets: np.ndarray,
    req: TrainRequest,
    experiment_name: str,
) -> TrainResult:
    """Run Monte Carlo simulation, log to MLflow, register model."""
    _setup_mlflow()
    mlflow.set_experiment(experiment_name)

    mc_params = MonteCarloParams(n_simulations=req.n_simulations, seed=42)
    result: MonteCarloResult = run_monte_carlo(
        port_rets,
        alpha=req.alpha,
        horizon_days=req.horizon_days,
        mc_params=mc_params,
    )

    run_name = f"montecarlo-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    model_name = "riskops-montecarlo"

    with mlflow.start_run(run_name=run_name) as run:
        run_id = run.info.run_id

        # Compute additional risk metrics (Max Drawdown, Sharpe, Sortino, Beta)
        extra_metrics = compute_risk_metrics(
            returns=port_rets,
            var=result.var,
            cvar=result.cvar,
            volatility=result.volatility,
        )

        mlflow.log_params({**result.to_mlflow_params(), "symbols": ",".join(req.symbols)})
        all_metrics = {**result.to_mlflow_metrics(), **extra_metrics.to_dict()}
        mlflow.log_metrics(all_metrics)

        # Log distribution plot
        plot_bytes = plot_monte_carlo_distribution(result, symbol=",".join(req.symbols))
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(plot_bytes)
            tmp_plot = f.name
        mlflow.log_artifact(tmp_plot, artifact_path="plots")
        os.unlink(tmp_plot)

        # Log risk report JSON (extended with additional metrics)
        report = {
            "model_type": "montecarlo",
            "symbols": req.symbols,
            "alpha": req.alpha,
            "horizon_days": req.horizon_days,
            "n_simulations": req.n_simulations,
            "var": result.var,
            "cvar": result.cvar,
            "volatility": result.volatility,
            "max_drawdown": extra_metrics.max_drawdown,
            "sharpe_ratio": extra_metrics.sharpe_ratio,
            "sortino_ratio": extra_metrics.sortino_ratio,
            "beta_to_benchmark": extra_metrics.beta_to_benchmark,
            "mean_return": result.mean_return,
            "std_return": result.std_return,
            "trained_at": datetime.now(timezone.utc).isoformat(),
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(report, f, indent=2)
            tmp_report = f.name
        mlflow.log_artifact(tmp_report, artifact_path="reports")
        os.unlink(tmp_report)

        # Build and log a proper mlflow.pyfunc model so the Inference Service
        # can load it with mlflow.pyfunc.load_model() and call predict().
        mc_pyfunc_model = MonteCarloModel.from_returns(
            port_rets, seed=mc_params.seed
        )
        # Also save a human-readable params JSON alongside the pyfunc model
        params_json = {
            "mu": mc_pyfunc_model.mu,
            "sigma": mc_pyfunc_model.sigma,
            "seed": mc_pyfunc_model.seed,
            "params": result.to_mlflow_params(),
            "metrics": result.to_mlflow_metrics(),
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(params_json, f, indent=2)
            tmp_params = f.name

        mlflow.pyfunc.log_model(
            artifact_path="model",
            python_model=mc_pyfunc_model,
            # Embed the params JSON as an extra artifact inside the model directory
            artifacts={"params_json": tmp_params},
        )
        os.unlink(tmp_params)

        model_version_str = _register_mlflow_model(run_id, model_name)

    _register_model_in_db(
        model_name=model_name,
        model_version=model_version_str,
        mlflow_run_id=run_id,
        metrics=all_metrics,
    )

    logger.info(
        "Monte Carlo training complete: run_id=%s  VaR=%.6f  CVaR=%.6f  MDD=%.4f  Sharpe=%.3f",
        run_id, result.var, result.cvar,
        extra_metrics.max_drawdown, extra_metrics.sharpe_ratio,
    )

    return TrainResult(
        run_id=run_id,
        model_type="montecarlo",
        model_name=model_name,
        model_version=model_version_str,
        var=result.var,
        cvar=result.cvar,
        volatility=result.volatility,
        metrics=result.to_mlflow_metrics(),
    )


def _register_mlflow_model(run_id: str, model_name: str) -> str:
    """Register a model version in the MLflow Model Registry.

    Returns the version string (e.g. "1", "2", ...).
    """
    try:
        client = mlflow.tracking.MlflowClient()
        # Ensure the registered model exists
        try:
            client.get_registered_model(model_name)
        except mlflow.exceptions.MlflowException:
            client.create_registered_model(model_name)

        # Create a new version pointing to the run's artifacts
        mv = client.create_model_version(
            name=model_name,
            source=f"runs:/{run_id}/model",
            run_id=run_id,
        )
        logger.info("Registered MLflow model %s version %s", model_name, mv.version)
        return str(mv.version)
    except Exception as exc:
        logger.warning("Could not register MLflow model: %s", exc)
        return "unknown"


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_training(req: TrainRequest) -> list[TrainResult]:
    """Run the full training pipeline for the requested model type(s).

    Returns a list of TrainResult (one per model trained).
    """
    logger.info(
        "Starting training: model_type=%s  symbols=%s  alpha=%.2f  horizon=%d",
        req.model_type, req.symbols, req.alpha, req.horizon_days,
    )

    # Load data
    returns_df = load_returns(req.symbols, lookback_days=req.lookback_days)
    port_rets = build_portfolio_returns(returns_df, weights=req.weights)

    results: list[TrainResult] = []
    model_types = (
        ["garch", "montecarlo"] if req.model_type == "all" else [req.model_type]
    )

    for mt in model_types:
        experiment_name = f"riskops-{mt}"
        try:
            if mt == "garch":
                r = _train_garch_pipeline(port_rets, req, experiment_name)
            elif mt == "montecarlo":
                r = _train_montecarlo_pipeline(port_rets, req, experiment_name)
            else:
                logger.warning("Unknown model type: %s — skipping", mt)
                continue
            results.append(r)
        except Exception as exc:
            logger.exception("Training failed for model_type=%s: %s", mt, exc)
            results.append(
                TrainResult(
                    run_id="",
                    model_type=mt,
                    model_name=f"riskops-{mt}",
                    model_version="",
                    var=0.0,
                    cvar=0.0,
                    volatility=0.0,
                    metrics={},
                    status="failed",
                    error=str(exc),
                )
            )

    return results
