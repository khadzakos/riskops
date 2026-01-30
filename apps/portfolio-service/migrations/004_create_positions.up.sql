-- Positions table
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_version_id UUID NOT NULL REFERENCES portfolio_versions(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    quantity DECIMAL(20, 8),
    weight DECIMAL(5, 4), -- вес в процентах (0.0000 - 100.0000)
    market_value DECIMAL(20, 2),
    average_price DECIMAL(20, 8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT positions_quantity_or_weight CHECK (
        (quantity IS NOT NULL AND quantity > 0) OR 
        (weight IS NOT NULL AND weight > 0 AND weight <= 100)
    ),
    CONSTRAINT positions_weight_check CHECK (weight IS NULL OR (weight >= 0 AND weight <= 100)),
    CONSTRAINT positions_quantity_check CHECK (quantity IS NULL OR quantity > 0),
    
    -- Уникальность позиции в версии портфеля (один актив = одна позиция)
    UNIQUE(portfolio_version_id, asset_id)
);

-- Indexes
CREATE INDEX idx_positions_portfolio_version_id ON positions(portfolio_version_id);
CREATE INDEX idx_positions_asset_id ON positions(asset_id);
CREATE INDEX idx_positions_market_value ON positions(market_value) WHERE market_value IS NOT NULL;

-- Trigger for positions
CREATE TRIGGER update_positions_updated_at 
BEFORE UPDATE ON positions 
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();

