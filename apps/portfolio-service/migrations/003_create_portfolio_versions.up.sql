-- Portfolio versions table
CREATE TABLE portfolio_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID,
    
    CONSTRAINT portfolio_versions_version_check CHECK (version_number > 0),
    UNIQUE(portfolio_id, version_number)
);

-- Indexes
CREATE INDEX idx_portfolio_versions_portfolio_id ON portfolio_versions(portfolio_id);
CREATE INDEX idx_portfolio_versions_version ON portfolio_versions(portfolio_id, version_number DESC);
CREATE INDEX idx_portfolio_versions_created_at ON portfolio_versions(created_at DESC);

-- Foreign key for portfolios.base_version_id (добавляем после создания таблицы)
ALTER TABLE portfolios 
ADD CONSTRAINT fk_portfolios_base_version 
FOREIGN KEY (base_version_id) REFERENCES portfolio_versions(id) ON DELETE SET NULL;

