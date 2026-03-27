-- eBay seller OAuth (Authorization Code + refresh token) for Fulfillment API.
-- Run once in your Postgres (e.g. Supabase SQL editor).
-- Refresh token is sensitive: restrict DB access, backups, and logs.

CREATE TABLE IF NOT EXISTS ebay_oauth_token (
  integration_key VARCHAR(64) PRIMARY KEY,
  user_name VARCHAR(255) NOT NULL,
  refresh_token TEXT NOT NULL,
  scope TEXT,
  ebay_user_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ebay_oauth_token IS 'Stores eBay user refresh token for sell.fulfillment; access tokens are fetched on demand and cached in memory on the API server.';

COMMENT ON COLUMN ebay_oauth_token.integration_key IS 'Fixed key default for single-seller app; extend if you add multi-account later.';
COMMENT ON COLUMN ebay_oauth_token.user_name IS 'eBay username from Commerce Identity after connect (or placeholder until fetched).';
COMMENT ON COLUMN ebay_oauth_token.refresh_token IS 'OAuth refresh token — treat as secret.';

CREATE INDEX IF NOT EXISTS ebay_oauth_token_updated_at_idx ON ebay_oauth_token (updated_at DESC);
