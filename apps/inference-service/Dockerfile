FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg

RUN python -m pip install --no-cache-dir -U pip uv

COPY pyproject.toml /app/pyproject.toml
COPY inference_service /app/inference_service

RUN uv pip install --system -e .

EXPOSE 8085

CMD ["python", "-m", "uvicorn", "inference_service.main:app", "--host", "0.0.0.0", "--port", "8085"]
