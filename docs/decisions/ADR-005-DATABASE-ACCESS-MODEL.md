# ADR-005: Database access model

- **Status:** APPROVED
- **Date:** 2026-09-29
- **Owners:** Backend / Platform
- **Related:** D-017, D-038, D-040; spec §4.2-4.3

## Context
Supabase exposes the `public` schema through its Data API by default and supplies `anon` and `authenticated` roles. Our backend is the only intended database client, and the API process must run with the least privilege that still works. The original spec left open whether a custom role could hold `BYPASSRLS` on Supabase.

## Decision
- All tables live in schema `app`, which is not in the Supabase exposed Data API schemas.
- Default privileges on schema `app` are revoked from PUBLIC, `anon` and `authenticated`; those roles have no grants.
- Roles:
  - `bytesac_api`: runtime; `SELECT/INSERT/UPDATE` on `app` tables, no `DELETE`, no DDL; `audit_events` is append-only for this role.
  - `bytesac_retention`: `DELETE` limited to the purge job's tables; used by the worker only.
  - Migrations run as the schema-owner role (Supabase `postgres`; a superuser locally), used only by `db:migrate`. There is no separate migrator role.
- RLS is enabled on every `app` table with permissive policies scoped to `bytesac_api` and `bytesac_retention`. No role holds `BYPASSRLS`. RLS is defense-in-depth; authorization is enforced in the application layer, with every protected query scoped by the session's `userId`.
- Local docker-compose mirrors the same roles.

## Alternatives considered
- `BYPASSRLS` on `bytesac_api` — depends on what Supabase permits and removes the safety net; rejected.
- RLS with no permissive policies plus a bypassing role — same dependency; rejected.
- Using the `postgres` owner at runtime — over-privileged; rejected.
- Supabase Data API with `authenticated` policies — contradicts the backend-only, backend-session model (ADR-003).

## Consequences
### Positive
- Accidental schema exposure yields no data to Supabase client roles.
- Runtime compromise cannot delete rows or alter schema.

### Negative / trade-offs
- Policies must be maintained with each new table.
- Retention deletes need a separate credential.

### Security, financial and operational impact
- Three connection strings: runtime, migrations (schema owner), retention. Credentials are never committed.

## Migration / rollout
Supabase operator steps: create the roles and set their passwords, keep `app` out of the exposed Data API schemas, confirm `anon`/`authenticated` have no privileges on `app`, and run `db:migrate` as `postgres`.

## Validation
Tests confirm the runtime role cannot `DELETE` or run DDL, `anon`/`authenticated` cannot read `app` tables, cross-user access via the API returns 404, and the retention role can purge only eligible tables.

## Open questions
- Audit-event retention (7 years proposed) is OPEN pending compliance review (D-040).
