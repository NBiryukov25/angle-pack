import { fakeFal } from './fake-fal.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { getConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { MODEL_IDS, DEFAULT_MODEL } from '../server/models.js';
import { DEFAULT_PRESERVATION } from '../public/presets.js';

const fixture=await sharp({create:{width:100,height:160,channels:3,background:'#497961'}}).png().toBuffer();
const spec=(overrides={})=>({mode:'GENERATIVE_ANGLE',execution:'MOCK',preservation:DEFAULT_PRESERVATION,outputs:[{angle:'LEFT_3Q',framing:'WAIST',sourceIndex:0,custom:''}],...overrides});
async function setup(overrides={},transport=()=>{throw new Error('Unexpected API call in mock test');}) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'angle-model-test-'));
  const config={...getConfig({}),...overrides,dataDir};
  const {app,store}=await createApp(config,transport);const client=request(app);
  const token=(await client.get('/api/config')).body.token;
  const submit=(job,refs=[fixture])=>{let req=client.post('/api/jobs').set('X-Angle-Pack-Token',token).field('spec',JSON.stringify(job));for(let i=0;i<refs.length;i++)req=req.attach('references',refs[i],`photo${i+1}.png`);return req;};
  return {client,store,token,submit,config};
}
async function finish(store,id){for(let i=0;i<300;i++){if(!store.active)return store.get(id);await new Promise(r=>setTimeout(r,20));}throw new Error('Job did not finish');}

test('/api/config publishes the model catalog and the configured default',async()=>{
  const {client,config}=await setup();
  const body=(await client.get('/api/config')).body;
  assert.equal(body.model,DEFAULT_MODEL);assert.equal(body.model,config.model);
  assert.deepEqual(body.models.map(m=>m.id),MODEL_IDS);
  assert.ok(body.models.every(m=>m.label&&m.family&&m.note));
});
test('a session-level model choice is recorded and sent to that endpoint',async()=>{
  const endpoints=[];
  const transport=fakeFal(fixture);const rawFetch=transport.fetch;
  transport.fetch=(url,options={})=>{if(options.method==='POST')endpoints.push(url);return rawFetch(url,options);};
  const {submit,store,config}=await setup({mockOnly:false,apiKey:'fake'},transport);
  const response=await submit(spec({execution:'LIVE',model:'fal-ai/qwen-image-edit-plus'}));
  const job=await finish(store,response.body.id);
  assert.equal(job.status,'complete');
  assert.equal(job.config.model,'fal-ai/qwen-image-edit-plus');
  assert.deepEqual(endpoints,['https://queue.fal.run/fal-ai/qwen-image-edit-plus']);
  const manifest=JSON.parse(await readFile(path.join(config.dataDir,job.id,'manifest.json'),'utf8'));
  assert.equal(manifest.outputs[0].generationParameters.model,'fal-ai/qwen-image-edit-plus');
  assert.equal(manifest.outputs[0].generationParameters.modelFamily,'Qwen');
  assert.equal(manifest.outputs[0].generationParameters.usesReferences,true);
  assert.equal(manifest.outputs[0].returnedParameters.model,'fal-ai/qwen-image-edit-plus');
});
test('per-output models override the session model and get distinct filenames',async()=>{
  const endpoints=[];
  const transport=fakeFal(fixture);const rawFetch=transport.fetch;
  transport.fetch=(url,options={})=>{if(options.method==='POST')endpoints.push(url.replace('https://queue.fal.run/',''));return rawFetch(url,options);};
  const {submit,store}=await setup({mockOnly:false,apiKey:'fake'},transport);
  const outputs=[
    {angle:'LEFT_3Q',framing:'WAIST',sourceIndex:0,custom:''},
    {angle:'LEFT_3Q',framing:'WAIST',sourceIndex:0,custom:'',model:'fal-ai/qwen-image-edit'},
    {angle:'LEFT_3Q',framing:'WAIST',sourceIndex:0,custom:'',model:'fal-ai/wan/v2.2-a14b/image-to-image'},
  ];
  const job=await finish(store,(await submit(spec({execution:'LIVE',outputs}))).body.id);
  assert.equal(job.status,'complete');
  assert.deepEqual(endpoints,[DEFAULT_MODEL,'fal-ai/qwen-image-edit','fal-ai/wan/v2.2-a14b/image-to-image']);
  const names=job.outputs.map(o=>o.generatedFilename);
  assert.equal(new Set(names).size,3,'each output keeps its own file');
  assert.match(names[0],/^angle_01_left_3q_waist\.png$/);
  assert.match(names[1],/_qwen-image-edit\.png$/);
  assert.match(names[2],/_wan-v2-2-a14b-image-to-image\.png$/);
  assert.deepEqual(job.outputs.map(o=>o.generationParameters.model),[DEFAULT_MODEL,'fal-ai/qwen-image-edit','fal-ai/wan/v2.2-a14b/image-to-image']);
});
test('regeneration can switch one output to another model',async()=>{
  const transport=fakeFal(fixture);
  const {submit,store,client,token}=await setup({mockOnly:false,apiKey:'fake'},transport);
  const job=await finish(store,(await submit(spec({execution:'LIVE'}))).body.id);
  assert.equal(job.outputs[0].generationParameters.model,DEFAULT_MODEL);
  const regenerated=await client.post(`/api/sessions/${job.id}/outputs/0/regenerate`).set('X-Angle-Pack-Token',token)
    .send({execution:'LIVE',output:{angle:'REAR',framing:'WIDE',model:'fal-ai/flux-pro/kontext/max/multi'}});
  assert.equal(regenerated.status,202);
  const revised=await finish(store,job.id);
  assert.equal(revised.outputs[0].generationParameters.model,'fal-ai/flux-pro/kontext/max/multi');
  assert.equal(revised.outputs[0].history.length,1);
  assert.match(revised.outputs[0].generatedFilename,/_flux-pro-kontext-max-multi_v2\.png$/);
});
test('unknown models are rejected and text-only models cannot outpaint',async()=>{
  const {submit}=await setup({mockOnly:false,apiKey:'fake'});
  assert.equal((await submit(spec({model:'fal-ai/made-up'}))).status,400);
  assert.equal((await submit(spec({outputs:[{angle:'FRONT',framing:'FACE',model:'fal-ai/made-up'}]}))).status,400);
  const outpaint=await submit(spec({mode:'OUTPAINT_ZOOM',model:'fal-ai/wan/v2.2-a14b/text-to-image'}));
  assert.equal(outpaint.status,400);assert.match(outpaint.body.error,/accepts no image input/);
  assert.equal((await submit(spec({mode:'GENERATIVE_ANGLE',model:'fal-ai/wan/v2.2-a14b/text-to-image'}))).status,202);
});
test('a text-only model records that no reference reached the provider',async()=>{
  const transport=fakeFal(fixture,{result:{image:{url:'https://fal.media/result.png'},seed:5}});
  const {submit,store}=await setup({mockOnly:false,apiKey:'fake'},transport);
  const job=await finish(store,(await submit(spec({execution:'LIVE',model:'fal-ai/wan/v2.2-a14b/text-to-image'})) ).body.id);
  assert.equal(job.status,'complete');assert.equal(transport.uploads.length,0);
  assert.equal(job.outputs[0].generationParameters.usesReferences,false);
  assert.equal(job.outputs[0].generationParameters.inputImageCount,0);
  assert.equal(job.outputs[0].generationParameters.referenceCount,1,'the session still records the reference it kept');
});
