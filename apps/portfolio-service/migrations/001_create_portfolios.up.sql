-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Portfolios table
CREATE TABLE portfolios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    user_id UUID,
    base_version_id UUID,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT portfolios_name_check CHECK (char_length(name) >= 1)
);

-- Indexes
CREATE INDEX idx_portfolios_user_id ON portfolios(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_portfolios_active ON portfolios(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_portfolios_deleted_at ON portfolios(deleted_at);
CREATE INDEX idx_portfolios_base_version_id ON portfolios(base_version_id) WHERE base_version_id IS NOT NULL;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for portfolios
CREATE TRIGGER update_portfolios_updated_at 
BEFORE UPDATE ON portfolios 
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();

