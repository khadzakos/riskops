# Market Data Service

**Language:** Go  
**Port:** `8083`  
**Path:** [`apps/market-data-service/`](../apps/market-data-service/)

## Что делает

Собирает, нормализует и хранит рыночные данные из нескольких источников. Поддерживает загрузку исторических цен акций (Yahoo Finance, MOEX ISS), синтетических данных и кредитных портфелей. Вычисляет дневные доходности из сырых цен и предоставляет их через REST API для training-service и inference-service.

## Источники данных

| Источник | Тип | Описание |
|----------|-----|----------|
| `yahoo` | цены | Yahoo Finance — US акции, ETF, индексы |
| `moex` | цены | MOEX ISS — российские акции и индексы |
| `synthetic` | цены | Случайное блуждание (для тестов без внешних API) |
| `credit_synthetic` | кредиты | Синтетические кредитные портфели |

## Endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| `POST` | `/api/market-data/ingest` | Запустить загрузку для конкретного источника и символов |
| `POST` | `/api/market-data/ingest/all` | Запустить загрузку по всем источникам |
| `GET` | `/api/market-data/prices` | Сырые цены (`?symbols=AAPL,MSFT&date_from=&date_to=&source=&limit=`) |
| `GET` | `/api/market-data/returns` | Обработанные доходности (`?symbols=&date_from=&date_to=&limit=`) |
| `GET` | `/api/market-data/credit` | Кредитные записи (`?source=&is_default=&limit=`) |
| `GET` | `/api/market-data/sources` | Список доступных источников и их статус |
| `GET` | `/api/market-data/ingestion-log` | История загрузок (`?source=&status=completed\|failed&limit=`) |

## Ключевые модели

**RawPrice** — `symbol`, `price_date`, `close`, `currency`, `source`, `ingested_at`

**ProcessedReturn** — `symbol`, `price_date`, `ret` (простая дневная доходность), `computed_at`

**CreditRecord** — `loan_id`, `borrower_id`, `loan_amount`, `interest_rate`, `term_months`, `credit_score`, `ltv_ratio`, `dti_ratio`, `is_default`, `origination_date`, `sector`

**IngestionLog** — `source`, `data_type`, `symbols[]`, `date_from`, `date_to`, `rows_ingested`, `status`, `error_message`

## Структура

```
apps/market-data-service/
├── main.go
├── openapi.yaml
└── internal/
    ├── config/config.go
    ├── collector/
    │   ├── collector.go          # интерфейс Collector
    │   ├── yahoo.go              # Yahoo Finance API
    │   ├── moex.go               # MOEX ISS API
    │   ├── synthetic.go          # генератор синтетических цен
    │   └── credit_synthetic.go   # генератор кредитных данных
    ├── handler/market_data.go    # HTTP handlers
    ├── repository/
    │   ├── prices.go             # raw_prices + processed_returns
    │   ├── credit.go             # credit_portfolio
    │   └── ingestion_log.go      # ingestion_log
    └── service/
        ├── ingest.go             # оркестрация загрузки
        └── returns.go            # вычисление доходностей
```
