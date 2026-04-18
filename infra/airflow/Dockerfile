FROM apache/airflow:2.9.3

# Copy the pipelines package so BashOperator can call `python -m riskops_pipelines ...`
COPY apps/pipelines/riskops_pipelines /opt/airflow/riskops_pipelines

# Ensure Python can import /opt/airflow/* packages.
ENV PYTHONPATH="/opt/airflow"

USER airflow
