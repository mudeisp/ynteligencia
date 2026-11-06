import test from 'node:test';import assert from 'node:assert/strict';
import {forbiddenRefs,verifyStagingTarget,stagingPoolConfig} from './orulo-v9-staging-guard.mjs';
const t={mode:'staging',name:'ynteligencia-v9-staging',organizationId:'xtqvxxncxirpujvxznly',projectRef:'abcdefghijklmnopqrst',host:'db.abcdefghijklmnopqrst.supabase.co',port:5432,database:'postgres',isolationVerified:true,syntheticWritesAuthorized:true,providerEvidenceFile:'reviewed-provider-evidence.json',approvalReference:'owner-approval'};
test('both production refs are rejected even when disguised in another field',()=>{
 for(const ref of forbiddenRefs)for(const patch of [{projectRef:ref},{host:`db.${ref}.supabase.co`},{approvalReference:ref}])assert.throws(()=>verifyStagingTarget({...t,...patch}),/PRODUCTION_TARGET_DENIED/);
});
test('unknown, shared, unapproved or redirected targets fail before connecting',()=>{
 for(const patch of [{name:'shared-preview'},{mode:'production'},{host:'localhost'},{projectRef:null},{database:'shared'},{organizationId:'other'},{isolationVerified:false},{syntheticWritesAuthorized:false},{approvalReference:''},{providerEvidenceFile:''},{port:0}])assert.throws(()=>verifyStagingTarget({...t,...patch}));
 assert.equal(verifyStagingTarget(t),t);
});
test('pool TLS cannot be weakened by DSN query params or ambient PG variables',()=>{
 const c=stagingPoolConfig(t,'orulo_webhook_writer','synthetic','CA');assert.equal(c.ssl.rejectUnauthorized,true);assert.equal(c.ssl.servername,t.host);assert.equal(c.connectionString,undefined);assert.equal(c.host,t.host);assert.equal(c.max,2);
 assert.throws(()=>stagingPoolConfig(t,'service_role','synthetic','CA'),/EXCLUSIVE/);assert.throws(()=>stagingPoolConfig(t,'postgres','','CA'),/EXCLUSIVE/);
});
test('disposable CI target has a distinct guard and cannot be called staging',()=>{
 const c={mode:'disposable-ci',host:'127.0.0.1',database:'orulo_v9_auth_test',port:5432};assert.equal(verifyStagingTarget(c,{ci:true}),c);assert.throws(()=>verifyStagingTarget(c),/ISOLATED/);assert.throws(()=>verifyStagingTarget({...c,host:t.host},{ci:true}),/LOCAL_CI/);
});
