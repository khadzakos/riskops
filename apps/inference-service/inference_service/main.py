"""FastAPI application entrypoint for the Inference Service."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import mlflow
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .config import get_settings
from .kafka_consumer import KafkaConsumerThread
from .models.loader import load_all_models

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

_kafka_consumer = KafkaConsumerThread()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    cfg = get_settings()

    # Configure MLflow and S3 credentials
    mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
    os.environ.setdefault("MLFLOW_S3_ENDPOINT_URL", cfg.mlflow_s3_endpoint_url)
    os.environ.setdefault("AWS_ACCESS_KEY_ID", cfg.aws_access_key_id)
    os.environ.setdefault("AWS_SECRET_ACCESS_KEY", cfg.aws_secret_access_key)
    logger.info("MLflow tracking URI: %s", cfg.mlflow_tracking_uri)

    # Load ML models from MLflow on startup
    # Failures are non-fatal — service falls back to historical simulation
    try:
        load_all_models()
    except Exception as exc:
        logger.error("Model loading failed on startup: %s — using historical fallback", exc)

    # Start Kafka consumer background thread
    _kafka_consumer.start()
    logger.info("Inference Service started on port %d", cfg.port)

    yield  # application runs here

    # Graceful shutdown
    _kafka_consumer.stop()
    logger.info("Inference Service shut down")


def create_app() -> FastAPI:
    app = FastAPI(
        title="RiskOps Inference Service",
        description=(
            "ML inference service for RiskOps. "
            "Loads GARCH and Monte Carlo models from MLflow, "
            "computes VaR/CVaR/volatility on demand, "
            "and reacts to Kafka events for auto-recalculation."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router)

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "service": "inference-service"}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    cfg = get_settings()
    uvicorn.run(
        "inference_service.main:app",
        host="0.0.0.0",
        port=cfg.port,
        log_level=cfg.log_level.lower(),
        reload=False,
    )
