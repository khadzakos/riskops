up:
	docker compose up -d --build

force-up:
	docker compose up -d --build --force-recreate

down:
	docker compose down -v

logs:
	docker compose logs -f --tail=200

ps:
	docker compose ps

cli-test-pipelines:
	docker compose run --rm pipelines ingest --symbols "AAPL,MSFT" --start 2024-01-01 --end 2024-12-31 --source synthetic
	docker compose run --rm pipelines process --symbols "AAPL,MSFT"
	docker compose run --rm pipelines risk --portfolio demo --alpha 0.99 --method historical
	docker compose run --rm pipelines log-to-mlflow --portfolio demo --experiment riskops-mvp