// Real local PostgreSQL only. Never set PGHOST to a remote/Production database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const database = `inventory_summary_test_${process.pid}`;
let project;
function psql(sql, db = database) { return execFileSync("psql", ["-X", "-q", "-d", db, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function read() { return JSON.parse(psql("select public.mia_inventory_summary_v1()")); }
function group(data, bedrooms = 1, band = "UP_TO_500K", name = "Pinheiros") { return data.groups.find(g => g.bedrooms_min === bedrooms && g.price_band === band && g.neighborhood === name); }
function insert(values) { psql(`insert into public.properties(source,neighborhood,bedrooms,price,active) values ${values}`); }
test.before(async () => {
  if (process.env.PGHOST && !["localhost", "127.0.0.1"].includes(process.env.PGHOST) && !process.env.PGHOST.startsWith("/")) throw new Error("Local PostgreSQL required");
  project = (await import("./inventory-summary.js")).projectInventorySummary;
  psql(`create database ${database}`, "postgres");
  psql(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  create table public.properties(id uuid primary key default gen_random_uuid(),external_id text unique,source text,title text,neighborhood text,city text default 'São Paulo',state text default 'SP',price numeric,bedrooms integer,active boolean default true,raw_data jsonb);
  alter table public.properties enable row level security;
  grant select on public.properties to service_role;`);
  execFileSync("psql", ["-X", "-d", database, "-v", "ON_ERROR_STOP=1", "-f", "supabase/inventory_summary.sql"], { stdio: "pipe" });
});
test.after(() => { psql(`drop database if exists ${database}`, "postgres"); });
test.beforeEach(() => psql("truncate public.properties"));

test("only active=true and finite positive price in scope count", () => {
  insert("('novos','Pinheiros',2,400000,true),('usados','Pinheiros',2,450000,true),('novos','Pinheiros',2,400000,false),('novos','Pinheiros',2,400000,null),('novos','Pinheiros',2,0,true),('novos','Pinheiros',2,-1,true),('novos','Pinheiros',2,null,true),('novos','Pinheiros',2,'NaN',true),('novos','Pinheiros',2,'Infinity',true)");
  assert.deepEqual(group(read()), { neighborhood: "Pinheiros", bedrooms_min: 1, price_band: "UP_TO_500K", available_properties: 2, new_count: 1, used_count: 1 });
});
test("neighborhood case/accent/space normalization uses approved canonical labels only", () => {
  insert("('novos','  pinheiros  ',1,420000,true),('usados','Butanta',1,450000,true),('novos','Butantã',1,450000,true),('novos','person@example.test',1,450000,true),('novos',null,1,450000,true)");
  const result = read(); assert.equal(group(result).available_properties, 1); assert.equal(group(result, 1, 'UP_TO_500K', 'Butantã').available_properties, 2); assert.equal(result.groups.some(g => g.neighborhood.includes('@')), false);
});
test("minimum bedrooms expand cumulatively, never count unknown/zero", () => {
  insert("('novos','Pinheiros',2,400000,true),('usados','Pinheiros',5,400000,true),('novos','Pinheiros',0,400000,true),('novos','Pinheiros',null,400000,true)");
  const result = read(); assert.equal(group(result, 1).available_properties, 2); assert.equal(group(result, 2).available_properties, 2); assert.equal(group(result, 3).available_properties, 1); assert.equal(group(result, 5).available_properties, 1);
});
test("exact consumer price bands include the ceiling and remain cumulative", () => {
  insert("('novos','Pinheiros',1,500000,true),('usados','Pinheiros',1,1000000,true),('novos','Pinheiros',1,2000000,true),('novos','Pinheiros',1,2000000.01,true)");
  const result = read(); assert.equal(group(result).available_properties, 1); assert.equal(group(result, 1, 'UP_TO_1M').available_properties, 2); assert.equal(group(result, 1, 'UP_TO_2M').available_properties, 3);
});
test("unknown source/city/state are outside the documented summary scope", () => {
  insert("('novos','Pinheiros',1,400000,true),('orulo','Pinheiros',1,400000,true),('Nonstop','Pinheiros',1,400000,true),(null,'Pinheiros',1,400000,true)");
  psql("insert into public.properties(source,neighborhood,bedrooms,price,city,state) values ('usados','Pinheiros',1,400000,'Rio','RJ')");
  const result = read(); assert.equal(group(result).available_properties, 1); assert.equal(group(result).new_count + group(result).used_count, group(result).available_properties);
});
test("primary key/external_id constraints define duplicates; separate real IDs remain separate records", () => {
  psql("insert into public.properties(id,external_id,source,neighborhood,bedrooms,price) values ('11111111-1111-4111-8111-111111111111','orulo:one','novos','Pinheiros',1,400000)");
  assert.throws(() => psql("insert into public.properties(id,source) values ('11111111-1111-4111-8111-111111111111','novos')"));
  assert.throws(() => psql("insert into public.properties(external_id,source) values ('orulo:one','novos')"));
  insert("('novos','Pinheiros',1,400000,true)"); assert.equal(group(read()).available_properties, 2);
});
test("empty inventory returns complete true, zero groups and correct UTC schema", () => {
  const result = read(); assert.equal(result.complete, true); assert.deepEqual(result.groups, []); assert.match(result.generated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); assert.ok(project(result));
});
test("actual SQL result projects safely, deterministic ordering, no individual fields", () => {
  insert("('usados','Brooklin',2,900000,true),('novos','Pinheiros',1,400000,true)");
  psql("update public.properties set title='private@example.test',raw_data='{" + '"phone":"private-phone"' + "}'::jsonb");
  const first = read(); const second = read(); assert.deepEqual(first.groups, second.groups); const output = project(first); assert.ok(output);
  assert.equal(JSON.stringify(output).includes('private'), false); assert.equal(JSON.stringify(output).includes('external_id'), false); assert.ok(output.groups.every(g => g.destination_url.startsWith('https://app.yincorp.com.br/?modo=explorar')));
});
test("service_role can GET RPC but PUBLIC/anon/authenticated cannot execute", () => {
  assert.equal(JSON.parse(psql("set role service_role; select public.mia_inventory_summary_v1()" )).complete, true);
  for (const role of ['anon','authenticated']) assert.throws(() => psql(`set role ${role}; select public.mia_inventory_summary_v1()`));
  assert.equal(psql("select has_function_privilege('anon','public.mia_inventory_summary_v1()','execute')"), 'f');
  assert.equal(psql("select prosecdef from pg_proc where oid='public.mia_inventory_summary_v1()'::regprocedure"), 'f');
});
test("SQL query error cannot yield a partial complete snapshot", () => {
  assert.throws(() => psql("begin; alter table public.properties rename column price to missing_price; select public.mia_inventory_summary_v1(); rollback;"));
  assert.equal(read().complete, true);
});
test("installation is repeatable without altering inventory or policies", () => {
  insert("('novos','Pinheiros',1,400000,true)"); const before = read();
  execFileSync("psql", ["-X", "-d", database, "-v", "ON_ERROR_STOP=1", "-f", "supabase/inventory_summary.sql"], { stdio: "pipe" });
  assert.deepEqual(read().groups, before.groups); assert.equal(psql("select count(*) from pg_policies where tablename='properties'"), '0');
});


test("local HTTP endpoint returns the real PostgreSQL aggregate with no raw catalog", async () => {
  const http = require("node:http");
  const handler = (await import("./api/search-properties.js")).default;
  insert("('novos','Pinheiros',1,400000,true),('usados','Pinheiros',2,480000,true)");
  const originalFetch = global.fetch;
  const env = { MIA_READ_TOKEN: "local-summary-token", MIA_READ_TOKEN_PREVIOUS: undefined, SUPABASE_URL: "https://inventory-local.test", SUPABASE_SERVICE_ROLE_KEY: "local-service-role", SUPABASE_SECRET_KEY: undefined };
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  let reads = 0;
  global.fetch = async (url, options) => {
    assert.equal(String(url), "https://inventory-local.test/rest/v1/rpc/mia_inventory_summary_v1");
    assert.equal(options.method, "GET"); reads++;
    return Response.json(JSON.parse(psql("set role service_role; select public.mia_inventory_summary_v1()")));
  };
  const server = http.createServer((req, res) => {
    req.query = Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    handler(req, res).catch(() => { res.statusCode = 500; res.end(); });
  });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/search-properties?action=inventory-summary`;
    const unauthorized = await originalFetch(url); assert.equal(unauthorized.status, 401);
    const response = await originalFetch(url, { headers: { Authorization: "Bearer local-summary-token" } });
    assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /application\/json/);
    const output = await response.json(); assert.equal(output.schema_version, "ynt-inventory-summary/1"); assert.equal(output.complete, true); assert.equal(group(output).available_properties, 2);
    for (const forbidden of ["property_id", "external_id", "raw_data", "title", "visitor_id", "local-service-role"]) assert.equal(JSON.stringify(output).includes(forbidden), false);
    assert.equal(reads, 1);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); global.fetch = originalFetch;
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
