DROP TABLE IF EXISTS benchmark_symbols;
ALTER TABLE portfolio_positions DROP COLUMN IF EXISTS price;
ALTER TABLE portfolio_positions DROP COLUMN IF EXISTS quantity;
