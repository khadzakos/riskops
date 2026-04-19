"""Backtest report: structured result + MLflow logging + diagnostic plot.

BacktestReport is the single object that flows from the rolling engine
through the API response and into MLflow. It is JSON-serialisable and
contains everything needed to assess model quality.

MLflow logging
--------------
When an existing run_id is provided, metrics are appended to that run
(so the backtest results live alongside the training metrics on the same run).
When no run_id is given, a standalone run is created in the experiment
"riskops-backtest".

Diagnostic plot
---------------
A two-panel PNG is generated:
  Left  — realised returns vs. predicted -VaR (violations highlighted in red)
  Right — violation hit sequence as a stem plot (clustering visible at a glance)
"""
from __future__ import annotations

import io
import logging
import os
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .rolling_backtest import RollingBacktestResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Report dataclass
# ---------------------------------------------------------------------------

@dataclass
class BacktestReport:
    """Structured summary of a rolling window VaR backtest.

    All numeric fields are JSON-serialisable (float / int / str).
    """
    # Identity
    model_type: str
    symbols: list[str]
    alpha: float
    lookback_days: int
    test_days: int
    run_at: str   # ISO-8601 UTC timestamp

    # Coverage
    violations: int
    total_obs: int
    violation_rate: float
    expected_rate: float

    # Kupiec UC test
    kupiec_lr: float
    kupiec_pvalue: float

    # Christoffersen CC test
    christoffersen_lr_ind: float
    christoffersen_lr_cc: float
    christoffersen_pvalue_ind: float
    christoffersen_pvalue_cc: float

    # Transition matrix
    n_00: int
    n_01: int
    n_10: int
    n_11: int
    pi_01: float   # P(violation | no violation yesterday)
    pi_11: float   # P(violation | violation yesterday)

    # Decision
    status: str   # OK | WARN | CRIT

    # Optional MLflow run linkage
    mlflow_run_id: Optional[str] = None

    def to_dict(self) -> dict:
        """Return a flat dict suitable for JSON serialisation."""
        return asdict(self)

    def to_mlflow_metrics(self) -> dict[str, float]:
        """Return only numeric fields for mlflow.log_metrics()."""
        return {
            "backtest_violations": float(self.violations),
            "backtest_total_obs": float(self.total_obs),
            "backtest_violation_rate": self.violation_rate,
            "backtest_expected_rate": self.expected_rate,
            "kupiec_lr": self.kupiec_lr,
            "kupiec_pvalue": self.kupiec_pvalue,
            "christoffersen_lr_ind": self.christoffersen_lr_ind,
            "christoffersen_lr_cc": self.christoffersen_lr_cc,
            "christoffersen_pvalue_ind": self.christoffersen_pvalue_ind,
            "christoffersen_pvalue_cc": self.christoffersen_pvalue_cc,
            "backtest_pi_01": self.pi_01,
            "backtest_pi_11": self.pi_11,
        }


# ---------------------------------------------------------------------------
# Factory: build BacktestReport from RollingBacktestResult
# ---------------------------------------------------------------------------

