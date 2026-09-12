import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serverEnvironment,blockedCall} from '../scripts/runtime-policy.mjs';
test('live SOAP overrides offline defaults',()=>assert.equal(serverEnvironment('adis',{ADIS_SOAP_ENABLED:''}).ADIS_SOAP_ENABLED,'1'));
test('unsupported coverage never reports a clean negative',async()=>{
 for(const server of ['dd','realestate']) assert.ok(await blockedCall(server,'anything',{},{}));
 assert.ok(await blockedCall('isir','check_ico_insolvency',{},{}));
 assert.equal(await blockedCall('isir','poll_isir_events',{},{}),null);
 assert.ok(await blockedCall('eu-registry','search_company',{},{}));
 assert.ok(await blockedCall('eu-registry','get_company',{country:'GB'},{}));
 assert.ok(await blockedCall('eu-registry','search_company',{country:'PL'},{}));
 assert.equal(await blockedCall('eu-registry','get_company',{country:'PL'},{}),null);
});
test('empty and stale sanctions database cannot produce screening conclusions',async()=>{
 assert.ok(await blockedCall('sanctions','search_person',{},{}));
 const dir=await mkdtemp(join(tmpdir(),'lawoss-policy-'));const db=join(dir,'source.sqlite');await writeFile(db,'fixture');
 try {
  const env={SANCTIONS_DB:db};
  for(const rows of [[],[{ok:0,source_count:5,refreshed_at:Date.now()}],[{ok:1,source_count:0,refreshed_at:Date.now()}],[{ok:1,source_count:5,refreshed_at:1}],[{source:'ofac',ok:1,source_count:5,refreshed_at:Date.now()}]]) assert.ok(await blockedCall('sanctions','search_person',{},env,async()=>rows));
  assert.equal(await blockedCall('sanctions','search_person',{},env,async()=>['eu','ofac'].map(source=>({source,ok:1,source_count:5,refreshed_at:Date.now()}))),null);
 } finally {await rm(dir,{recursive:true});}
});
