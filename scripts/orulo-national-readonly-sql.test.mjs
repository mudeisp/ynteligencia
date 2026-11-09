import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {sha} from './orulo-national-transfer-common.mjs';
import {verifyRows} from './orulo-national-simulate.mjs';
const {PGlite}=createRequire(new URL('../test-support/orulo-cas/package.json',import.meta.url))('@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create table public.properties(id uuid primary key,source text,external_id text,state text,active boolean,price numeric,created_at timestamptz,raw_data jsonb);
 insert into public.properties values('11111111-1111-1111-1111-111111111111','novos','orulo:1:1','SP',true,9007199254740993.25,'2026-11-09T07:00:00Z','{"building_id":"1","building":{"floor_plans":[{"id":"7"}]}}');`);
const sql=name=>readFileSync(new URL('../orulo-national-v2/sql/'+name,import.meta.url),'utf8');
const pageSQL=sql('operational-dry-run-rows.sql').replaceAll('__AFTER__','00000000-0000-0000-0000-000000000000').replaceAll('__LIMIT__','100');

test('real PostgreSQL read exports and global recheck agree, preserving exact canonical bytes for precise numerics',async()=>{
 const pages=await db.exec(pageSQL),records=pages.find(p=>p.rows[0]?.rows)?.rows[0].rows;
 const checks=await db.exec(sql('operational-recheck.sql')),recheck=checks.find(p=>p.rows[0]?.recheck)?.rows[0].recheck;
 assert.equal(records.length,1);assert.equal(sha(records[0].recordCanonical),records[0].recordSha256);
 assert.ok(records[0].recordCanonical.includes('9007199254740993.25'));
 assert.equal(verifyRows(records,recheck).rows.size,1);
 const projection=await db.exec(sql('inventory.sql').replaceAll('__AFTER__','00000000-0000-0000-0000-000000000000').replaceAll('__LIMIT__','100'));
 assert.equal(projection.find(p=>p.rows[0]?.rows).rows[0].rows[0].recordSha256,records[0].recordSha256);
});
test('READ ONLY rejects a mutation, leaving the exported property unchanged',async()=>{
 await db.exec('rollback');
 await db.exec('begin read only');
 await assert.rejects(()=>db.exec("update public.properties set price=0"),/read-only transaction/i);
 await db.exec('rollback');
 assert.equal((await db.query('select price::text p from public.properties')).rows[0].p,'9007199254740993.25');
 await db.close();
});
