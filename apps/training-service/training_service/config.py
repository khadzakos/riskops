from __future__ import annotations

import os
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Server
    port: int = 8084
    log_level: str = "info"

    # Postgres
    database_url: str = "postgresql://riskops:riskops@db:5432/riskops"

    # MLflow
    mlflow_tracking_uri: str = "http://mlflow:3000"
    mlflow_s3_endpoint_url: str = "http://minio:9000"

    # MinIO / S3
    aws_access_key_id: str = "riskops"
    aws_secret_access_key: str = "riskops123"

    # Kafka
    kafka_brokers: str = "kafka:9092"
    kafka_consumer_group: str = "training-service"
    kafka_topic_market_data: str = "market.data.ingested"
    kafka_topic_model_trained: str = "model.trained"

    # Training defaults
    default_lookback_days: int = 252
    default_alpha: float = 0.99
    default_horizon_days: int = 1
    monte_carlo_simulations: int = 10_000

    # Downstream service URLs
    market_data_service_url: str = "http://market-data-service:8083"

    model_config = {"env_file": ".env", "case_sensitive": False}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
