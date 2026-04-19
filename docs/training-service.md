# Training Service

**Language:** Python (FastAPI)  
**Port:** `8084`  
**Path:** [`apps/training-service/`](../apps/training-service/)

## Что делает

Обучает ML-модели для оценки рыночного риска (VaR/CVaR/Volatility). Поддерживает два типа моделей: **GARCH(1,1)** и **Monte Carlo (GBM)**. Обучение запускается асинхронно (фоновая задача в ThreadPoolExecutor), результаты логируются в MLflow, обученные модели регистрируются в таблице `model_registry` в PostgreSQL.

Включает **Backtesting Engine** — модуль скользящего окна для out-of-sample валидации VaR-моделей со статистическими тестами Купика и Кристофферсена.

> ⚠️ **Известная проблема (§16.9):** публикация события `model.trained` в Kafka не реализована — inference-service не получает сигнал о новой модели автоматически. Требует перезапуска контейнера для подхвата новой версии.

---

## Endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| `POST` | `/api/risk/train` | Запустить обучение (возвращает `job_id` сразу, HTTP 202) |
| `GET` | `/api/risk/train/status/{job_id}` | Статус задачи: `queued / running / completed / failed` |
| `GET` | `/api/risk/train/run/{run_id}` | Детали MLflow run по `run_id` (метрики, параметры, время) |
| `GET` | `/api/risk/models` | Список зарегистрированных моделей из `model_registry` |
| `POST` | `/api/risk/backtest` | Out-of-sample rolling VaR backtest (Kupiec + Christoffersen) |

### Параметры `POST /api/risk/train`

**Файл:** [`training_service/api/routes.py:139`](../apps/training-service/training_service/api/routes.py)

| Поле | По умолчанию | Ограничения | Описание |
|------|-------------|-------------|----------|
| `symbols` | `["AAPL","MSFT"]` | min 1 элемент | Тикеры для обучения |
| `model_type` | `all` | `garch` / `montecarlo` / `all` | Тип модели |
| `alpha` | `0.99` | 0.9–0.9999 | Уровень доверия VaR |
| `horizon_days` | `1` | 1–30 | Горизонт прогноза (дней) |
| `lookback_days` | `252` | 30–2520 | Окно исторических данных |
| `weights` | `null` | dict `{symbol: float}` | Веса символов. Если `null` — равные веса |
| `n_simulations` | `10000` | 1000–100000 | Число симуляций Monte Carlo |

---

## Подготовка данных перед обучением

**Файл:** [`training_service/pipelines/train.py`](../apps/training-service/training_service/pipelines/train.py)

### Шаг 1 — Загрузка доходностей из Postgres

```python
# train.py:33–72  — функция load_returns()
SELECT symbol, price_date, ret
FROM processed_returns
WHERE symbol = ANY(:symbols)
ORDER BY symbol, price_date ASC
```

Затем берётся только последние `lookback_days` строк на каждый символ (`.tail(lookback_days)` по группе).

### Шаг 2 — Построение портфельной доходности

```python
# train.py:75–97  — функция build_portfolio_returns()
pivot = returns_df.pivot(index="price_date", columns="symbol", values="ret").dropna()
port_rets = pivot.values @ weights   # shape: (T,) — одномерный ряд
```

Если `weights=None` — равные веса: `w_i = 1/N`. Веса нормируются так, чтобы сумма = 1. Строки с `NaN` по любому символу отбрасываются (`dropna()`).

**Результат:** одномерный numpy-массив `port_rets` — ежедневные доходности портфеля в десятичных долях (например, `-0.02` = -2%).

---

## Модель 1: GARCH(1,1)

