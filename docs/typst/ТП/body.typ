#let column_names = [My *content*] 
= ТЕКСТ ПРОГРАММЫ
#h(2em)  MLOps-конвейер для автоматизации оценки рыночного риска портфеля «RiskOps» представляет из себя набор сервисов, образующих пайплайн данных для оценки рыночных рисков. Ознакомиться с с текстом программы можно по данной ссылке на ресурсе "GitHub": https://github.com/khadzakos/riskops

== Сервисы и библиотеки
=== Gateway
HTTP-шлюз с CORS, проксирующий запросы к портфельному, рыночным данным, inference- и training-сервисам.

Ссылка: https://github.com/khadzakos/riskops/tree/main/apps/gateway

=== Market Data Service
Сервис сбора, хранения и выдачи рыночных данных через API/Синтетическую генерацию для тестовых целей.

Ссылка: https://github.com/khadzakos/riskops/tree/main/apps/market-data-service

=== Portfolio Service
Управление инвестиционными портфелями и сопутствующими сущностями на жизненном цикле.

Ссылка: https://github.com/khadzakos/riskops/tree/main/apps/portfolio-service

=== Inference Service
Выдача предсказаний обученных ML-моделей в эксплуатации.

Ссылка: https://github.com/khadzakos/riskops/tree/main/apps/inference-service

=== Training Service
Обучение и сопутствующие сценарии (MLflow, фоновая обработка событий Kafka).

Ссылка: https://github.com/khadzakos/riskops/tree/main/apps/training-service

=== Pipelines
Библиотека пайплайнов, оркестрирующих работу компонентов системы.

Ссылка: https://github.com/khadzakos/riskops/tree/main/apps/pipelines

=== Frontend
Web-интерфейс для визуализации рисков и данных портфеля.

Ссылка: https://github.com/khadzakos/riskops/tree/main/apps/frontend

=== Infra
Инфраструктурные манифесты и сценарии развёртывания проекта.

Ссылка: https://github.com/khadzakos/riskops/tree/main/infra

== Сборка

Сборка всего приложения совершается через Makefile:

https://github.com/khadzakos/riskops/blob/main/Makefile

== CI/CD
Конфиг для CI/CD находится по ссылке: https://github.com/khadzakos/riskops/tree/main/.github/workflows.

== Библиотеки и фреймворки
=== Airflow
Программное обеспечение для оркестрации и мониторинга рабочих процессов обработки данных, предназначенное для разработчиков и инженеров данных.

Ссылка: https://airflow.apache.org/

=== MLFlow

Это платформа с открытым исходным кодом для управления жизненным циклом машинного обучения

Ссылка: https://mlflow.org/

=== FastAPI
Асинхронный веб-фреймворк на Python для REST API сервисов обучения и вывода.

Ссылка: https://fastapi.tiangolo.com/

=== Next.js
Фреймворк для веб-интерфейса на React (серверный рендеринг, маршрутизация).

Ссылка: https://nextjs.org/

=== Chi
Лёгкий маршрутизатор HTTP для Go-сервисов.

Ссылка: https://github.com/go-chi/chi

=== pgx
Драйвер и набор инструментов для работы с PostgreSQL из Go.

Ссылка: https://github.com/jackc/pgx

=== Zap
Структурированное логирование в Go-сервисах.

Ссылка: https://github.com/uber-go/zap

=== Kafka
Распределённый брокер потоков сообщений; в Go используется клиент kafka-go.

Ссылка: https://kafka.apache.org/

=== PostgreSQL

Реляционная база данных с открытым исходным кодом.

Ссылка: https://www.postgresql.org/

=== MinIO
S3-совместимое объектное хранилище; в проекте — для артефактов MLflow.

Ссылка: https://min.io/

=== Docker

Docker помогает разработчикам создавать, совместно использовать, запускать и проверять приложения в любом месте.

Ссылка: https://www.docker.com/

=== Prometheus
Сбор и хранение метрик; в связке с экспортом из приложений.

Ссылка: https://prometheus.io/

=== Grafana
Визуализация метрик и дашборды.

Ссылка: https://grafana.com/

=== Caddy
Веб-сервер и обратный прокси с автоматическим HTTPS.

Ссылка: https://caddyserver.com/