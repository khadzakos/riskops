FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN python -m pip install --no-cache-dir -U pip uv

COPY pyproject.toml /app/pyproject.toml
COPY riskops_inference /app/riskops_inference

RUN uv pip install --system -e .

EXPOSE 8000

CMD ["uvicorn", "riskops_inference.main:app", "--host", "0.0.0.0", "--port", "8000"]
