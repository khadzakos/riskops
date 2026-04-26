-- Migration 003: stress test results table + bulk ingestion tracking

-- Stress test results persistence
CREATE TABLE IF NOT EXISTS stress_test_results (
    id BIGSERIAL PRIMARY KEY,
    portfolio_id BIGINT NULL REFERENCES portfolios(id) ON DELETE SET NULL,
    scenario_id TEXT NOT NULL,
    scenario_name TEXT NOT NULL,
    scenario_type TEXT NOT NULL,           -- 'historical' | 'parametric'
    stressed_var NUMERIC(24, 12) NOT NULL,
    stressed_cvar NUMERIC(24, 12) NOT NULL,
    max_drawdown NUMERIC(24, 12) NOT NULL,
    worst_day NUMERIC(24, 12) NOT NULL,
    p10_return NUMERIC(24, 12) NOT NULL,
    p1_return NUMERIC(24, 12) NOT NULL,
    mean_return NUMERIC(24, 12) NOT NULL,
    n_observations INT NOT NULL DEFAULT 0,
    alpha NUMERIC(6, 5) NOT NULL DEFAULT 0.99,
    vol_multiplier NUMERIC(10, 4),
    corr_shock NUMERIC(10, 4),
    n_simulations INT NOT NULL DEFAULT 50000,
    lookback_days INT NOT NULL DEFAULT 252,
    description TEXT NOT NULL DEFAULT '',
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stress_results_portfolio ON stress_test_results (portfolio_id);
CREATE INDEX IF NOT EXISTS idx_stress_results_scenario ON stress_test_results (scenario_id);
CREATE INDEX IF NOT EXISTS idx_stress_results_computed ON stress_test_results (computed_at DESC);

-- Bulk ingestion job tracking (for 10-year historical load)
CREATE TABLE IF NOT EXISTS bulk_ingest_jobs (
    id BIGSERIAL PRIMARY KEY,
    job_type TEXT NOT NULL DEFAULT 'historical',  -- 'historical' | 'daily_refresh'
    source TEXT NOT NULL,                          -- 'yahoo' | 'moex'
    total_symbols INT NOT NULL DEFAULT 0,
    completed_symbols INT NOT NULL DEFAULT 0,
    failed_symbols INT NOT NULL DEFAULT 0,
    total_rows_ingested INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',        -- 'running' | 'completed' | 'failed' | 'partial'
    date_from DATE,
    date_to DATE,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bulk_ingest_jobs_status ON bulk_ingest_jobs (status);
CREATE INDEX IF NOT EXISTS idx_bulk_ingest_jobs_started ON bulk_ingest_jobs (started_at DESC);
