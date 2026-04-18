# Pipelines (CLI-утилита)

**Language:** Python (Typer CLI)  
**Path:** [`apps/pipelines/`](../apps/pipelines/)

## Что делает

Автономная CLI-утилита для ручного управления данными и риск-расчётами напрямую через PostgreSQL. Используется для начальной загрузки данных, отладки и логирования результатов в MLflow без запуска полного стека сервисов.

Запускается как: `python -m riskops_pipelines <command>`

---

## Команды

### `ingest` — загрузка сырых цен в `raw_prices`

```bash
python -m riskops_pipelines ingest \
  --symbols AAPL,MSFT \
  --start 2024-01-01 \
  --end 2024-12-31 \
  --source synthetic   # synthetic | csv
  --csv-path data.csv  # только для source=csv
  --seed 7
```

- **`synthetic`** — генерирует случайное блуждание (log-normal): `μ=0.0002`, `σ=0.02`, начальная цена `U(80, 200)`
- **`csv`** — читает CSV с колонками `symbol, date, close`
- Использует `INSERT ... ON CONFLICT DO UPDATE` (upsert)

---

### `process` — вычисление доходностей в `processed_returns`

```bash
python -m riskops_pipelines process --symbols AAPL,MSFT
```

Читает `raw_prices`, вычисляет простые дневные доходности: `r_t = (P_t - P_{t-1}) / P_{t-1}` через `pct_change()`. Записывает в `processed_returns` (upsert).

---

### `risk` — вычисление VaR/CVaR и запись в `risk_results`

```bash
python -m riskops_pipelines risk \
  --portfolio demo \
  --alpha 0.99 \
  --horizon-days 1 \
  --method historical \
  --lookback-days 252
```

1. Находит портфель по имени в таблице `portfolios`
2. Загружает позиции из `portfolio_positions`
3. Загружает `processed_returns` для символов портфеля
4. Строит взвешенный ряд доходностей: `R_p = Σ w_i · r_i`
5. Вычисляет историческую VaR/CVaR:
   ```
   VaR  = -quantile(R_p, 1 - α)
   CVaR = -mean(R_p | R_p ≤ -VaR)
   ```
6. Записывает 2 строки в `risk_results` (метрики `var` и `cvar`)

> Поддерживается только `method=historical`. GARCH и Monte Carlo — через training/inference сервисы.

---

### `log-to-mlflow` — логирование результатов в MLflow

```bash
python -m riskops_pipelines log-to-mlflow \
  --portfolio demo \
  --experiment riskops-mvp
```

Читает последние `risk_results` для портфеля и создаёт MLflow run с параметрами и метриками. Также сохраняет JSON-артефакт `risk_summary.json`.

---

## Конфигурация (env)

| Переменная | По умолчанию |
|-----------|-------------|
| `DATABASE_URL` | `postgresql://...` |
| `MLFLOW_TRACKING_URI` | `http://mlflow:3000` |

---

## Структура

```
apps/pipelines/
├── Dockerfile
└── riskops_pipelines/
    ├── __main__.py    # точка входа: python -m riskops_pipelines
    ├── cli.py         # все команды (ingest, process, risk, log-to-mlflow)
    └── db.py          # psycopg2 + SQLAlchemy подключение
```
