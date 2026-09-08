import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { getConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { DEFAULT_PRESERVATION } from '../public/presets.js';
const password='test-only-password';
async function setup(){
  const config={...getConfig({RENDER:'true',APP_PASSWORD:password,FAL_KEY:'secret-api-test'}),dataDir:await mkdtemp(path.join(os.tmpdir(),'angle-simple-test-'))};
  const {app,store}=await createApp(config,()=>{throw new Error('No real requests allowed');});
  const client=request(app),req=(method,url)=>client[method](url).set('Host','example.onrender.com').set('X-Forwarded-Proto','https').set('Origin','https://example.onrender.com');
  const login=async()=>{const response=await req('post','/api/auth/login').send({password});assert.equal(response.status,200);const cookie=response.headers['set-cookie'][0].split(';')[0];const c=await req('get','/api/config').set('Cookie',cookie);return {cookie,token:c.body.token};};
  return {req,store,login,client};
}
test('Render needs only a plain password: no disk, hostname or hash configuration',()=>{
  const c=getConfig({RENDER:'true',APP_PASSWORD:password});assert.equal(c.host,'0.0.0.0');assert.equal(c.authEnabled,true);assert.equal(c.dataDir,path.join(os.tmpdir(),'angle-pack'));assert.throws(()=>getConfig({RENDER:'true'}),/APP_PASSWORD/);
});
test('password login protects API and downloads; logout invalidates access',async()=>{
  const {req,login,client}=await setup();assert.equal((await client.get('/healthz')).status,200);
  for(const url of ['/api/config','/api/sessions','/api/sessions/fake/file/file.png','/api/sessions/fake/reference/0'])assert.equal((await req('get',url)).status,401);
  assert.equal((await req('get','/')).status,302);
  assert.equal((await req('post','/api/auth/login').send({password:'wrong'})).status,401);
  const auth=await login();const c=await req('get','/api/config').set('Cookie',auth.cookie);assert.equal(c.status,200);assert.ok(!JSON.stringify(c.body).includes('secret-api-test'));assert.ok(!JSON.stringify(c.body).includes(password));
  assert.equal((await req('post','/api/auth/logout').set('Cookie',auth.cookie).set('X-Angle-Pack-Token',auth.token)).status,200);
  assert.equal((await req('get','/api/config').set('Cookie',auth.cookie)).status,401);
});
test('basic cookie, HTTPS and same-origin protections need no setup',async()=>{
  const {req,login}=await setup();const r=await req('post','/api/auth/login').send({password});for(const flag of ['HttpOnly','Secure','SameSite=Strict'])assert.ok(r.headers['set-cookie'][0].includes(flag));
  const auth=await login();assert.equal((await req('post','/api/jobs').set('Cookie',auth.cookie)).status,403);
  assert.equal((await req('post','/api/auth/login').set('Origin','https://other.test').send({password})).status,403);
  assert.equal((await req('get','/login').set('X-Forwarded-Proto','http').set('Origin','http://example.onrender.com')).status,400);
});
test('hosted mock generation and direct download work without disk or submission IDs',async()=>{
  const {req,login,store}=await setup(),auth=await login();
  const fixture=await sharp({create:{width:80,height:120,channels:3,background:'#567854'}}).png().toBuffer();
  const spec={mode:'GENERATIVE_ANGLE',execution:'MOCK',preservation:DEFAULT_PRESERVATION,outputs:[{angle:'LEFT_3Q',framing:'WAIST'}]};
  const r=await req('post','/api/jobs').set('Cookie',auth.cookie).set('X-Angle-Pack-Token',auth.token).field('spec',JSON.stringify(spec)).attach('references',fixture,'reference.png');assert.equal(r.status,202);
  for(let i=0;i<200&&store.active;i++)await new Promise(resolve=>setTimeout(resolve,20));
  const job=store.get(r.body.id);assert.equal(job.status,'complete');
  const d=await req('get',`/api/sessions/${job.id}/file/${job.outputs[0].generatedFilename}?download=1`).set('Cookie',auth.cookie);assert.equal(d.status,200);assert.match(d.headers['content-disposition'],/attachment/);assert.match(d.headers['content-type'],/image\/png/);
});
test('removed infrastructure is no longer required or present',async()=>{
  for(const file of ['render.yaml','.github/workflows/ci.yml','server/safeguards.js','scripts/password-hash.js'])await assert.rejects(access(file));
});
test('health reports the deployed commit and nothing else',async()=>{
  const {app}=await createApp({...getConfig({RENDER:'true',APP_PASSWORD:password,FAL_KEY:'secret-api-test',RENDER_GIT_COMMIT:'1d4206620825c8b836e3334d49c7d26626fb5e2a'}),dataDir:await mkdtemp(path.join(os.tmpdir(),'angle-health-'))});
  const health=await request(app).get('/healthz');
  assert.equal(health.status,200);
  assert.deepEqual(health.body,{status:'ok',commit:'1d4206620825c8b836e3334d49c7d26626fb5e2a'});
  const serialized=JSON.stringify(health.body);
  for(const secret of ['secret-api-test',password])assert.ok(!serialized.includes(secret));
  const {app:local}=await createApp({...getConfig({}),dataDir:await mkdtemp(path.join(os.tmpdir(),'angle-health-local-'))});
  assert.deepEqual((await request(local).get('/healthz')).body,{status:'ok',commit:'unknown'},'an unknown commit must not break the health check');
});
