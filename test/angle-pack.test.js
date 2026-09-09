import { fakeFal } from './fake-fal.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { getConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { editImage, cropImage, outpaintInputs } from '../server/imaging.js';
import { buildPrompt } from '../server/prompts.js';
import { jobSchema } from '../server/schema.js';
import { autoPack, DEFAULT_PRESERVATION } from '../public/presets.js';

const fixture=await sharp({create:{width:100,height:160,channels:3,background:'#497961'}}).png().toBuffer();
const spec=(overrides={})=>({mode:'GENERATIVE_ANGLE',execution:'MOCK',preservation:DEFAULT_PRESERVATION,outputs:[{angle:'LEFT_3Q',framing:'WAIST',sourceIndex:0,custom:''}],...overrides});
async function setup(overrides={},transport=()=>{throw new Error('Unexpected API call in mock test');}) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'angle-pack-test-'));
  const config={...getConfig({}),...overrides,dataDir};
  const {app,store}=await createApp(config,transport);const client=request(app);
  const token=(await client.get('/api/config')).body.token;
  const submit=(job,refs=[fixture])=>{let req=client.post('/api/jobs').set('X-Angle-Pack-Token',token).field('spec',JSON.stringify(job));for(let i=0;i<refs.length;i++)req=req.attach('references',refs[i],`photo${i+1}.png`);return req;};
  return {client,store,token,submit,config};
}
async function finish(store,id){for(let i=0;i<300;i++){if(!store.active)return store.get(id);await new Promise(r=>setTimeout(r,20));}throw new Error('Job did not finish');}

