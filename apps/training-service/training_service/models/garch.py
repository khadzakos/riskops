"""GARCH(1,1) volatility model for VaR/CVaR estimation.

Uses the `arch` library to fit a GARCH(1,1) model on portfolio returns,
then derives parametric VaR and CVaR from the conditional volatility forecast.
"""
from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field
from typing import Optional

import matplotlib
matplotlib.use("Agg")  # non-interactive backend before pyplot import
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from arch import arch_model
from arch.univariate import ARCHModelResult
from scipy import stats

logger = logging.getLogger(__name__)


@dataclass
class GARCHParams:
    """Hyper-parameters for GARCH fitting."""
    p: int = 1          # ARCH lag order
    q: int = 1          # GARCH lag order
    dist: str = "normal"  # innovation distribution: normal | t | skewt
    mean: str = "Zero"  # mean model: Zero | Constant | AR


@dataclass
class GARCHResult:
    """Output of a GARCH training run."""
    # Fitted model result (arch library object)
    fit_result: ARCHModelResult

    # Risk metrics
    var: float          # Value-at-Risk (positive number, loss)
    cvar: float         # Conditional VaR / Expected Shortfall
    volatility: float   # 1-step-ahead conditional volatility forecast (annualised)

    # Model diagnostics
    aic: float
    bic: float
    log_likelihood: float

    # Serialisable params for MLflow
    params: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)

    # Backtest
    backtest_coverage_ratio: Optional[float] = None

    def to_mlflow_params(self) -> dict:
        return self.params

    def to_mlflow_metrics(self) -> dict:
        return self.metrics


def train_garch(
    returns: np.ndarray,
    alpha: float = 0.99,
    horizon_days: int = 1,
    garch_params: Optional[GARCHParams] = None,
) -> GARCHResult:
    """Fit GARCH(p,q) on *returns* and compute VaR/CVaR.

    Args:
        returns: 1-D array of daily portfolio returns (e.g. -0.02 = -2%).
        alpha: Confidence level for VaR (e.g. 0.99).
        horizon_days: Forecast horizon in trading days.
        garch_params: Model hyper-parameters; defaults to GARCH(1,1) with Normal innovations.

    Returns:
        GARCHResult with fitted model and risk metrics.
    """
    if garch_params is None:
        garch_params = GARCHParams()

    if len(returns) < 30:
        raise ValueError(f"Need at least 30 return observations, got {len(returns)}")

    # arch expects returns scaled to percentage points for numerical stability
    scaled = returns * 100.0

    am = arch_model(
        scaled,
        mean=garch_params.mean,
        vol="GARCH",
        p=garch_params.p,
        q=garch_params.q,
        dist=garch_params.dist,
    )

    res = am.fit(disp="off", show_warning=False)
    logger.info("GARCH fit: AIC=%.4f  BIC=%.4f  LL=%.4f", res.aic, res.bic, res.loglikelihood)

    # 1-step-ahead conditional volatility forecast (in percentage points)
    forecast = res.forecast(horizon=horizon_days, reindex=False)
    cond_var_pct = float(forecast.variance.iloc[-1, horizon_days - 1])
    cond_vol_pct = np.sqrt(cond_var_pct)

    # Convert back to decimal
    cond_vol = cond_vol_pct / 100.0

    # Annualised volatility (√252 scaling)
    vol_annualised = cond_vol * np.sqrt(252)

    # Parametric VaR / CVaR using Normal distribution
    # (even when dist='t', we use Normal for simplicity in MVP; can extend later)
    z_alpha = stats.norm.ppf(1.0 - alpha)  # negative quantile for left tail
    var = float(-z_alpha * cond_vol)       # positive loss number

    # CVaR = E[loss | loss > VaR] = φ(z_α) / (1-α) * σ
    pdf_z = stats.norm.pdf(z_alpha)
    cvar = float(pdf_z / (1.0 - alpha) * cond_vol)

    # Backtest: fraction of historical returns worse than -VaR
    exceedances = np.sum(returns < -var)
    coverage_ratio = float(exceedances / len(returns))

    params = {
        "model_type": "garch",
        "p": garch_params.p,
        "q": garch_params.q,
        "dist": garch_params.dist,
        "mean": garch_params.mean,
        "alpha": alpha,
        "horizon_days": horizon_days,
        "n_observations": len(returns),
    }
    metrics = {
        "var": var,
        "cvar": cvar,
        "volatility": vol_annualised,
        "aic": float(res.aic),
        "bic": float(res.bic),
        "log_likelihood": float(res.loglikelihood),
        "backtest_coverage_ratio": coverage_ratio,
        "expected_coverage_ratio": 1.0 - alpha,
    }

    return GARCHResult(
        fit_result=res,
        var=var,
        cvar=cvar,
        volatility=vol_annualised,
        aic=float(res.aic),
        bic=float(res.bic),
        log_likelihood=float(res.loglikelihood),
        params=params,
        metrics=metrics,
        backtest_coverage_ratio=coverage_ratio,
    )


def plot_garch_diagnostics(result: GARCHResult, symbol: str = "portfolio") -> bytes:
    """Generate a 2×2 diagnostic plot and return PNG bytes for MLflow artifact logging."""
    res = result.fit_result
    std_resid = res.std_resid

    fig, axes = plt.subplots(2, 2, figsize=(12, 8))
    fig.suptitle(f"GARCH(1,1) Diagnostics — {symbol}", fontsize=14)

    # 1. Standardised residuals
    ax = axes[0, 0]
    ax.plot(std_resid, linewidth=0.6, color="steelblue")
    ax.axhline(0, color="black", linewidth=0.8, linestyle="--")
    ax.set_title("Standardised Residuals")
    ax.set_xlabel("Observation")
    ax.set_ylabel("Std. Residual")

    # 2. Conditional volatility
    ax = axes[0, 1]
    cond_vol = res.conditional_volatility / 100.0  # back to decimal
    ax.plot(cond_vol, linewidth=0.8, color="darkorange")
    ax.set_title("Conditional Volatility (daily)")
    ax.set_xlabel("Observation")
    ax.set_ylabel("Volatility")

    # 3. QQ-plot of standardised residuals
    ax = axes[1, 0]
    (osm, osr), (slope, intercept, _) = stats.probplot(std_resid.dropna(), dist="norm")
    ax.scatter(osm, osr, s=4, color="steelblue", alpha=0.6)
    ax.plot(osm, slope * np.array(osm) + intercept, color="red", linewidth=1)
    ax.set_title("QQ-Plot (Normal)")
    ax.set_xlabel("Theoretical Quantiles")
    ax.set_ylabel("Sample Quantiles")

    # 4. Histogram of standardised residuals
    ax = axes[1, 1]
    ax.hist(std_resid.dropna(), bins=50, density=True, color="steelblue", alpha=0.7, edgecolor="white")
    x = np.linspace(std_resid.min(), std_resid.max(), 200)
    ax.plot(x, stats.norm.pdf(x), color="red", linewidth=1.5, label="N(0,1)")
    ax.set_title("Residual Distribution")
    ax.set_xlabel("Std. Residual")
    ax.set_ylabel("Density")
    ax.legend()

    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100)
    plt.close(fig)
    buf.seek(0)
    return buf.read()
