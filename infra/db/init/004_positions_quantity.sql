-- Add quantity and price columns to portfolio_positions.
-- Weight is now derived: weight_raw = quantity * price, then renormalized across all positions.
-- Existing rows get quantity=0, price=0 (legacy weight-only rows).

ALTER TABLE portfolio_positions
    ADD COLUMN IF NOT EXISTS quantity  NUMERIC(24, 8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS price     NUMERIC(18, 8) NOT NULL DEFAULT 0;

-- Benchmark symbols table: stores which symbols are used as market benchmarks.
-- SPY is auto-seeded as the default US equity benchmark.
CREATE TABLE IF NOT EXISTS benchmark_symbols (
    symbol      TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    region      TEXT NOT NULL DEFAULT 'US',
    source      TEXT NOT NULL DEFAULT 'yahoo',
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO benchmark_symbols (symbol, name, region, source)
VALUES ('SPY', 'SPDR S&P 500 ETF Trust', 'US', 'yahoo')
ON CONFLICT (symbol) DO NOTHING;
