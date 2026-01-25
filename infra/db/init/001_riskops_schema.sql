-- RiskOps MVP schema (raw → processed → risk results)

-- Raw market data (daily close prices for MVP)
CREATE TABLE IF NOT EXISTS raw_prices (
  symbol TEXT NOT NULL,
  price_date DATE NOT NULL,
  close NUMERIC(18, 8) NOT NULL,
  currency TEXT NULL,
  source TEXT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, price_date)
);

CREATE INDEX IF NOT EXISTS idx_raw_prices_date ON raw_prices (price_date);

-- Processed returns (simple returns for MVP)
CREATE TABLE IF NOT EXISTS processed_returns (
  symbol TEXT NOT NULL,
  price_date DATE NOT NULL,
  ret NUMERIC(18, 12) NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, price_date)
);

CREATE INDEX IF NOT EXISTS idx_processed_returns_date ON processed_returns (price_date);

-- Portfolio definition (minimal)
CREATE TABLE IF NOT EXISTS portfolios (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Portfolio positions (symbol-weighted for MVP)
CREATE TABLE IF NOT EXISTS portfolio_positions (
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  weight NUMERIC(18, 10) NOT NULL CHECK (weight >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portfolio_id, symbol)
);

-- Risk results (VaR/CVaR etc.)
CREATE TABLE IF NOT EXISTS risk_results (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id BIGINT NULL REFERENCES portfolios(id) ON DELETE SET NULL,
  asof_date DATE NOT NULL,
  horizon_days INT NOT NULL DEFAULT 1 CHECK (horizon_days > 0),
  alpha NUMERIC(6, 5) NOT NULL CHECK (alpha > 0 AND alpha < 1),
  method TEXT NOT NULL, -- historical|parametric|mc
  metric TEXT NOT NULL, -- var|cvar|vol|...
  value NUMERIC(24, 12) NOT NULL,
  model_version TEXT NOT NULL DEFAULT 'baseline-historical-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_results_asof ON risk_results (asof_date);
CREATE INDEX IF NOT EXISTS idx_risk_results_portfolio_asof ON risk_results (portfolio_id, asof_date);

-- Seed one demo portfolio (safe to re-run)
INSERT INTO portfolios (name)
VALUES ('demo')
ON CONFLICT (name) DO NOTHING;

-- Seed demo weights (safe to re-run)
INSERT INTO portfolio_positions (portfolio_id, symbol, weight)
SELECT p.id, v.symbol, v.weight
FROM portfolios p
JOIN (
  VALUES
    ('AAPL', 0.50::NUMERIC),
    ('MSFT', 0.50::NUMERIC)
) AS v(symbol, weight) ON TRUE
WHERE p.name = 'demo'
ON CONFLICT (portfolio_id, symbol) DO UPDATE SET
  weight = EXCLUDED.weight,
  updated_at = NOW();

