"""Backtesting engine for VaR model validation.

Public API
----------
Rolling window out-of-sample backtest:
    run_rolling_backtest(returns, model_type, alpha, lookback_days, test_days)
    → RollingBacktestResult

Statistical tests:
    kupiec_test(violations, total_obs, alpha)       → KupiecResult
    christoffersen_test(hit_sequence, alpha)         → ChristoffersenResult

Report & MLflow logging:
    build_report(result, symbols)                    → BacktestReport
    log_backtest_to_mlflow(report, result, symbol)   → run_id (str)
    plot_backtest(result, symbol)                    → bytes (PNG)
"""
from .christoffersen import ChristoffersenResult, christoffersen_test
from .kupiec import KupiecResult, kupiec_test
from .report import BacktestReport, build_report, log_backtest_to_mlflow, plot_backtest
from .rolling_backtest import DayResult, RollingBacktestResult, run_rolling_backtest

__all__ = [
    # Rolling engine
    "run_rolling_backtest",
    "RollingBacktestResult",
    "DayResult",
    # Statistical tests
    "kupiec_test",
    "KupiecResult",
    "christoffersen_test",
    "ChristoffersenResult",
    # Report
    "BacktestReport",
    "build_report",
    "log_backtest_to_mlflow",
    "plot_backtest",
]
