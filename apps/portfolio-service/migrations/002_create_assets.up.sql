-- Assets table (справочник активов)
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker VARCHAR(20) NOT NULL,
    exchange VARCHAR(10),
    asset_type VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    sector VARCHAR(100),
    country VARCHAR(3), -- ISO country code
    isin VARCHAR(12), -- для акций/облигаций
    cusip VARCHAR(9), -- для US securities
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT assets_ticker_check CHECK (char_length(ticker) >= 1),
    CONSTRAINT assets_name_check CHECK (char_length(name) >= 1),
    CONSTRAINT assets_currency_check CHECK (char_length(currency) = 3),
    UNIQUE(ticker, exchange, asset_type)
);

-- Indexes
CREATE INDEX idx_assets_ticker ON assets(ticker);
CREATE INDEX idx_assets_exchange ON assets(exchange) WHERE exchange IS NOT NULL;
CREATE INDEX idx_assets_type ON assets(asset_type);
CREATE INDEX idx_assets_sector ON assets(sector) WHERE sector IS NOT NULL;
CREATE INDEX idx_assets_active ON assets(is_active) WHERE is_active = true;
CREATE INDEX idx_assets_ticker_exchange_type ON assets(ticker, exchange, asset_type);

-- Trigger for assets
CREATE TRIGGER update_assets_updated_at 
BEFORE UPDATE ON assets 
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();

