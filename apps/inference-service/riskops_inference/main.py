from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from sqlalchemy import text

from .db import db_ping, get_engine
from .models import (
    HealthResponse,
    PortfolioResponse,
    RiskCalcRequest,
    RiskCalcResponse,
    RiskLatestResponse,
)
from .risk import historical_var_cvar

app = FastAPI(title="RiskOps Inference Service", version="0.1.0")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    engine = get_engine()
    ok = db_ping(engine)
    return HealthResponse(
        status="ok" if ok else "degraded",
        db_ok=ok,
        time_utc=datetime.now(timezone.utc),
    )


@app.get("/portfolios", response_model=list[PortfolioResponse])
def list_portfolios() -> list[PortfolioResponse]:
    engine = get_engine()
    with engine.connect() as conn:
        df = pd.read_sql(
            text("SELECT id, name, created_at FROM portfolios ORDER BY id ASC"),
            conn,
        )
        if df.empty:
            return []
        return [
            PortfolioResponse(
                id=int(r.id),
                name=str(r.name),
                created_at=r.created_at.to_pydatetime() if hasattr(r.created_at, "to_pydatetime") else r.created_at,
                positions=[],
            )
            for r in df.itertuples(index=False)
        ]


@app.get("/portfolios/{name}", response_model=PortfolioResponse)
def get_portfolio(name: str) -> PortfolioResponse:
    engine = get_engine()
    with engine.connect() as conn:
        p = pd.read_sql(
            text("SELECT id, name, created_at FROM portfolios WHERE name = :name"),
            conn,
            params={"name": name},
        )
        if p.empty:
            raise HTTPException(status_code=404, detail="portfolio not found")
        pid = int(p.iloc[0]["id"])
        positions = pd.read_sql(
            text(
                """
                SELECT symbol, weight
                FROM portfolio_positions
                WHERE portfolio_id = :pid
                ORDER BY symbol ASC
                """
            ),
            conn,
            params={"pid": pid},
        )

    return PortfolioResponse(
        id=pid,
        name=str(p.iloc[0]["name"]),
        created_at=p.iloc[0]["created_at"].to_pydatetime()
        if hasattr(p.iloc[0]["created_at"], "to_pydatetime")
        else p.iloc[0]["created_at"],
        positions=[
            {"symbol": str(r.symbol), "weight": float(r.weight)} for r in positions.itertuples(index=False)
        ],
    )


@app.get("/risk/latest", response_model=RiskLatestResponse)
def latest_risk(portfolio: str = "demo") -> RiskLatestResponse:
    engine = get_engine()
    with engine.connect() as conn:
        p = pd.read_sql(
            text("SELECT id FROM portfolios WHERE name = :name"),
            conn,
            params={"name": portfolio},
        )
        if p.empty:
            raise HTTPException(status_code=404, detail="portfolio not found")
        pid = int(p.iloc[0]["id"])
        rr = pd.read_sql(
            text(
                """
                SELECT asof_date, horizon_days, alpha, method, metric, value, model_version, created_at
                FROM risk_results
                WHERE portfolio_id = :pid
                ORDER BY created_at DESC
                LIMIT 50
                """
            ),
            conn,
            params={"pid": pid},
        )

    if rr.empty:
        return RiskLatestResponse(portfolio=portfolio, asof_date=None, alpha=None, horizon_days=None, method=None,
                                  model_version=None, var=None, cvar=None, created_at=None)

    latest_asof = rr.iloc[0]["asof_date"]
    latest_created = rr.iloc[0]["created_at"]
    latest_mv = rr.iloc[0]["model_version"]
    batch = rr[(rr["asof_date"] == latest_asof) & (rr["model_version"] == latest_mv)].copy()
    metrics = {row.metric: float(row.value) for row in batch.itertuples(index=False)}

    return RiskLatestResponse(
        portfolio=portfolio,
        asof_date=latest_asof,
        alpha=float(batch.iloc[0]["alpha"]),
        horizon_days=int(batch.iloc[0]["horizon_days"]),
        method=str(batch.iloc[0]["method"]),
        model_version=str(latest_mv),
        var=metrics.get("var"),
        cvar=metrics.get("cvar"),
        created_at=latest_created.to_pydatetime() if hasattr(latest_created, "to_pydatetime") else latest_created,
    )


@app.post("/risk/calc", response_model=RiskCalcResponse)
def calc_risk(req: RiskCalcRequest) -> RiskCalcResponse:
    engine = get_engine()

    with engine.connect() as conn:
        p = pd.read_sql(
            text("SELECT id FROM portfolios WHERE name = :name"),
            conn,
            params={"name": req.portfolio},
        )
        if p.empty:
            raise HTTPException(status_code=404, detail="portfolio not found")
        pid = int(p.iloc[0]["id"])

        w = pd.read_sql(
            text(
                """
                SELECT symbol, weight
                FROM portfolio_positions
                WHERE portfolio_id = :pid
                """
            ),
            conn,
            params={"pid": pid},
        )
        if w.empty:
            raise HTTPException(status_code=400, detail="portfolio has no positions")

        rets = pd.read_sql(
            text(
                """
                SELECT symbol, price_date, ret
                FROM processed_returns
                WHERE symbol = ANY(:symbols)
                ORDER BY price_date ASC
                """
            ),
            conn,
            params={"symbols": w["symbol"].tolist()},
        )

    if rets.empty:
        raise HTTPException(status_code=400, detail="no processed_returns; run processing first")

    rets["ret"] = rets["ret"].astype(float)
    w["weight"] = w["weight"].astype(float)

    pivot = rets.pivot(index="price_date", columns="symbol", values="ret").dropna()
    if pivot.empty:
        raise HTTPException(status_code=400, detail="not enough aligned returns across symbols")

    weights = np.array([float(w.loc[w["symbol"] == c, "weight"].iloc[0]) for c in pivot.columns])
    if weights.sum() <= 0:
        raise HTTPException(status_code=400, detail="sum of weights must be > 0")
    weights = weights / weights.sum()

    port_rets = pivot.values @ weights
    if port_rets.size > req.lookback_days:
        port_rets = port_rets[-req.lookback_days :]

    try:
        m = historical_var_cvar(port_rets, alpha=req.alpha)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    asof_date = pivot.index.max()

    if req.persist:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO risk_results(
                      portfolio_id, asof_date, horizon_days, alpha, method, metric, value, model_version
                    )
                    VALUES
                      (:pid, :asof, :h, :alpha, :method, 'var', :var, :mv),
                      (:pid, :asof, :h, :alpha, :method, 'cvar', :cvar, :mv)
                    """
                ),
                {
                    "pid": pid,
                    "asof": asof_date,
                    "h": req.horizon_days,
                    "alpha": req.alpha,
                    "method": req.method,
                    "var": m.var,
                    "cvar": m.cvar,
                    "mv": req.model_version,
                },
            )

    return RiskCalcResponse(
        portfolio=req.portfolio,
        asof_date=asof_date,
        alpha=req.alpha,
        horizon_days=req.horizon_days,
        method=req.method,
        model_version=req.model_version,
        var=m.var,
        cvar=m.cvar,
    )

