import { fakeSegmind } from './fake-segmind.js';
import { fakeFal } from './fake-fal.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { getConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { normalizeReference } from '../server/imaging.js';
import { generateImage, providerFor, providerReady, keyFor } from '../server/provider.js';
import { prepareForTransport, TRANSPORT_BYTE_BUDGET } from '../server/segmind.js';
import { buildPrompt } from '../server/prompts.js';
import { jobSchema } from '../server/schema.js';
import { MODELS, MODEL_IDS, DEFAULT_MODEL, getModel, modelCatalog } from '../server/models.js';
import { DEFAULT_PRESERVATION } from '../public/presets.js';

const out = await sharp({create:{width:64,height:96,channels:3,background:'#402f28'}}).png().toBuffer();
const photo = (w,h) => sharp({create:{width:w,height:h,channels:3,background:'#8a6a55'}}).jpeg({quality:92}).toBuffer();
const SEG = 'segmind/qwen-image-edit-plus';
const NEXT = 'segmind/qwen-image-edit-plus-next-scene';
const live = model => ({...getConfig({}),mockOnly:false,segmindKey:'sk-test-not-real',model});
const job = jobSchema.parse({mode:'GENERATIVE_ANGLE',execution:'LIVE',preservation:DEFAULT_PRESERVATION,referenceAngles:['FRONT'],outputs:[{angle:'PROFILE_LEFT',framing:'WAIST'}]});
const decode = uri => Buffer.from(String(uri).split(',')[1],'base64');

// 6. Model selection routes to Segmind.
test('the default is Segmind Qwen Image Edit Plus and selection routes by provider',()=>{
  assert.equal(DEFAULT_MODEL,SEG);
  assert.equal(getConfig({}).model,SEG);
  assert.equal(getConfig({}).provider,'segmind');
  assert.equal(providerFor(SEG),'segmind');
  assert.equal(providerFor(NEXT),'segmind');
  assert.equal(providerFor('fal-ai/flux-2/edit'),'fal');
  assert.equal(getConfig({ANGLE_PACK_MODEL:'fal-ai/flux-2/edit'}).provider,'fal','an existing deployment can pin fal');
  assert.equal(getConfig({FAL_IMAGE_MODEL:'fal-ai/flux-2/edit'}).provider,'fal','the legacy variable still works');
  const catalog=modelCatalog().filter(m=>m.provider==='segmind');
  assert.deepEqual(catalog.map(m=>m.id),[SEG,NEXT]);
  assert.deepEqual(catalog.map(m=>m.label),['Qwen Image Edit Plus (Segmind)','Qwen Image Edit Plus - Next Scene (Segmind)']);
  assert.ok(catalog.every(m=>m.family==='Segmind'),'a new family means the picker groups them without a frontend change');
});
test('each provider authenticates with its own key and neither leaks to the browser',async()=>{
  const config=getConfig({SEGMIND_API_KEY:'sk-seg',FAL_KEY:'fal-key'});
  assert.equal(keyFor(config,'segmind'),'sk-seg');
  assert.equal(keyFor(config,'fal'),'fal-key');
  assert.equal(providerReady(getConfig({}),'segmind'),false);
  assert.equal(providerReady(config,'segmind'),true);
  const {app}=await createApp({...config,dataDir:await mkdtemp(path.join(os.tmpdir(),'seg-cfg-'))});
  const body=(await request(app).get('/api/config')).body;
  const serialized=JSON.stringify(body);
  assert.ok(!serialized.includes('sk-seg'),'the Segmind key must never reach the browser');
  assert.ok(!serialized.includes('fal-key'));
  assert.deepEqual(body.providers,{segmind:true,fal:true});
  assert.equal(body.provider,'segmind');
  const health=(await request(app).get('/healthz')).body;
  assert.equal(health.provider,'segmind');assert.equal(health.model,SEG);
  assert.ok(!JSON.stringify(health).includes('sk-seg'));
});

