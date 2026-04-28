DROP TABLE IF EXISTS training_jobs;
DROP TABLE IF EXISTS ingestion_log;
DROP TABLE IF EXISTS model_registry;
DROP TABLE IF EXISTS credit_data;
ALTER TABLE portfolios DROP COLUMN IF EXISTS updated_at;
ALTER TABLE portfolios DROP COLUMN IF EXISTS currency;
ALTER TABLE portfolios DROP COLUMN IF EXISTS description;
