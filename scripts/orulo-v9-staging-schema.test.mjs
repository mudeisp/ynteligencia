import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createRequire}from'node:module';
const {PGlite}=process.env.PGLITE_MODULE?await import(process.env.PGLITE_MODULE):createRequire(new URL('../test-support/orulo-cas/package.json',import.meta.url))('@electric-sql/pglite');
const sql=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('minimal fresh staging schema installs existing dependencies without data or login activation',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role;');
  await db.exec(sql('test-support/orulo-v9-staging/schema.sql'));
  for(const name of ['20261104093722_orulo_postgres_audit.sql','20261104102956_orulo_paged_snapshots.sql','20261106114525_orulo_webhook_provenance.sql'])await db.exec(sql('supabase/migrations/'+name));
  assert.equal((await db.query('select count(*)::int n from properties')).rows[0].n,0);
  assert.ok((await db.query("select rolcanlogin from pg_roles where rolname in ('orulo_webhook_writer','orulo_provenance_reader')")).rows.every(r=>r.rolcanlogin===false));
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_table_privilege($1,'public.properties','UPDATE') allowed",[role])).rows[0].allowed,false);
 }finally{await db.close();}
});
test('bootstrap refuses existing properties without changing their data',async()=>{
 const db=new PGlite();try{await db.exec('create table public.properties(id int);insert into properties values(1)');await assert.rejects(db.exec(sql('test-support/orulo-v9-staging/schema.sql')),/FRESH_ISOLATED_SCHEMA_REQUIRED/);await db.exec('rollback');assert.equal((await db.query('select id from properties')).rows[0].id,1);}finally{await db.close();}
});
