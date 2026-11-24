begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('yincorp-studio-books', 'yincorp-studio-books', false, 20971520, array['application/pdf']);

create policy studio_book_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'yincorp-studio-books'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and storage.filename(name) ~ '^[a-f0-9]{64}\.pdf$'
  and (select auth.jwt() #> '{app_metadata,yincorp_studio}') = 'true'::jsonb
);
create policy studio_book_read on storage.objects for select to authenticated using (
  bucket_id = 'yincorp-studio-books'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select auth.jwt() #> '{app_metadata,yincorp_studio}') = 'true'::jsonb
);

create table public.studio_book_extractions (
  owner uuid not null references auth.users on delete cascade,
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  extraction_version integer not null,
  property_id text not null,
  filename text not null,
  status text not null check (status in ('running', 'complete', 'failed')),
  lease uuid not null,
  updated_at timestamptz not null default now(),
  result jsonb,
  primary key (owner, digest, extraction_version)
);
alter table public.studio_book_extractions enable row level security;
revoke all on public.studio_book_extractions from public, anon, authenticated;
grant select, insert, update on public.studio_book_extractions to authenticated;
create policy studio_book_extractions_owner on public.studio_book_extractions for all to authenticated
using (owner = (select auth.uid()) and (select auth.jwt() #> '{app_metadata,yincorp_studio}') = 'true'::jsonb)
with check (owner = (select auth.uid()) and (select auth.jwt() #> '{app_metadata,yincorp_studio}') = 'true'::jsonb);

create function public.studio_claim_book(p_digest text, p_version integer, p_property text, p_filename text, p_lease uuid)
returns setof public.studio_book_extractions
language sql
set search_path = ''
as $$
  insert into public.studio_book_extractions as extraction
    (owner,digest,extraction_version,property_id,filename,status,lease)
  values (auth.uid(),p_digest,p_version,p_property,p_filename,'running',p_lease)
  on conflict (owner,digest,extraction_version) do update
    set lease = p_lease, status = 'running', updated_at = now()
    where extraction.status = 'failed' or
      (extraction.status = 'running' and extraction.updated_at < now() - interval '3 minutes')
  returning *
$$;
revoke all on function public.studio_claim_book(text,integer,text,text,uuid) from public, anon;
grant execute on function public.studio_claim_book(text,integer,text,text,uuid) to authenticated;

commit;