// 1. The original reference is passed correctly.
test('the original reference is carried to Segmind byte for byte',async()=>{
  const reference=await normalizeReference(await photo(1200,1600));
  let input=null;
  const transport=fakeSegmind(out,{onSubmit:b=>{input=b;}});
  const result=await generateImage(live(SEG),[reference],'PROMPT',null,transport,undefined,{});
  assert.equal(transport.count,1);
  assert.equal(transport.calls[0].url,'https://api.segmind.com/v1/qwen-image-edit-plus');
  assert.equal(transport.calls[0].headers['x-api-key'],'sk-test-not-real','Segmind authenticates with x-api-key');
  assert.match(input.image,/^data:image\/png;base64,/,'images travel inline; we have no public URL to offer');
  assert.equal(Buffer.compare(decode(input.image),reference),0,'the carried bytes must be the normalized reference exactly');
  assert.equal('image_2' in input,false,'a single reference fills only the first field');
  assert.equal(result.returned.provider,'segmind');
  assert.equal(result.returned.resizedForTransport,0);
  assert.deepEqual(result.returned.imageFields,['image']);
  assert.ok(result.buffer.length);
});
// 2. Multi-reference images are passed correctly.
test('multiple references fill the documented image fields in order',async()=>{
  const refs=await Promise.all([[900,1200],[901,1200],[902,1200]].map(async ([w,h])=>normalizeReference(await photo(w,h))));
  for(const [model,fields] of [[SEG,['image','image_2','image_3']],[NEXT,['image_1','image_2','image_3']]]) {
    let input=null;
    const transport=fakeSegmind(out,{onSubmit:b=>{input=b;}});
    const result=await generateImage(live(model),refs,'PROMPT',null,transport,undefined,{});
    assert.deepEqual(Object.keys(input).filter(k=>k.startsWith('image')&&k!=='image_format'),fields,`${model} field names`);
    for(let i=0;i<3;i++)assert.equal(Buffer.compare(decode(input[fields[i]]),refs[i]),0,`${model} reference ${i+1} must arrive unchanged`);
    assert.deepEqual(result.returned.inputMapping,[[0],[1],[2]],'three references need no contact sheet');
    assert.equal(result.returned.inputCount,3);
  }
});
test('a fourth reference is contact-sheeted because the endpoint documents only three fields',async()=>{
  const refs=await Promise.all(Array(5).fill(0).map(async(_,i)=>normalizeReference(await photo(900+i,1200))));
  let input=null;
  const transport=fakeSegmind(out,{onSubmit:b=>{input=b;}});
  const result=await generateImage(live(SEG),refs,'PROMPT',null,transport,undefined,{});
  assert.equal(getModel(SEG).maxImages,3);
  assert.deepEqual(Object.keys(input).filter(k=>k.startsWith('image')&&k!=='image_format'),['image','image_2','image_3']);
  assert.deepEqual(result.returned.inputMapping,[[0],[1],[2,3,4]],'no reference is silently dropped');
  assert.equal(Buffer.compare(decode(input.image),refs[0]),0,'the first two still travel untouched');
});
// 3. Source aspect ratio preserved or matched where supported.
test('Edit Plus matches the input frame natively; Next Scene snaps to a documented ratio',async()=>{
  for(const [w,h,expected] of [[3024,4032,'3:4'],[4032,3024,'4:3'],[2048,2048,'1:1'],[1080,1920,'9:16']]) {
    const reference=await normalizeReference(await photo(w,h));
    let editPlus=null,nextScene=null;
    await generateImage(live(SEG),[reference],'P',null,fakeSegmind(out,{onSubmit:b=>{editPlus=b;}}),undefined,{});
    await generateImage(live(NEXT),[reference],'P',null,fakeSegmind(out,{onSubmit:b=>{nextScene=b;}}),undefined,{});
    assert.equal(editPlus.aspect_ratio,'match_input_image',`${w}x${h}: Edit Plus should let the endpoint match the source`);
    assert.equal(nextScene.aspect_ratio,expected,`${w}x${h}: Next Scene must snap to its nearest documented ratio`);
    assert.ok(getModel(NEXT).ratios.includes(nextScene.aspect_ratio));
  }
  // The A2 guarantee holds: the configured frame is never imposed on the source.
  let forced=null;
  await generateImage(live(SEG),[await normalizeReference(await photo(3024,4032))],'P',null,fakeSegmind(out,{onSubmit:b=>{forced=b;}}),undefined,{});
  assert.equal('image_size' in forced,false,'Segmind takes no pixel size');
  assert.notEqual(forced.aspect_ratio,'2:3','the 1024x1536 configured frame must not be forced onto a 3:4 source');
});
// 4. The compact prompt survives intact.
test('the compact camera, identity and garment prompt reaches Segmind unaltered',async()=>{
  const compact=buildPrompt(job,job.outputs[0],{compact:true});
  let input=null;
  await generateImage(live(SEG),[await normalizeReference(await photo(1200,1600))],compact,null,fakeSegmind(out,{onSubmit:b=>{input=b;}}),undefined,{});
  assert.equal(input.prompt,compact,'the prompt must arrive byte for byte');
  assert.match(input.prompt,/^Camera position: Rotate the camera a full 90 degrees/);
  assert.match(input.prompt,/Do NOT reproduce the reference viewpoint/);
  assert.match(input.prompt,/SAME PERSON as the reference/);
  assert.match(input.prompt,/SAME CLOTHING as the reference, as constructed/);
  assert.match(input.prompt,/Binding: FACE, BODY, HAIR, OUTFIT, ACCESSORIES/);
  assert.match(input.prompt,/FINAL CHECK/);
  assert.ok(input.prompt.length/3.6<512,'still inside the encoder budget');
  // Neither endpoint documents these, so none is invented.
  for(const absent of ['negative_prompt','steps','num_inference_steps','guidance_scale','cfg_scale'])
    assert.equal(absent in input,false,`${absent} is not documented for this endpoint`);
  assert.equal(input.image_format,'png');assert.equal(input.base64,false);assert.equal(input.quality,95);
});
test('a documented seed is forwarded and an absent one is not invented',async()=>{
  let withSeed=null,without=null;
  await generateImage(live(SEG),[await normalizeReference(await photo(800,800))],'P',null,fakeSegmind(out,{onSubmit:b=>{withSeed=b;}}),undefined,{seed:12345});
  await generateImage(live(SEG),[await normalizeReference(await photo(800,800))],'P',null,fakeSegmind(out,{onSubmit:b=>{without=b;}}),undefined,{});
  assert.equal(withSeed.seed,12345);
  assert.equal('seed' in without,false);
  assert.equal(getModel(NEXT).build({prompt:'p',images:{},aspect:'1:1'}).lora,'next_scene','Next Scene pins its documented LoRA');
});
// 5. Provider errors are sanitized.
test('Segmind errors are sanitized before reaching the browser',async t=>{
  t.mock.method(console,'error',()=>{});
  const config=live(SEG);
  const leaky=fakeSegmind(out,{status:401,body:{error:`Invalid key ${config.segmindKey}`,message:'unauthorized'}});
  await assert.rejects(generateImage(config,[await normalizeReference(await photo(600,800))],'secret prompt text',null,leaky,undefined,{}),error=>{
    assert.match(error.message,/^Segmind HTTP 401/);
    assert.match(error.message,/Authentication failed or access denied/);
    assert.match(error.message,/No automatic resubmission was made/);
    assert.ok(!error.message.includes(config.segmindKey),'the API key must never appear');
    assert.ok(!error.message.includes('secret prompt text'),'the prompt must never be echoed');
    return true;
  });
  assert.equal(leaky.count,1,'a failed paid call is never retried');
  // Unstructured upstream prose is logged but not surfaced, as with fal.
  const prose=fakeSegmind(out,{status:500,body:'INTERNAL stack trace SECRET'});
  await assert.rejects(generateImage(config,[await normalizeReference(await photo(600,800))],'P',null,prose,undefined,{}),error=>{
    assert.ok(!error.message.includes('SECRET'));
    assert.doesNotMatch(error.message,/Segmind said/);
    return true;
  });
  // A structured message is surfaced, so a failure is diagnosable.
  const explained=fakeSegmind(out,{status:422,body:{error:'Image resolution not supported'}});
  await assert.rejects(generateImage(config,[await normalizeReference(await photo(600,800))],'P',null,explained,undefined,{}),
    /Segmind said: Image resolution not supported/);
  // A non-image success is rejected rather than written to disk as a broken file.
  const wrong=fakeSegmind(out,{contentType:'application/json'});
  await assert.rejects(generateImage(config,[await normalizeReference(await photo(600,800))],'P',null,wrong,undefined,{}),/Expected an image/);
});
// 7. The fal.ai fallback still works.
test('the fal.ai fallback is intact behind the same call',async()=>{
  const reference=await normalizeReference(await photo(1200,1600));
  let input=null;
  const transport=fakeFal(out,{onSubmit:b=>{input=b;}});
  const result=await generateImage({...getConfig({}),mockOnly:false,apiKey:'fal-key',model:'fal-ai/flux-2/edit'},[reference],'PROMPT',null,transport,undefined,{preservation:DEFAULT_PRESERVATION});
  assert.equal(result.returned.provider,'fal.ai');
  assert.equal(result.returned.model,'fal-ai/flux-2/edit');
  assert.equal(input.image_urls.length,1,'fal still uploads and passes URLs');
  assert.equal(input.guidance_scale,3.5,'the fal adapter keeps its own controls');
  assert.deepEqual(input.image_size,{width:1088,height:1440},'A2 source-aware sizing still applies on fal');
  assert.equal(MODEL_IDS.filter(id=>MODELS[id].provider==='fal').length,9,'all nine fal models remain available');
});
test('live submission requires the key of the chosen provider, not any key',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'seg-live-'));
  const config={...getConfig({}),mockOnly:false,segmindKey:'',apiKey:'fal-key',dataDir};
  const {app}=await createApp(config,()=>{throw new Error('no network in this test');});
  const client=request(app);const token=(await client.get('/api/config')).body.token;
  const fixture=await photo(600,800);
  const send=model=>client.post('/api/jobs').set('X-Angle-Pack-Token',token)
    .field('spec',JSON.stringify({mode:'GENERATIVE_ANGLE',execution:'LIVE',model,preservation:DEFAULT_PRESERVATION,outputs:[{angle:'LEFT_3Q',framing:'WAIST'}]}))
    .attach('references',fixture,'p.png');
  const refused=await send(SEG);
  assert.equal(refused.status,400);
  assert.match(refused.body.error,/runs on segmind, and no SEGMIND_API_KEY is configured/);
  assert.ok(!JSON.stringify(refused.body).includes('fal-key'));
  assert.equal((await send('fal-ai/flux-2/edit')).status,202,'the configured fal fallback is still accepted');
});
test('a reference too large to carry inline is reduced in size only, never in shape',async()=>{
  const big=await sharp({create:{width:4000,height:3000,channels:3,background:'#777'}})
    .composite([{input:Buffer.from(`<svg width="4000" height="3000">${Array.from({length:400},(_,i)=>`<circle cx="${(i*97)%4000}" cy="${(i*61)%3000}" r="40" fill="#${(i*7919).toString(16).slice(0,6)}"/>`).join('')}</svg>`)}])
    .png().toBuffer();
  const carried=await prepareForTransport(big);
  if(big.length>TRANSPORT_BYTE_BUDGET) {
    assert.equal(carried.resized,true);
    const meta=await sharp(carried.buffer).metadata();
    assert.ok(Math.max(meta.width,meta.height)<=2048);
    assert.ok(Math.abs(meta.width/meta.height-4000/3000)<0.01,'aspect must be preserved exactly');
  }
  const small=await normalizeReference(await photo(600,800));
  const untouched=await prepareForTransport(small);
  assert.equal(untouched.resized,false);
  assert.equal(Buffer.compare(untouched.buffer,small),0,'a normal photograph is never altered');
});