test('defaults disable live mode and use the centrally configured current model',()=>{
  const c=getConfig({});assert.equal(c.mockOnly,true);assert.equal(c.model,'fal-ai/flux-2/edit');assert.equal(c.quality,'standard');
});
test('automatic packs have distinct views and use reference labels to avoid repetitions',()=>{
  assert.deepEqual(autoPack(5).map(o=>o.angle),['LEFT_3Q','RIGHT_3Q','PROFILE_RIGHT','REAR_3Q_LEFT','HIGH']);
  const avoided=['LEFT_3Q','RIGHT_3Q'];const pack=autoPack(5,avoided);assert.equal(pack.length,5);assert.ok(pack.every(o=>!avoided.includes(o.angle)));
});
test('schema bounds costs, rejects missing custom positions, and enforces crop boundaries',()=>{
  assert.throws(()=>jobSchema.parse(spec({outputs:Array(6).fill(spec().outputs[0])})));
  assert.throws(()=>jobSchema.parse(spec({outputs:[{angle:'CUSTOM',framing:'FACE',custom:''}]})));
  assert.throws(()=>jobSchema.parse(spec({outputs:[{angle:'FRONT',framing:'FACE',crop:{x:.8,y:0,w:.8,h:1}}]})));
});
test('local crop retains exact source pixels without resampling',async()=>{
  const pixels=Buffer.alloc(100*160*3);for(let i=0;i<pixels.length;i++)pixels[i]=i%251;
  const source=await sharp(pixels,{raw:{width:100,height:160,channels:3}}).png().toBuffer();
  const result=await cropImage(source,{crop:{x:.2,y:.25,w:.5,h:.5}});
  assert.deepEqual(result.rectangle,{left:20,top:40,width:50,height:80});
  const actual=await sharp(result.buffer).raw().toBuffer();const expected=await sharp(source).extract(result.rectangle).raw().toBuffer();assert.deepEqual(actual,expected);
});
test('outpaint creates equal-size RGBA canvas and mask with editable margins',async()=>{
  const {canvas,mask,placement:p}=await outpaintInputs(fixture,{expansion:2},'1024x1536');
  const c=await sharp(canvas).metadata(),m=await sharp(mask).metadata();assert.equal(c.width,m.width);assert.equal(c.height,m.height);assert.equal(m.channels,4);
  const {data,info}=await sharp(mask).raw().toBuffer({resolveWithObject:true});assert.equal(data[3],0);assert.equal(data[((p.top+1)*info.width+p.left+1)*4+3],255);
});
test('prompt requires true camera reconstruction and all references',()=>{
  const job=jobSchema.parse(spec());const prompt=buildPrompt(job,job.outputs[0]);
  assert.match(prompt,/genuinely new virtual camera position/);assert.match(prompt,/Use every reference/);assert.match(prompt,/SUBJECT'S OWN LEFT/);assert.match(prompt,/PRESERVE_FACE \(HIGH, identity\)/);
});
test('fal adapter uploads all evidence in four inputs and submits exactly one image',async()=>{
  const transport=fakeFal(fixture,{onSubmit:(input,options)=>{assert.equal(input.image_urls.length,4);assert.equal(input.num_images,1);assert.equal(input.output_format,'png');assert.equal(options.headers.Authorization,'Key test-only');assert.match(input.prompt,/contact sheet/);assert.equal('mask' in input,false);}});
  const result=await editImage({...getConfig({}),mockOnly:false,apiKey:'test-only'},Array(5).fill(fixture),'Test',null,transport);
  assert.equal(transport.count,1);assert.equal(transport.uploads.length,4);assert.deepEqual(result.returned.inputMapping,[[0],[1],[2],[3,4]]);assert.ok(result.buffer.length);
});
test('adapter never retries a provider error or echoes upstream text',async()=>{
  const transport=fakeFal(fixture,{failAt:1});await assert.rejects(editImage({...getConfig({}),mockOnly:false},[fixture],'test',null,transport),error=>error.message.includes('429')&&!error.message.includes('SECRET'));assert.equal(transport.count,1);
});
test('five-output mock job persists refs, manifest, gallery files, and one-output revision',async()=>{
  const {client,store,token,submit,config}=await setup();
  const response=await submit(spec({outputs:autoPack(5)}),Array(5).fill(fixture));assert.equal(response.status,202);
  const job=await finish(store,response.body.id);assert.equal(job.status,'complete');assert.equal(job.references.length,5);
  const oldNames=job.outputs.map(o=>o.generatedFilename);assert.ok(oldNames.every(n=>n.startsWith('mock_angle_')));
  const manifest=JSON.parse(await readFile(path.join(config.dataDir,job.id,'manifest.json'),'utf8'));assert.equal(manifest.outputs[0].generationParameters.apiRequests,0);assert.equal(manifest.outputs[0].generationParameters.referenceCount,5);assert.ok(manifest.references[0].sha256);
  assert.equal((await client.get(`/api/sessions/${job.id}/file/${oldNames[0]}`)).status,200);
  assert.equal((await client.get(`/api/sessions/${job.id}/file/.env`)).status,404);
  const regenerated=await client.post(`/api/sessions/${job.id}/outputs/1/regenerate`).set('X-Angle-Pack-Token',token).send({output:{angle:'REAR',framing:'WIDE'},execution:'MOCK'});assert.equal(regenerated.status,202);
  const revised=await finish(store,job.id);assert.equal(revised.outputs[1].history.length,1);assert.match(revised.outputs[1].generatedFilename,/_v2.png$/);assert.equal(revised.outputs[0].generatedFilename,oldNames[0]);assert.equal(revised.outputs[2].generatedFilename,oldNames[2]);
  assert.ok((await readdir(path.join(config.dataDir,job.id))).includes(oldNames[1]));
  const restored=await createApp(config);assert.equal(restored.store.get(job.id).outputs[1].history.length,1);
});
test('live disabled, cross-origin, missing token, too many files, malformed images are rejected',async()=>{
  const {client,token,submit}=await setup();
  assert.equal((await submit(spec({execution:'LIVE'}))).status,400);
  assert.equal((await client.post('/api/jobs')).status,403);
  assert.equal((await client.post('/api/jobs').set('X-Angle-Pack-Token',token).set('Origin','https://example.com')).status,403);
  assert.equal((await client.get('/api/config').set('Host','attacker.test')).status,403);
  assert.equal((await submit(spec(),Array(6).fill(fixture))).status,400);
  assert.notEqual((await submit(spec(),[Buffer.from('not an image')])).status,202);
});
test('crop mode in LIVE selection still makes no API calls; outpaint mock saves masks',async()=>{
  const {submit,store}=await setup();
  const cropped=await submit(spec({mode:'CROP_ZOOM',execution:'LIVE'}));assert.equal(cropped.status,202);const cropJob=await finish(store,cropped.body.id);assert.equal(cropJob.status,'complete');assert.equal(cropJob.outputs[0].generationParameters.apiRequests,0);
  const padded=await submit(spec({mode:'OUTPAINT_ZOOM'}));const paintJob=await finish(store,padded.body.id);assert.equal(paintJob.status,'complete');assert.ok(paintJob.outputs[0].outpaint.maskFile);
});
test('fake LIVE outpaint packs canvas and every reference without unsupported mask',async()=>{
  const transport=fakeFal(fixture,{onSubmit:input=>{assert.equal(input.image_urls.length,4);assert.equal('mask' in input,false);}});
  const {submit,store}=await setup({mockOnly:false,apiKey:'fake'},transport);
  const response=await submit(spec({mode:'OUTPAINT_ZOOM',execution:'LIVE'}),Array(5).fill(fixture));const job=await finish(store,response.body.id);assert.equal(job.status,'complete');assert.equal(transport.count,1);assert.deepEqual(job.outputs[0].returnedParameters.inputMapping,[[0],[1],[2],[3,4,5]]);
});
test('partial provider failure retains successful outputs and does not retry',async()=>{
  const transport=fakeFal(fixture,{failAt:2});const {submit,store}=await setup({mockOnly:false,apiKey:'fake'},transport);
  const response=await submit(spec({execution:'LIVE',outputs:autoPack(3)}));const job=await finish(store,response.body.id);
  assert.equal(transport.count,3);assert.equal(job.status,'partial');assert.deepEqual(job.outputs.map(o=>o.status),['complete','failed','complete']);
});
test('server restart marks an unfinished request interrupted without resubmitting',async()=>{
  const {submit,store,config}=await setup();const response=await submit(spec());const job=await finish(store,response.body.id);
  const interrupted=structuredClone(job);interrupted.status='running';interrupted.outputs[0].status='running';
  await writeFile(path.join(config.dataDir,job.id,'manifest.json'),JSON.stringify(interrupted));
  const restored=await createApp(config,()=>{throw new Error('Must never resubmit on restart');});
  assert.equal(restored.store.get(job.id).status,'interrupted');assert.equal(restored.store.get(job.id).outputs[0].status,'interrupted');assert.equal(restored.store.active,false);
});
