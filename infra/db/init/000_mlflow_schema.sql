-- Ensure MLflow uses its own schema to avoid Alembic table collisions
-- (Airflow and MLflow both use an `alembic_version` table).

CREATE SCHEMA IF NOT EXISTS mlflow AUTHORIZATION riskops;
GRANT USAGE, CREATE ON SCHEMA mlflow TO riskops;

