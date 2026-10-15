-- Reviewed installation script, following this repository's supabase/*.sql convention.
-- Do not apply automatically to Production. No table, policy, extension or inventory writes.
begin;

create or replace function public.mia_inventory_summary_v1()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  with canonical(neighborhood, normalized) as (
    values
      ('Perdizes', 'perdizes'),
      ('Pompeia', 'pompeia'),
      ('Pinheiros', 'pinheiros'),
      ('Vila Madalena', 'vila madalena'),
      ('Lapa', 'lapa'),
      ('Alto da Lapa', 'alto da lapa'),
      ('Barra Funda', 'barra funda'),
      ('Butantã', 'butanta'),
      ('Jaguaré', 'jaguare'),
      ('Sumaré', 'sumare'),
      ('Vila Leopoldina', 'vila leopoldina'),
      ('Alto de Pinheiros', 'alto de pinheiros'),
      ('Rio Pequeno', 'rio pequeno'),
      ('Vila Sônia', 'vila sonia'),
      ('Morumbi', 'morumbi'),
      ('Moema', 'moema'),
      ('Vila Mariana', 'vila mariana'),
      ('Chácara Klabin', 'chacara klabin'),
      ('Brooklin', 'brooklin'),
      ('Brooklin Paulista', 'brooklin paulista'),
      ('Brooklin Novo', 'brooklin novo'),
      ('Campo Belo', 'campo belo'),
      ('Saúde', 'saude'),
      ('Ipiranga', 'ipiranga'),
      ('Paraíso', 'paraiso'),
      ('Aclimação', 'aclimacao'),
      ('Jardins', 'jardins'),
      ('Jardim Paulista', 'jardim paulista'),
      ('Itaim Bibi', 'itaim bibi'),
      ('Vila Nova Conceição', 'vila nova conceicao'),
      ('Santo Amaro', 'santo amaro'),
      ('Campo Grande', 'campo grande'),
      ('Vila Clementino', 'vila clementino'),
      ('Planalto Paulista', 'planalto paulista'),
      ('Mirandópolis', 'mirandopolis'),
      ('Santana', 'santana'),
      ('Tucuruvi', 'tucuruvi'),
      ('Casa Verde', 'casa verde'),
      ('Mandaqui', 'mandaqui'),
      ('Vila Guilherme', 'vila guilherme'),
      ('Vila Maria', 'vila maria'),
      ('Parada Inglesa', 'parada inglesa'),
      ('Jardim São Paulo', 'jardim sao paulo'),
      ('Lauzane Paulista', 'lauzane paulista'),
      ('Limão', 'limao'),
      ('Freguesia do Ó', 'freguesia do o'),
      ('Tremembé', 'tremembe'),
      ('Jaçanã', 'jacana'),
      ('Tatuapé', 'tatuape'),
      ('Mooca', 'mooca'),
      ('Anália Franco', 'analia franco'),
      ('Vila Prudente', 'vila prudente'),
      ('Penha', 'penha'),
      ('Carrão', 'carrao'),
      ('Belém', 'belem'),
      ('Brás', 'bras'),
      ('Água Rasa', 'agua rasa'),
      ('Vila Formosa', 'vila formosa'),
      ('Vila Matilde', 'vila matilde'),
      ('Itaquera', 'itaquera'),
      ('Aricanduva', 'aricanduva'),
      ('Sapopemba', 'sapopemba'),
      ('São Mateus', 'sao mateus')
  ),
  caps(price_band, amount) as (
    values ('UP_TO_500K', 500000::numeric),
           ('UP_TO_1M', 1000000::numeric),
           ('UP_TO_2M', 2000000::numeric)
  ),
  eligible as materialized (
    select p.id, p.source, p.price, p.bedrooms, c.neighborhood
    from public.properties as p
    join canonical as c on c.normalized = lower(regexp_replace(
      normalize(btrim(regexp_replace(p.neighborhood, '\s+', ' ', 'g')), NFD),
      U&'[\0300-\036f]', '', 'g'
    ))
    where p.active is true
      and p.price > 0 and p.price <= 2000000
      and p.source in ('novos', 'usados')
      and p.city = 'São Paulo' and p.state = 'SP'
      and p.bedrooms >= 1
  ),
  grouped as (
    select e.neighborhood, bedrooms_min, caps.price_band,
      count(*) as available_properties,
      count(*) filter (where e.source = 'novos') as new_count,
      count(*) filter (where e.source = 'usados') as used_count
    from eligible as e
    cross join generate_series(1, 5) as bedrooms_min
    join caps on e.price <= caps.amount
    where e.bedrooms >= bedrooms_min
    group by e.neighborhood, bedrooms_min, caps.price_band
  )
  select jsonb_build_object(
    'schema_version', 'ynt-inventory-summary/1',
    'generated_at', to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'city', 'São Paulo', 'state', 'SP',
    'counting_unit', 'active_priced_catalog_entries',
    'complete', true,
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
      'neighborhood', neighborhood, 'bedrooms_min', bedrooms_min, 'price_band', price_band,
      'available_properties', available_properties, 'new_count', new_count, 'used_count', used_count
    ) order by neighborhood collate "C", bedrooms_min, price_band collate "C") from grouped), '[]'::jsonb)
  );
$function$;

revoke all on function public.mia_inventory_summary_v1() from public;
do $acl$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mia_inventory_summary_v1() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.mia_inventory_summary_v1() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mia_inventory_summary_v1() to service_role;
  end if;
end;
$acl$;
commit;
