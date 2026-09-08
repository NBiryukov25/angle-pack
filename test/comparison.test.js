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
import { jobSchema } from '../server/schema.js';
import { buildPrompt } from '../server/prompts.js';
import { comparisonPack, DEFAULT_PRESERVATION } from '../public/presets.js';
import { DEFAULT_MODEL } from '../server/models.js';

const fixture=await sharp({create:{width:100,height:160,channels:3,background:'#497961'}}).png().toBuffer();
const compared=['fal-ai/flux-2/edit','fal-ai/qwen-image-edit-plus','fal-ai/wan/v2.2-a14b/image-to-image'];
const spec=(overrides={})=>({mode:'MODEL_COMPARISON',execution:'MOCK',preservation:DEFAULT_PRESERVATION,outputs:comparisonPack(compared,{angle:'RIGHT_3Q',framing:'CHEST'}),...overrides});
async function setup(overrides={},transport=()=>{throw new Error('Unexpected API call in mock test');}) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'angle-compare-test-'));
  const config={...getConfig({}),...overrides,dataDir};
  const {app,store}=await createApp(config,transport);const client=request(app);
  const token=(await client.get('/api/config')).body.token;
  const submit=(job,refs=[fixture])=>{let req=client.post('/api/jobs').set('X-Angle-Pack-Token',token).field('spec',JSON.stringify(job));for(let i=0;i<refs.length;i++)req=req.attach('references',refs[i],`photo${i+1}.png`);return req;};
  return {client,store,token,submit,config};
}
async function finish(store,id){for(let i=0;i<300;i++){if(!store.active)return store.get(id);await new Promise(r=>setTimeout(r,20));}throw new Error('Job did not finish');}

test('comparisonPack varies only the model and drops duplicates',()=>{
  const pack=comparisonPack([...compared,'fal-ai/flux-2/edit'],{angle:'RIGHT_3Q',framing:'CHEST'});
  assert.deepEqual(pack.map(o=>o.model),compared,'a repeated model is not a second comparison');
  for(const output of pack){assert.equal(output.angle,'RIGHT_3Q');assert.equal(output.framing,'CHEST');assert.equal(output.sourceIndex,0);}
  assert.equal(comparisonPack(Array(8).fill(0).map((_,i)=>`m${i}`)).length,5,'bounded by the five-output limit');
});
test('a comparison needs at least two different models',()=>{
  assert.throws(()=>jobSchema.parse(spec({outputs:comparisonPack(['fal-ai/flux-2/edit'])})),/at least 2 different models/);
  assert.throws(()=>jobSchema.parse(spec({outputs:[{angle:'FRONT',framing:'FACE'},{angle:'FRONT',framing:'FACE'}]})),/at least 2 different models/);
  assert.ok(jobSchema.parse(spec({outputs:[{angle:'FRONT',framing:'FACE'},{angle:'FRONT',framing:'FACE',model:'fal-ai/qwen-image'}]})),'the session default counts as one of the two');
});
test('every compared output receives an identical prompt',()=>{
  const job=jobSchema.parse(spec());
  const prompts=job.outputs.map(output=>buildPrompt(job,output));
  assert.equal(new Set(prompts).size,1,'the model must be the only variable');
  assert.match(prompts[0],/MODEL COMPARISON/);
  assert.match(prompts[0],/add no stylistic interpretation of your own/);
});
test('a live comparison calls each model once and files every result separately',async()=>{
  const endpoints=[];
  const transport=fakeFal(fixture);const rawFetch=transport.fetch;
  transport.fetch=(url,options={})=>{if(options.method==='POST')endpoints.push(url.replace('https://queue.fal.run/',''));return rawFetch(url,options);};
  const {submit,store,config}=await setup({mockOnly:false,apiKey:'fake'},transport);
  const job=await finish(store,(await submit(spec({execution:'LIVE'}))).body.id);
  assert.equal(job.status,'complete');
  assert.deepEqual(endpoints,compared,'one request per compared model, in order');
  assert.equal(transport.count,3);
  const names=job.outputs.map(o=>o.generatedFilename);
  assert.equal(new Set(names).size,3);
  for(const name of names)assert.match(name,/_(flux-2-edit|qwen-image-edit-plus|wan-v2-2-a14b-image-to-image)\.png$/,`${name} must name its model`);
  const manifest=JSON.parse(await readFile(path.join(config.dataDir,job.id,'manifest.json'),'utf8'));
  assert.deepEqual(manifest.comparison.map(c=>c.model),compared);
  assert.deepEqual(manifest.comparison.map(c=>c.family),['FLUX','Qwen','WAN']);
  assert.deepEqual(manifest.comparison.map(c=>c.output),[1,2,3]);
  assert.deepEqual(manifest.outputs.map(o=>o.generationParameters.model),compared);
});
test('one failing model leaves the other comparisons intact and is not retried',async()=>{
  const transport=fakeFal(fixture,{failAt:2});
  const {submit,store}=await setup({mockOnly:false,apiKey:'fake'},transport);
  const job=await finish(store,(await submit(spec({execution:'LIVE'}))).body.id);
  assert.equal(transport.count,3);
  assert.equal(job.status,'partial');
  assert.deepEqual(job.outputs.map(o=>o.status),['complete','failed','complete']);
  assert.match(job.outputs[1].error,/No automatic resubmission/);
});
test('a mock comparison costs nothing and still labels each model',async()=>{
  const {submit,store}=await setup();
  const job=await finish(store,(await submit(spec())).body.id);
  assert.equal(job.status,'complete');
  assert.deepEqual(job.outputs.map(o=>o.generationParameters.apiRequests),[0,0,0]);
  assert.deepEqual(job.outputs.map(o=>o.generationParameters.modelLabel),['FLUX.2 [dev] Edit','Qwen Image Edit Plus','WAN 2.2 A14B Image to Image']);
  assert.ok(job.outputs.every(o=>o.generatedFilename.startsWith('mock_angle_')));
  assert.equal(job.comparison[0].model,DEFAULT_MODEL);
});
