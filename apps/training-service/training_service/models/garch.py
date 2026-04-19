"""GARCH(1,1) volatility model for VaR/CVaR estimation.

Uses the `arch` library to fit a GARCH(1,1) model on portfolio returns,
then derives parametric VaR and CVaR from the conditional volatility forecast.

Distribution support:
  - normal  : standard Normal innovations (fast, underestimates fat tails)
  - t       : Student-t innovations (captures fat tails; uses fitted df)
  - skewt   : Skewed Student-t innovations (asymmetric fat tails)
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
from arch.univariate.base import ARCHModelResult
from scipy import stats

logger = logging.getLogger(__name__)


@dataclass
class GARCHParams:
    """Hyper-parameters for GARCH fitting."""
    p: int = 1          # ARCH lag order
    q: int = 1          # GARCH lag order
    dist: str = "normal"  # innovation distribution: normal | t | skewt
    mean: str = "Zero"  # mean model: Zero | Constant | AR


def _var_cvar_from_dist(
    dist: str,
    fit_result: ARCHModelResult,
    cond_vol: float,
    alpha: float,
) -> tuple[float, float]:
    """Compute parametric VaR and CVaR using the correct innovation distribution.

    Args:
        dist:       Innovation distribution name: 'normal', 't', or 'skewt'.
        fit_result: Fitted ARCHModelResult (contains estimated parameters).
        cond_vol:   1-step-ahead conditional volatility in decimal (not %).
        alpha:      VaR confidence level (e.g. 0.99).

    Returns:
        (var, cvar) — both positive loss numbers.

    Notes:
        - Normal: uses standard Normal quantile.
        - Student-t: uses fitted degrees-of-freedom from the arch result.
          Degrees of freedom are stored in fit_result.params under the key 'nu'.
        - Skewed Student-t: uses fitted nu and lambda (skewness) parameters.
          Falls back to Student-t if lambda is not available.
        - CVaR = E[loss | loss > VaR] computed analytically for Normal/t,
          and numerically (from the fitted distribution) for skewt.
    """
    q_level = 1.0 - alpha  # left-tail quantile level

    if dist == "normal":
        z = stats.norm.ppf(q_level)          # negative number
        var = float(-z * cond_vol)
        pdf_z = stats.norm.pdf(z)
        cvar = float(pdf_z / (1.0 - alpha) * cond_vol)

    elif dist == "t":
        # Extract fitted degrees of freedom; fall back to Normal if not found
        nu = float(fit_result.params.get("nu", 0.0))
        if nu < 2.1:
            # nu too small or not fitted — fall back to Normal
            logger.warning(
                "GARCH dist='t' but nu=%.2f (invalid) — falling back to Normal for VaR/CVaR",
                nu,
            )
            z = stats.norm.ppf(q_level)
            var = float(-z * cond_vol)
            cvar = float(stats.norm.pdf(z) / (1.0 - alpha) * cond_vol)
        else:
            # Student-t quantile (standardised, zero-mean, unit-variance)
            # scipy.stats.t.ppf gives quantile of t(nu); we need standardised t
            # Standardised t has variance nu/(nu-2), so scale by sqrt((nu-2)/nu)
            scale = np.sqrt((nu - 2.0) / nu)
            z = float(stats.t.ppf(q_level, df=nu) * scale)   # negative
            var = float(-z * cond_vol)

            # CVaR for standardised Student-t:
            # E[X | X < z] = -f_t(z; nu) / F_t(z; nu) * (nu + z²) / (nu - 1) * scale
            pdf_z = stats.t.pdf(z / scale, df=nu) / scale
            cdf_z = float(q_level)  # = F_t(z/scale; nu) by construction
            cvar = float(pdf_z / cdf_z * (nu + (z / scale) ** 2) / (nu - 1) * scale * cond_vol)

    elif dist == "skewt":
        # Skewed Student-t: use numerical CVaR from the fitted distribution
        # arch stores skewness parameter as 'lambda' (η in some notations)
        nu = float(fit_result.params.get("nu", 0.0))
        lam = float(fit_result.params.get("lambda", 0.0))

        if nu < 2.1:
            logger.warning(
                "GARCH dist='skewt' but nu=%.2f (invalid) — falling back to Normal",
                nu,
            )
            z = stats.norm.ppf(q_level)
            var = float(-z * cond_vol)
            cvar = float(stats.norm.pdf(z) / (1.0 - alpha) * cond_vol)
        else:
            # Use arch's own distribution object for correct quantile/pdf
            try:
                from arch.univariate.distribution import SkewStudent
                skewt_dist = SkewStudent()
                # ppf returns standardised quantile
                z = float(skewt_dist.ppf(q_level, parameters=np.array([nu, lam])))
                var = float(-z * cond_vol)

                # Numerical CVaR: integrate over the left tail
                # Use 10 000 quantile points for accuracy
                tail_probs = np.linspace(1e-6, q_level, 10_000)
                tail_quantiles = skewt_dist.ppf(tail_probs, parameters=np.array([nu, lam]))
                cvar = float(-np.mean(tail_quantiles) * cond_vol)
            except Exception as exc:
                logger.warning(
                    "SkewStudent CVaR computation failed (%s) — falling back to Student-t",
                    exc,
                )
                # Fall back to Student-t
                scale = np.sqrt((nu - 2.0) / nu)
                z = float(stats.t.ppf(q_level, df=nu) * scale)
                var = float(-z * cond_vol)
                pdf_z = stats.t.pdf(z / scale, df=nu) / scale
                cvar = float(
                    pdf_z / q_level * (nu + (z / scale) ** 2) / (nu - 1) * scale * cond_vol
                )
    else:
        # Unknown distribution — fall back to Normal with a warning
        logger.warning("Unknown GARCH dist=%r — using Normal for VaR/CVaR", dist)
        z = stats.norm.ppf(q_level)
        var = float(-z * cond_vol)
        cvar = float(stats.norm.pdf(z) / (1.0 - alpha) * cond_vol)

    return var, cvar


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

    # Parametric VaR / CVaR — use the correct innovation distribution
    # (Normal, Student-t with fitted df, or Skewed Student-t)
    var, cvar = _var_cvar_from_dist(
        dist=garch_params.dist,
        fit_result=res,
        cond_vol=cond_vol,
        alpha=alpha,
    )

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
        # Out-of-sample backtest metrics are added by the backtesting engine
        # (training_service/backtesting/) after training completes.
        # Use POST /api/risk/backtest for on-demand evaluation.
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
    )


def plot_garch_diagnostics(result: GARCHResult, symbol: str = "portfolio") -> bytes:
    """Generate a 2×2 diagnostic plot and return PNG bytes for MLflow artifact logging."""
    res = result.fit_result
    # std_resid may be ndarray or Series depending on arch version — normalise to Series
    std_resid = pd.Series(np.asarray(res.std_resid).ravel())

    fig, axes = plt.subplots(2, 2, figsize=(12, 8))
    fig.suptitle(f"GARCH(1,1) Diagnostics — {symbol}", fontsize=14)

    # 1. Standardised residuals
    ax = axes[0, 0]
    ax.plot(std_resid.values, linewidth=0.6, color="steelblue")
    ax.axhline(0, color="black", linewidth=0.8, linestyle="--")
    ax.set_title("Standardised Residuals")
    ax.set_xlabel("Observation")
    ax.set_ylabel("Std. Residual")

    # 2. Conditional volatility
    ax = axes[0, 1]
    cond_vol = np.asarray(res.conditional_volatility).ravel() / 100.0  # back to decimal
    ax.plot(cond_vol, linewidth=0.8, color="darkorange")
    ax.set_title("Conditional Volatility (daily)")
    ax.set_xlabel("Observation")
    ax.set_ylabel("Volatility")

    # 3. QQ-plot of standardised residuals
    ax = axes[1, 0]
    clean = std_resid.dropna().values
    (osm, osr), (slope, intercept, _) = stats.probplot(clean, dist="norm")
    ax.scatter(osm, osr, s=4, color="steelblue", alpha=0.6)
    ax.plot(osm, slope * np.array(osm) + intercept, color="red", linewidth=1)
    ax.set_title("QQ-Plot (Normal)")
    ax.set_xlabel("Theoretical Quantiles")
    ax.set_ylabel("Sample Quantiles")

    # 4. Histogram of standardised residuals
    ax = axes[1, 1]
    clean = std_resid.dropna().values
    ax.hist(clean, bins=50, density=True, color="steelblue", alpha=0.7, edgecolor="white")
    x = np.linspace(clean.min(), clean.max(), 200)
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
