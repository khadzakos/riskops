-- Migration 006: FRED (Federal Reserve Economic Data) series catalogue
-- Stores metadata for financially significant FRED series.
-- Actual time-series data is stored in raw_prices with source='fred'
-- and processed_returns for return-based series.

CREATE TABLE IF NOT EXISTS fred_series (
    series_id   TEXT PRIMARY KEY,          -- e.g. 'DGS10', 'FEDFUNDS'
    name        TEXT NOT NULL,             -- human-readable name
    category    TEXT NOT NULL,             -- 'rates' | 'spreads' | 'macro' | 'volatility'
    frequency   TEXT NOT NULL DEFAULT 'daily',  -- 'daily' | 'weekly' | 'monthly'
    units       TEXT NOT NULL DEFAULT '',  -- e.g. 'Percent', 'Index'
    description TEXT NOT NULL DEFAULT '',
    last_fetched TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the financially significant FRED series
INSERT INTO fred_series (series_id, name, category, frequency, units, description)
VALUES
    ('DGS10',         '10-Year Treasury Constant Maturity Rate',        'rates',      'daily',   'Percent',  'US 10-year risk-free rate benchmark'),
    ('DGS2',          '2-Year Treasury Constant Maturity Rate',         'rates',      'daily',   'Percent',  'US 2-year Treasury yield'),
    ('FEDFUNDS',      'Federal Funds Effective Rate',                   'rates',      'daily',   'Percent',  'Overnight Fed Funds rate — monetary policy anchor'),
    ('T10Y2Y',        '10-Year minus 2-Year Treasury Yield Spread',     'spreads',    'daily',   'Percent',  'Yield curve slope — recession indicator when negative'),
    ('BAMLH0A0HYM2',  'ICE BofA US High Yield Index OAS',               'spreads',    'daily',   'Percent',  'High-yield credit spread — risk appetite indicator'),
    ('VIXCLS',        'CBOE Volatility Index (VIX)',                    'volatility', 'daily',   'Index',    'Equity market fear gauge'),
    ('UNRATE',        'Unemployment Rate',                              'macro',      'monthly', 'Percent',  'US unemployment rate — lagging macro indicator'),
    ('CPIAUCSL',      'Consumer Price Index for All Urban Consumers',   'macro',      'monthly', 'Index',    'US CPI — inflation measure'),
    ('MORTGAGE30US',  '30-Year Fixed Rate Mortgage Average',            'rates',      'weekly',  'Percent',  'US mortgage rate — housing market indicator')
ON CONFLICT (series_id) DO UPDATE SET
    name        = EXCLUDED.name,
    category    = EXCLUDED.category,
    frequency   = EXCLUDED.frequency,
    units       = EXCLUDED.units,
    description = EXCLUDED.description;

CREATE INDEX IF NOT EXISTS idx_fred_series_category ON fred_series (category);
