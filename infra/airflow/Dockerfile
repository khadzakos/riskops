FROM apache/airflow:2.9.3

# Install minimal deps to run our pipelines CLI inside Airflow tasks.
COPY apps/pipelines/requirements.txt /tmp/pipelines-requirements.txt
RUN python -m pip install --no-cache-dir -U pip uv && uv pip install -r /tmp/pipelines-requirements.txt

# Copy the pipelines package so BashOperator can call `python -m riskops_pipelines ...`
COPY apps/pipelines/riskops_pipelines /opt/airflow/riskops_pipelines

# Ensure Python can import /opt/airflow/* packages.
ENV PYTHONPATH="/opt/airflow"

USER airflow
