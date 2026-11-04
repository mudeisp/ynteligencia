# Órulo Lote 1: current executor

The current executor uses GitHub Actions + Supabase PostgreSQL. AWS/S3 configuration
is no longer required. See [PostgreSQL audit setup, guarantees, recovery and rollback](orulo-postgres-audit.md).

The workflow is read-only, manual on main, restricted to mudeisp, with the fixed
99-building manifest. No operational write is enabled by this change.
