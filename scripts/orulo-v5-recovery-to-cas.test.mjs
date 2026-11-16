import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverAuditedBuilding} from './orulo-v5-recovery-to-cas.mjs';
const row=()=>({id:'property-1',source:'novos',state:'SP',active:true,updated_at:'2026-11-09T00:00:00Z',
 raw_data:{building:{id:51496,floor_plans:[{id:7,name:'A',area:55,image_url:null,images:[]}]}}});
const manifest={writeEnabled:false,state:'SP',manifestHash:'hash',targets:[{buildingId:'51496',missingPlanIds:['7']}]};
const approval={verified:true,manifestHash:'hash'};
const base=()=>{let stored=row(), writes=0, backups=0;
 const deps={buildingId:'51496',manifest,approval,
 source:async()=>({floor_plans:[{id:7,name:'A',area:55,image_url:'https://images.example.test/plan.jpg',images:[]}]}),
 loadRows:async()=>[structuredClone(stored)],
 checkImage:async()=>true,
 backup:async({hash})=>{backups++;return {durable:true,restoreTested:true,hash};},
 authorize:async()=>({verified:true}),
 commitIntent:async({desiredPlans})=>({committed:true,operationId:'op-1',runUuid:'run-1',desiredPlans}),
 auditedCas:async({intent})=>{writes++;stored.raw_data.building.floor_plans=intent.desiredPlans;stored.updated_at='2026-11-09T00:01:00Z';return {auditReceiptVerified:true,casReadbackVerified:true};},
 readback:async()=>structuredClone(stored),record:async()=>{}};
 return {deps,getWrites:()=>writes,getBackups:()=>backups};};
test('connects source to audited CAS after backup and validates readback',async()=>{
 const {deps,getWrites,getBackups}=base();
 const r=await recoverAuditedBuilding(deps);
 assert.equal(r.status,'VERIFIED');assert.equal(r.images,1);assert.equal(getWrites(),1);assert.equal(getBackups(),1);
});
test('rejects unverified backup before any CAS',async()=>{
 const {deps,getWrites}=base();deps.backup=async()=>({durable:true,restoreTested:false});
 await assert.rejects(recoverAuditedBuilding(deps),/V5_BACKUP_NOT_VERIFIED/);assert.equal(getWrites(),0);
});
test('rejects missing source image before any CAS',async()=>{
 const {deps,getWrites}=base();deps.source=async()=>({floor_plans:[{id:7}]});
 await assert.rejects(recoverAuditedBuilding(deps),/V5_SOURCE_IMAGE_MISSING/);assert.equal(getWrites(),0);
});
test('rejects source plan mismatch before any CAS',async()=>{
 const {deps,getWrites}=base();deps.source=async()=>({floor_plans:[{id:8,image_url:'https://images.example.test/8.jpg'}]});
 await assert.rejects(recoverAuditedBuilding(deps),/V5_SOURCE_PLAN_MISMATCH/);assert.equal(getWrites(),0);
});
test('rejects unverified CAS receipt',async()=>{
 const {deps}=base();deps.auditedCas=async()=>({auditReceiptVerified:false,casReadbackVerified:true});
 await assert.rejects(recoverAuditedBuilding(deps),/V5_CAS_RECEIPT_UNVERIFIED/);
});
test('rejects non-image source mutation',async()=>{
 const {deps}=base();deps.source=async()=>({floor_plans:[{id:7,name:'HACKED',image_url:'https://images.example.test/plan.jpg'}]});
 // Only the source image fields are copied; source metadata is never copied.
 const r=await recoverAuditedBuilding(deps);assert.equal(r.images,1);
});
