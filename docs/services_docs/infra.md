# Инфраструктура

**Path:** [`infra/`](../infra/)

Вся инфраструктура поднимается через `docker-compose.yaml`. Включает базу данных, брокер сообщений, оркестратор пайплайнов, хранилище ML-экспериментов и мониторинг.

---

## Компоненты

### PostgreSQL

Единая БД для всех сервисов. Инициализируется SQL-скриптами из [`infra/db/init/`](../infra/db/init/) при первом запуске.

**Схемы:**

| Файл | Что создаёт |
|------|-------------|
| [`000_mlflow_schema.sql`](../infra/db/init/000_mlflow_schema.sql) | Схема `mlflow` для MLflow Tracking Server |
| [`001_riskops_schema.sql`](../infra/db/init/001_riskops_schema.sql) | Основная схема RiskOps |
| [`002_extensions.sql`](../infra/db/init/002_extensions.sql) | PostgreSQL расширения (uuid-ossp и др.) |

**Таблицы RiskOps:**

| Таблица | Описание |
|---------|----------|
| `raw_prices` | Сырые дневные цены закрытия (`symbol`, `price_date`, `close`, `currency`, `source`) |
| `processed_returns` | Дневные доходности (`symbol`, `price_date`, `ret`) |
| `portfolios` | Портфели (`id`, `name`, `description`, `currency`) |
| `portfolio_positions` | Позиции портфеля (`portfolio_id`, `symbol`, `weight`) |
| `risk_results` | Результаты риск-расчётов (`portfolio_id`, `asof_date`, `method`, `metric`, `value`, `model_version`) |
| `model_registry` | Реестр обученных моделей (`model_name`, `model_version`, `mlflow_run_id`, `status`, `metrics`) |
| `ingestion_log` | Лог загрузок рыночных данных |
| `credit_portfolio` | Кредитные данные |

При инициализации создаётся демо-портфель `demo` с позициями `AAPL (50%)` и `MSFT (50%)`.

---

### Kafka

Брокер сообщений для асинхронного взаимодействия между сервисами.

**Топики:**

| Топик | Продюсер | Консьюмер | Описание |
|-------|----------|-----------|----------|
| `portfolio.updated` | portfolio-service | training-service | Изменение портфеля/позиций |
| `model.trained` | training-service | inference-service | Новая версия модели готова |
| `market.data.ingested` | market-data-service | training-service | Новые данные загружены |

---

### MLflow

Tracking Server для логирования экспериментов и Model Registry.

- **UI:** `http://localhost:3000`
- **Артефакты:** хранятся в MinIO (S3-совместимое хранилище)
- **Эксперименты:** `riskops-garch`, `riskops-montecarlo`
- **Зарегистрированные модели:** `riskops-garch`, `riskops-montecarlo`

---

### Airflow

Оркестратор пайплайнов. Запускает DAG'и по расписанию.

**DAG'и:**

| DAG ID | Расписание | Описание |
|--------|-----------|----------|
| `riskops_ingest_moex` | `0 19 * * 1-5` (19:00 UTC, пн–пт) | Загрузка данных MOEX ISS |
| `riskops_ingest_yahoo` | `0 21 * * 1-5` (21:00 UTC, пн–пт) | Загрузка данных Yahoo Finance |
| `riskops_scheduled_training` | `0 22 * * 1-5` (22:00 UTC, пн–пт) | Плановое переобучение моделей |
| `riskops_ondemand_training` | manual | Ручной запуск обучения с параметрами |
| `riskops_daily_risk_pipeline` | `0 6 * * *` (06:00 UTC) | Полный дневной пайплайн |

**Дневной пайплайн (`riskops_daily_risk_pipeline`):**

```
health_checks → ingest_market_data → train_models → poll_training → run_inference → verify_results
```

1. **health_checks** — проверяет `/health` у всех трёх сервисов
2. **ingest_market_data** — `POST /api/market-data/ingest/all`
3. **train_models** — `POST /api/risk/train` (symbols: AAPL, MSFT, GOOGL, SBER, GAZP)
4. **poll_training** — опрашивает статус каждые 30 сек, таймаут 30 мин
5. **run_inference** — `POST /api/risk/predict` для каждого портфеля
6. **verify_results** — проверяет, что результаты записаны

**Символы по умолчанию:**

- MOEX: `SBER, GAZP, LKOH, YNDX, GMKN, ROSN, NVTK, TATN, MGNT, IMOEX`
- Yahoo: `AAPL, MSFT, GOOGL, AMZN, NVDA, SPY, ^GSPC, ^VIX, GLD, TLT`

---

### Prometheus + Grafana

Мониторинг сервисов.

- **Prometheus:** `http://localhost:9090` — сбор метрик
- **Grafana:** `http://localhost:3001` — дашборды
- **Дашборд:** [`infra/grafana/dashboards/riskops-overview.json`](../infra/grafana/dashboards/riskops-overview.json)
- **Datasource:** Prometheus (авто-провизионирован)

Конфигурация скрейпинга: [`infra/prometheus/prometheus.yml`](../infra/prometheus/prometheus.yml)

---

## Порты сервисов

| Сервис | Порт |
|--------|------|
| Gateway | `8081` |
| Portfolio Service | `8082` |
| Market Data Service | `8083` |
| Training Service | `8084` |
| Inference Service | `8085` |
| PostgreSQL | `5432` |
| Kafka | `9092` |
| MLflow | `3000` |
| Airflow | `8080` |
| Grafana | `3001` |
| Prometheus | `9090` |
| MinIO | `9000` / `9001` |

---

## Структура

```
infra/
├── airflow/
│   ├── Dockerfile
│   └── dags/
│       ├── daily_risk_dag.py                  # полный дневной пайплайн
│       ├── market_data_dag.py                 # MOEX + Yahoo ingestion DAGs
│       ├── training_dag.py                    # scheduled + on-demand training DAGs
│       └── riskops_market_data_ingest_dag.py  # legacy/альтернативный DAG
├── db/
│   └── init/
│       ├── 000_mlflow_schema.sql
│       ├── 001_riskops_schema.sql
│       └── 002_extensions.sql
├── grafana/
│   ├── dashboards/riskops-overview.json
│   └── provisioning/
│       ├── dashboards/dashboards.yml
│       └── datasources/datasources.yml
└── prometheus/
    └── prometheus.yml
```
