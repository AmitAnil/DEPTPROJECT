#!/usr/bin/env bash
# Tests the migrations and row level security on a throwaway PostgreSQL database.
#   PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=deptdocs_migration_test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }
run -f tests/supabase_stub.sql
run -f tests/legacy_schema.sql
for f in migrations/*.sql; do echo "applying $f"; run -f "$f"; done
for f in migrations/*.sql; do echo "re-applying $f (must be idempotent)"; run -f "$f"; done
run -f tests/rls_test.sql
psql -q -d postgres -c "drop database $DB"
echo "All migration/RLS tests passed."
