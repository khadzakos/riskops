# RiskOps

[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?style=flat&logo=go&logoColor=white)](https://go.dev/)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![Telegram](https://img.shields.io/badge/Telegram-@khadzakos-2CA5E0?style=flat&logo=telegram&logoColor=white)](https://t.me/khadzakos)
[![Commit Activity](https://img.shields.io/github/commit-activity/m/khadzakos/riskops?style=flat&color=brightgreen)](https://github.com/khadzakos/riskops/commits)

**MLOps pipeline for automated portfolio market risk assessment.**

Collects market data, trains risk models, runs daily inference, backtests model quality — all orchestrated end-to-end with Airflow and exposed through a unified API.

---

## Architecture

```
Yahoo Finance / MOEX ISS / Other Sources
         │
         ▼
 Market Data Service (Go)
         │ Kafka: market.data.ingested
         ▼
 Training Service (Python) ──► MLflow / MinIO
         │ Kafka: model.trained
         ▼
 Inference Service (Python) ◄── Portfolio Service (Go)
         │                              │ Kafka: portfolio.updated
         ▼                              ▼
      Postgres                       Postgres
         │
         ▼
  API Gateway (Go) ──► Next.js Frontend
```

All services are containerized and orchestrated via `docker-compose`. Airflow runs the daily pipeline at 06:00 UTC: `ingest → train → infer → verify`.

### Services

| Service | Stack | Responsibility |
|---|---|---|
| API Gateway | Go | Reverse proxy, CORS |
| Portfolio Service | Go | Portfolio/position CRUD, risk history |
| Market Data Service | Go | Data ingestion, returns computation |
| Training Service | Python / FastAPI | Model training, backtesting, MLflow |
| Inference Service | Python / FastAPI | Risk prediction, stress testing |
| Frontend | Next.js | Dashboard UI |

### Infrastructure

| Component | Role |
|---|---|
| PostgreSQL | Prices, returns, portfolios, risk results, training jobs |
| Kafka | Event bus between services |
| MLflow + MinIO | Model registry and artifact storage |
| Airflow | Pipeline orchestration |
| Prometheus + Grafana | Observability |

---

## Risk Models

### GARCH(1,1) — `riskops-garch`
Fits a GARCH(1,1) model on log-returns using the [`arch`](https://arch.readthedocs.io/) library.
Supports three error distributions: **Normal**, **Student-t**, **Skewed-t**.
Outputs parametric **VaR** and **CVaR** with conditional volatility forecast.

> Bollerslev, T. (1986). *Generalized autoregressive conditional heteroskedasticity.* Journal of Econometrics, 31(3), 307–327.

### Monte Carlo GBM — `riskops-montecarlo`
Simulates portfolio P&L paths under Geometric Brownian Motion using historical μ and σ.
VaR and CVaR are derived from the simulated return distribution.
Packaged as an `mlflow.pyfunc` model for versioned deployment.

> Hull, J. C. (2018). *Options, Futures, and Other Derivatives* (10th ed.). Pearson.

### Historical Simulation — fallback
Empirical quantile from `processed_returns`. No training required, always available.

### Risk Metrics (all methods)

`VaR`, `CVaR`, `Volatility`, `Max Drawdown`, `Sharpe Ratio`, `Sortino Ratio`, `Beta`

---

## Backtesting

Rolling out-of-sample window: fit on `[t−lookback, t−1]`, predict VaR at `t`, record violation if `return(t) < −VaR(t)`.

Statistical tests:

| Test | What it checks |
|---|---|
| **Kupiec UC** | Violation rate equals `1 − α` |
| **Christoffersen CC** | Violations are independently distributed |

> Kupiec, P. (1995). *Techniques for verifying the accuracy of risk measurement models.* Journal of Derivatives, 3(2), 73–84.
> Christoffersen, P. (1998). *Evaluating interval forecasts.* International Economic Review, 39(4), 841–862.

Results are classified as `OK` / `WARN` / `CRIT` based on p-value thresholds.

---

## Data Sources

| Source | Type | Collector |
|---|---|---|
| [Yahoo Finance](https://finance.yahoo.com) | Equities, ETFs (global) | `collector/yahoo.go` |
| [MOEX ISS](https://iss.moex.com) | Russian equities and bonds | `collector/moex.go` |
| Synthetic GBM | Simulated price series | `collector/synthetic.go` |
| Synthetic Credit | Simulated credit records | `collector/credit_synthetic.go` |

---

## Stress Testing

5 built-in scenarios:

| Scenario | Type | Description |
|---|---|---|
| `historical_2008` | Historical | Lehman collapse, equity −50% |
| `historical_2020` | Historical | COVID crash, VIX > 80 |
| `historical_1998` | Historical | LTCM / Russia default |
| `parametric_mild` | Parametric | vol ×2, corr → 0.7 |
| `parametric_severe` | Parametric | vol ×4, corr → 0.95 |

---

## Quick Start

```bash
docker compose up -d
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3002 |
| API Gateway | http://localhost:8081 |
| MLflow | http://localhost:3000 |
| Airflow | http://localhost:8080 |
| Grafana | http://localhost:3001 |

---

## Project Status

| Feature | Status |
|---|---|
| End-to-end pipeline: ingest → train → infer → UI | done |
| Kupiec + Christoffersen backtesting | done |
| 5 stress test scenarios | done |
| Model versioning with rollback (MLflow) | done |
| Training job state persisted across restarts | done |
| Automated retraining on CRIT alert | under development |
| Model drift monitoring dashboard | under development |
