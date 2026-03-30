FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg

RUN python -m pip install --no-cache-dir -U pip uv

COPY pyproject.toml /app/pyproject.toml
COPY training_service /app/training_service

RUN uv pip install --system -e .

EXPOSE 8084

CMD ["python", "-m", "uvicorn", "training_service.main:app", "--host", "0.0.0.0", "--port", "8084"]
