/*
  Migração incremental de ads_visitors.

  Use este arquivo somente se a tabela já existir com declared_intent.
  Banco novo deve aplicar apenas supabase/ads_events.sql.

  Ordem:
  1. Banco vazio: supabase/ads_events.sql
  2. Banco da versão anterior: este arquivo, uma vez.
     Ele copia declared_intent para first e current e remove a coluna antiga.
*/

alter table public.ads_visitors
  add column if not exists first_product text not null default '',
  add column if not exists last_product text not null default '',
  add column if not exists first_declared_intent jsonb,
  add column if not exists current_declared_intent jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ads_visitors'
      and column_name = 'declared_intent'
  ) then
    update public.ads_visitors
    set
      first_declared_intent = coalesce(first_declared_intent, declared_intent),
      current_declared_intent = coalesce(current_declared_intent, declared_intent)
    where declared_intent is not null;

    alter table public.ads_visitors drop column declared_intent;
  end if;
end $$;
