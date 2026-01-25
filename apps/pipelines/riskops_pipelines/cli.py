from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import numpy as np
import pandas as pd
import typer

from sqlalchemy import text

from .db import db_conn, get_engine

app = typer.Typer(no_args_is_help=True)


def _parse_symbols(symbols: str) -> list[str]:
    out = [s.strip().upper() for s in symbols.split(",")]
    return [s for s in out if s]

def _parse_date(s: str) -> date:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError as e:
        raise typer.BadParameter("Date must be in YYYY-MM-DD format") from e


def _bday_range(start: date, end: date) -> pd.DatetimeIndex:
    return pd.bdate_range(start=pd.Timestamp(start), end=pd.Timestamp(end), tz=None)


@dataclass(frozen=True)
class RiskMetrics:
    var: float
    cvar: float


def _historical_var_cvar(returns: np.ndarray, alpha: float) -> RiskMetrics:
    # returns: array of portfolio returns (e.g. daily)
    if returns.size < 5:
        raise ValueError("Not enough returns to compute VaR/CVaR (need >= 5)")
    q = np.quantile(returns, 1.0 - alpha)  # left tail quantile (usually negative)
    tail = returns[returns <= q]
    var = float(-q)
    cvar = float(-tail.mean()) if tail.size > 0 else var
    return RiskMetrics(var=var, cvar=cvar)


@app.command()
def ingest(
    symbols: str = typer.Option("AAPL,MSFT", help="Comma-separated symbols"),
    start: str = typer.Option("2024-01-01", help="Start date (YYYY-MM-DD)"),
    end: str = typer.Option("2024-12-31", help="End date (YYYY-MM-DD)"),
    source: str = typer.Option("synthetic", help="Data source: synthetic|csv"),
    csv_path: Optional[str] = typer.Option(None, help="CSV path when source=csv"),
    seed: int = typer.Option(7, help="Random seed for synthetic"),
) -> None:
    """
    Load raw close prices into raw_prices.

    MVP default is synthetic prices (random walk), so it works without external APIs.
    """
    syms = _parse_symbols(symbols)
    start_d = _parse_date(start)
    end_d = _parse_date(end)
    idx = _bday_range(start_d, end_d)
    if len(idx) == 0:
        raise typer.BadParameter("No business days in given range")

    rows: list[tuple[str, date, float, str, str]] = []

    if source == "csv":
        if not csv_path:
            raise typer.BadParameter("csv_path is required when source=csv")
        df = pd.read_csv(csv_path)
        # expected columns: symbol, date, close
        df["symbol"] = df["symbol"].astype(str).str.upper()
        df["date"] = pd.to_datetime(df["date"]).dt.date
        df["close"] = df["close"].astype(float)
        df = df[df["symbol"].isin(syms)]
        for r in df.itertuples(index=False):
            rows.append((r.symbol, r.date, float(r.close), None, "csv"))
    else:
        rng = np.random.default_rng(seed)
        for sym in syms:
            # simple random walk on log-returns
            mu = 0.0002
            sigma = 0.02
            lr = rng.normal(loc=mu, scale=sigma, size=len(idx))
            price0 = rng.uniform(80, 200)
            prices = price0 * np.exp(np.cumsum(lr))
            for ts, px in zip(idx, prices, strict=False):
                rows.append((sym, ts.date(), float(px), "USD", "synthetic"))

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO raw_prices(symbol, price_date, close, currency, source)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (symbol, price_date) DO UPDATE SET
                  close = EXCLUDED.close,
                  currency = COALESCE(EXCLUDED.currency, raw_prices.currency),
                  source = EXCLUDED.source,
                  ingested_at = NOW()
                """,
                rows,
            )

    typer.echo(f"Inserted/updated raw_prices: {len(rows)} rows for {len(syms)} symbols")


@app.command()
def process(symbols: str = typer.Option("AAPL,MSFT", help="Comma-separated symbols")) -> None:
    """Compute simple returns from raw_prices into processed_returns."""
    syms = _parse_symbols(symbols)

    engine = get_engine()
    with engine.connect() as conn:
        df = pd.read_sql(
            text(
                """
                SELECT symbol, price_date, close
                FROM raw_prices
                WHERE symbol = ANY(:symbols)
                ORDER BY symbol, price_date
                """
            ),
            conn,
            params={"symbols": syms},
        )

    if df.empty:
        raise RuntimeError("No raw_prices found for given symbols")

    df["close"] = df["close"].astype(float)
    df["ret"] = df.groupby("symbol")["close"].pct_change()
    df = df.dropna(subset=["ret"])

    rows = [(r.symbol, r.price_date, float(r.ret)) for r in df.itertuples(index=False)]

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO processed_returns(symbol, price_date, ret)
                VALUES (%s, %s, %s)
                ON CONFLICT (symbol, price_date) DO UPDATE SET
                  ret = EXCLUDED.ret,
                  computed_at = NOW()
                """,
                rows,
            )

    typer.echo(f"Inserted/updated processed_returns: {len(rows)} rows")


