-- Local/test only. Mirrors Supabase client roles so grant/RLS tests are meaningful.
CREATE DATABASE bytesac_dev;
CREATE DATABASE bytesac_test;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
