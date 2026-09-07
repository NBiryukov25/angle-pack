import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {getConfig} from '../server/config.js';
import {ApiClient,uploadForm} from '../public/api-client.js';
import {DEFAULT_PRESERVATION} from '../public/presets.js';
const origin='https://nbiryukov25.github.io';
test('production CORS admits GitHub Pages with bearer auth, upload, regeneration and downloads',async()=>{
  const config={...getConfig({NODE_ENV:'production',APP_PASSWORD:'test-pages-password',FAL_KEY:'test-secret-not-real'}),dataDir:await mkdtemp(path.join(os.tmpdir(),'pages-test-'))};
  const {app,store}=await createApp(config,{upload:()=>{throw new Error('No paid uploads');}});
  const client=request(app),req=(method,url,o=origin)=>client[method](url).set('Host','backend.onrender.com').set('X-Forwarded-Proto','https').set('Origin',o);
  const preflight=await req('options','/api/jobs').set('Access-Control-Request-Method','POST').set('Access-Control-Request-Headers','authorization,content-type,x-angle-pack-token');
  assert.equal(preflight.status,204);assert.equal(preflight.headers['access-control-allow-origin'],origin);assert.match(preflight.headers['access-control-allow-headers'],/Authorization/);assert.equal(preflight.headers['access-control-allow-credentials'],undefined);
  for(const o of ['http://localhost:8080','https://evil.test','null','https://nbiryukov25.github.io.evil.test'])assert.equal((await req('options','/api/jobs',o)).status,403);
  assert.equal((await req('get','/api/config')).status,401);
  const login=await req('post','/api/auth/login').send({password:'test-pages-password'});assert.equal(login.status,200);assert.match(login.body.accessToken,/^[a-f0-9]{64}$/);
  const bearer=`Bearer ${login.body.accessToken}`;
  const settings=await req('get','/api/config').set('Authorization',bearer);assert.equal(settings.status,200);assert.ok(!JSON.stringify(settings.body).includes('test-secret'));
  const token=settings.body.token;
  const image=await sharp({create:{width:80,height:120,channels:3,background:'#854d57'}}).png().toBuffer();
  const spec={mode:'GENERATIVE_ANGLE',execution:'MOCK',preservation:DEFAULT_PRESERVATION,outputs:[{angle:'LEFT_3Q',framing:'WAIST'}]};
  const created=await req('post','/api/jobs').set('Authorization',bearer).set('X-Angle-Pack-Token',token).field('spec',JSON.stringify(spec)).attach('references',image,'fixture.png');assert.equal(created.status,202);
  const finish=async()=>{for(let i=0;i<200&&store.active;i++)await new Promise(r=>setTimeout(r,20));assert.equal(store.active,false);};await finish();
  const job=store.get(created.body.id);assert.equal(job.status,'complete');
  const download=await req('get',`/api/sessions/${job.id}/file/${job.outputs[0].generatedFilename}?download=1`).set('Authorization',bearer);assert.equal(download.status,200);assert.match(download.headers['content-type'],/image\/png/);
  const regen=await req('post',`/api/sessions/${job.id}/outputs/0/regenerate`).set('Authorization',bearer).set('X-Angle-Pack-Token',token).send({execution:'MOCK',output:{angle:'REAR',framing:'WIDE'}});assert.equal(regen.status,202);await finish();assert.equal(job.outputs[0].history.length,1);
  const manifest=await req('get',`/api/sessions/${job.id}/file/manifest.json`).set('Authorization',bearer);assert.equal(manifest.status,200);assert.ok(!JSON.stringify(manifest.body).includes('test-secret'));
  assert.equal((await req('post','/api/auth/logout').set('Authorization',bearer).set('X-Angle-Pack-Token',token)).status,200);assert.equal((await req('get','/api/config').set('Authorization',bearer)).status,401);
});
test('development allows loopback frontend origins',async()=>{
  const {app}=await createApp({...getConfig({}),dataDir:await mkdtemp(path.join(os.tmpdir(),'cors-dev-'))});
  for(const origin of ['http://localhost:8080','http://127.0.0.1:8080']){const r=await request(app).get('/api/config').set('Origin',origin);assert.equal(r.status,200);assert.equal(r.headers['access-control-allow-origin'],origin);}
});
test('browser client reports unavailable backend, expired auth and expired storage',async()=>{
  await assert.rejects(new ApiClient('http://localhost',async()=>{throw new Error('fetch failed');}).request('/api/config'),/Backend unavailable/);
  const c=new ApiClient('https://example.test',async()=>new Response('{}',{status:401}));c.accessToken='old';await assert.rejects(c.request('/api/config'),/Sign in/);assert.equal(c.accessToken,'');
  await assert.rejects(new ApiClient('https://example.test',async()=>new Response('{}',{status:404})).request('/api/sessions/old'),/expired/);
});
test('browser upload preserves multipart boundary and sends runtime bearer only to backend',async()=>{
  const form=uploadForm([{file:new Blob(['test'],{type:'image/png'}),name:'photo.png'}],{mode:'CROP_ZOOM'});
  const c=new ApiClient('https://backend.test/',async(url,options)=>{assert.equal(url,'https://backend.test/api/jobs');assert.equal(options.headers.Authorization,'Bearer runtime-token');assert.equal(options.headers['Content-Type'],undefined);assert.equal(options.credentials,'omit');assert.equal(options.body.getAll('references').length,1);assert.equal(JSON.parse(options.body.get('spec')).mode,'CROP_ZOOM');return Response.json({status:'queued'});});c.accessToken='runtime-token';await c.request('/api/jobs',{method:'POST',body:form});
});
test('browser client contains no provider credentials or SDK',async()=>{const source=await readFile('public/api-client.js','utf8');assert.doesNotMatch(source,/FAL_KEY|OPENAI_API_KEY|@fal-ai/);});
