COMPOSE := docker-compose

up:
	$(COMPOSE) --profile all up -d --build

# Rebuild and recreate all containers
force-up:
	$(COMPOSE) --profile all up -d --build --force-recreate

# Start without rebuilding (use existing images)
start:
	$(COMPOSE) --profile infra --profile apps --profile mlflow --profile observability up -d

down:
	$(COMPOSE) --profile infra --profile apps --profile mlflow --profile observability --profile airflow down -v

logs:
	$(COMPOSE) logs -f --tail=200

ps:
	$(COMPOSE) ps -a


# Infrastructure only: db + kafka + minio (no build)
up-infra:
	$(COMPOSE) --profile infra up -d

# Apps only: all Go + Python services (requires infra + mlflow running)
up-apps:
	$(COMPOSE) --profile apps up -d --build

start-apps:
	$(COMPOSE) --profile apps up -d

# MLflow + MinIO (no build)
up-mlflow:
	$(COMPOSE) --profile mlflow up -d

# Airflow (builds custom image)
up-airflow:
	$(COMPOSE) --profile airflow up -d --build

# Observability: Prometheus + Grafana (no build)
up-observability:
	$(COMPOSE) --profile observability up -d

# ── Restart individual services without rebuild ────────────────
restart-gateway:
	$(COMPOSE) restart gateway

restart-portfolio:
	$(COMPOSE) restart portfolio-service

restart-market-data:
	$(COMPOSE) restart market-data-service

restart-training:
	$(COMPOSE) restart training-service

restart-inference:
	$(COMPOSE) restart inference-service

# ── End-to-end integration test ────────────────────────────────

# Run full e2e test (requires all services up: make up)
e2e:
	./scripts/e2e_test.sh

# Run e2e skipping slow steps (health + gateway routing only)
e2e-fast:
	./scripts/e2e_test.sh --skip-ingest --skip-train --skip-infer

# Run e2e skipping training (use existing models)
e2e-no-train:
	./scripts/e2e_test.sh --skip-train

# ── Code generation ────────────────────────────────────────────

OAPI_CODEGEN := $(shell go env GOPATH)/bin/oapi-codegen
# Shared config: api/oapi-codegen.yaml (generate:* only). Per service: -o, -package, spec path.
OAPI_GEN_CFG := api/oapi-codegen.yaml

generate-portfolio:
	$(OAPI_CODEGEN) --config $(OAPI_GEN_CFG) -package api -o apps/portfolio-service/internal/api/api.gen.go apps/portfolio-service/openapi.yaml

generate-market-data:
	$(OAPI_CODEGEN) --config $(OAPI_GEN_CFG) -package api -o apps/market-data-service/internal/api/api.gen.go apps/market-data-service/openapi.yaml

generate: generate-portfolio generate-market-data

# ── Go builds ──────────────────────────────────────────────────

build-gateway:
	go build -o bin/gateway ./apps/gateway

build-portfolio:
	go build -o bin/portfolio-service ./apps/portfolio-service

build-market-data:
	go build -o bin/market-data-service ./apps/market-data-service

build-all: build-gateway build-portfolio build-market-data

tidy:
	go mod tidy

# ── Pipeline CLI ───────────────────────────────────────────────

cli-test-pipelines:
	docker compose run --rm pipelines ingest --symbols "AAPL,MSFT" --start 2024-01-01 --end 2024-12-31 --source synthetic
	docker compose run --rm pipelines process --symbols "AAPL,MSFT"
	docker compose run --rm pipelines risk --portfolio demo --alpha 0.99 --method historical
	docker compose run --rm pipelines log-to-mlflow --portfolio demo --experiment riskops-mvp
