up:
	docker-compose up -d --build

force-up:
	docker-compose up -d --build --force-recreate

down:
	docker-compose down -v

logs:
	docker-compose logs -f --tail=200

ps:
	docker-compose ps

# ── Code generation ────────────────────────────────────────

OAPI_CODEGEN := $(shell go env GOPATH)/bin/oapi-codegen
# Shared config: api/oapi-codegen.yaml (generate:* only). Per service: -o, -package, spec path.
OAPI_GEN_CFG := api/oapi-codegen.yaml

generate-portfolio:
	$(OAPI_CODEGEN) --config $(OAPI_GEN_CFG) -package api -o apps/portfolio-service/internal/api/api.gen.go apps/portfolio-service/openapi.yaml

generate: generate-portfolio

# ── Go builds ──────────────────────────────────────────────

build-gateway:
	go build -o bin/gateway ./apps/gateway

build-portfolio:
	go build -o bin/portfolio-service ./apps/portfolio-service

build-all: build-gateway build-portfolio

tidy:
	go mod tidy

# ── Pipeline CLI ───────────────────────────────────────────

cli-test-pipelines:
	docker-compose run --rm pipelines ingest --symbols "AAPL,MSFT" --start 2024-01-01 --end 2024-12-31 --source synthetic
	docker-compose run --rm pipelines process --symbols "AAPL,MSFT"
	docker-compose run --rm pipelines risk --portfolio demo --alpha 0.99 --method historical
	docker-compose run --rm pipelines log-to-mlflow --portfolio demo --experiment riskops-mvp
