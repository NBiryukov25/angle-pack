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
import { packEvidence } from '../server/fal.js';
import { outpaintInputs } from '../server/imaging.js';
import { buildPrompt } from '../server/prompts.js';
import { jobSchema } from '../server/schema.js';
import { MODELS, MODEL_IDS } from '../server/models.js';
import { MODES, MODE_KEYS, DEFAULT_PRESERVATION } from '../public/presets.js';

const fixture=await sharp({create:{width:100,height:160,channels:3,background:'#497961'}}).png().toBuffer();
const spec=(overrides={})=>({mode:'GENERATIVE_ANGLE',execution:'MOCK',preservation:DEFAULT_PRESERVATION,outputs:[{angle:'LEFT_3Q',framing:'WAIST',sourceIndex:0,custom:''}],...overrides});
const textModels=MODEL_IDS.filter(id=>MODELS[id].kind==='text');
const singleInput=MODEL_IDS.filter(id=>MODELS[id].kind==='edit'&&MODELS[id].maxImages===1);
async function setup(overrides={},transport=()=>{throw new Error('Unexpected API call in mock test');}) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'angle-refinput-test-'));
  const config={...getConfig({}),...overrides,dataDir};
  const {app,store}=await createApp(config,transport);const client=request(app);
  const token=(await client.get('/api/config')).body.token;
  const submit=(job,refs=[fixture,fixture])=>{let req=client.post('/api/jobs').set('X-Angle-Pack-Token',token).field('spec',JSON.stringify(job));for(let i=0;i<refs.length;i++)req=req.attach('references',refs[i],`photo${i+1}.png`);return req;};
  return {client,store,token,submit,config};
}
async function finish(store,id){for(let i=0;i<300;i++){if(!store.active)return store.get(id);await new Promise(r=>setTimeout(r,20));}throw new Error('Job did not finish');}

// (a) An outpaint canvas is the image being extended, not evidence about it.
test('a single-input endpoint receives the outpaint canvas itself, never a contact sheet of it',async()=>{
  const {canvas}=await outpaintInputs(fixture,{expansion:1.6},'1024x1536');
  const inputs=[canvas,fixture,fixture];
  const packed=await packEvidence(inputs,1,true);
  assert.equal(packed.buffers.length,1);
  assert.deepEqual(packed.mapping,[[0]],'the canvas must be the whole input');
  assert.deepEqual(packed.omitted,[1,2],'the references it could not carry are reported');
  assert.deepEqual(await sharp(packed.buffers[0]).raw().toBuffer(),await sharp(canvas).raw().toBuffer(),'the canvas must be sent unaltered');
  // Endpoints that take several images still keep the canvas first and pack the rest.
  for(const limit of [2,3,4]) {
    const wide=await packEvidence(inputs,limit,true);
    assert.deepEqual(wide.mapping[0],[0],`limit ${limit} must keep the canvas separate`);
    assert.deepEqual(wide.omitted,[],`limit ${limit} loses no reference`);
    assert.deepEqual(wide.mapping.flat(),[0,1,2],`limit ${limit} keeps every input`);
  }
});
test('without a privileged first input the packing is unchanged',async()=>{
  const packed=await packEvidence([fixture,fixture,fixture],1);
  assert.deepEqual(packed.mapping,[[0,1,2]],'a plain edit still keeps every view in one sheet');
  assert.deepEqual(packed.omitted,[]);
  assert.deepEqual((await packEvidence(Array(5).fill(fixture),4)).mapping,[[0],[1],[2],[3,4]]);
});
test('a live outpaint on a single-input model sends one image and says so in the prompt',async()=>{
  for(const model of singleInput) {
    let input=null;
    const transport=fakeFal(fixture,{onSubmit:body=>{input=body;}});
    const {submit,store}=await setup({mockOnly:false,apiKey:'fake'},transport);
    const job=await finish(store,(await submit(spec({mode:'OUTPAINT_ZOOM',execution:'LIVE',model}))).body.id);
    assert.equal(job.status,'complete',`${model}: ${job.outputs[0].error||''}`);
    assert.equal(transport.uploads.length,1,`${model} uploads only the canvas`);
    assert.equal(input.image_url,'https://fal.media/ref1.png');
    assert.match(input.prompt,/only the expanded canvas was sent/,`${model} must not claim references it never got`);
    assert.doesNotMatch(input.prompt,/contact sheet/);
    const returned=job.outputs[0].returnedParameters;
    assert.deepEqual(returned.inputMapping,[[0]]);
    assert.deepEqual(returned.omittedInputs,[1,2],`${model} records the omission in the manifest`);
    assert.equal(returned.inputCount,1);
  }
});
test('a multi-input outpaint still carries every reference and no omission',async()=>{
  let input=null;
  const transport=fakeFal(fixture,{onSubmit:body=>{input=body;}});
  const {submit,store}=await setup({mockOnly:false,apiKey:'fake'},transport);
  const job=await finish(store,(await submit(spec({mode:'OUTPAINT_ZOOM',execution:'LIVE'}),Array(5).fill(fixture))).body.id);
  assert.equal(job.status,'complete');
  assert.equal(input.image_urls.length,4);
  assert.deepEqual(job.outputs[0].returnedParameters.inputMapping,[[0],[1],[2],[3,4,5]]);
  assert.deepEqual(job.outputs[0].returnedParameters.omittedInputs,[]);
  assert.match(input.prompt,/contact sheet/);
});

