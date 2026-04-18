# Training Service

**Language:** Python (FastAPI)  
**Port:** `8084`  
**Path:** [`apps/training-service/`](../apps/training-service/)

## Что делает

Обучает ML-модели для оценки рыночного риска (VaR/CVaR/Volatility). Поддерживает два типа моделей: **GARCH(1,1)** и **Monte Carlo (GBM)**. Обучение запускается асинхронно (фоновая задача в ThreadPoolExecutor), результаты логируются в MLflow, обученные модели регистрируются в таблице `model_registry` в PostgreSQL. После обучения публикует событие `model.trained` в Kafka — inference-service подхватывает его и горячо перезагружает модель.

---

## Endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| `POST` | `/api/risk/train` | Запустить обучение (возвращает `job_id` сразу, HTTP 202) |
| `GET` | `/api/risk/train/status/{job_id}` | Статус задачи: `queued / running / completed / failed` |
| `GET` | `/api/risk/train/run/{run_id}` | Детали MLflow run по `run_id` (метрики, параметры, время) |
| `GET` | `/api/risk/models` | Список зарегистрированных моделей из `model_registry` |

### Параметры `POST /api/risk/train`

| Поле | По умолчанию | Описание |
|------|-------------|----------|
| `symbols` | `["AAPL","MSFT"]` | Тикеры для обучения |
| `model_type` | `all` | `garch` / `montecarlo` / `all` |
| `alpha` | `0.99` | Уровень доверия VaR (0.9–0.9999) |
| `horizon_days` | `1` | Горизонт прогноза (1–30 дней) |
| `lookback_days` | `252` | Окно исторических данных (30–2520) |
| `weights` | `null` | Веса символов `{symbol: weight}`. Если `null` — равные веса |
| `n_simulations` | `10000` | Число симуляций Monte Carlo (1000–100000) |

---

## Модели

### GARCH(1,1)

**Файл:** [`training_service/models/garch.py`](../apps/training-service/training_service/models/garch.py)

GARCH (Generalized Autoregressive Conditional Heteroskedasticity) — модель для оценки условной волатильности временного ряда доходностей.

#### Спецификация модели

```
Модель дисперсии:
  σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}

где:
  σ²_t  — условная дисперсия в момент t
  ε_t   — инновация (остаток) в момент t
  ω     — константа (базовый уровень волатильности)
  α     — ARCH-коэффициент (реакция на шок)
  β     — GARCH-коэффициент (инерция волатильности)

Параметры по умолчанию: p=1, q=1, dist=normal, mean=Zero
```

#### Процесс обучения

1. Входные данные масштабируются в процентные пункты (`× 100`) для численной стабильности
2. Модель фитируется через MLE (библиотека `arch`) с `disp="off"`
3. Строится 1-шаговый прогноз условной дисперсии: `forecast(horizon=horizon_days)`
4. Условная волатильность переводится обратно в десятичные доли и аннуализируется: `σ_annual = σ_daily × √252`

#### Вычисление VaR и CVaR

Используется параметрический подход (нормальное распределение):

```
z_α = Φ⁻¹(1 - α)          # квантиль нормального распределения (отрицательный)

VaR  = -z_α × σ_daily      # положительное число (потеря)

CVaR = φ(z_α) / (1 - α) × σ_daily
     где φ — PDF стандартного нормального распределения
```

Пример при α=0.99: `z_0.99 ≈ -2.326`, `VaR ≈ 2.326 × σ`

#### Бэктест

После обучения вычисляется `backtest_coverage_ratio` — доля исторических наблюдений, где реальная потеря превысила VaR. Ожидаемое значение: `1 - α` (например, 0.01 при α=0.99).

#### Метрики, логируемые в MLflow

| Метрика | Описание |
|---------|----------|
| `var` | Value-at-Risk |
| `cvar` | Conditional VaR (Expected Shortfall) |
| `volatility` | Аннуализированная условная волатильность |
| `aic` | Akaike Information Criterion |
| `bic` | Bayesian Information Criterion |
| `log_likelihood` | Log-likelihood фита |
| `backtest_coverage_ratio` | Доля превышений VaR на истории |
| `expected_coverage_ratio` | Ожидаемая доля = `1 - α` |

#### Артефакты в MLflow

- `plots/` — 2×2 диагностический PNG: стандартизированные остатки, условная волатильность, QQ-plot, гистограмма остатков
- `reports/` — JSON с параметрами и метриками
- `model/` — pickle-файл с объектом `ARCHModelResult`

