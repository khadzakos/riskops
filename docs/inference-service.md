# Inference Service

**Language:** Python (FastAPI)  
**Port:** `8085`  
**Path:** [`apps/inference-service/`](../apps/inference-service/)

## Что делает

Вычисляет риск-метрики (VaR, CVaR, Volatility) для портфелей в реальном времени. При старте загружает последние версии ML-моделей из MLflow Model Registry в память. Слушает Kafka-топик `model.trained` и горячо перезагружает модели без перезапуска сервиса. Результаты сохраняет в таблицу `risk_results` в PostgreSQL.

---

## Endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| `POST` | `/api/risk/predict` | Вычислить VaR/CVaR/Volatility для портфеля |
| `GET` | `/api/risk/predict/health` | Статус загруженных моделей |

### `POST /api/risk/predict`

**Запрос:**

| Поле | По умолчанию | Описание |
|------|-------------|----------|
| `portfolio_id` | обязательно | ID портфеля |
| `method` | `garch` | `historical` / `garch` / `montecarlo` |
| `alpha` | `0.99` | Уровень доверия VaR (0.5–0.9999) |
| `horizon_days` | `1` | Горизонт прогноза (1–252 дней) |

**Ответ:**

```json
{
  "portfolio_id": 1,
  "asof_date": "2026-04-18",
  "method": "garch",
  "alpha": 0.99,
  "horizon_days": 1,
  "var": 0.023451,
  "cvar": 0.031204,
  "volatility": 0.187632,
  "model_version": "garch-v3",
  "computed_at": "2026-04-18T17:00:00Z"
}
```

### `GET /api/risk/predict/health`

```json
{
  "status": "ok",
  "loaded_models": ["garch", "montecarlo"],
  "fallback_available": true
}
```

`status = "degraded"` если ни одна ML-модель не загружена (но `historical` всегда доступен).

---

## Методы предсказания

### 1. `historical` — Историческая симуляция (fallback)

Непараметрический метод. Не требует загруженной ML-модели.

**Алгоритм:**
1. Загружает позиции портфеля из `portfolio_positions`
2. Загружает `processed_returns` для символов портфеля (последние `lookback_days`)
3. Вычисляет взвешенные доходности портфеля: `R_p = Σ w_i · r_i`
4. Масштабирует на горизонт (square-root-of-time): `R_p *= √horizon_days`

```
VaR  = -quantile(R_p, 1 - α)
CVaR = -mean(R_p | R_p ≤ -VaR)    # среднее по хвосту потерь
vol  = std(R_p) × √(252 / horizon_days)
```

`model_version = "historical-v1"`

---

### 2. `garch` — Параметрический VaR из GARCH-модели

Использует загруженный `ARCHModelResult` (pickle из MLflow). Не перефитирует модель — только строит прогноз условной волатильности.

**Алгоритм:**
1. Вызывает `arch_result.forecast(horizon=horizon_days)` на уже обученной модели
2. Извлекает условную дисперсию: `σ²_cond = forecast.variance[-1, horizon-1]` (в процентных пунктах²)
3. Переводит в десятичные доли: `σ_daily = √σ²_cond / 100`
4. Аннуализирует: `σ_annual = σ_daily × √252`

```
z_α  = Φ⁻¹(1 - α)                    # квантиль N(0,1), отрицательный

VaR  = -z_α × σ_daily
CVaR = φ(z_α) / (1 - α) × σ_daily    # φ — PDF стандартного нормального
```

Пример при α=0.99: `z ≈ -2.326`, `VaR ≈ 2.326 × σ_daily`

`model_version = "garch-v{mlflow_version}"`

**Fallback:** если GARCH-модель не загружена → `historical`

---

### 3. `montecarlo` — Monte Carlo GBM

Использует загруженный MC-артефакт (JSON с параметрами из MLflow), но **переоценивает** `μ` и `σ` из текущих доходностей портфеля для актуальности.

**Алгоритм:**
1. Загружает текущие доходности портфеля из `processed_returns`
2. Оценивает параметры GBM:
   ```
   σ = std(R_p)
   μ = mean(R_p) + 0.5·σ²    # MLE оценка дрейфа
   ```
3. Симулирует `n_simulations` траекторий:
   ```
   drift     = (μ - 0.5·σ²) · dt
   diffusion = σ · √dt
   
   r_t ~ N(drift, diffusion²)           # дневной лог-доход
   R_sim = exp(Σ_{t=1}^{horizon} r_t) - 1   # простой доход за горизонт
   ```
4. VaR/CVaR из эмпирического распределения:
   ```
   VaR  = -quantile(R_sim, 1 - α)
   CVaR = -mean(R_sim | R_sim ≤ -VaR)
   vol  = std(R_sim) × √(252 / horizon_days)
   ```

`model_version = "montecarlo-v{mlflow_version}"`

**Fallback:** если MC-модель не загружена → `historical`

---

## Загрузка и горячая перезагрузка моделей

**Файл:** [`inference_service/models/loader.py`](../apps/inference-service/inference_service/models/loader.py)

### При старте (`load_all_models`)

```
load_all_models()
  ├── MlflowClient.get_latest_versions("riskops-garch")
  │    └── предпочитает стадию: Production → Staging → None
  │    └── скачивает .pkl артефакт → pickle.load() → ARCHModelResult
  ├── MlflowClient.get_latest_versions("riskops-montecarlo")
  │    └── скачивает .json артефакт → json.load() → dict с параметрами
  └── ModelRegistry.set(model)   # thread-safe
```

Если MLflow недоступен или модели не найдены — сервис стартует в режиме `historical`-only (не падает).

### Горячая перезагрузка (`reload_model`)

Вызывается Kafka-консьюмером при получении события `model.trained`:

```
Kafka: model.trained → kafka_consumer.py
  └── reload_model(model_name, model_version)
       ├── скачивает новую версию из MLflow
       └── ModelRegistry.set(model)   # атомарная замена под RLock
```

### `ModelRegistry`

Thread-safe in-memory хранилище: `dict[model_type → LoadedModel]`. Использует `threading.RLock` для безопасного чтения/записи при конкурентных запросах.

---

## Kafka

- **Слушает топик:** `model.trained`
- **Действие:** горячая перезагрузка модели указанной версии из MLflow

---

## Персистентность результатов

После каждого успешного предсказания сохраняет 3 строки в `risk_results`:

| `metric` | Значение |
|----------|---------|
| `var` | Value-at-Risk |
| `cvar` | Conditional VaR |
| `volatility` | Аннуализированная волатильность |

Ошибка записи в БД логируется, но **не прерывает** HTTP-ответ клиенту.

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
apps/inference-service/
├── Dockerfile
└── inference_service/
    ├── main.py                  # FastAPI app + startup (load_all_models)
    ├── config.py                # настройки через pydantic-settings
    ├── db.py                    # SQLAlchemy engine
    ├── kafka_consumer.py        # слушает model.trained → reload_model()
    ├── api/routes.py            # POST /predict, GET /predict/health
    └── models/
        ├── loader.py            # MLflow загрузка + ModelRegistry (hot-reload)
        └── predictor.py         # historical / garch / montecarlo predict()
```
