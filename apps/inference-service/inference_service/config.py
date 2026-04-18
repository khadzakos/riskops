from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Server
    port: int = 8085
    log_level: str = "info"

    # Postgres
    database_url: str = "postgresql://riskops:riskops@db:5432/riskops"

    # MLflow
    mlflow_tracking_uri: str = "http://mlflow:3000"
    mlflow_s3_endpoint_url: str = "http://minio:9000"

    # MinIO / S3
    aws_access_key_id: str = "riskops"
    aws_secret_access_key: str = "riskops123"
    s3_bucket_models: str = "riskops-models"

    # Kafka
    kafka_brokers: str = "kafka:9092"
    kafka_consumer_group: str = "inference-service"
    kafka_topic_portfolio_updated: str = "portfolio.updated"
    kafka_topic_model_trained: str = "model.trained"

    # Inference defaults
    default_alpha: float = 0.99
    default_horizon_days: int = 1
    default_lookback_days: int = 252
    monte_carlo_simulations: int = 10_000

    model_config = {"env_file": ".env", "case_sensitive": False}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
