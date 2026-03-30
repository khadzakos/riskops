"""FastAPI application entrypoint for the Training Service."""
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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

_kafka_consumer = KafkaConsumerThread()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    cfg = get_settings()

    # Configure MLflow
    mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
    os.environ.setdefault("MLFLOW_S3_ENDPOINT_URL", cfg.mlflow_s3_endpoint_url)
    os.environ.setdefault("AWS_ACCESS_KEY_ID", cfg.aws_access_key_id)
    os.environ.setdefault("AWS_SECRET_ACCESS_KEY", cfg.aws_secret_access_key)
    logger.info("MLflow tracking URI: %s", cfg.mlflow_tracking_uri)

    # Start Kafka consumer background thread
    _kafka_consumer.start()
    logger.info("Training Service started on port %d", cfg.port)

    yield  # application runs here

    # Graceful shutdown
    _kafka_consumer.stop()
    logger.info("Training Service shut down")


def create_app() -> FastAPI:
    cfg = get_settings()

    app = FastAPI(
        title="RiskOps Training Service",
        description=(
            "ML model training service for RiskOps. "
            "Trains GARCH and Monte Carlo models, logs experiments to MLflow, "
            "and registers model versions."
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
        return {"status": "ok", "service": "training-service"}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    cfg = get_settings()
    uvicorn.run(
        "training_service.main:app",
        host="0.0.0.0",
        port=cfg.port,
        log_level=cfg.log_level.lower(),
        reload=False,
    )
