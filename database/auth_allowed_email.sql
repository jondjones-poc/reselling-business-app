-- Allowed Google sign-in emails + roles (managed from Settings → Access by admins).
-- Roles: admin (manage access settings) | user (app access only)
-- Run in Supabase SQL editor or: psql "$DATABASE_URL" -f database/auth_allowed_email.sql

CREATE TABLE IF NOT EXISTS auth_allowed_email (
  id SERIAL PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_allowed_email_email_unique UNIQUE (email),
  CONSTRAINT auth_allowed_email_role_check CHECK (role IN ('admin', 'user'))
);

-- Migrate existing installs (safe to re-run)
ALTER TABLE auth_allowed_email ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user';
ALTER TABLE auth_allowed_email ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auth_allowed_email_role_check'
  ) THEN
    ALTER TABLE auth_allowed_email
      ADD CONSTRAINT auth_allowed_email_role_check CHECK (role IN ('admin', 'user'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auth_allowed_email_email ON auth_allowed_email (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_auth_allowed_email_role ON auth_allowed_email (role);

-- Bootstrap admin (also set AUTH_ADMIN_EMAILS on the API host for env-based admin)
INSERT INTO auth_allowed_email (email, role, updated_at)
VALUES ('jon.jones.home@gmail.com', 'admin', CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE
SET role = 'admin', updated_at = CURRENT_TIMESTAMP;