@app.command()
def risk(
    portfolio: str = typer.Option("demo", help="Portfolio name (from portfolios.name)"),
    alpha: float = typer.Option(0.99, help="Confidence level, e.g. 0.99"),
    horizon_days: int = typer.Option(1, help="Horizon in days (MVP stores as metadata)"),
    method: str = typer.Option("historical", help="historical|parametric|mc (MVP: historical)"),
    lookback_days: int = typer.Option(252, help="Max number of return observations to use"),
) -> None:
    """Compute historical VaR/CVaR for a portfolio and store into risk_results."""
    if not (0.0 < alpha < 1.0):
        raise typer.BadParameter("alpha must be between 0 and 1")
    if horizon_days <= 0:
        raise typer.BadParameter("horizon_days must be > 0")
    if method != "historical":
        raise typer.BadParameter("MVP supports only method=historical for now")

    with db_conn() as conn:
        engine = get_engine()
        with engine.connect() as c2:
            p = pd.read_sql(
                text("SELECT id, name FROM portfolios WHERE name = :name"),
                c2,
                params={"name": portfolio},
            )
        if p.empty:
            raise RuntimeError(f"Portfolio not found: {portfolio}")
        portfolio_id = int(p.iloc[0]["id"])

        with engine.connect() as c2:
            w = pd.read_sql(
                text(
                    """
                    SELECT symbol, weight
                    FROM portfolio_positions
                    WHERE portfolio_id = :portfolio_id
                    """
                ),
                c2,
                params={"portfolio_id": portfolio_id},
            )
        if w.empty:
            raise RuntimeError(f"No positions for portfolio: {portfolio}")

        with engine.connect() as c2:
            rets = pd.read_sql(
                text(
                    """
                    SELECT symbol, price_date, ret
                    FROM processed_returns
                    WHERE symbol = ANY(:symbols)
                    ORDER BY price_date ASC
                    """
                ),
                c2,
                params={"symbols": w["symbol"].tolist()},
            )

    if rets.empty:
        raise RuntimeError("No processed returns found; run process first")

    rets["ret"] = rets["ret"].astype(float)
    w["weight"] = w["weight"].astype(float)

    pivot = rets.pivot(index="price_date", columns="symbol", values="ret").dropna()
    # align weights to pivot columns
    weights = np.array([float(w.loc[w["symbol"] == c, "weight"].iloc[0]) for c in pivot.columns])
    if weights.sum() <= 0:
        raise RuntimeError("Sum of weights must be > 0")
    weights = weights / weights.sum()

    port_rets = pivot.values @ weights
    if port_rets.size > lookback_days:
        port_rets = port_rets[-lookback_days:]

    metrics = _historical_var_cvar(port_rets, alpha=alpha)
    asof_date = pivot.index.max()

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO risk_results(
                  portfolio_id, asof_date, horizon_days, alpha, method, metric, value, model_version
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        portfolio_id,
                        asof_date,
                        horizon_days,
                        alpha,
                        method,
                        "var",
                        metrics.var,
                        "baseline-historical-v1",
                    ),
                    (
                        portfolio_id,
                        asof_date,
                        horizon_days,
                        alpha,
                        method,
                        "cvar",
                        metrics.cvar,
                        "baseline-historical-v1",
                    ),
                ],
            )

    typer.echo(
        f"Stored risk_results for portfolio={portfolio} asof={asof_date}: "
        f"VaR={metrics.var:.6f}, CVaR={metrics.cvar:.6f}"
    )


@app.command("log-to-mlflow")
def log_to_mlflow(
    portfolio: str = typer.Option("demo", help="Portfolio name"),
    experiment: str = typer.Option("riskops-mvp", help="MLflow experiment name"),
) -> None:
    """Log the latest risk_results (VaR/CVaR) to MLflow as a run."""
    import mlflow

    tracking_uri = os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:3000")
    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(experiment)

    engine = get_engine()
    with engine.connect() as conn:
        p = pd.read_sql(
            text("SELECT id, name FROM portfolios WHERE name = :name"),
            conn,
            params={"name": portfolio},
        )
        if p.empty:
            raise RuntimeError(f"Portfolio not found: {portfolio}")
        portfolio_id = int(p.iloc[0]["id"])

        rr = pd.read_sql(
            text(
                """
                SELECT asof_date, horizon_days, alpha, method, metric, value, model_version, created_at
                FROM risk_results
                WHERE portfolio_id = :portfolio_id
                ORDER BY created_at DESC
                LIMIT 20
                """
            ),
            conn,
            params={"portfolio_id": portfolio_id},
        )
    if rr.empty:
        raise RuntimeError("No risk_results found; run risk first")

    # pick latest asof_date + model_version batch
    latest_asof = rr.iloc[0]["asof_date"]
    latest_mv = rr.iloc[0]["model_version"]
    batch = rr[(rr["asof_date"] == latest_asof) & (rr["model_version"] == latest_mv)].copy()
    metrics_map = {row.metric: float(row.value) for row in batch.itertuples(index=False)}

    with mlflow.start_run(run_name=f"{portfolio}-{latest_asof}"):
        mlflow.log_param("portfolio", portfolio)
        mlflow.log_param("asof_date", str(latest_asof))
        mlflow.log_param("model_version", str(latest_mv))
        mlflow.log_param("method", str(batch.iloc[0]["method"]))
        mlflow.log_param("alpha", float(batch.iloc[0]["alpha"]))
        mlflow.log_param("horizon_days", int(batch.iloc[0]["horizon_days"]))

        for k, v in metrics_map.items():
            mlflow.log_metric(k, v)

        summary = {
            "portfolio": portfolio,
            "asof_date": str(latest_asof),
            "model_version": str(latest_mv),
            "metrics": metrics_map,
            "logged_at": datetime.utcnow().isoformat() + "Z",
        }
        mlflow.log_text(json.dumps(summary, indent=2), "risk_summary.json")

    typer.echo(f"Logged to MLflow at {tracking_uri}: {metrics_map}")