def build_report(
    result: RollingBacktestResult,
    symbols: list[str],
    mlflow_run_id: Optional[str] = None,
) -> BacktestReport:
    """Convert a RollingBacktestResult into a BacktestReport.

    Args:
        result:        Output of run_rolling_backtest().
        symbols:       List of ticker symbols used in the backtest.
        mlflow_run_id: Optional run_id to link the report to an existing MLflow run.

    Returns:
        BacktestReport ready for serialisation and MLflow logging.
    """
    kupiec = result.kupiec
    cc = result.christoffersen

    # Defaults when tests could not be run (< 2 observations)
    kupiec_lr = kupiec.lr_statistic if kupiec else float("nan")
    kupiec_pvalue = kupiec.p_value if kupiec else float("nan")

    cc_lr_ind = cc.lr_ind if cc else float("nan")
    cc_lr_cc = cc.lr_cc if cc else float("nan")
    cc_pvalue_ind = cc.p_value_ind if cc else float("nan")
    cc_pvalue_cc = cc.p_value_cc if cc else float("nan")

    n_00 = cc.n_00 if cc else 0
    n_01 = cc.n_01 if cc else 0
    n_10 = cc.n_10 if cc else 0
    n_11 = cc.n_11 if cc else 0
    pi_01 = cc.pi_01 if cc else float("nan")
    pi_11 = cc.pi_11 if cc else float("nan")

    return BacktestReport(
        model_type=result.model_type,
        symbols=symbols,
        alpha=result.alpha,
        lookback_days=result.lookback_days,
        test_days=result.test_days,
        run_at=datetime.now(timezone.utc).isoformat(),
        violations=result.violations,
        total_obs=result.total_obs,
        violation_rate=result.violation_rate,
        expected_rate=result.expected_rate,
        kupiec_lr=kupiec_lr,
        kupiec_pvalue=kupiec_pvalue,
        christoffersen_lr_ind=cc_lr_ind,
        christoffersen_lr_cc=cc_lr_cc,
        christoffersen_pvalue_ind=cc_pvalue_ind,
        christoffersen_pvalue_cc=cc_pvalue_cc,
        n_00=n_00,
        n_01=n_01,
        n_10=n_10,
        n_11=n_11,
        pi_01=pi_01,
        pi_11=pi_11,
        status=result.status,
        mlflow_run_id=mlflow_run_id,
    )


# ---------------------------------------------------------------------------
# Diagnostic plot
# ---------------------------------------------------------------------------

def plot_backtest(
    result: RollingBacktestResult,
    symbol: str = "portfolio",
) -> bytes:
    """Generate a two-panel diagnostic PNG and return the bytes.

    Panel 1 (left): Realised returns vs. predicted -VaR threshold.
                    Violations are highlighted as red dots.
    Panel 2 (right): Hit sequence stem plot — shows clustering of violations.

    Args:
        result: Output of run_rolling_backtest().
        symbol: Label for the plot title.

    Returns:
        PNG image as bytes (suitable for mlflow.log_artifact).
    """
    days = result.day_results
    if not days:
        # Return a minimal blank PNG if no data
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.text(0.5, 0.5, "No backtest data", ha="center", va="center")
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=100)
        plt.close(fig)
        buf.seek(0)
        return buf.read()

    t_idx = np.arange(len(days))
    returns_arr = np.array([d.realised_return for d in days])
    var_arr = np.array([d.var_predicted for d in days])
    hits = np.array([d.violation for d in days])

    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    fig.suptitle(
        f"VaR Backtest — {symbol}  |  model={result.model_type}  "
        f"α={result.alpha:.2%}  violations={result.violations}/{result.total_obs}  "
        f"status={result.status}",
        fontsize=11,
    )

    # --- Panel 1: Returns vs. -VaR ---
    ax = axes[0]
    ax.plot(t_idx, returns_arr, color="steelblue", linewidth=0.8, label="Realised return")
    ax.plot(t_idx, -var_arr, color="darkorange", linewidth=1.2,
            linestyle="--", label=f"-VaR ({result.alpha:.0%})")

    # Highlight violations
    viol_idx = t_idx[hits == 1]
    viol_ret = returns_arr[hits == 1]
    if len(viol_idx) > 0:
        ax.scatter(viol_idx, viol_ret, color="red", zorder=5, s=30, label="Violation")

    ax.axhline(0, color="black", linewidth=0.5, linestyle=":")
    ax.set_title("Realised Returns vs. −VaR Threshold")
    ax.set_xlabel("Out-of-sample day")
    ax.set_ylabel("Daily return")
    ax.legend(fontsize=8)

    # --- Panel 2: Hit sequence ---
    ax = axes[1]
    ax.stem(
        t_idx,
        hits,
        linefmt="C3-",
        markerfmt="C3o",
        basefmt="k-",
    )
    ax.set_title("Violation Hit Sequence (1 = VaR exceeded)")
    ax.set_xlabel("Out-of-sample day")
    ax.set_ylabel("Violation")
    ax.set_ylim(-0.1, 1.4)

    # Annotate p-values
    kupiec = result.kupiec
    cc = result.christoffersen
    if kupiec and cc:
        annotation = (
            f"Kupiec p={kupiec.p_value:.3f}\n"
            f"CC p={cc.p_value_cc:.3f}\n"
            f"π₀₁={cc.pi_01:.3f}  π₁₁={cc.pi_11:.3f}"
        )
        ax.text(
            0.97, 0.97, annotation,
            transform=ax.transAxes,
            ha="right", va="top",
            fontsize=8,
            bbox=dict(boxstyle="round,pad=0.3", facecolor="lightyellow", alpha=0.8),
        )

    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


