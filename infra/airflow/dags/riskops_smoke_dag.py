from __future__ import annotations

from datetime import datetime

from airflow import DAG
from airflow.providers.docker.operators.docker import DockerOperator

PIPELINES_ENV = {
    "DATABASE_URL": "postgresql://riskops:riskops@db:5432/riskops",
    "MLFLOW_TRACKING_URI": "http://mlflow:3000",
}

with DAG(
    dag_id="riskops_pipeline",
    start_date=datetime(2025, 1, 1),
    schedule=None,
    catchup=False,
    tags=["riskops", "mvp"],
) as dag:
    ingest = DockerOperator(
        task_id="ingest",
        image="riskops-pipelines",
        command=(
            "ingest --symbols 'AAPL,MSFT' --start 2024-01-01 --end 2024-12-31 --source synthetic"
        ),
        docker_url="unix://var/run/docker.sock",
        network_mode="riskops_default",
        environment=PIPELINES_ENV,
        mount_tmp_dir=False,
        auto_remove=True,
    )

    process = DockerOperator(
        task_id="process",
        image="riskops-pipelines",
        command="process --symbols 'AAPL,MSFT'",
        docker_url="unix://var/run/docker.sock",
        network_mode="riskops_default",
        environment=PIPELINES_ENV,
        mount_tmp_dir=False,
        auto_remove=True,
    )

    risk = DockerOperator(
        task_id="risk",
        image="riskops-pipelines",
        command="risk --portfolio demo --alpha 0.99 --method historical",
        docker_url="unix://var/run/docker.sock",
        network_mode="riskops_default",
        environment=PIPELINES_ENV,
        mount_tmp_dir=False,
        auto_remove=True,
    )

    log_to_mlflow = DockerOperator(
        task_id="log_to_mlflow",
        image="riskops-pipelines",
        command="log-to-mlflow --portfolio demo --experiment riskops-mvp",
        docker_url="unix://var/run/docker.sock",
        network_mode="riskops_default",
        environment=PIPELINES_ENV,
        mount_tmp_dir=False,
        auto_remove=True,
    )

    ingest >> process >> risk >> log_to_mlflow

