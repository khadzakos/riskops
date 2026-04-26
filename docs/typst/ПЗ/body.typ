#import "@preview/cetz:0.3.4": canvas, draw

#let placeholder(kind: "СКРИНШОТ", desc, caption) = figure(
  rect(
    width: 100%,
    height: 55mm,
    stroke: (paint: gray, dash: "dashed", thickness: 0.6pt),
    inset: 6mm,
    align(center + horizon)[
      #set text(size: 11pt, fill: gray)
      *[#kind]* \
      #desc
    ],
  ),
  caption: caption,
)

// Цветовая палитра для диаграмм
#let c-svc = rgb("#cfe2ff")     // Go-сервисы
#let c-py  = rgb("#fff3cd")     // Python-сервисы
#let c-fe  = rgb("#d1e7dd")     // Frontend
#let c-db  = rgb("#f8d7da")     // Хранилища
#let c-ext = rgb("#e2e3e5")     // Внешние / инфраструктура
#let c-mq  = rgb("#ffe5b4")     // Очереди

#let dbox(x, y, w, h, label, fill: c-svc) = {
  import draw: *
  rect((x, y), (x + w, y + h), fill: fill, stroke: 0.5pt + black, radius: 1pt)
  content((x + w/2, y + h/2), text(7pt)[#label])
}

#let darrow(from, to, label: none, dash: none) = {
  import draw: *
  line(from, to, mark: (end: ">"), stroke: (paint: black, thickness: 0.5pt, dash: dash))
  if label != none {
    let mid = ((from.at(0) + to.at(0))/2, (from.at(1) + to.at(1))/2)
    content(mid, box(fill: white, inset: 1pt, text(6pt)[#label]))
  }
}


= ВВЕДЕНИЕ


== Наименование программы

Полное наименование программы – «MLOps-конвейер для автоматизации оценки рыночного риска портфеля».

Наименование на английском языке – «RiskOps: MLOps Pipeline for Automated Portfolio Market Risk Assessment».

Краткое наименование – «RiskOps».

== Тема разработки

RiskOps представляет собой микросервисную систему, реализующую полный жизненный цикл MLOps-конвейера для автоматизированной оценки рыночного риска инвестиционного портфеля. Система обеспечивает периодическую загрузку рыночных данных из внешних источников (Yahoo Finance, MOEX ISS), вычисление дневных доходностей, обучение и переобучение моделей оценки рыночного риска (GARCH(1,1), Monte Carlo на базе геометрического броуновского движения), регистрацию обученных моделей в реестре MLflow, online-инференс риск-метрик (Value-at-Risk, Conditional Value-at-Risk, волатильность, максимальная просадка, коэффициенты Шарпа и Сортино, коэффициент Бета), out-of-sample бэктестирование с применением статистических тестов Купика и Кристофферсена, выполнение стресс-тестирования по историческим и параметрическим сценариям, а также визуализацию результатов в виде веб-интерфейса.

== Документ, на основании которого ведётся разработка

Основанием для разработки является учебный план подготовки бакалавров по направлению 09.03.04 «Программная инженерия» и утверждённая академическим руководителем образовательной программы тема курсового проекта.


= НАЗНАЧЕНИЕ И ОБЛАСТЬ ПРИМЕНЕНИЯ


== Назначение программы

Программный комплекс RiskOps предназначен для автоматизированной оценки рыночного риска инвестиционных портфелей в соответствии с практиками MLOps. Система решает следующие прикладные задачи:

1. периодический сбор и нормализация исторических ценовых рядов финансовых инструментов из внешних источников;
2. вычисление и хранение дневных простых доходностей по каждому инструменту;
3. ведение справочника портфелей и их позиций (символ инструмента и его весовая доля);
4. обучение моделей оценки рыночного риска: параметрической GARCH(1,1) и стохастической Monte Carlo на базе геометрического броуновского движения (GBM);
5. ведение реестра версий моделей с поддержкой отката и горячей перезагрузки;
6. вычисление в режиме онлайн риск-метрик портфеля (VaR, CVaR, волатильность, максимальная просадка, коэффициенты Шарпа и Сортино);
7. out-of-sample бэктестирование качества VaR-моделей с автоматической классификацией статуса модели (OK / WARN / CRIT) на основании p-value тестов Купика и Кристофферсена;
8. стресс-тестирование портфеля по пяти встроенным сценариям и пользовательскому параметрическому сценарию;
9. предоставление веб-интерфейса.

== Краткая характеристика области применения программы

Областью применения программного комплекса является финансовая аналитика, в частности — управление рыночным риском портфелей, состоящих из ликвидных биржевых инструментов (акций, биржевых фондов, индексов). Основные пользователи системы:

#v(-2mm)
- риск-аналитики и портфельные управляющие, которым требуется ежедневная количественная оценка возможных потерь портфеля;
- разработчики количественных моделей, использующие систему как стенд для исследования и сравнения моделей оценки риска;
- образовательные учреждения, использующие систему в учебных курсах по риск-менеджменту и MLOps.
\
#v(-8mm)

Система ориентирована на работу с дневными ценовыми рядами и горизонтом прогнозирования от 1 до 252 торговых дней.


= ТЕХНИЧЕСКИЕ ХАРАКТЕРИСТИКИ


== Постановка задачи на разработку программы

Цель работы — спроектировать и реализовать полный MLOps-конвейер автоматизированной оценки рыночного риска портфеля, удовлетворяющий следующим требованиям:

1. микросервисная архитектура с чётким разделением ответственности между сервисами и независимым развёртыванием каждого сервиса;
2. реализация двух независимых параметрических подходов к оценке VaR (GARCH(1,1) и Monte Carlo GBM) и одного непараметрического (исторической симуляции);
3. автоматическое логирование всех экспериментов обучения и регистрация версий моделей в MLflow;
4. оркестрация ежедневного конвейера #raw("ingest → train → infer → verify") средствами Apache Airflow;
5. реализация out-of-sample процедуры бэктестирования со статистическими тестами Купика (unconditional coverage) и Кристофферсена (conditional coverage);
6. реализация стресс-тестирования портфеля по историческим (2008, 2020, 1998 гг.) и параметрическим сценариям;
7. контейнеризация всех компонентов системы средствами Docker и развёртывание единой командой #raw("docker compose up -d");
8. реализация графического веб-интерфейса для просмотра портфелей, позиций, риск-метрик, бэктестов и сценариев стресс-тестирования.

== Требования к системе

=== Функциональные требования

Функциональные требования к системе сведены в таблицу 1.

#align(right)[_Таблица 1 — Функциональные требования_]
#figure(
  table(
    columns: (auto, 1fr),
    align: (center + horizon, left + horizon),
    table.header([Код], [Описание]),
    [Ф-1], [Загрузка дневных цен закрытия из источников Yahoo Finance, MOEX ISS, синтетических генераторов, а также синтетических кредитных портфелей.],
    [Ф-2], [Вычисление и хранение простых дневных доходностей $r_t = (P_t - P_(t-1))/P_(t-1)$.],
    [Ф-3], [Создание, редактирование и удаление портфелей и их позиций (символ + вес).],
    [Ф-4], [Публикация в Kafka события #raw("portfolio.updated") при любом изменении портфеля или позиции.],
    [Ф-5], [Асинхронный запуск обучения моделей с возможностью опроса статуса задачи.],
    [Ф-6], [Регистрация обученной модели в MLflow и в локальной таблице #raw("model_registry").],
    [Ф-7], [Вычисление в режиме онлайн риск-метрик (VaR, CVaR, волатильность, max drawdown, Sharpe, Sortino) для произвольного портфеля.],
    [Ф-8], [Сохранение каждого результата инференса в таблицу #raw("risk_results").],
    [Ф-9], [Out-of-sample rolling backtest VaR со статистическими тестами Купика и Кристофферсена.],
    [Ф-10], [Стресс-тестирование портфеля по пяти встроенным сценариям и одному пользовательскому.],
    [Ф-11], [Веб-интерфейс с разделами «Дашборд», «Портфели», «Данные», «Модели», «Бэктест», «Стресс-тест», «Дрифт», «Алерты».],
    [Ф-12], [Ежедневный пайплайн в Airflow по расписанию (06:00 UTC).],
    [Ф-13], [Горячая перезагрузка моделей в inference-сервисе по событию #raw("model.trained") в Kafka.],
  ),
)\

=== Нефункциональные требования

#v(-2mm)
- _Производительность_: время отклика API инференса VaR/CVaR не должно превышать 5 с при объёме исторических данных до 2520 торговых дней.
- _Надёжность_: отказ MLflow или отсутствие обученной ML-модели не приводит к недоступности сервиса инференса — выполняется автоматический откат на метод исторической симуляции.
- _Масштабируемость_: каждый сервис может масштабироваться горизонтально независимо за счёт stateless-архитектуры Go-сервисов и общего хранилища PostgreSQL.
- _Воспроизводимость_: все эксперименты обучения логируются в MLflow с полным набором параметров, метрик и артефактов; для Monte Carlo используется фиксированный #raw("seed=42").
- _Удобный UI_: веб-интерфейс реализован с четким разделением функционала, элементы страницы интерпретируются и используются однозначно, поддерживает построение графиков и вывод позитивных/негативных сигналов через зеленый/красный цвет.
- _Безопасность_: подключения к PostgreSQL и Kafka осуществляются по внутренней Docker-сети; секреты передаются через переменные окружения.
\
#v(-8mm)

== Описание архитектуры программного решения

Архитектура системы построена по принципам микросервисной архитектуры с шиной событий на базе Apache Kafka и единой реляционной СУБД PostgreSQL. Общая структура взаимодействия компонентов представлена на рисунке 1.

#figure(
  canvas(length: 1cm, {
    import draw: *
    // Внешние источники
    rect((0, 8), (3, 9), fill: c-ext, stroke: 0.5pt, radius: 1pt)
    content((1.5, 8.5), text(7pt)[Yahoo Finance / MOEX ISS])
    // Frontend
    rect((13, 8), (16, 9), fill: c-fe, stroke: 0.5pt, radius: 1pt)
    content((14.5, 8.5), text(7pt)[Frontend (Next.js)])
    // Gateway
    rect((13, 6.5), (16, 7.3), fill: c-svc, stroke: 0.5pt, radius: 1pt)
    content((14.5, 6.9), text(7pt)[Gateway (Go)])
    // market-data-service
    rect((0, 6.5), (3, 7.3), fill: c-svc, stroke: 0.5pt, radius: 1pt)
    content((1.5, 6.9), text(7pt)[market-data-service])
    // portfolio-service
    rect((9.5, 6.5), (12.5, 7.3), fill: c-svc, stroke: 0.5pt, radius: 1pt)
    content((11, 6.9), text(7pt)[portfolio-service])
    // training-service
    rect((4, 5), (7, 5.8), fill: c-py, stroke: 0.5pt, radius: 1pt)
    content((5.5, 5.4), text(7pt)[training-service])
    // inference-service
    rect((9.5, 5), (12.5, 5.8), fill: c-py, stroke: 0.5pt, radius: 1pt)
    content((11, 5.4), text(7pt)[inference-service])
    // Kafka шина
    rect((0, 3.5), (16, 4.2), fill: c-mq, stroke: 0.5pt, radius: 1pt)
    content((8, 3.85), text(7pt)[Apache Kafka: market.data.ingested · model.trained · portfolio.updated])
    // MLflow + MinIO
    rect((4, 2), (7, 2.8), fill: c-db, stroke: 0.5pt, radius: 1pt)
    content((5.5, 2.4), text(7pt)[MLflow + MinIO (S3)])
    // PostgreSQL
    rect((9.5, 2), (12.5, 2.8), fill: c-db, stroke: 0.5pt, radius: 1pt)
    content((11, 2.4), text(7pt)[PostgreSQL])
    // Airflow
    rect((0, 2), (3, 2.8), fill: c-ext, stroke: 0.5pt, radius: 1pt)
    content((1.5, 2.4), text(7pt)[Apache Airflow])
    // Мониторинг
    rect((13, 2), (16, 2.8), fill: c-ext, stroke: 0.5pt, radius: 1pt)
    content((14.5, 2.4), text(7pt)[Prometheus + Grafana])

    // Стрелки
    line((1.5, 8), (1.5, 7.3), mark: (end: ">"), stroke: 0.5pt)
    line((14.5, 8), (14.5, 7.3), mark: (end: ">"), stroke: 0.5pt)
    line((13, 6.9), (12.5, 6.9), mark: (end: ">"), stroke: 0.5pt)
    line((1.5, 6.5), (1.5, 4.2), mark: (end: ">"), stroke: 0.7pt)
    line((11, 6.5), (11, 5.8), mark: (end: ">"), stroke: 0.5pt)
    line((11, 6.5), (5.5, 5.8), mark: (end: ">"), stroke: 0.5pt)
    line((5.5, 5), (5.5, 4.2), mark: (end: ">", start: ">"), stroke: 0.5pt)
    line((11, 5), (11, 4.2), mark: (end: ">", start: ">"), stroke: 0.5pt)
    line((5.5, 5), (5.5, 2.8), mark: (end: ">", start: ">"), stroke: (paint: black, thickness: 0.5pt, dash: "dashed"))
    line((11, 5), (11, 2.8), mark: (end: ">", start: ">"), stroke: (paint: black, thickness: 0.5pt, dash: "dashed"))
    line((1.5, 6.5), (1.5, 2.8), mark: (end: ">", start: ">"), stroke: (paint: black, thickness: 0.5pt, dash: "dashed"))
  }),
  caption: [Компонентная архитектура программного комплекса RiskOps],
)

Система состоит из следующих логически обособленных слоёв:

1. _Слой сбора данных_ — сервис #raw("market-data-service") (Go), отвечающий за взаимодействие с внешними источниками рыночных данных, нормализацию и сохранение их в PostgreSQL, а также за вычисление производных временных рядов (доходностей).
2. _Слой управления портфелями_ — сервис #raw("portfolio-service") (Go), реализующий CRUD-операции над портфелями и позициями и публикующий события об их изменении в Kafka.
3. _Слой обучения моделей_ — сервис #raw("training-service") (Python, FastAPI), реализующий пайплайн обучения, бэктестирования и регистрации моделей в MLflow и в локальном реестре.
4. _Слой инференса_ — сервис #raw("inference-service") (Python, FastAPI), осуществляющий онлайн-вычисление риск-метрик и выполнение стресс-сценариев. Сервис подгружает последние версии моделей из MLflow при старте и поддерживает горячую перезагрузку моделей по событию Kafka.
5. _Слой шлюза_ — сервис #raw("gateway") (Go) реализует обратный прокси и единую точку входа для веб-интерфейса.
6. _Слой представления_ — фронтенд-приложение на Next.js (React, TypeScript), отображающее данные и предоставляющее интерактивные элементы управления.
7. _Слой оркестрации_ — Apache Airflow с DAG-ами, реализующими ежедневный конвейер.
8. _Слой инфраструктуры данных_ — PostgreSQL (основное хранилище), Apache Kafka (KRaft-режим, шина событий), MLflow (трекинг и реестр моделей), MinIO (S3-совместимое объектное хранилище для артефактов MLflow).
9. _Слой наблюдаемости_ — Prometheus и Grafana с предсконфигурированным дашбордом #raw("riskops-overview").

В системе применены следующие архитектурные паттерны:

#v(-2mm)
- _Microservices_ — каждый бизнес-домен инкапсулирован в самостоятельный сервис со своим жизненным циклом;
- _API Gateway_ — gateway-сервис реализует паттерн обратного прокси, скрывая топологию внутренних сервисов от фронтенда;
- _Event-Driven Architecture_ — шина событий Kafka обеспечивает асинхронное взаимодействие между portfolio-service, training-service и inference-service;
- _Repository_ — в Go-сервисах слой доступа к данным выделен в пакеты #raw("internal/repository");
- _Dependency Injection_ — конфигурация и зависимости сервисов подаются в конструкторы через структуры из пакета #raw("internal/config");
- _Strategy_ — выбор метода оценки риска (#raw("historical") / #raw("garch") / #raw("montecarlo")) в inference-service выполнен через единый интерфейс предсказания;
- _Observer_ — горячая перезагрузка моделей в inference-service подписана на топик #raw("model.trained");
- _Factory_ — коллекторы рыночных данных в market-data-service создаются по идентификатору источника;
- _Code Generation_ — публичные REST-контракты Go-сервисов описаны в OpenAPI и кодогенерируются через oapi-codegen.
\
#v(-8mm)

== Технологический стек

Состав используемых языков, фреймворков и инфраструктурных компонентов представлен в таблице 2.

#align(right)[_Таблица 2 — Технологический стек_]
#figure(
  table(
    columns: (auto, auto, 1fr),
    align: left + horizon,
    table.header([Категория], [Компонент], [Назначение]),
    [Языки], [Go 1.25], [gateway, portfolio-service, market-data-service],
    [], [Python 3.12], [training-service, inference-service, pipelines, Airflow DAG-и],
    [], [TypeScript 5 / React 18], [фронтенд (Next.js)],
    [Backend-фреймворки], [chi v5], [HTTP-роутинг в Go-сервисах],
    [], [FastAPI], [REST API в Python-сервисах],
    [], [Pydantic v2], [валидация входных данных в Python],
    [Frontend], [Next.js 14 (App Router)], [SSR / CSR-рендеринг],
    [БД-доступ], [pgx/v5 + pgxpool], [пул подключений PostgreSQL для Go],
    [], [SQLAlchemy + psycopg2], [подключение PostgreSQL для Python],
    [Очереди сообщений], [segmentio/kafka-go], [Kafka-клиент в Go],
    [], [aiokafka], [асинхронный Kafka-консьюмер в Python],
    [Числовые библиотеки], [arch], [GARCH-модели и SkewStudent-распределения],
    [], [NumPy / SciPy / Pandas], [численные расчёты, статистика],
    [], [scikit-learn], [вспомогательные метрики],
    [], [matplotlib], [построение диагностических графиков],
    [Эксперименты ML], [MLflow Tracking + Registry], [логирование экспериментов и реестр моделей],
    [], [MinIO (S3 API)], [объектное хранилище артефактов MLflow],
    [Оркестрация], [Apache Airflow 2.x], [планировщик ежедневного конвейера],
    [Контейнеризация], [Docker, Docker Compose], [сборка и развёртывание],
    [], [Caddy], [HTTPS-проксирование (опционально)],
    [Наблюдаемость], [Prometheus 2.55, Grafana 11.3], [метрики и визуализация],
    [Логирование], [zap (Go), logging (Python)], [структурированные логи],
    [Кодогенерация], [oapi-codegen v2.4], [генерация Go-клиентов и серверов из OpenAPI],
  ),
)\

Обоснование выбора ключевых технологий:

#v(-2mm)
- _Go_ выбран для сервисов с высокой нагрузкой ввода-вывода (gateway, portfolio-service, market-data-service) благодаря низкой задержке HTTP-обработки, нативной поддержке параллелизма и компактным Docker-образам.
- _Python_ выбран для training-service и inference-service из-за богатой экосистемы научных библиотек (#raw("arch"), #raw("scipy"), #raw("statsmodels")), без которых реализация GARCH-моделей была бы значительно более трудоёмкой.
- _PostgreSQL_ используется как единое транзакционное хранилище для всех бизнес-данных, а также для бэкенда MLflow и Airflow (выделенные схемы).
- _Kafka в KRaft-режиме_ выбрана как шина событий, обладает достаточной производительностью для асинхронного взаимодействия микросервисов.
- _MLflow + MinIO_ — стандартное промышленное решение для трекинга экспериментов и хранения артефактов моделей.
- _Airflow_ выбран как оркестратор пайплайнов в силу зрелости, поддержки расписаний cron и развитой UI для отладки DAG.
\
#v(-8mm)


= ОПИСАНИЕ ФУНКЦИОНАЛЬНОЙ СТРУКТУРЫ


В разделе детально описывается каждый сервис системы: его ответственность, структура каталогов, основные классы, ключевые функции с указанием сигнатур, реализуемые алгоритмы.

== Сервис «Gateway» (API-шлюз)

*Язык:* Go 1.25. *Порт:* 8081. *Расположение:* #raw("apps/gateway/").

Сервис реализует единую точку входа для веб-интерфейса. Не содержит бизнес-логики и выполняет только маршрутизацию HTTP-запросов и установку CORS-заголовков. Структура каталогов:

#raw("apps/gateway/
├── main.go
└── internal/
    ├── config/config.go        — загрузка переменных окружения
    └── handler/
        ├── cors.go             — middleware CORS
        └── proxy.go            — регистрация маршрутов и reverse proxy")

Маршруты прокси-перенаправления приведены в таблице 3.

#align(right)[_Таблица 3 — Маршрутизация шлюза_]
#figure(
  table(
    columns: (auto, 1fr),
    align: left + horizon,
    table.header([Префикс маршрута], [Целевой сервис]),
    [#raw("/api/portfolios/*")], [portfolio-service (#raw("http://portfolio-service:8082"))],
    [#raw("/api/scenarios/*")], [portfolio-service],
    [#raw("/api/risk-limits/*")], [portfolio-service],
    [#raw("/api/alerts/*")], [portfolio-service],
    [#raw("/api/market-data/*")], [market-data-service (#raw("http://market-data-service:8083"))],
    [#raw("/api/risk/predict/*")], [inference-service (#raw("http://inference-service:8085"))],
    [#raw("/api/risk/scenarios/*")], [inference-service],
    [#raw("/api/risk/train/*")], [training-service (#raw("http://training-service:8084"))],
    [#raw("/api/risk/models/*")], [training-service],
    [#raw("/api/risk/backtest/*")], [training-service],
  ),
)\

Реализация выполнена средствами стандартного пакета #raw("net/http/httputil.ReverseProxy"). Конфигурация задаётся переменными окружения #raw("PORT"), #raw("LOG_LEVEL"), #raw("PORTFOLIO_SERVICE_URL"), #raw("MARKET_DATA_SERVICE_URL"), #raw("INFERENCE_SERVICE_URL"), #raw("TRAINING_SERVICE_URL").

== Сервис «Portfolio Service»

*Язык:* Go 1.25. *Порт:* 8082. *Расположение:* #raw("apps/portfolio-service/").

Сервис управляет портфелями и позициями, хранит их в PostgreSQL, при каждом изменении публикует событие в Kafka в топик #raw("portfolio.updated"). Также сервис предоставляет агрегирующий read-only доступ к таблице #raw("risk_results"), которую заполняет inference-service.

Структура каталогов:

#raw("apps/portfolio-service/
├── main.go
├── openapi.yaml                — OpenAPI
└── internal/
    ├── api/api.gen.go          — сгенерированный oapi-codegen код
    ├── config/config.go
    ├── handler/portfolio.go    — реализация StrictServerInterface
    ├── repository/portfolio.go — SQL-запросы (pgx)
    └── service/portfolio.go    — бизнес-логика + Kafka-publish")

Ключевые модели данных (общий пакет #raw("pkg/models")):

#v(-2mm)
- #raw("Portfolio")
- #raw("Position")
- #raw("RiskResult")
\
#v(-8mm)

Класс `PortfolioHandler` реализует сгенерированный интерфейс #raw("api.StrictServerInterface") и делегирует вызовы в `service.PortfolioService`. Сигнатуры основных методов хендлера:

#v(-2mm)
- #raw("ListPortfolios(ctx, req) -> response") — возвращает список всех портфелей;
- #raw("CreatePortfolio(ctx, req) -> 201|400|500") — создаёт портфель, валидируя обязательное поле #raw("name");
- #raw("GetPortfolio(ctx, req) -> 200|404") — получение портфеля по идентификатору;
- #raw("DeletePortfolio(ctx, req) -> 204|404") — удаление портфеля и каскадное удаление позиций;
- #raw("ListPositions(ctx, req) -> response") — список позиций портфеля;
- #raw("UpsertPosition(ctx, req) -> 200|400|500") — создание/обновление позиции (UPSERT по PRIMARY KEY (portfolio_id, symbol));
- #raw("DeletePosition(ctx, req) -> 204|404") — удаление позиции;
- #raw("GetLatestRisk(ctx, req) -> response") — последние записи #raw("risk_results") по портфелю;
- #raw("GetRiskHistory(ctx, req) -> response") — история риск-результатов с параметром #raw("limit") (по умолчанию 100).
\
#v(-8mm)

Полная HTTP-спецификация эндпоинтов сведена в таблице 4.

#align(right)[_Таблица 4 — REST-эндпоинты Portfolio Service_]
#figure(
  table(
    columns: (auto, 1fr, 1.5fr),
    align: (center, left, left),
    table.header([Метод], [Путь], [Описание]),
    [GET], [#raw("/api/portfolios")], [Список портфелей],
    [POST], [#raw("/api/portfolios")], [Создание портфеля (тело: name, description?, currency?)],
    [GET], [#raw("/api/portfolios/{id}")], [Получение портфеля по ID],
    [DELETE], [#raw("/api/portfolios/{id}")], [Удаление портфеля],
    [GET], [#raw("/api/portfolios/{id}/positions")], [Список позиций],
    [POST], [#raw("/api/portfolios/{id}/positions")], [Upsert позиции (тело: symbol, weight)],
    [DELETE], [#raw("/api/portfolios/{id}/positions/{symbol}")], [Удаление позиции],
    [GET], [#raw("/api/portfolios/{id}/risk/latest")], [Последние риск-метрики],
    [GET], [#raw("/api/portfolios/{id}/risk")], [История риск-метрик (#raw("?limit=N"))],
  ),
)\

При создании / удалении портфеля или позиции `service.PortfolioService` публикует в Kafka сообщение со схемой `{ event, portfolio_id, action, symbol?, occurred_at }` в топик #raw("portfolio.updated"). Это сообщение служит триггером для inference-service.

== Сервис «Market Data Service»

*Язык:* Go 1.25. *Порт:* 8083. *Расположение:* #raw("apps/market-data-service/").

Сервис ответственен за загрузку, нормализацию и хранение рыночных данных, а также за вычисление дневных доходностей. Поддерживаются четыре источника данных, перечисленные в таблице 5.

#align(right)[_Таблица 5 — Источники рыночных данных_]
#figure(
  table(
    columns: (auto, auto, 1fr),
    align: left + horizon,
    table.header([Источник], [Тип], [Описание]),
    [#raw("yahoo")], [цены], [Yahoo Finance — мировые акции, ETF, индексы; HTTP API #raw("query1.finance.yahoo.com")],
    [#raw("moex")], [цены], [MOEX ISS — российские акции и облигации; #raw("https://iss.moex.com")],
    [#raw("synthetic")], [цены], [Синтетический генератор GBM (для тестирования без внешних API)],
    [#raw("credit_synthetic")], [кредиты], [Синтетические кредитные портфели],
  ),
)\

Структура каталогов сервиса:

#raw("apps/market-data-service/
├── main.go
├── openapi.yaml
└── internal/
    ├── api/api.gen.go
    ├── config/config.go
    ├── collector/
    │   ├── collector.go        — интерфейс Collector
    │   ├── yahoo.go            — Yahoo Finance
    │   ├── moex.go             — MOEX ISS
    │   ├── synthetic.go        — генератор синтетических цен
    │   └── credit_synthetic.go — генератор кредитных данных
    ├── handler/market_data.go
    ├── repository/
    │   ├── prices.go           — raw_prices + processed_returns
    │   ├── credit.go           — credit_portfolio
    │   └── ingestion_log.go
    └── service/
        ├── ingest.go           — оркестрация загрузки
        └── returns.go          — вычисление доходностей")

Интерфейс коллектора (паттерн _Strategy_):

#raw(lang: "go", "type Collector interface {
    Source() string
    Fetch(ctx context.Context, symbols []string,
          from, to time.Time) ([]RawPrice, error)
}")

Реализация для Yahoo Finance `apps/market-data-service/internal/collector/yahoo.go` выполняет HTTP-запрос к #raw("https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"), парсит JSON-ответ и преобразует временные метки UNIX в даты в часовом поясе UTC. Реализация для MOEX `apps/market-data-service/internal/collector/moex.go` использует REST API ISS и поддерживает разбиение на страницы. Синтетический коллектор использует логнормальное случайное блуждание с параметрами $mu=0.0002$, $sigma=0.02$ и начальной ценой $U(80,200)$.

Список эндпоинтов представлен в таблице 6.

#align(right)[_Таблица 6 — REST-эндпоинты Market Data Service_]
#figure(
  table(
    columns: (auto, 1fr, 2fr),
    align: (center, left, left),
    table.header([Метод], [Путь], [Описание]),
    [POST], [#raw("/api/market-data/ingest")], [Загрузка по конкретному источнику и символам],
    [POST], [#raw("/api/market-data/ingest/all")], [Загрузка по всем источникам],
    [GET], [#raw("/api/market-data/prices")], [Сырые цены (#raw("?symbols=&date_from=&date_to=&source=&limit="))],
    [GET], [#raw("/api/market-data/returns")], [Дневные доходности],
    [GET], [#raw("/api/market-data/credit")], [Записи кредитного портфеля],
    [GET], [#raw("/api/market-data/sources")], [Список источников и их статус],
    [GET], [#raw("/api/market-data/ingestion-log")], [История загрузок],
  ),
)\

Сервис #raw("ingest.go") вычисляет дневные простые доходности по формуле

$ r_t = (P_t - P_(t-1)) / P_(t-1) $

и сохраняет их в таблицу #raw("processed_returns") операцией #raw("INSERT ... ON CONFLICT DO UPDATE"). Каждая загрузка протоколируется в #raw("ingestion_log") со статусом #raw("completed") или #raw("failed"). После каждой успешной загрузки публикуется событие в Kafka-топик #raw("market.data.ingested").

== Сервис «Training Service»

*Язык:* Python 3.12 (FastAPI). *Порт:* 8084. *Расположение:* #raw("apps/training-service/").

Сервис обучает ML-модели оценки рыночного риска, ведёт реестр моделей и реализует подсистему бэктестирования. Структура пакета:

#raw("apps/training-service/training_service/
├── main.py                — FastAPI-приложение, монтирование роутера
├── config.py              — настройки (pydantic-settings)
├── db.py                  — подключение SQLAlchemy
├── kafka_consumer.py      — слушает market.data.ingested
├── api/routes.py          — REST-эндпоинты
├── models/
│   ├── garch.py           — обучение GARCH(1,1)
│   ├── montecarlo.py      — Monte Carlo GBM (простой объект)
│   └── mc_pyfunc.py       — Monte Carlo как mlflow.pyfunc.PythonModel
├── pipelines/train.py     — главный пайплайн обучения
├── metrics/
│   └── risk_metrics.py    — Max Drawdown, Sharpe, Sortino, Beta
└── backtesting/
    ├── kupiec.py          — тест Купика
    ├── christoffersen.py  — тест Кристофферсена
    ├── rolling_backtest.py — движок скользящего окна
    └── report.py          — формирование отчёта и MLflow-логирование")

=== REST-API сервиса обучения

#align(right)[_Таблица 7 — REST-эндпоинты Training Service_]
#figure(
  table(
    columns: (auto, 1fr, 1.5fr),
    align: (center, left, left),
    table.header([Метод], [Путь], [Описание]),
    [POST], [#raw("/api/risk/train")], [Запустить обучение, ответ HTTP 202 с #raw("job_id")],
    [GET], [#raw("/api/risk/train/status/{job_id}")], [Статус задачи: queued / running / completed / failed],
    [GET], [#raw("/api/risk/train/run/{run_id}")], [Детали MLflow-запуска по #raw("run_id")],
    [GET], [#raw("/api/risk/models")], [Список зарегистрированных моделей из #raw("model_registry")],
    [POST], [#raw("/api/risk/backtest")], [Out-of-sample rolling-VaR backtest],
  ),
)\

Параметры запроса #raw("POST /api/risk/train") приведены в таблице 8.

#align(right)[_Таблица 8 — Параметры запроса на обучение_]
#figure(
  table(
    columns: (auto, auto, auto, 1fr),
    align: left + horizon,
    table.header([Поле], [По умолчанию], [Ограничения], [Описание]),
    [#raw("symbols")], [#raw("[\"AAPL\",\"MSFT\"]")], [#sym.gt.eq 1 элемент], [Тикеры],
    [#raw("model_type")], [#raw("all")], [#raw("garch")/#raw("montecarlo")/#raw("all")], [Тип модели],
    [#raw("alpha")], [0.99], [0.9–0.9999], [Уровень доверия VaR],
    [#raw("horizon_days")], [1], [1–30], [Горизонт прогноза],
    [#raw("lookback_days")], [252], [30–2520], [Окно истории],
    [#raw("weights")], [#raw("null")], [dict {symbol: float}], [Веса; #raw("null") — равные],
    [#raw("n_simulations")], [10000], [1000–100000], [Симуляции Monte Carlo],
  ),
)\

=== Подготовка данных перед обучением

Функция #raw("load_returns(symbols, lookback_days)") в `apps/training-service/training_service/pipelines/train.py` загружает доходности из таблицы #raw("processed_returns") и оставляет последние #raw("lookback_days") наблюдений на каждый символ:

#raw(lang: "sql", "SELECT symbol, price_date, ret
FROM processed_returns
WHERE symbol = ANY(:symbols)
ORDER BY symbol, price_date ASC")

Функция #raw("build_portfolio_returns(returns_df, weights)") строит ряд портфельных доходностей: выполняется поворот таблицы (`pivot`) к виду $T times N$, отбрасываются строки с #raw("NaN") (по любому из символов), нормируются веса так, чтобы $sum_i w_i = 1$, и вычисляется одномерный массив $r_t^p = sum_(i=1)^N w_i r_t^i$.

=== Модель 1: GARCH(1,1)

Файл `apps/training-service/training_service/models/garch.py`. Использована библиотека #raw("arch"). MLflow-эксперимент: #raw("riskops-garch").

Уравнение условной дисперсии модели GARCH(p, q) при $p = q = 1$:

$ sigma^2_t = omega + alpha epsilon^2_(t-1) + beta sigma^2_(t-1) $

где $omega > 0$ — константа, $alpha >= 0$ — ARCH-коэффициент, $beta >= 0$ — GARCH-коэффициент, $epsilon_t = r_t - mu_t$ — инновация. Условие стационарности: $alpha + beta < 1$. Долгосрочная дисперсия: $sigma^2_infinity = omega / (1 - alpha - beta)$. Уравнение среднего по умолчанию выбрано нулевым: $mu_t = 0$ (стандарт для дневных доходностей).

Гиперпараметры (датакласс #raw("GARCHParams")):

#v(-2mm)
- #raw("p") = 1 — порядок ARCH;
- #raw("q") = 1 — порядок GARCH;
- #raw("dist") $in$ {#raw("normal"), #raw("t"), #raw("skewt")} — распределение инноваций (по умолчанию #raw("normal"));
- #raw("mean") $in$ {#raw("Zero"), #raw("Constant"), #raw("AR")} — модель среднего (по умолчанию #raw("Zero")).
\
#v(-8mm)

Алгоритм обучения (функция #raw("train_garch()")):

1. Масштабирование: #raw("scaled = returns * 100") (библиотека #raw("arch") ожидает данные в процентных пунктах).
2. Создание модели: #raw("am = arch_model(scaled, mean=\"Zero\", vol=\"GARCH\", p=1, q=1, dist=\"normal\")").
3. Фитирование методом максимального правдоподобия: #raw("res = am.fit(disp=\"off\")"). Оцениваются параметры $omega$, $alpha$, $beta$ (а также $nu$, $lambda$ при #raw("dist") $in$ {#raw("t"), #raw("skewt")}).
4. Прогноз условной дисперсии на #raw("horizon_days") шагов: #raw("forecast = res.forecast(horizon=horizon_days)"); $sigma_("daily") = sqrt(sigma^2_("cond")) / 100$.
5. Аннуализация: $sigma_("annual") = sigma_("daily") sqrt(252)$.
6. Расчёт VaR и CVaR по выбранному распределению инноваций (см. ниже).
7. In-sample диагностика: #raw("insample_coverage_ratio = sum(returns < -VaR) / T") — _не является_ настоящим бэктестом и помечена соответствующей метрикой.

Расчёт VaR и CVaR по распределению (функция #raw("_var_cvar_from_dist()")):

#v(-2mm)
- _Нормальное распределение_: $z = Phi^(-1)(1-alpha)$, $"VaR" = -z dot sigma_("daily")$, $"CVaR" = phi(z) / (1-alpha) dot sigma_("daily")$, где $phi$ — плотность $N(0,1)$;
- _Стьюдента (t)_: $z = t_nu^(-1)(1-alpha) dot sqrt((nu-2)/nu)$, $"VaR" = -z dot sigma_("daily")$; CVaR — по аналитической формуле для t-распределения. При $nu < 2.1$ выполняется откат на нормальное распределение;
- _Скошенное t (skewt)_: квантиль вычисляется через #raw("SkewStudent().ppf()") из библиотеки #raw("arch"); CVaR — численно по сетке хвостовых вероятностей. При ошибке выполняется откат на t-распределение.
\
#v(-8mm)

В качестве артефактов в MLflow логируются: сериализованный объект #raw("ARCHModelResult") (pickle), JSON-отчёт и диагностический график 2x2 (стандартизованные остатки, условная волатильность, QQ-plot, гистограмма с нормальной аппроксимацией).

#placeholder(
  kind: "СКРИНШОТ",
  [Окно MLflow Tracking UI с открытым запуском обучения GARCH-модели: панели «Parameters», «Metrics» (var, cvar, volatility, aic, bic), «Artifacts» с диагностическим PNG.],
  [Запуск обучения GARCH-модели в MLflow Tracking UI],
)\

=== Модель 2: Monte Carlo (GBM)

Файл `apps/training-service/training_service/models/montecarlo.py` и обёртка `apps/training-service/training_service/models/mc_pyfunc.py`. MLflow-эксперимент: #raw("riskops-montecarlo").

Цена актива моделируется геометрическим броуновским движением:

$ d S / S = mu d t + sigma d W_t $

В дискретной форме дневной лог-доход:

$ r_t = (mu - 0.5 sigma^2) d t + sigma sqrt(d t) epsilon_t, quad epsilon_t tilde N(0,1), quad d t = 1 $

Простой доход за горизонт $H$ дней: $R = exp(sum_(t=1)^H r_t) - 1$.

Оценка параметров из истории (метод максимального правдоподобия):

#raw("sigma = std(returns, ddof=1)
mu    = mean(returns) + 0.5 * sigma^2")

Гиперпараметры (датакласс #raw("MonteCarloParams")):

#v(-2mm)
- #raw("n_simulations") = 10000 — число симулированных траекторий;
- #raw("seed") = 42 — фиксированное зерно для воспроизводимости.
\
#v(-8mm)

Одноактивный случай реализуется функцией #raw("_simulate_gbm_1d()"):

#raw(lang: "python", "drift     = (mu - 0.5 * sigma**2) * dt
diffusion = sigma * np.sqrt(dt)
daily = rng.normal(loc=drift, scale=diffusion,
                   size=(n_sims, horizon))
total_log = daily.sum(axis=1)
simulated = np.exp(total_log) - 1.0   # shape: (n_sims,)")

Многоактивный случай (функция #raw("_simulate_gbm_multiasset()")) использует разложение Холецкого ковариационной матрицы $Sigma = L L^T$ для генерации коррелированных шоков $z' = z dot L^T$. При вырожденной матрице добавляется регуляризация $Sigma + epsilon I$, $epsilon = 10^(-8)$. В текущем пайплайне обучения портфельные доходности сводятся в одномерный ряд до передачи в Monte Carlo, поэтому многоактивный путь используется только при прямом вызове #raw("run_monte_carlo()") с двумерным массивом.

VaR и CVaR вычисляются эмпирически из распределения симулированных доходностей:

$ "VaR" = - q_(1-alpha) ("simulated"), quad "CVaR" = - "mean"({"sim"_i: "sim"_i <= q_(1-alpha)}) $

$ sigma_("annual") = "std"("simulated") sqrt(252 / "horizon"_("days")) $

Monte Carlo-модель упаковывается как #raw("mlflow.pyfunc.PythonModel") и при сериализации в MLflow содержит:

#v(-2mm)
- #raw("MLmodel") — метаданные;
- #raw("python_model.pkl") — pickle объекта #raw("MonteCarloModel(mu, sigma, seed)");
- #raw("params.json") — параметры в человеко-читаемой форме.
\
#v(-8mm)

=== Дополнительные метрики риска

Файл `apps/training-service/training_service/metrics/risk_metrics.py`. Вычисляются для обеих моделей и логируются в MLflow:

$ "MaxDrawdown" = min_t (("Cum"_t - max_(s <= t) "Cum"_s) / max_(s <= t) "Cum"_s) $

где $"Cum"_t = product_(s=1)^t (1 + r_s)$.

$ "Sharpe" = (overline(r) - r_f / 252) / "std"(r) sqrt(252) $

$ "Sortino" = (overline(r) - r_f / 252) / sqrt("mean"({r_i: r_i < r_f / 252}^2)) sqrt(252) $

Бета к бенчмарку: $beta = "cov"(r_p, r_b) / "var"(r_b)$. 

=== Подсистема бэктестирования

Реализует _настоящий_ out-of-sample rolling backtest. Алгоритм скользящего окна:

#v(-2mm)
- для каждого дня $t in [T_("train"), T_("end"))$:
  - обучающее окно: $"returns"[t - "lookback" : t]$;
  - обучить модель и предсказать $"VaR"(t)$;
  - реализованная доходность $r_t$ и нарушение $h_t = II[r_t < -"VaR"(t)]$, где $II[dot]$ — индикаторная функция;
  - сдвинуть окно на 1 день вперёд.

Реализация: `apps/training-service/training_service/backtesting/rolling_backtest.py`.

==== Тест Купика (Unconditional Coverage)

Проверяет, соответствует ли наблюдаемая частота нарушений $hat(p) = N_1 / N$ заявленному уровню $p = 1 - alpha$. Статистика:

$ "LR"_("uc") = -2 ln (((1-p)^(N_0) p^(N_1)) / ((1-hat(p))^(N_0) hat(p)^(N_1))) tilde chi^2_1 $

Реализация: `apps/training-service/training_service/backtesting/kupiec.py`.

==== Тест Кристофферсена (Conditional Coverage)

Проверяет независимость нарушений во времени (отсутствие кластеризации). Использует переходные вероятности $pi_(00), pi_(01), pi_(10), pi_(11)$ и комбинирует независимость с тестом Купика:

$ "LR"_("cc") = "LR"_("uc") + "LR"_("ind") tilde chi^2_2 $

Реализация: `apps/training-service/training_service/backtesting/christoffersen.py`.

==== Классификация результата

Файл `apps/training-service/training_service/backtesting/report.py` присваивает статус:

#v(-2mm)
- *OK* — оба p-value $> 0.05$ и относительное отклонение покрытия $|hat(p) - p|/p < 0.5$;
- *WARN* — один из тестов отвергнут или умеренное отклонение;
- *CRIT* — оба теста отвергнуты или $hat(p) > 2 p$.

#figure(
  canvas(length: 1cm, {
    import draw: *
    // Lifelines
    let xs = (1, 5, 9, 13)
    let names = ([API клиент], [BacktestRunner], [Модель (GARCH/MC)], [Тесты Kupiec/CC])
    for i in range(4) {
      rect((xs.at(i) - 1.2, 9.2), (xs.at(i) + 1.2, 9.8), fill: c-svc, stroke: 0.5pt)
      content((xs.at(i), 9.5), text(7pt)[#names.at(i)])
      line((xs.at(i), 9.2), (xs.at(i), 0.5), stroke: (paint: gray, dash: "dashed", thickness: 0.4pt))
    }
    // Сообщения
    line((xs.at(0), 8.7), (xs.at(1), 8.7), mark: (end: ">"), stroke: 0.5pt)
    content((3, 8.9), text(6pt)[POST /backtest])
    // Цикл по дням
    rect((xs.at(1) - 1, 7.8), (xs.at(2) + 1, 8.2), stroke: (paint: rgb("#1a73e8"), thickness: 0.4pt, dash: "dashed"), fill: none)
    content((xs.at(1), 8), text(6pt)[loop t = T_train..T_end])
    line((xs.at(1), 7.4), (xs.at(2), 7.4), mark: (end: ">"), stroke: 0.5pt)
    content((7, 7.6), text(6pt)[fit(returns[t-L:t])])
    line((xs.at(2), 6.9), (xs.at(1), 6.9), mark: (end: ">"), stroke: (paint: black, thickness: 0.4pt, dash: "dashed"))
    content((7, 7.1), text(6pt)[VaR(t)])
    line((xs.at(1), 6.4), (xs.at(1) + 0.7, 6.4), mark: (end: ">"), stroke: 0.5pt)
    content((6, 6.6), text(6pt)[h_t = II[r_t < -VaR(t)]])
    // Конец цикла
    line((xs.at(1), 5.8), (xs.at(2) + 1, 5.8), stroke: (paint: rgb("#1a73e8"), thickness: 0.4pt, dash: "dashed"))
    // Передача данных в тесты
    line((xs.at(1), 5.2), (xs.at(3), 5.2), mark: (end: ">"), stroke: 0.5pt)
    content((9, 5.4), text(6pt)[hits[], coverage])
    line((xs.at(3), 4.7), (xs.at(3) + 1, 4.7), mark: (end: ">"), stroke: 0.5pt)
    content((14, 4.9), text(6pt)[LR_uc, p_uc])
    line((xs.at(3), 4.2), (xs.at(3) + 1, 4.2), mark: (end: ">"), stroke: 0.5pt)
    content((14, 4.4), text(6pt)[LR_cc, p_cc])
    line((xs.at(3), 3.6), (xs.at(1), 3.6), mark: (end: ">"), stroke: (paint: black, thickness: 0.4pt, dash: "dashed"))
    content((9, 3.8), text(6pt)[BacktestReport])
    // Классификация
    rect((xs.at(1) - 1.6, 2.3), (xs.at(1) + 1.6, 3), fill: c-mq, stroke: 0.5pt, radius: 1pt)
    content((xs.at(1), 2.65), text(6pt)[classify: OK / WARN / CRIT])
    line((xs.at(1), 2.3), (xs.at(1), 1.7), mark: (end: ">"), stroke: 0.5pt)
    line((xs.at(1), 1.4), (xs.at(0), 1.4), mark: (end: ">"), stroke: (paint: black, thickness: 0.4pt, dash: "dashed"))
    content((3, 1.6), text(6pt)[200 OK + report])
  }),
  caption: [Диаграмма последовательности процесса бэктестирования],
)

=== Подсистема инференса (Inference Service)

Файл `apps/inference-service/inference_service/api/routes.py`.

==== Endpoints

#v(-2mm)
- #raw("POST /api/risk/predict") — расчёт VaR/CVaR/Volatility для портфеля выбранным методом;
- #raw("GET /api/risk/predict/health") — статус загруженных моделей в #raw("ModelRegistry");
- #raw("GET /api/risk/scenarios") — список доступных стресс-сценариев;
- #raw("POST /api/risk/scenarios/run") — запуск стресс-теста.

==== Pydantic-модели запроса прогноза

Класс #raw("PredictRequest"): #raw("portfolio_id: int"), #raw("method: Literal[\"historical\", \"garch\", \"montecarlo\"]"), #raw("alpha: float in [0.5, 0.999]"), #raw("horizon_days: int in [1, 252]"). Класс #raw("PredictResponse") включает все ключевые метрики риска.

==== Реестр моделей (ModelRegistry)

Файл `apps/inference-service/inference_service/models/loader.py`. Загружает MLflow-модели по алиасу #raw("@champion") (см. MLflow Model Registry). Поддерживает горячую перезагрузку через Kafka-сообщения topic #raw("model.trained"): обработчик читает #raw("portfolio_id, model_type"), вызывает #raw("registry.reload_model()") и подменяет объект в памяти без рестарта сервиса.

==== Persistence результатов

Функция #raw("_store_risk_results()") выполняет атомарную запись в таблицу #raw("risk_results") внутри #raw("with engine.begin() as conn:"). Сохраняются: #raw("portfolio_id, model, var, cvar, volatility, max_drawdown, sharpe_ratio, sortino_ratio, beta, computed_at").

==== Стресс-тестирование

Файл `apps/inference-service/inference_service/scenarios/engine.py`. Регистр сценариев #raw("SCENARIOS") содержит пять предопределённых наборов:

#v(-2mm)
- #raw("historical_2008") — Мировой экономический кризис 2008: актуальные исторические доходности 2008-09;
- #raw("historical_2020") — COVID-19 шок: март 2020;
- #raw("historical_1998") — Российский дефолт 1998 г.;
- #raw("parametric_mild") — vol_multiplier = 1.5, corr_shock = 0.2;
- #raw("parametric_severe") — vol_multiplier = 3.0, corr_shock = 0.5.

==== Алгоритмы стресс-теста

Функция #raw("_run_parametric_stress()"): берёт исторические доходности, умножает их волатильность на множитель, добавляет к корреляционной матрице сдвиг #raw("corr_shock"), затем семплирует из многомерного нормального распределения N симуляций горизонтом 1 день. Функция #raw("_run_historical_replay()"): загружает фактические доходности из заданного исторического окна и применяет их к текущим весам портфеля.

Точка входа #raw("run_scenario()") возвращает #raw("StressResult") с полями: #raw("var, cvar, max_drawdown, mean_return, std_return, scenario_name, period").

[СКРИНШОТ 7: Страница «Stress» фронтенда — выбор сценария и таблица результатов с метриками VaR/CVaR/MaxDrawdown.]

== Описание архитектуры

#figure(
  canvas(length: 1cm, {
    import draw: *
    // Внешний пользователь
    rect((0, 9.5), (3, 10.3), fill: c-ext, stroke: 0.5pt, radius: 1pt)
    content((1.5, 9.9), text(7pt)[Пользователь (браузер)])
    // Caddy
    rect((4.5, 9.5), (7.5, 10.3), fill: c-ext, stroke: 0.5pt, radius: 1pt)
    content((6, 9.9), text(7pt)[Caddy (reverse proxy)])
    // Frontend
    rect((9, 9.5), (12, 10.3), fill: c-fe, stroke: 0.5pt, radius: 1pt)
    content((10.5, 9.9), text(7pt)[Frontend Next.js])
    // Gateway
    rect((6, 7.5), (10, 8.3), fill: c-svc, stroke: 0.5pt, radius: 1pt)
    content((8, 7.9), text(7pt)[Gateway (Go)])
    // Сервисы — ряд
    rect((0, 5.5), (3, 6.5), fill: c-svc, stroke: 0.5pt, radius: 1pt)
    content((1.5, 6), text(7pt)[market-data-service\ Go])
    rect((4, 5.5), (7, 6.5), fill: c-svc, stroke: 0.5pt, radius: 1pt)
    content((5.5, 6), text(7pt)[portfolio-service\ Go])
    rect((8, 5.5), (11, 6.5), fill: c-py, stroke: 0.5pt, radius: 1pt)
    content((9.5, 6), text(7pt)[training-service\ Python])
    rect((12, 5.5), (15, 6.5), fill: c-py, stroke: 0.5pt, radius: 1pt)
    content((13.5, 6), text(7pt)[inference-service\ Python])
    // Хранилища
    rect((0, 3), (3, 4), fill: c-db, stroke: 0.5pt, radius: 1pt)
    content((1.5, 3.5), text(7pt)[PostgreSQL])
    rect((4, 3), (7, 4), fill: c-mq, stroke: 0.5pt, radius: 1pt)
    content((5.5, 3.5), text(7pt)[Kafka])
    rect((8, 3), (11, 4), fill: c-db, stroke: 0.5pt, radius: 1pt)
    content((9.5, 3.5), text(7pt)[MLflow\ MinIO S3])
    rect((12, 3), (15, 4), fill: c-ext, stroke: 0.5pt, radius: 1pt)
    content((13.5, 3.5), text(7pt)[Airflow])
    // Мониторинг
    rect((4, 1), (11, 1.8), fill: c-ext, stroke: 0.5pt, radius: 1pt)
    content((7.5, 1.4), text(7pt)[Prometheus + Grafana])

    // Стрелки
    line((3, 9.9), (4.5, 9.9), mark: (end: ">"), stroke: 0.5pt)
    line((7.5, 9.9), (9, 9.9), mark: (end: ">"), stroke: 0.5pt)
    line((10.5, 9.5), (8, 8.3), mark: (end: ">"), stroke: 0.5pt)
    line((8, 7.5), (1.5, 6.5), mark: (end: ">"), stroke: 0.5pt)
    line((8, 7.5), (5.5, 6.5), mark: (end: ">"), stroke: 0.5pt)
    line((8, 7.5), (9.5, 6.5), mark: (end: ">"), stroke: 0.5pt)
    line((8, 7.5), (13.5, 6.5), mark: (end: ">"), stroke: 0.5pt)
    line((1.5, 5.5), (1.5, 4), mark: (end: ">"), stroke: 0.5pt)
    line((5.5, 5.5), (1.5, 4), mark: (end: ">"), stroke: 0.5pt)
    line((9.5, 5.5), (1.5, 4), mark: (end: ">"), stroke: 0.5pt)
    line((13.5, 5.5), (1.5, 4), mark: (end: ">"), stroke: 0.5pt)
    line((1.5, 5.5), (5.5, 4), mark: (end: ">", start: ">"), stroke: 0.5pt)
    line((5.5, 5.5), (5.5, 4), mark: (end: ">", start: ">"), stroke: 0.5pt)
    line((9.5, 5.5), (5.5, 4), mark: (end: ">", start: ">"), stroke: 0.5pt)
    line((13.5, 5.5), (5.5, 4), mark: (end: ">", start: ">"), stroke: 0.5pt)
    line((9.5, 5.5), (9.5, 4), mark: (end: ">", start: ">"), stroke: 0.5pt)
    line((13.5, 5.5), (9.5, 4), mark: (end: ">", start: ">"), stroke: 0.5pt)
    line((13.5, 4), (13.5, 5.5), mark: (end: ">"), stroke: (paint: black, thickness: 0.4pt, dash: "dashed"))
  }),
  caption: [Архитектурная диаграмма уровня C4-Container],
)

=== Стилевые принципы

#v(-2mm)
- *Микросервисная архитектура*: каждый сервис изолирован, имеет собственный Dockerfile и независимый деплой;
- *API Gateway*: единая точка входа на порту 8081 с фасадом, скрывающим внутреннюю топологию;
- *Event-driven communication*: критичные доменные события (обучение модели, обновление портфеля) публикуются в Kafka, что обеспечивает слабую связанность;
- *Code generation*: серверные интерфейсы Go-сервисов генерируются из OpenAPI-спецификаций через `oapi-codegen`, что устраняет дрейф контракта;
- *Repository pattern*: доступ к БД инкапсулирован в репозиториях (#raw("internal/repository/")) с интерфейсами для тестирования;
- *Dependency Injection*: композиция в #raw("main.go") (Go) и FastAPI #raw("Depends") (Python);
- *Strategy pattern*: переключение методов VaR (historical / GARCH / Monte Carlo) через единый интерфейс #raw("predict()");
- *Observer pattern*: Kafka consumers как наблюдатели за событиями обучения и обновления портфелей;
- *Factory pattern*: создание моделей в #raw("training_service.models.__init__.MODEL_REGISTRY").

=== Слои системы

#table(
  columns: (32mm, 1fr),
  align: (left, left),
  stroke: 0.4pt,
  table.header(
    [*Слой*], [*Компоненты*],
  ),
  [Представление], [Next.js 14 (apps/frontend), браузерный UI, Caddy reverse proxy],
  [API Gateway], [apps/gateway (Go), CORS, проксирование, маршрутизация],
  [Бизнес-логика], [portfolio-service (Go), market-data-service (Go), training-service (Python), inference-service (Python)],
  [Данные], [PostgreSQL 16 (riskops, mlflow), MinIO S3 (артефакты MLflow)],
  [Интеграция], [Apache Kafka 3.x (KRaft mode), MLflow Tracking, Apache Airflow],
  [Наблюдаемость], [Prometheus, Grafana, /metrics endpoints],
)

_Таблица 5 — Слои системы и реализующие их компоненты._

== Информационное обеспечение

=== Схема базы данных

Файл `infra/db/init/001_riskops_schema.sql` содержит DDL основной схемы. Используется PostgreSQL 16 с расширениями (см. `002_extensions.sql`).

==== Таблица `raw_prices`

Хранит сырые котировки, загруженные из внешних источников.

#table(
  columns: (40mm, 30mm, 1fr),
  align: (left, left, left),
  stroke: 0.4pt,
  table.header([*Поле*], [*Тип*], [*Назначение*]),
  [`id`], [`bigserial PK`], [Суррогатный ключ],
  [`symbol`], [`text NOT NULL`], [Тикер актива],
  [`ts`], [`timestamptz NOT NULL`], [Метка времени котировки],
  [`open, high, low, close`], [`numeric`], [OHLC-цены],
  [`volume`], [`numeric`], [Объём торгов],
  [`source`], [`text`], [Источник: yahoo / moex / synthetic],
  [`UNIQUE (symbol, ts, source)`], [], [Идемпотентность загрузки],
)

_Таблица 6 — Структура таблицы raw_prices._

==== Таблица `processed_returns`

Доходности, вычисленные из `raw_prices`.

#table(
  columns: (40mm, 30mm, 1fr),
  align: (left, left, left),
  stroke: 0.4pt,
  table.header([*Поле*], [*Тип*], [*Назначение*]),
  [`id`], [`bigserial PK`], [Суррогатный ключ],
  [`symbol`], [`text NOT NULL`], [Тикер],
  [`ts`], [`timestamptz NOT NULL`], [Дата],
  [`return_simple`], [`numeric`], [$r_t = P_t / P_(t-1) - 1$],
  [`return_log`], [`numeric`], [$ell_t = ln(P_t / P_(t-1))$],
  [`UNIQUE (symbol, ts)`], [], [Идемпотентность пересчёта],
)

_Таблица 7 — Структура таблицы processed_returns._

==== Таблица `portfolios` и `portfolio_positions`

#raw("portfolios(id bigserial PK, name text NOT NULL, created_at timestamptz)") и #raw("portfolio_positions(portfolio_id FK -> portfolios.id, symbol text, quantity numeric, weight numeric, PRIMARY KEY(portfolio_id, symbol))"). Веса позиций должны суммироваться к 1.

==== Таблица `risk_results`

Хранит результаты расчётов риска.

#table(
  columns: (40mm, 30mm, 1fr),
  align: (left, left, left),
  stroke: 0.4pt,
  table.header([*Поле*], [*Тип*], [*Назначение*]),
  [`id`], [`bigserial PK`], [Суррогатный ключ],
  [`portfolio_id`], [`bigint FK`], [Ссылка на портфель],
  [`model`], [`text`], [historical / garch / montecarlo],
  [`var`, `cvar`], [`numeric`], [Метрики риска],
  [`volatility`], [`numeric`], [Годовая волатильность],
  [`max_drawdown, sharpe_ratio, sortino_ratio, beta`], [`numeric`], [Доп. метрики],
  [`computed_at`], [`timestamptz`], [Время расчёта],
)

_Таблица 8 — Структура таблицы risk_results._

// TODO: ТУТ СКРИНШОТ СХЕМЫ БАЗ ДАННЫХ

=== Базы данных MLflow и Airflow

Скрипт `infra/db/init/000_mlflow_schema.sql` создаёт отдельную схему `mlflow` для MLflow Tracking Server. Airflow использует свою БД `airflow_db`, разворачиваемую в `docker-compose.yaml`.

== Программное обеспечение

=== Состав сервисов

#table(
  columns: (40mm, 18mm, 14mm, 1fr),
  align: (left, left, left, left),
  stroke: 0.4pt,
  table.header([*Сервис*], [*Язык*], [*Порт*], [*Назначение*]),
  [gateway], [Go], [8081], [API-фасад с CORS и проксированием],
  [portfolio-service], [Go], [8082], [CRUD портфелей и позиций],
  [market-data-service], [Go], [8083], [Загрузка и обработка котировок],
  [training-service], [Python], [8084], [Обучение моделей VaR и бэктестинг],
  [inference-service], [Python], [8085], [Расчёт VaR и стресс-тестов],
  [pipelines (CLI)], [Python], [—], [Утилита для batch-обработок],
  [frontend], [TS/React], [3000], [SPA на Next.js],
)

_Таблица 9 — Состав программных компонентов._

=== Внешние зависимости (ключевые)

*Go-сервисы* (`go.mod`): `chi/v5` (HTTP-роутер), `pgx/v5` (драйвер PostgreSQL), `confluentinc/confluent-kafka-go`, `oapi-codegen/runtime`, `slog`. *Python-сервисы* (`pyproject.toml`): `fastapi`, `uvicorn`, `arch` (GARCH), `numpy`, `pandas`, `scipy`, `mlflow`, `psycopg2-binary`, `confluent-kafka`, `pydantic`. *Frontend*: `next`, `react`, `recharts`, `swr`.

== Описание API

API формализован через OpenAPI 3.0 в файлах #raw("apps/<service>/openapi.yaml"). Серверные интерфейсы Go генерируются `oapi-codegen` (см. `api/oapi-codegen.yaml`).

=== API Portfolio Service

Файл `apps/portfolio-service/openapi.yaml`. Реализация — `apps/portfolio-service/internal/handler/portfolio.go` (структура `PortfolioHandler` реализует `api.StrictServerInterface`).

#table(
  columns: (18mm, 60mm, 1fr),
  align: (left, left, left),
  stroke: 0.4pt,
  table.header([*Метод*], [*Путь*], [*Описание*]),
  [GET], [`/api/portfolios`], [Список портфелей],
  [POST], [`/api/portfolios`], [Создание портфеля],
  [GET], [`/api/portfolios/{id}`], [Детали портфеля],
  [DELETE], [`/api/portfolios/{id}`], [Удаление портфеля],
  [PUT], [`/api/portfolios/{id}/positions`], [Upsert позиции (handler `UpsertPosition`],
  [DELETE], [`/api/portfolios/{id}/positions/{symbol}`], [Удаление позиции],
  [GET], [`/api/portfolios/{id}/risk`], [Последний расчёт риска],
  [GET], [`/api/portfolios/{id}/risk/history`], [История расчётов],
)

_Таблица 10 — Endpoints Portfolio Service._

=== API Market Data Service

Файл `apps/market-data-service/openapi.yaml`.

#table(
  columns: (18mm, 60mm, 1fr),
  align: (left, left, left),
  stroke: 0.4pt,
  table.header([*Метод*], [*Путь*], [*Описание*]),
  [POST], [`/api/market-data/ingest`], [Запуск загрузки котировок],
  [POST], [`/api/market-data/process`], [Расчёт доходностей],
  [GET], [`/api/market-data/prices`], [Запрос котировок],
  [GET], [`/api/market-data/returns`], [Запрос доходностей],
  [GET], [`/api/market-data/ingestion-log`], [Журнал загрузок],
)

_Таблица 11 — Endpoints Market Data Service._

=== API Training Service

#table(
  columns: (18mm, 60mm, 1fr),
  align: (left, left, left),
  stroke: 0.4pt,
  table.header([*Метод*], [*Путь*], [*Описание*]),
  [POST], [`/api/risk/train`], [Обучение модели VaR],
  [POST], [`/api/risk/backtest`], [Запуск бэктеста],
  [GET], [`/api/risk/models`], [Список моделей],
)

_Таблица 12 — Endpoints Training Service._

=== API Inference Service

#table(
  columns: (18mm, 60mm, 1fr),
  align: (left, left, left),
  stroke: 0.4pt,
  table.header([*Метод*], [*Путь*], [*Описание*]),
  [POST], [`/api/risk/predict`], [Расчёт VaR/CVaR],
  [GET], [`/api/risk/predict/health`], [Здоровье моделей],
  [GET], [`/api/risk/scenarios`], [Список стресс-сценариев],
  [POST], [`/api/risk/scenarios/run`], [Запуск стресс-теста],
)

_Таблица 13 — Endpoints Inference Service._

== Описание пользовательского интерфейса

Фронтенд реализован на Next.js 14, TypeScript, Recharts. Файлы — `apps/frontend/src/app/`.

=== Структура страниц

#v(-2mm)
- `/` — главный дашборд: карточки основных метрик риска, выбор портфеля, графики цен/доходностей, расчёт VaR;
- `/portfolio` — управление портфелями и позициями;
- `/data` — загрузка и просмотр рыночных данных;
- `/models` — список обученных моделей и их метрик MLflow;
- `/backtest` — запуск бэктеста и просмотр результатов (Kupiec, Christoffersen);
- `/stress` — стресс-сценарии и таблица их результатов;
- `/drift` — мониторинг дрейфа данных;
- `/alerts` — журнал триггерных алертов.

=== Главный дашборд

Файл `apps/frontend/src/app/page.tsx`. Компонент `DashboardPage` использует следующие хуки: `useEffect` для начальной загрузки списка портфелей; `useCallback loadPortfolioData`; `handlePredict` — вызов `POST /api/risk/predict`. Компонент `KpiCard` рендерит метрики; `donutData` — данные для круговой диаграммы весов позиций.

[СКРИНШОТ 8: Главный дашборд — KPI-карточки (VaR, CVaR, Volatility, Sharpe), таблица позиций, линейный график доходностей, donut-диаграмма весов.]

[СКРИНШОТ 9: Страница «Backtest» — таблица результатов с p-value Купика и Кристофферсена, статус OK/WARN/CRIT.]

[СКРИНШОТ 10: Страница «Models» — список champion-моделей с метриками RMSE, AIC, log-likelihood из MLflow.]

== Алгоритмы оценки риска

=== Историческая симуляция

Описана в `docs/services_docs/inference-service.md`. Алгоритм:

#v(-2mm)
+ Загрузить исторические доходности портфеля за `lookback_days`;
+ Вычислить взвешенную доходность $r_p^((i)) = sum_k w_k r_k^((i))$ для каждого дня;
+ $"VaR"_alpha = - "quantile"(r_p, 1 - alpha)$;
+ $"CVaR"_alpha = - "mean"(r_p | r_p <= -"VaR"_alpha)$.

Преимущества — отсутствие предположений о распределении; недостаток — невозможность экстраполяции за пределы выборки.

=== Параметрический VaR из GARCH(1,1)

Использует обученную модель `arch_model` для прогноза $sigma_(T+1)^2$, после чего:

$ "VaR"_alpha = - mu - sigma_(T+1) Phi^(-1)(1 - alpha) $

где $Phi^(-1)$ — обратная функция распределения инноваций (нормального, t или skew-t).

=== Monte Carlo GBM

Алгоритм Geometric Brownian Motion с разложением Холецкого ковариационной матрицы для многоактивного случая (см. `apps/training-service/training_service/models/montecarlo.py`):

$ S_(t+Delta t) = S_t exp((mu - sigma^2 / 2) Delta t + sigma sqrt(Delta t) Z), quad Z tilde N(0, Sigma) $

VaR и CVaR вычисляются как эмпирические квантили N симуляций.

#figure(
  canvas(length: 1cm, {
    import draw: *
    // Оси
    line((0, 0), (15, 0), mark: (end: ">"), stroke: 0.5pt)
    line((0, 0), (0, 6), mark: (end: ">"), stroke: 0.5pt)
    content((15.4, -0.2), text(7pt)[t])
    content((-0.4, 6), text(7pt)[r])
    // Базовая линия 0
    line((0, 3), (15, 3), stroke: (paint: gray, thickness: 0.3pt, dash: "dotted"))
    content((-0.5, 3), text(6pt)[0])
    // Реализованные доходности (точки)
    let pts = ((0.5, 3.4), (1.2, 2.7), (2.0, 3.6), (2.8, 3.1), (3.6, 2.5),
               (4.4, 3.8), (5.2, 2.2), (6.0, 1.4), (6.8, 1.8), (7.6, 2.0),
               (8.4, 3.5), (9.2, 4.0), (10.0, 2.8), (10.8, 3.2), (11.6, 1.6),
               (12.4, 2.4), (13.2, 3.0), (14.0, 3.6))
    for p in pts {
      circle(p, radius: 0.08, fill: black, stroke: none)
    }
    for i in range(pts.len() - 1) {
      line(pts.at(i), pts.at(i + 1), stroke: (paint: gray, thickness: 0.3pt))
    }
    // Линия historical VaR (квантильный, ступенчатая, медленнее реагирует)
    let hist = ((0.5, 1.4), (3.0, 1.4), (3.0, 1.5), (6.0, 1.5), (6.0, 1.0), (9.0, 1.0), (9.0, 1.2), (12.0, 1.2), (12.0, 1.4), (15, 1.4))
    for i in range(hist.len() - 1) {
      line(hist.at(i), hist.at(i + 1), stroke: (paint: rgb("#1a73e8"), thickness: 0.6pt))
    }
    // GARCH VaR (быстрее реагирует, плавная)
    let garch = ((0.5, 1.7), (1.5, 1.6), (2.5, 1.5), (3.5, 1.3), (4.5, 1.5),
                 (5.5, 1.2), (6.5, 0.8), (7.5, 0.6), (8.5, 0.9), (9.5, 1.4),
                 (10.5, 1.6), (11.5, 1.0), (12.5, 1.2), (13.5, 1.5), (14.5, 1.6))
    for i in range(garch.len() - 1) {
      line(garch.at(i), garch.at(i + 1), stroke: (paint: rgb("#dc3545"), thickness: 0.6pt))
    }
    // Monte Carlo VaR (близок к GARCH, чуть консервативнее)
    let mc = ((0.5, 1.5), (1.5, 1.4), (2.5, 1.3), (3.5, 1.2), (4.5, 1.3),
              (5.5, 1.0), (6.5, 0.6), (7.5, 0.4), (8.5, 0.7), (9.5, 1.2),
              (10.5, 1.4), (11.5, 0.8), (12.5, 1.0), (13.5, 1.3), (14.5, 1.4))
    for i in range(mc.len() - 1) {
      line(mc.at(i), mc.at(i + 1), stroke: (paint: rgb("#28a745"), thickness: 0.6pt, dash: "dashed"))
    }
    // Легенда
    rect((10, 5.2), (15, 6.2), fill: white, stroke: 0.4pt)
    line((10.2, 5.95), (10.8, 5.95), stroke: (paint: rgb("#1a73e8"), thickness: 0.6pt))
    content((12.4, 5.95), text(6.5pt)[Historical VaR])
    line((10.2, 5.65), (10.8, 5.65), stroke: (paint: rgb("#dc3545"), thickness: 0.6pt))
    content((12.4, 5.65), text(6.5pt)[Parametric (GARCH)])
    line((10.2, 5.35), (10.8, 5.35), stroke: (paint: rgb("#28a745"), thickness: 0.6pt, dash: "dashed"))
    content((12.4, 5.35), text(6.5pt)[Monte Carlo GBM])
    // Подписи: возрастание стресса в середине
    content((7, 5.3), text(6.5pt)[период повышенной волатильности])
    line((7, 5.1), (7, 1.0), stroke: (paint: gray, thickness: 0.3pt, dash: "dotted"))
  }),
  caption: [Сравнение траекторий VaR трёх методов на едином временном ряду],
)

== Развёртывание

=== Docker Compose

Файл `docker-compose.yaml` описывает все 14+ контейнеров:

#v(-2mm)
- _Инфраструктура_: postgres, kafka (KRaft), minio, mlflow, airflow-webserver, airflow-scheduler, prometheus, grafana, caddy;
- _Сервисы приложения_: gateway, portfolio-service, market-data-service, training-service, inference-service, frontend.

Запуск: `docker compose up -d`. Healthcheck'и для критичных зависимостей (Postgres, Kafka, MLflow). Volumes для персистентности данных PostgreSQL, MinIO и Kafka.

=== Сети и порты

Все сервисы в сети Docker `riskops_default`. Внешние порты (см. `docs/services_docs/infra.md`): 80/443 (Caddy), 3000 (frontend), 8081--8085 (сервисы), 5432 (Postgres), 9092 (Kafka), 5000 (MLflow), 9000/9001 (MinIO), 8080 (Airflow), 9090 (Prometheus), 3001 (Grafana).

=== Конвейеры обработки и Airflow DAG'и

Папка `infra/airflow/dags/` содержит:

#v(-2mm)
- `daily_risk_dag.py` — ежедневный пересчёт VaR для всех портфелей;
- `market_data_dag.py` — загрузка котировок (с расписанием cron);
- `training_dag.py` — еженедельное переобучение моделей;
- `riskops_market_data_ingest_dag.py` — отдельный DAG для исторической загрузки.

DAG'и оперируют через CLI-утилиту `pipelines` (см. `apps/pipelines/riskops_pipelines/cli.py`) с командами `ingest`, `process`, `risk`, `log-to-mlflow`.

[СКРИНШОТ 11: Веб-интерфейс Apache Airflow с активными DAG'ами проекта RiskOps.]

[СКРИНШОТ 12: Дашборд Grafana «riskops-overview» с метриками HTTP-запросов, ошибок и времени отклика сервисов.]

== Тестирование

=== Юнит-тесты

#v(-2mm)
- Go: тесты в файлах `*_test.go` рядом с тестируемым кодом (например, `apps/market-data-service/internal/collector/moex_integration_test.go`);
- Python: расположены рядом с модулями, запускаются через `pytest`.

=== Интеграционные тесты

Скрипт `scripts/e2e_test.sh` выполняет сквозной end-to-end тест: создание портфеля → загрузка котировок → пересчёт доходностей → обучение модели → расчёт VaR → запуск бэктеста.

=== Метрики и мониторинг

Все Go-сервисы экспортируют метрики Prometheus на endpoint `/metrics` (HTTP-запросы, латентность, ошибки). Python-сервисы — через `prometheus-fastapi-instrumentator`. Дашборды Grafana — `infra/grafana/dashboards/riskops-overview.json`.

== Заключение

В рамках выполненной работы спроектирован и реализован MLOps-конвейер RiskOps для автоматизированной оценки рыночного риска инвестиционного портфеля. Получены следующие результаты:

#v(-2mm)
+ Разработана микросервисная архитектура из 6 сервисов и фронтенда, с API-шлюзом и событийно-ориентированной интеграцией через Apache Kafka;
+ Реализованы три независимых метода оценки VaR/CVaR — историческая симуляция, параметрический GARCH(1,1) с тремя вариантами распределения инноваций (normal, Student-t, skew-t) и Monte Carlo GBM с разложением Холецкого для многоактивного случая;
+ Реализована полноценная подсистема out-of-sample rolling backtesting с тестами Купика (Unconditional Coverage) и Кристофферсена (Conditional Coverage);
+ Реализован движок стресс-тестирования с пятью предопределёнными сценариями (исторические кризисы 1998, 2008, 2020 и параметрические шоки);
+ Развёрнут стек MLflow + MinIO для версионирования моделей и Airflow для оркестрации регулярных пайплайнов;
+ Реализован веб-интерфейс на Next.js 14 с восемью функциональными страницами;
+ Настроен мониторинг через Prometheus и Grafana с готовым дашбордом.

Система пригодна к промышленной эксплуатации в задачах автоматизированного управления рыночным риском малых и средних инвестиционных портфелей. Возможные направления развития: расширение перечня моделей, интеграция с внешними риск-движками, поддержка деривативов, расширение покрытия мониторинга на бизнес-метрики (drift detection, model degradation alerts).

== Список использованных источников

+ ГОСТ 19.404-79. Единая система программной документации. Пояснительная записка. Требования к содержанию и оформлению.
+ ГОСТ 7.32-2017. Система стандартов по информации, библиотечному и издательскому делу. Отчёт о научно-исследовательской работе. Структура и правила оформления.
+ ГОСТ 19.701-90. Единая система программной документации. Схемы алгоритмов, программ, данных и систем. Условные обозначения и правила выполнения.
+ Bollerslev T. Generalized autoregressive conditional heteroskedasticity // Journal of Econometrics. — 1986. — Vol. 31, No. 3. — P. 307--327.
+ Engle R. F. Autoregressive Conditional Heteroscedasticity with Estimates of the Variance of United Kingdom Inflation // Econometrica. — 1982. — Vol. 50, No. 4. — P. 987--1007.
+ Kupiec P. Techniques for verifying the accuracy of risk measurement models // The Journal of Derivatives. — 1995. — Vol. 3, No. 2. — P. 73--84.
+ Christoffersen P. F. Evaluating Interval Forecasts // International Economic Review. — 1998. — Vol. 39, No. 4. — P. 841--862.
+ Jorion P. Value at Risk: The New Benchmark for Managing Financial Risk. 3rd ed. — McGraw-Hill, 2007.
+ McNeil A. J., Frey R., Embrechts P. Quantitative Risk Management: Concepts, Techniques and Tools. — Princeton University Press, 2015.
+ Glasserman P. Monte Carlo Methods in Financial Engineering. — Springer, 2003.
+ Newman S. Building Microservices. 2nd ed. — O'Reilly Media, 2021.
+ Kreps J. I Heart Logs: Event Data, Stream Processing, and Data Integration. — O'Reilly Media, 2014.
+ Apache Kafka Documentation. — URL: https://kafka.apache.org/documentation/.
+ MLflow Documentation. — URL: https://mlflow.org/docs/latest/index.html.
+ Apache Airflow Documentation. — URL: https://airflow.apache.org/docs/.
+ FastAPI Documentation. — URL: https://fastapi.tiangolo.com/.
+ Next.js Documentation. — URL: https://nextjs.org/docs.
+ OpenAPI Specification 3.0. — URL: https://spec.openapis.org/oas/v3.0.3.

== Приложения

=== Приложение А. Перечень условных обозначений

#table(
  columns: (28mm, 1fr),
  align: (left, left),
  stroke: 0.4pt,
  table.header([*Обозначение*], [*Расшифровка*]),
  [VaR], [Value at Risk — стоимостная мера риска],
  [CVaR], [Conditional VaR (Expected Shortfall) — условная VaR],
  [GARCH], [Generalized AutoRegressive Conditional Heteroskedasticity],
  [GBM], [Geometric Brownian Motion],
  [MLOps], [Machine Learning Operations],
  [API], [Application Programming Interface],
  [DAG], [Directed Acyclic Graph (Airflow)],
  [UC / CC], [Unconditional / Conditional Coverage (бэктесты)],
  [KRaft], [Kafka Raft — режим Kafka без ZooKeeper],
)

_Таблица 14 — Перечень условных обозначений._

=== Приложение Б. Перечень файлов проекта

Дерево исходных кодов представлено в корне репозитория:

#v(-2mm)
- `apps/` — исходные коды микросервисов и фронтенда;
- `infra/` — Dockerfile-ы инфраструктуры, Airflow DAG'и, конфиги Prometheus/Grafana, init-скрипты Postgres;
- `api/` — конфигурация генерации кода `oapi-codegen`;
- `pkg/` — общие Go-библиотеки (config, logger, postgres);
- `scripts/` — служебные скрипты CI и E2E-тестов;
- `docs/` — документация (включая настоящую ПЗ);
- `plans/` — архитектурные планы;
- `docker-compose.yaml`, `Makefile`, `go.mod`, `README.md` — корневые файлы проекта.

=== Приложение В. Пример конфигурационных переменных окружения

#raw(
  "DB_HOST=postgres
DB_PORT=5432
DB_NAME=riskops
DB_USER=riskops
DB_PASSWORD=riskops123
KAFKA_BROKERS=kafka:9092
MLFLOW_TRACKING_URI=http://mlflow:5000
MLFLOW_S3_ENDPOINT_URL=http://minio:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minio123
GATEWAY_PORT=8081
PORTFOLIO_SERVICE_URL=http://portfolio-service:8082
MARKET_DATA_SERVICE_URL=http://market-data-service:8083
TRAINING_SERVICE_URL=http://training-service:8084
INFERENCE_SERVICE_URL=http://inference-service:8085",
  block: true,
)
