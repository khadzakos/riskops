from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"] = "ok"
    db_ok: bool
    time_utc: datetime


class PortfolioPosition(BaseModel):
    symbol: str
    weight: float


class PortfolioResponse(BaseModel):
    id: int
    name: str
    created_at: datetime
    positions: list[PortfolioPosition] = Field(default_factory=list)


class RiskCalcRequest(BaseModel):
    portfolio: str = Field(default="demo", description="Portfolio name (portfolios.name)")
    alpha: float = Field(default=0.99, gt=0.0, lt=1.0)
    horizon_days: int = Field(default=1, gt=0)
    method: Literal["historical"] = "historical"
    lookback_days: int = Field(default=252, gt=0)
    persist: bool = Field(default=True, description="If true, write results to risk_results")
    model_version: str = Field(default="baseline-historical-v1")


class RiskCalcResponse(BaseModel):
    portfolio: str
    asof_date: date
    alpha: float
    horizon_days: int
    method: str
    model_version: str
    var: float
    cvar: float


class RiskLatestResponse(BaseModel):
    portfolio: str
    asof_date: Optional[date]
    alpha: Optional[float]
    horizon_days: Optional[int]
    method: Optional[str]
    model_version: Optional[str]
    var: Optional[float]
    cvar: Optional[float]
    created_at: Optional[datetime]