# ---------------------------------------------------------------------------
# MLflow logging helper
# ---------------------------------------------------------------------------

def log_backtest_to_mlflow(
    report: BacktestReport,
    result: RollingBacktestResult,
    symbol: str = "portfolio",
    run_id: Optional[str] = None,
) -> str:
    """Log backtest metrics, report JSON, and diagnostic plot to MLflow.

    If *run_id* is provided, metrics are appended to that existing run.
    Otherwise a new run is created in the "riskops-backtest" experiment.

    Args:
        report:  BacktestReport to log.
        result:  RollingBacktestResult (used for the plot).
        symbol:  Label for the plot title.
        run_id:  Optional existing MLflow run_id to append metrics to.

    Returns:
        The MLflow run_id used (existing or newly created).
    """
    import json
    import mlflow

    metrics = report.to_mlflow_metrics()
    # Filter out NaN values — MLflow rejects them
    metrics = {k: v for k, v in metrics.items() if not (isinstance(v, float) and np.isnan(v))}

    if run_id:
        # Append to existing run
        with mlflow.start_run(run_id=run_id):
            mlflow.log_metrics(metrics)
            mlflow.log_param("backtest_status", report.status)
            _log_artifacts(report, result, symbol)
        used_run_id = run_id
    else:
        # Standalone backtest run
        mlflow.set_experiment("riskops-backtest")
        run_name = f"backtest-{report.model_type}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
        with mlflow.start_run(run_name=run_name) as run:
            used_run_id = run.info.run_id
            mlflow.log_params({
                "model_type": report.model_type,
                "symbols": ",".join(report.symbols),
                "alpha": report.alpha,
                "lookback_days": report.lookback_days,
                "test_days": report.test_days,
                "backtest_status": report.status,
            })
            mlflow.log_metrics(metrics)
            _log_artifacts(report, result, symbol)

    logger.info(
        "Backtest logged to MLflow run %s: status=%s  violations=%d/%d  "
        "kupiec_p=%.4f  cc_p=%.4f",
        used_run_id, report.status, report.violations, report.total_obs,
        report.kupiec_pvalue, report.christoffersen_pvalue_cc,
    )
    return used_run_id


def _log_artifacts(
    report: BacktestReport,
    result: RollingBacktestResult,
    symbol: str,
) -> None:
    """Log report JSON and diagnostic plot as MLflow artifacts (called inside an active run)."""
    import json
    import mlflow

    # Report JSON
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(report.to_dict(), f, indent=2, default=str)
        tmp_report = f.name
    try:
        mlflow.log_artifact(tmp_report, artifact_path="backtest_reports")
    finally:
        os.unlink(tmp_report)

    # Diagnostic plot
    plot_bytes = plot_backtest(result, symbol=symbol)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(plot_bytes)
        tmp_plot = f.name
    try:
        mlflow.log_artifact(tmp_plot, artifact_path="backtest_plots")
    finally:
        os.unlink(tmp_plot)
