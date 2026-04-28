-- Extensions for core MVP: add missing columns, credit data, model registry, ingestion log

-- Add description, currency, updated_at to portfolios (UI expects them)
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Credit portfolio data (synthetic for MVP)
CREATE TABLE IF NOT EXISTS credit_data (
    id BIGSERIAL PRIMARY KEY,
    loan_id TEXT NOT NULL UNIQUE,
    borrower_id TEXT NOT NULL,
    loan_amount NUMERIC(18, 2) NOT NULL,
    interest_rate NUMERIC(8, 5) NOT NULL,
    term_months INT NOT NULL,
    credit_score INT NOT NULL,
    ltv_ratio NUMERIC(8, 5),
    dti_ratio NUMERIC(8, 5),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    default_date DATE,
    origination_date DATE NOT NULL,
    sector TEXT,
    source TEXT NOT NULL DEFAULT 'synthetic',
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_data_borrower ON credit_data (borrower_id);
CREATE INDEX IF NOT EXISTS idx_credit_data_default ON credit_data (is_default);
CREATE INDEX IF NOT EXISTS idx_credit_data_origination ON credit_data (origination_date);

-- Model registry tracking (supplements MLflow)
CREATE TABLE IF NOT EXISTS model_registry (
    id BIGSERIAL PRIMARY KEY,
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    mlflow_run_id TEXT,
    status TEXT NOT NULL DEFAULT 'staging',
    metrics JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(model_name, model_version)
);

-- Data ingestion log
CREATE TABLE IF NOT EXISTS ingestion_log (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    data_type TEXT NOT NULL DEFAULT 'market_price',
    symbols TEXT[] NOT NULL,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    rows_ingested INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Training job state (replaces in-memory dict in training-service)
-- Survives container restarts; polled by GET /api/risk/train/status/{job_id}
CREATE TABLE IF NOT EXISTS training_jobs (
    job_id      TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'queued',   -- queued | running | completed | failed
    model_type  TEXT,
    symbols     TEXT[],
    alpha       NUMERIC(8, 6),
    horizon_days INT,
    lookback_days INT,
    n_simulations INT,
    results     JSONB,          -- list of TrainResult dicts once completed
    error       TEXT,           -- error message if failed
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_jobs_status ON training_jobs (status);
CREATE INDEX IF NOT EXISTS idx_training_jobs_created ON training_jobs (created_at DESC);
