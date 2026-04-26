# Gateway

**Language:** Go  
**Port:** `8081`  
**Path:** [`apps/gateway/`](../apps/gateway/)

## Что делает

Единая точка входа для всех клиентов (UI, внешние запросы). Принимает HTTP-запросы и проксирует их в нужный downstream-сервис через `net/http/httputil.ReverseProxy`. Также добавляет CORS-заголовки.

Сам по себе никакой бизнес-логики не содержит — только маршрутизация и CORS.

## Маршруты и куда они уходят

| Prefix | Downstream сервис | URL по умолчанию |
|--------|-------------------|-----------------|
| `/api/portfolios/*` | portfolio-service | `http://portfolio-service:8082` |
| `/api/scenarios/*` | portfolio-service | `http://portfolio-service:8082` |
| `/api/risk-limits/*` | portfolio-service | `http://portfolio-service:8082` |
| `/api/alerts/*` | portfolio-service | `http://portfolio-service:8082` |
| `/api/market-data/*` | market-data-service | `http://market-data-service:8083` |
| `/api/risk/predict/*` | inference-service | `http://inference-service:8085` |
| `/api/risk/train/*` | training-service | `http://training-service:8084` |
| `/api/risk/models/*` | training-service | `http://training-service:8084` |

## Конфигурация (env)

| Переменная | По умолчанию |
|-----------|-------------|
| `PORT` | `8081` |
| `LOG_LEVEL` | `info` |
| `PORTFOLIO_SERVICE_URL` | `http://portfolio-service:8082` |
| `MARKET_DATA_SERVICE_URL` | `http://market-data-service:8083` |
| `INFERENCE_SERVICE_URL` | `http://inference-service:8085` |
| `TRAINING_SERVICE_URL` | `http://training-service:8084` |

## Структура

```
apps/gateway/
├── main.go                    # точка входа, сборка роутера
└── internal/
    ├── config/config.go       # загрузка env
    └── handler/
        ├── cors.go            # CORS middleware
        └── proxy.go           # регистрация маршрутов + reverse proxy
```
