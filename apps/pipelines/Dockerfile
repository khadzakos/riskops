FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN python -m pip install --no-cache-dir -U pip uv

COPY pyproject.toml /app/pyproject.toml
COPY riskops_pipelines /app/riskops_pipelines

# Install dependencies + project into system site-packages
RUN uv pip install --system -e .

ENTRYPOINT ["python", "-m", "riskops_pipelines"]