---

### Monte Carlo (GBM)

**Файл:** [`training_service/models/montecarlo.py`](../apps/training-service/training_service/models/montecarlo.py)

Симулирует `N` будущих траекторий доходностей на основе Geometric Brownian Motion, вычисляет VaR/CVaR из эмпирического распределения симулированных потерь.

#### Спецификация модели

```
Геометрическое броуновское движение (GBM):
  dS/S = μ·dt + σ·dW

Дискретная форма (дневной лог-доход):
  r_t = (μ - 0.5·σ²)·dt + σ·√dt·ε_t,   ε_t ~ N(0,1)

Оценка параметров из истории (MLE):
  σ = std(r)
  μ = mean(r) + 0.5·σ²

Простой доход за горизонт horizon_days:
  R = exp(Σ r_t) - 1
```

#### Многоактивный случай (Cholesky)

Если передаётся матрица доходностей `(T × N)`, используется разложение Холецкого для генерации коррелированных шоков:

```
Σ = L·Lᵀ                    # Cholesky разложение ковариационной матрицы
z ~ N(0, I)                  # независимые стандартные нормальные
ε = z · Lᵀ                  # коррелированные шоки

Доходность портфеля:
  R_portfolio = Σ w_i · R_i
```

При вырожденной ковариационной матрице добавляется регуляризация `+1e-8·I`.

#### Вычисление VaR и CVaR

Из эмпирического распределения `N` симулированных доходностей:

```
VaR  = -quantile(R_sim, 1 - α)
CVaR = -mean(R_sim | R_sim ≤ -VaR)    # среднее по хвосту
```

#### Метрики, логируемые в MLflow

| Метрика | Описание |
|---------|----------|
| `var` | Value-at-Risk |
| `cvar` | Conditional VaR |
| `volatility` | Аннуализированная волатильность симуляций: `std(R_sim) × √(252/horizon)` |
| `mean_simulated_return` | Среднее симулированных доходностей |
| `std_simulated_return` | Стандартное отклонение симулированных доходностей |

#### Артефакты в MLflow

- `plots/` — 2 графика: гистограмма распределения с VaR/CVaR, CDF
- `reports/` — JSON с параметрами и метриками
- `model/` — JSON с параметрами (MC не имеет сохраняемого состояния модели)

---

## Pipeline обучения

**Файл:** [`training_service/pipelines/train.py`](../apps/training-service/training_service/pipelines/train.py)

```
run_training(req)
  ├── load_returns()           — загрузка processed_returns из Postgres
  ├── build_portfolio_returns() — pivot + взвешивание → 1D массив доходностей
  └── для каждого model_type:
       ├── _train_garch_pipeline()      или
       ├── _train_montecarlo_pipeline()
       │    ├── обучение модели
       │    ├── mlflow.start_run()
       │    │    ├── log_params / log_metrics
       │    │    ├── log_artifact (plot, report, model)
       │    │    └── register в MLflow Model Registry
       │    └── _register_model_in_db() → INSERT INTO model_registry
       └── TrainResult
```

---

## Kafka

- **Топик:** `model.trained`
- **Публикуется после:** успешного завершения обучения каждой модели
- **Payload:** `{ model_name, model_version, model_type, mlflow_run_id, ... }`
- inference-service слушает этот топик и горячо перезагружает модель

---

## Конфигурация (env)

| Переменная | По умолчанию |
|-----------|-------------|
| `DATABASE_URL` | `postgresql://...` |
| `MLFLOW_TRACKING_URI` | `http://mlflow:3000` |
| `KAFKA_BROKERS` | `kafka:9092` |
| `DEFAULT_LOOKBACK_DAYS` | `252` |
| `MONTE_CARLO_SIMULATIONS` | `10000` |

---

## Структура

```
apps/training-service/
├── Dockerfile
└── training_service/
    ├── main.py                  # FastAPI app + startup
    ├── config.py                # настройки через pydantic-settings
    ├── db.py                    # SQLAlchemy engine
    ├── kafka_consumer.py        # слушает market.data.ingested → авто-ретрейн
    ├── api/routes.py            # HTTP endpoints
    ├── models/
    │   ├── garch.py             # GARCH(1,1): обучение, VaR/CVaR, диагностика
    │   └── montecarlo.py        # Monte Carlo GBM: симуляция, VaR/CVaR
    └── pipelines/
        └── train.py             # оркестрация: данные → обучение → MLflow → registry
```