**Файл:** [`training_service/models/garch.py`](../apps/training-service/training_service/models/garch.py)  
**Библиотека:** [`arch`](https://arch.readthedocs.io/) (Kevin Sheppard)  
**MLflow experiment:** `riskops-garch`

### Математическая спецификация

GARCH (Generalized Autoregressive Conditional Heteroskedasticity) — модель для оценки **условной волатильности** временного ряда доходностей. Ключевая идея: волатильность не постоянна, а зависит от прошлых шоков и прошлой волатильности (volatility clustering).

```
Уравнение дисперсии GARCH(1,1):
  σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}

где:
  σ²_t   — условная дисперсия в момент t (то, что мы прогнозируем)
  ε_t    — инновация (остаток): ε_t = r_t - μ_t
  ω > 0  — константа (базовый уровень дисперсии)
  α ≥ 0  — ARCH-коэффициент (реакция на вчерашний шок)
  β ≥ 0  — GARCH-коэффициент (инерция волатильности)

Условие стационарности: α + β < 1
Долгосрочная дисперсия: σ²_∞ = ω / (1 - α - β)

Уравнение среднего (mean="Zero"):
  μ_t = 0   (нулевое среднее — стандарт для дневных доходностей)
```

### Гиперпараметры

**Файл:** [`garch.py:30–36`](../apps/training-service/training_service/models/garch.py) — датакласс `GARCHParams`

| Параметр | Значение по умолчанию | Допустимые значения | Описание |
|----------|----------------------|---------------------|----------|
| `p` | `1` | целое ≥ 1 | Порядок ARCH (лаги ε²) |
| `q` | `1` | целое ≥ 1 | Порядок GARCH (лаги σ²) |
| `dist` | `"normal"` | `"normal"` / `"t"` / `"skewt"` | Распределение инноваций |
| `mean` | `"Zero"` | `"Zero"` / `"Constant"` / `"AR"` | Модель среднего |

В [`pipelines/train.py:184`](../apps/training-service/training_service/pipelines/train.py) при вызове используются значения по умолчанию:
```python
garch_params = GARCHParams(p=1, q=1, dist="normal", mean="Zero")
```

### Процесс обучения

**Файл:** [`garch.py:180–274`](../apps/training-service/training_service/models/garch.py) — функция `train_garch()`

```
1. Масштабирование: scaled = returns × 100
   (arch ожидает данные в процентных пунктах для численной стабильности)
   → garch.py:204

2. Создание модели:
   am = arch_model(scaled, mean="Zero", vol="GARCH", p=1, q=1, dist="normal")
   → garch.py:206–213

3. Фитирование через MLE:
   res = am.fit(disp="off", show_warning=False)
   Оценивает параметры: ω, α, β (и ν, λ если dist="t"/"skewt")
   → garch.py:215

4. 1-шаговый прогноз условной дисперсии:
   forecast = res.forecast(horizon=horizon_days, reindex=False)
   cond_var_pct = forecast.variance.iloc[-1, horizon_days - 1]
   cond_vol_pct = sqrt(cond_var_pct)
   → garch.py:219–221

5. Перевод обратно в десятичные доли:
   cond_vol = cond_vol_pct / 100.0
   → garch.py:224

6. Аннуализация:
   vol_annualised = cond_vol × √252
   → garch.py:227

7. Вычисление VaR и CVaR (см. ниже)
   → garch.py:231–236

8. In-sample backtest (⚠️ не настоящий backtest):
   exceedances = sum(returns < -var)
   coverage_ratio = exceedances / len(returns)
   → garch.py:239–240
```

### Вычисление VaR и CVaR по распределению инноваций

**Файл:** [`garch.py:39–147`](../apps/training-service/training_service/models/garch.py) — функция `_var_cvar_from_dist()`

#### dist="normal" (по умолчанию)

```
q_level = 1 - alpha                    # например, 0.01 при alpha=0.99

z = Φ⁻¹(q_level)                      # квантиль N(0,1), отрицательный
                                        # при alpha=0.99: z ≈ -2.3263

VaR  = -z × σ_daily                   # положительное число (потеря)
     = 2.3263 × σ_daily

CVaR = φ(z) / (1 - alpha) × σ_daily   # φ — PDF стандартного нормального
     = φ(-2.3263) / 0.01 × σ_daily
```

#### dist="t" (Student-t с подобранными степенями свободы)

```
ν = fit_result.params["nu"]            # подобранные степени свободы (ν > 2)
                                        # garch.py:75

scale = √((ν - 2) / ν)                # нормировка: Var(t_ν) = ν/(ν-2)
                                        # garch.py:89

z = t_ν.ppf(q_level) × scale          # квантиль стандартизованного t
                                        # garch.py:90

VaR = -z × σ_daily                    # garch.py:91

CVaR = f_t(z/scale; ν) / scale / q_level × (ν + (z/scale)²) / (ν-1) × scale × σ_daily
                                        # аналитическая формула CVaR для t
                                        # garch.py:95–97
```

Если `ν < 2.1` (невалидное значение) — автоматический fallback на Normal.

#### dist="skewt" (Skewed Student-t)

```
ν   = fit_result.params["nu"]          # степени свободы
λ   = fit_result.params["lambda"]      # параметр асимметрии

z = SkewStudent().ppf(q_level, [ν, λ]) # квантиль из arch
                                        # garch.py:119

VaR = -z × σ_daily                    # garch.py:120

CVaR — численно:                       # garch.py:123–126
  tail_probs = linspace(1e-6, q_level, 10_000)
  tail_quantiles = SkewStudent().ppf(tail_probs, [ν, λ])
  CVaR = -mean(tail_quantiles) × σ_daily
```

При ошибке SkewStudent — fallback на Student-t.

### Диагностический график (артефакт MLflow)

**Файл:** [`garch.py:277–328`](../apps/training-service/training_service/models/garch.py) — функция `plot_garch_diagnostics()`

Генерирует PNG 12×8 дюймов с 4 панелями:

| Панель | Содержимое |
|--------|-----------|
| (0,0) Standardised Residuals | Временной ряд стандартизованных остатков `ε_t / σ_t` |
| (0,1) Conditional Volatility | Временной ряд условной волатильности `σ_t` (в десятичных долях) |
| (1,0) QQ-Plot | Квантиль-квантильный график остатков vs N(0,1) |
| (1,1) Residual Distribution | Гистограмма остатков + кривая N(0,1) |

### Параметры и метрики, логируемые в MLflow

**Файл:** [`pipelines/train.py:207–209`](../apps/training-service/training_service/pipelines/train.py)

**Params:**

| Параметр | Источник |
|----------|---------|
| `model_type` | `"garch"` |
| `p` | `GARCHParams.p` = 1 |
| `q` | `GARCHParams.q` = 1 |
| `dist` | `GARCHParams.dist` = `"normal"` |
| `mean` | `GARCHParams.mean` = `"Zero"` |
| `alpha` | из запроса (default 0.99) |
| `horizon_days` | из запроса (default 1) |
| `n_observations` | длина `port_rets` |
| `symbols` | строка через запятую |

**Metrics:**

| Метрика | Формула / источник |
|---------|-------------------|
| `var` | `-z × σ_daily` |
| `cvar` | аналитически по распределению |
| `volatility` | `σ_daily × √252` (аннуализированная) |
| `aic` | `res.aic` (Akaike Information Criterion) |
| `bic` | `res.bic` (Bayesian Information Criterion) |
| `log_likelihood` | `res.loglikelihood` |
| `backtest_coverage_ratio` | `sum(r < -VaR) / T` ⚠️ in-sample |
| `expected_coverage_ratio` | `1 - alpha` |
| `max_drawdown` | из [`metrics/risk_metrics.py`](../apps/training-service/training_service/metrics/risk_metrics.py) |
| `sharpe_ratio` | аннуализированный Sharpe |
| `sortino_ratio` | аннуализированный Sortino |
| `n_observations` | длина ряда |
| `risk_free_rate` | 0.0 (по умолчанию) |

**Артефакты:**

| Путь | Содержимое |
|------|-----------|
| `plots/*.png` | 2×2 диагностический график |
| `reports/*.json` | JSON с params + metrics + временем обучения |
| `model/*.pkl` | pickle-файл объекта `ARCHModelResult` |

---

## Модель 2: Monte Carlo (GBM)

**Файл:** [`training_service/models/montecarlo.py`](../apps/training-service/training_service/models/montecarlo.py)  
**MLflow pyfunc wrapper:** [`training_service/models/mc_pyfunc.py`](../apps/training-service/training_service/models/mc_pyfunc.py)  
**MLflow experiment:** `riskops-montecarlo`

### Математическая спецификация

Geometric Brownian Motion (GBM) — стохастический процесс для моделирования цен активов. Симулирует `N` будущих траекторий доходностей, VaR/CVaR вычисляются из **эмпирического распределения** симулированных потерь.

```
Непрерывная форма GBM:
  dS/S = μ·dt + σ·dW_t

Дискретная форма (дневной лог-доход):
  r_t = (μ - 0.5·σ²)·dt + σ·√dt·ε_t,   ε_t ~ N(0,1),  dt = 1 день

Простой доход за горизонт H дней:
  R = exp(Σ_{t=1}^{H} r_t) - 1
```

### Оценка параметров из истории (MLE)

**Файл:** [`montecarlo.py:56–64`](../apps/training-service/training_service/models/montecarlo.py) — функция `_estimate_gbm_params()`

```python
sigma = std(returns, ddof=1)           # дневная волатильность
mu    = mean(returns) + 0.5 * sigma²   # дневной дрейф (MLE для GBM)
```

Параметры сохраняются в `MonteCarloModel` (mu, sigma) и используются при инференсе.

### Гиперпараметры

**Файл:** [`montecarlo.py:22–26`](../apps/training-service/training_service/models/montecarlo.py) — датакласс `MonteCarloParams`

| Параметр | Значение по умолчанию | Описание |
|----------|----------------------|----------|
| `n_simulations` | `10_000` | Число симулированных траекторий |
| `seed` | `42` | Seed для воспроизводимости (`None` = случайный) |

В [`pipelines/train.py:290`](../apps/training-service/training_service/pipelines/train.py):
```python
mc_params = MonteCarloParams(n_simulations=req.n_simulations, seed=42)
```

### Одноактивный случай (1D)

**Файл:** [`montecarlo.py:161–181`](../apps/training-service/training_service/models/montecarlo.py) — функция `_simulate_gbm_1d()`

```python
dt = 1.0
drift     = (mu - 0.5 * sigma²) * dt
diffusion = sigma * sqrt(dt)

# Shape: (n_simulations, horizon_days)
daily_log_returns = rng.normal(loc=drift, scale=diffusion, size=(n_sims, horizon))
total_log_returns = daily_log_returns.sum(axis=1)   # суммируем по дням

# Конвертация лог-доходности в простую:
simulated = exp(total_log_returns) - 1.0            # shape: (n_sims,)
```

### Многоактивный случай с разложением Холецкого

**Файл:** [`montecarlo.py:184–229`](../apps/training-service/training_service/models/montecarlo.py) — функция `_simulate_gbm_multiasset()`

Используется когда `returns.ndim == 2` (матрица T×N). Генерирует **коррелированные** шоки через разложение Холецкого:

```python
cov_mat = cov(returns.T, ddof=1)       # ковариационная матрица N×N
L = cholesky(cov_mat)                  # нижнетреугольная матрица: Σ = L·Lᵀ

# При вырожденной матрице — регуляризация:
cov_mat += eye(N) * 1e-8               # montecarlo.py:212

z = rng.standard_normal((n_sims, horizon, N))   # независимые шоки
corr_z = z @ L.T                       # коррелированные шоки: (n_sims, horizon, N)

daily_log_returns = drift_vec + corr_z          # broadcast дрейфа
total_log_returns = daily_log_returns.sum(axis=1)  # (n_sims, N)
asset_returns = exp(total_log_returns) - 1.0    # (n_sims, N)

portfolio_returns = asset_returns @ weights     # (n_sims,) — взвешенная сумма
```

> **Важно:** в текущем пайплайне [`pipelines/train.py:75–97`](../apps/training-service/training_service/pipelines/train.py) `build_portfolio_returns()` уже агрегирует доходности в 1D до передачи в `run_monte_carlo()`. Многоактивный путь используется только при прямом вызове `run_monte_carlo()` с 2D массивом.

### Вычисление VaR и CVaR

**Файл:** [`montecarlo.py:117–125`](../apps/training-service/training_service/models/montecarlo.py)

```python
# Из эмпирического распределения N симулированных доходностей:
var_quantile = quantile(simulated, 1 - alpha)   # отрицательное число
var  = -var_quantile                             # положительная потеря

tail = simulated[simulated <= var_quantile]      # хвост распределения
cvar = -mean(tail)                               # среднее по хвосту

vol_annualised = std(simulated, ddof=1) * sqrt(252 / horizon_days)
```

### MLflow pyfunc wrapper

**Файл:** [`models/mc_pyfunc.py`](../apps/training-service/training_service/models/mc_pyfunc.py)

Monte Carlo сохраняется в MLflow как `mlflow.pyfunc` модель (в отличие от GARCH, который сохраняется как pickle). Это позволяет Inference Service загружать его через `mlflow.pyfunc.load_model()`.

```python
class MonteCarloModel(mlflow.pyfunc.PythonModel):
    # Хранит: mu, sigma, seed — параметры GBM, оценённые при обучении
    # mc_pyfunc.py:56–59

    def predict(self, context, model_input: pd.DataFrame) -> pd.DataFrame:
        # Принимает DataFrame с колонками: n_simulations, horizon_days, alpha
        # Возвращает DataFrame с колонками: var, cvar, volatility, method
        # mc_pyfunc.py:65–92

    @classmethod
    def from_returns(cls, returns, seed=42):
        # Оценивает mu, sigma из исторических доходностей
        # sigma = std(returns, ddof=1)
        # mu    = mean(returns) + 0.5 * sigma²
        # mc_pyfunc.py:134–152
```

Артефактная структура в MLflow:
```
model/
  MLmodel           ← метаданные mlflow.pyfunc
  python_model.pkl  ← pickle MonteCarloModel (mu, sigma, seed)
  params.json       ← человекочитаемые параметры для инспекции
```

### Параметры и метрики, логируемые в MLflow

**Файл:** [`pipelines/train.py:312–314`](../apps/training-service/training_service/pipelines/train.py)

**Params:**

| Параметр | Значение |
|----------|---------|
| `model_type` | `"montecarlo"` |
| `n_simulations` | из запроса (default 10000) |
| `alpha` | из запроса (default 0.99) |
| `horizon_days` | из запроса (default 1) |
| `n_observations` | длина `port_rets` |
| `seed` | 42 |
| `symbols` | строка через запятую |

**Metrics:**

| Метрика | Формула |
|---------|---------|
| `var` | `-quantile(simulated, 1-alpha)` |
| `cvar` | `-mean(simulated[simulated ≤ -VaR])` |
| `volatility` | `std(simulated) × √(252/horizon)` |
| `mean_simulated_return` | `mean(simulated)` |
| `std_simulated_return` | `std(simulated, ddof=1)` |
| `max_drawdown` | из [`metrics/risk_metrics.py`](../apps/training-service/training_service/metrics/risk_metrics.py) |
| `sharpe_ratio` | аннуализированный Sharpe |
| `sortino_ratio` | аннуализированный Sortino |

**Артефакты:**

| Путь | Содержимое |
|------|-----------|
| `plots/*.png` | 2 графика: гистограмма + CDF с VaR/CVaR |
| `reports/*.json` | JSON с params + metrics |
| `model/` | mlflow.pyfunc (pickle MonteCarloModel + params.json) |

---

## Дополнительные метрики риска

**Файл:** [`training_service/metrics/risk_metrics.py`](../apps/training-service/training_service/metrics/risk_metrics.py)

Вычисляются для обеих моделей в [`pipelines/train.py:199–204`](../apps/training-service/training_service/pipelines/train.py) через `compute_all()` и логируются в MLflow вместе с основными метриками.

### Max Drawdown

```python
# risk_metrics.py:37–55
cumulative  = cumprod(1 + returns)
running_max = maximum.accumulate(cumulative)
drawdown    = (cumulative - running_max) / running_max
max_drawdown = drawdown.min()   # отрицательное число, например -0.43 = -43%
```

### Sharpe Ratio (аннуализированный)

```python
# risk_metrics.py:58–82
rf_daily = risk_free_rate / 252          # годовая ставка → дневная
excess   = returns - rf_daily
sharpe   = mean(excess) / std(excess, ddof=1) * sqrt(252)
```

### Sortino Ratio (аннуализированный)

```python
# risk_metrics.py:85–117
rf_daily     = risk_free_rate / 252
excess       = returns - rf_daily
downside     = excess[excess < 0]        # только отрицательные избыточные доходности
downside_std = sqrt(mean(downside²))     # downside deviation
sortino      = mean(excess) / downside_std * sqrt(252)
```

### Beta к бенчмарку

```python
# risk_metrics.py:120–152
cov      = cov(portfolio_returns, benchmark_returns)[0, 1]
var_bench = var(benchmark_returns, ddof=1)
beta     = cov / var_bench
```

Бенчмарк не передаётся в текущем пайплайне → `beta_to_benchmark = None`.

### Correlation Matrix

```python
# risk_metrics.py:155–167
returns_df.corr(method="pearson")   # DataFrame N×N
```

Реализована, но **не используется** в текущем пайплайне обучения и не экспонируется через API.

---

## Pipeline обучения (полный поток)

**Файл:** [`training_service/pipelines/train.py`](../apps/training-service/training_service/pipelines/train.py)

```
run_training(req: TrainRequest)                          # train.py:434
  │
  ├── load_returns(symbols, lookback_days)               # train.py:33
  │     SQL: SELECT symbol, price_date, ret
  │          FROM processed_returns
  │          WHERE symbol = ANY(:symbols)
  │     → DataFrame (symbol, price_date, ret)
  │
  ├── build_portfolio_returns(returns_df, weights)       # train.py:75
  │     pivot → (T × N) → @ weights → (T,) port_rets
  │
  └── для каждого model_type в ["garch", "montecarlo"]:
        │
        ├── [GARCH] _train_garch_pipeline(port_rets, req, "riskops-garch")
        │     │                                          # train.py:175
        │     ├── train_garch(port_rets, alpha, horizon, GARCHParams)
        │     │     → GARCHResult(var, cvar, vol, aic, bic, ll, coverage_ratio)
        │     │
        │     ├── compute_risk_metrics(port_rets, var, cvar, vol)
        │     │     → RiskMetrics(mdd, sharpe, sortino, beta)
        │     │
        │     ├── mlflow.start_run(run_name="garch-YYYYMMDD-HHMMSS")
        │     │     ├── log_params({p, q, dist, mean, alpha, horizon, n_obs, symbols})
        │     │     ├── log_metrics({var, cvar, vol, aic, bic, ll, coverage, mdd, sharpe, sortino})
        │     │     ├── log_artifact(plot.png → "plots/")
        │     │     ├── log_artifact(report.json → "reports/")
        │     │     ├── log_artifact(model.pkl → "model/")
        │     │     └── create_model_version("riskops-garch", source="runs:/{run_id}/model")
        │     │
        │     └── _register_model_in_db(model_name, version, run_id, metrics)
        │           INSERT INTO model_registry ... ON CONFLICT DO UPDATE
        │
        └── [MC] _train_montecarlo_pipeline(port_rets, req, "riskops-montecarlo")
              │                                          # train.py:281
              ├── run_monte_carlo(port_rets, alpha, horizon, MonteCarloParams)
              │     → MonteCarloResult(var, cvar, vol, mean_ret, std_ret, simulated)
              │
              ├── compute_risk_metrics(port_rets, var, cvar, vol)
              │     → RiskMetrics(mdd, sharpe, sortino, beta)
```

---

## Backtesting Engine

**Директория:** [`training_service/backtesting/`](../apps/training-service/training_service/backtesting/)

Реализует **out-of-sample rolling window backtest** для валидации VaR-моделей. Исправляет критический баг §16.1 — ранее `backtest_coverage_ratio` в `garch.py` вычислялся на **обучающей** выборке (in-sample), что делало его бессмысленным.

### Структура модуля

```
backtesting/
├── __init__.py            # публичный API (re-exports)
├── kupiec.py              # тест Купика (unconditional coverage)
├── christoffersen.py      # тест Кристофферсена (conditional coverage)
├── rolling_backtest.py    # движок скользящего окна
└── report.py              # BacktestReport + MLflow logging + диагностический график
```

### Алгоритм скользящего окна

```
Для каждого дня t в out-of-sample периоде [T_train, T_end):

  1. Обучающее окно : returns[t - lookback_days : t]
  2. Обучить модель → предсказать VaR(t)
  3. Реализованная доходность : returns[t]
  4. Нарушение (violation) : 1 если returns[t] < -VaR(t) иначе 0

Собрать hit-последовательность → запустить тесты Купика + Кристофферсена
```

### Параметры `POST /api/risk/backtest`

**Файл:** [`training_service/api/routes.py`](../apps/training-service/training_service/api/routes.py)

| Поле | По умолчанию | Ограничения | Описание |
|------|-------------|-------------|----------|
| `symbols` | `["AAPL","MSFT"]` | min 1 элемент | Тикеры для бэктеста |
| `model_type` | `garch` | `garch` / `montecarlo` / `historical` | Тип модели |
| `alpha` | `0.99` | 0.9–0.9999 | Уровень доверия VaR |
| `lookback_days` | `252` | 30–2520 | Размер скользящего обучающего окна |
| `test_days` | `60` | 10–504 | Число out-of-sample дней |
| `horizon_days` | `1` | 1–30 | Горизонт прогноза VaR |
| `n_simulations` | `1000` | 100–10000 | Симуляций MC на шаг (только для `montecarlo`) |
| `weights` | `null` | dict `{symbol: float}` | Веса символов |
| `mlflow_run_id` | `null` | строка | Существующий run_id для дозаписи метрик |
| `log_to_mlflow` | `true` | bool | Логировать ли результаты в MLflow |

### Пример запроса и ответа

```bash
curl -X POST http://localhost:8084/api/risk/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["AAPL", "MSFT"],
    "model_type": "garch",
    "alpha": 0.99,
    "lookback_days": 252,
    "test_days": 60
  }'
```

```json
{
  "violations": 3,
  "total_obs": 60,
  "violation_rate": 0.05,
  "expected_rate": 0.01,
  "kupiec_lr": 8.234,
  "kupiec_pvalue": 0.023,
  "christoffersen_lr_ind": 1.102,
  "christoffersen_lr_cc": 9.336,
  "christoffersen_pvalue_ind": 0.294,
  "christoffersen_pvalue_cc": 0.041,
  "pi_01": 0.048,
  "pi_11": 0.333,
  "status": "WARN",
  "model_type": "garch",
  "alpha": 0.99,
  "lookback_days": 252,
  "test_days": 60,
  "mlflow_run_id": "abc123..."
}
```

### Статистические тесты

#### Тест Купика (Unconditional Coverage)

**Файл:** [`backtesting/kupiec.py`](../apps/training-service/training_service/backtesting/kupiec.py)

```
H0: p = 1 - α   (наблюдаемая частота нарушений = ожидаемой)

LR_uc = -2 · ln[ (1-p₀)^(T-x) · p₀^x  /  (1-p̂)^(T-x) · p̂^x ]
LR_uc ~ χ²(1) при H0

где:
  T   = число out-of-sample наблюдений
  x   = число нарушений VaR
  p₀  = 1 - alpha (ожидаемая частота)
  p̂   = x / T    (наблюдаемая частота)
```

#### Тест Кристофферсена (Conditional Coverage)

**Файл:** [`backtesting/christoffersen.py`](../apps/training-service/training_service/backtesting/christoffersen.py)

Дополнительно проверяет **независимость** нарушений (отсутствие кластеризации).

```
LR_cc  = LR_uc + LR_ind  ~  χ²(2) при H0
LR_ind = LR_cc - LR_uc   ~  χ²(1) при H0 (только независимость)

Матрица переходов:
  n_ij = число дней, когда состояние i сменяется состоянием j
         (0 = нет нарушения, 1 = нарушение)

  π₀₁ = n₀₁ / (n₀₀ + n₀₁)  — P(нарушение | вчера нарушения не было)
  π₁₁ = n₁₁ / (n₁₀ + n₁₁)  — P(нарушение | вчера было нарушение)
```

#### Пороги принятия решений

| p-value | Статус | Действие |
|---------|--------|----------|
| `> 0.05` | **OK** | Модель хорошо откалибрована |
| `0.01 < p ≤ 0.05` | **WARN** | Мониторинг, возможно переобучение |
| `≤ 0.01` | **CRIT** | Триггер переобучения |

Используется минимум из `kupiec_pvalue` и `christoffersen_pvalue_cc`.

### MLflow артефакты бэктеста

При `log_to_mlflow=true` в MLflow логируются:

| Путь | Содержимое |
|------|-----------|
| `backtest_reports/*.json` | `BacktestReport` — все метрики и параметры |
| `backtest_plots/*.png` | Двухпанельный диагностический график |

**Метрики в MLflow:**

| Метрика | Описание |
|---------|---------|
| `backtest_violations` | Число нарушений VaR |
| `backtest_total_obs` | Число out-of-sample наблюдений |
| `backtest_violation_rate` | Наблюдаемая частота нарушений |
| `backtest_expected_rate` | Ожидаемая частота (= 1 - alpha) |
| `kupiec_lr` | LR-статистика теста Купика |
| `kupiec_pvalue` | p-value теста Купика |
| `christoffersen_lr_ind` | LR-статистика независимости |
| `christoffersen_lr_cc` | LR-статистика условного покрытия |
| `christoffersen_pvalue_ind` | p-value теста независимости |
| `christoffersen_pvalue_cc` | p-value теста условного покрытия |
| `backtest_pi_01` | P(нарушение \| вчера нарушения не было) |
| `backtest_pi_11` | P(нарушение \| вчера было нарушение) |

### Диагностический график

**Файл:** [`backtesting/report.py`](../apps/training-service/training_service/backtesting/report.py) — функция `plot_backtest()`

Двухпанельный PNG 14×5 дюймов:

| Панель | Содержимое |
|--------|-----------|
| Левая | Реализованные доходности vs. предсказанный `-VaR` (нарушения — красные точки) |
| Правая | Hit-последовательность (stem plot) — кластеризация нарушений видна визуально |

### Исправление бага §16.1

**Файл:** [`training_service/models/garch.py`](../apps/training-service/training_service/models/garch.py)

До исправления:
```python
# БЫЛО (in-sample — неверно):
exceedances = np.sum(returns < -var)
coverage_ratio = float(exceedances / len(returns))
# Метрика называлась "backtest_coverage_ratio" — вводила в заблуждение
```

После исправления:
```python
# СТАЛО (явно помечено как in-sample диагностика):
insample_exceedances = np.sum(returns < -var)
insample_coverage_ratio = float(insample_exceedances / len(returns))
# Метрика переименована в "insample_coverage_ratio"
# Настоящий бэктест — POST /api/risk/backtest
```

### Поддерживаемые типы моделей в бэктесте

| `model_type` | Описание | Скорость |
|-------------|---------|---------|
| `historical` | Эмпирический квантиль обучающего окна | Быстро (~1 с) |
| `garch` | GARCH(1,1) с Normal innovations | Средне (~10–20 с) |
| `montecarlo` | Monte Carlo GBM | Медленно (~30–60 с) |

> **Примечание:** `montecarlo` в режиме бэктеста использует `n_simulations=1000` по умолчанию (вместо 10000 при обучении) для приемлемой скорости.