// (b) A text-to-image endpoint gets no image, so it must get no talk of images.
test('a text-only model receives a prompt that never mentions references',()=>{
  const job=jobSchema.parse(spec({model:'fal-ai/qwen-image',outputs:[{angle:'LEFT_3Q',framing:'WAIST'}],referenceAngles:['FRONT']}));
  const text=buildPrompt(job,job.outputs[0],{usesReferences:false});
  for(const forbidden of [/reference photographs as evidence/i,/Use every reference/i,/PRESERVE_/,/Reference view labels/i,/from the references/i])
    assert.doesNotMatch(text,forbidden,`${forbidden} must not reach an endpoint with no image input`);
  assert.match(text,/No reference photograph is sent to this endpoint/);
  assert.match(text,/Camera position: Rotate the camera approximately 45 degrees/,'the requested view survives');
  assert.match(text,/Requested framing: Waist-up portrait/);
  assert.match(text,/Produce ONE photograph/);
  const withReferences=buildPrompt(job,job.outputs[0]);
  assert.match(withReferences,/reference photographs as evidence/,'the default is unchanged');
  assert.ok(text.length<withReferences.length/2,'the reference-free prompt is far shorter');
});
test('the direction and session notes still reach a text-only model',()=>{
  const job=jobSchema.parse(spec({mode:'MODEL_COMPARISON',notes:'shot on a 50mm lens',outputs:[
    {angle:'FRONT',framing:'FACE',custom:'standing on a beach at dawn'},
    {angle:'FRONT',framing:'FACE',model:'fal-ai/qwen-image'}]}));
  const text=buildPrompt(job,job.outputs[0],{usesReferences:false});
  assert.match(text,/Direction for this output: standing on a beach at dawn/);
  assert.match(text,/Additional session instructions: shot on a 50mm lens/);
});
test('the job store picks the prompt from the resolved model, not the mode',async()=>{
  const transport=fakeFal(fixture,{result:{image:{url:'https://fal.media/result.png'},seed:4}});
  const {submit,store}=await setup({mockOnly:false,apiKey:'fake'},transport);
  const outputs=[{angle:'LEFT_3Q',framing:'WAIST'},{angle:'LEFT_3Q',framing:'WAIST',model:'fal-ai/wan/v2.2-a14b/text-to-image'}];
  const job=await finish(store,(await submit(spec({mode:'MODEL_COMPARISON',execution:'LIVE',outputs}))).body.id);
  assert.equal(job.status,'complete');
  assert.match(job.outputs[0].prompt,/reference photographs as evidence/,'the image model keeps the full prompt');
  assert.match(job.outputs[1].prompt,/No reference photograph is sent/,'the text model gets the reference-free one');
  assert.equal(job.outputs[1].generationParameters.usesReferences,false);
});

// (c) The modes defined by the references refuse an endpoint that cannot see them.
test('every reference-dependent mode rejects a text-only model, at submission and at regeneration',async()=>{
  const dependent=MODE_KEYS.filter(m=>MODES[m].requiresReferenceInput);
  assert.deepEqual(dependent,['OUTPAINT_ZOOM','MULTI_REFERENCE','COMBINED_IMAGES','ATTRIBUTE_COMBINE']);
  const extras={COMBINED_IMAGES:{custom:'one table'},ATTRIBUTE_COMBINE:{attributes:[{attribute:'FACE',reference:0},{attribute:'OUTFIT',reference:1}]}};
  const {submit,client,token,store}=await setup({mockOnly:false,apiKey:'fake'});
  for(const mode of dependent) {
    const outputs=[{angle:'FRONT',framing:'WAIST',...(extras[mode]||{})}];
    for(const model of textModels) {
      const session=await submit(spec({mode,model,outputs}));
      assert.equal(session.status,400,`${mode} must refuse ${model} as the session model`);
      assert.match(session.body.error,/accepts no image input/);
      assert.match(session.body.error,new RegExp(MODES[mode].label));
      const perOutput=await submit(spec({mode,outputs:[{...outputs[0],model}]}));
      assert.equal(perOutput.status,400,`${mode} must refuse ${model} on a single output`);
    }
    // One session at a time: the store refuses a concurrent submission by design.
    const accepted=await submit(spec({mode,outputs}));
    assert.equal(accepted.status,202,`${mode} still accepts an image model`);
    const job=await finish(store,accepted.body.id);
    const swap=await client.post(`/api/sessions/${job.id}/outputs/0/regenerate`).set('X-Angle-Pack-Token',token)
      .send({execution:'MOCK',output:{...outputs[0],model:textModels[0]}});
    assert.equal(swap.status,400,`${mode} must refuse a text-only model on regeneration too`);
    assert.match(swap.body.error,/accepts no image input/);
  }
});
test('modes that do not depend on the references still allow a text-only model',async()=>{
  const {submit,store}=await setup({mockOnly:false,apiKey:'fake'});
  for(const mode of MODE_KEYS.filter(m=>!MODES[m].requiresReferenceInput&&MODES[m].generative)) {
    const outputs=mode==='MODEL_COMPARISON'
      ? [{angle:'FRONT',framing:'WAIST'},{angle:'FRONT',framing:'WAIST',model:textModels[0]}]
      : [{angle:'FRONT',framing:'WAIST',model:textModels[0]}];
    const accepted=await submit(spec({mode,outputs}));
    assert.equal(accepted.status,202,`${mode} should still permit ${textModels[0]}`);
    await finish(store,accepted.body.id);
  }
});
test('the browser blocks the same combination before anything is submitted',async()=>{
  const local=await readFile('public/app.js','utf8');
  assert.match(local,/rules\.requiresReferenceInput/,'the browser must mirror the server rule');
  assert.match(local,/chosen&&!chosen\.usesReferences/,'it must resolve each output\'s own model');
  const hosted=await readFile(new URL('../../joyce-photos-gallery/assets/angle-pack/app.js',import.meta.url),'utf8').catch(()=>null);
  if(hosted)assert.match(hosted,/rules\.requiresReferenceInput/,'the hosted copy must carry the same rule');
});
