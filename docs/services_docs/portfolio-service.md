# Portfolio Service

**Language:** Go  
**Port:** `8082`  
**Path:** [`apps/portfolio-service/`](../apps/portfolio-service/)

## Что делает

Управляет портфелями и позициями. Хранит данные в PostgreSQL. При каждом изменении портфеля или позиции публикует событие `portfolio.updated` в Kafka — это триггер для inference-service, чтобы пересчитать риски.

Также предоставляет read-only доступ к результатам риск-расчётов (которые пишет inference-service).

## Endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/portfolios` | Список всех портфелей |
| `POST` | `/api/portfolios` | Создать портфель |
| `GET` | `/api/portfolios/{id}` | Получить портфель по ID |
| `DELETE` | `/api/portfolios/{id}` | Удалить портфель |
| `GET` | `/api/portfolios/{id}/positions` | Список позиций портфеля |
| `POST` | `/api/portfolios/{id}/positions` | Создать/обновить позицию (upsert) |
| `DELETE` | `/api/portfolios/{id}/positions/{symbol}` | Удалить позицию |
| `GET` | `/api/portfolios/{id}/risk/latest` | Последние риск-результаты |
| `GET` | `/api/portfolios/{id}/risk` | История риск-результатов (`?limit=100`) |

## Ключевые модели

**Portfolio** — `id`, `name`, `description`, `currency`, `created_at`, `updated_at`

**Position** — `portfolio_id`, `symbol`, `weight` (доля в портфеле, float)

**RiskResult** — `portfolio_id`, `asof_date`, `horizon_days`, `alpha`, `method`, `metric` (var/cvar/volatility), `value`, `model_version`

## Kafka

- **Топик:** `portfolio.updated`
- **Событие публикуется при:** создании/удалении портфеля, upsert/удалении позиции
- **Payload:** `{ event, portfolio_id, action, symbol?, occurred_at }`

## Конфигурация (env)

| Переменная | По умолчанию |
|-----------|-------------|
| `PORT` | `8082` |
| `DATABASE_URL` | `postgres://...` |
| `KAFKA_BROKERS` | `kafka:9092` |

## Структура

```
apps/portfolio-service/
├── main.go
├── openapi.yaml
└── internal/
    ├── config/config.go
    ├── handler/portfolio.go    # HTTP handlers
    ├── repository/portfolio.go # SQL-запросы
    └── service/portfolio.go    # бизнес-логика + Kafka publish
```
