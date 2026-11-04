-- Stop the audit executor without deleting any evidence or enabling old writes.
begin;
revoke all on function public.orulo_audit_control(text,uuid,bigint,text,jsonb),
 public.orulo_audited_cas(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.orulo_media_cas(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
-- Keep private runs, entries, snapshots, CAS receipts and append-only triggers.
-- Administrative reconciliation remains possible; do not DROP/TRUNCATE history.
notify pgrst,'reload schema';
commit;
