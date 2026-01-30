-- Portfolio snapshots table (снимки портфеля для истории)
CREATE TABLE portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    portfolio_version_id UUID NOT NULL REFERENCES portfolio_versions(id) ON DELETE CASCADE,
    total_value DECIMAL(20, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    snapshot_date DATE NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT portfolio_snapshots_total_value_check CHECK (total_value >= 0),
    CONSTRAINT portfolio_snapshots_currency_check CHECK (char_length(currency) = 3),
    UNIQUE(portfolio_id, snapshot_date)
);

-- Indexes
CREATE INDEX idx_portfolio_snapshots_portfolio_id ON portfolio_snapshots(portfolio_id);
CREATE INDEX idx_portfolio_snapshots_version_id ON portfolio_snapshots(portfolio_version_id);
CREATE INDEX idx_portfolio_snapshots_date ON portfolio_snapshots(snapshot_date DESC);
CREATE INDEX idx_portfolio_snapshots_portfolio_date ON portfolio_snapshots(portfolio_id, snapshot_date DESC);
CREATE INDEX idx_portfolio_snapshots_metadata ON portfolio_snapshots USING GIN(metadata) WHERE metadata IS NOT NULL;

