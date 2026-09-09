import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { getConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { jobSchema, outputIssues } from '../server/schema.js';
import { buildPrompt } from '../server/prompts.js';
import { MODES, MODE_KEYS, ATTRIBUTES, DEFAULT_PRESERVATION } from '../public/presets.js';

const fixture=await sharp({create:{width:100,height:160,channels:3,background:'#497961'}}).png().toBuffer();
const out=(overrides={})=>({angle:'LEFT_3Q',framing:'WAIST',sourceIndex:0,custom:'',...overrides});
const spec=(overrides={})=>({mode:'GENERATIVE_ANGLE',execution:'MOCK',preservation:DEFAULT_PRESERVATION,outputs:[out()],...overrides});
async function setup(overrides={}) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'angle-modes-test-'));
  const config={...getConfig({}),...overrides,dataDir};
  const {app,store}=await createApp(config,()=>{throw new Error('Unexpected API call in mock test');});
  const client=request(app);const token=(await client.get('/api/config')).body.token;
  const submit=(job,refs=[fixture,fixture])=>{let req=client.post('/api/jobs').set('X-Angle-Pack-Token',token).field('spec',JSON.stringify(job));for(let i=0;i<refs.length;i++)req=req.attach('references',refs[i],`photo${i+1}.png`);return req;};
  return {client,store,token,submit,config};
}
async function finish(store,id){for(let i=0;i<300;i++){if(!store.active)return store.get(id);await new Promise(r=>setTimeout(r,20));}throw new Error('Job did not finish');}
const prompt=(mode,output={},job={})=>{const parsed=jobSchema.parse(spec({mode,outputs:[out(output)],...job}));return buildPrompt(parsed,parsed.outputs[0]);};

test('the mode table is complete and drives the accepted job modes',()=>{
  assert.deepEqual(MODE_KEYS,['CROP_ZOOM','OUTPAINT_ZOOM','GENERATIVE_ANGLE','MULTI_REFERENCE','COMBINED_IMAGES','ATTRIBUTE_COMBINE','MODEL_COMPARISON']);
  for(const [key,rules] of Object.entries(MODES)) {
    assert.ok(rules.label&&rules.blurb&&rules.note,`${key} needs display text`);
    assert.ok(['same','distinct','attributes'].includes(rules.subject),`${key} subject`);
    assert.ok(rules.minReferences>=1&&rules.minReferences<=5,`${key} minimum references`);
    if(!rules.generative)assert.equal(rules.usesAngle,false,`${key} cannot pick a camera without a model`);
  }
  assert.throws(()=>jobSchema.parse(spec({mode:'NOT_A_MODE'})));
});
test('Multi-Reference synthesises one subject from every reference',async()=>{
  const text=prompt('MULTI_REFERENCE',{custom:'walking outside at golden hour'});
  assert.match(text,/MULTI-REFERENCE SYNTHESIS/);
  assert.match(text,/SAME subject/);
  assert.match(text,/Direction for this output: walking outside at golden hour/);
  assert.match(text,/Camera position: Rotate the camera approximately 45 degrees/);
  const {submit,store}=await setup();
  assert.equal((await submit(spec({mode:'MULTI_REFERENCE'}),[fixture])).status,400,'one photograph is not multi-reference');
  const job=await finish(store,(await submit(spec({mode:'MULTI_REFERENCE'}))).body.id);
  assert.equal(job.status,'complete');assert.equal(job.references.length,2);
});
test('Combined Images keeps the references distinct and demands a direction',async()=>{
  const text=prompt('COMBINED_IMAGES',{custom:'seat them at the same table'});
  assert.match(text,/DIFFERENT subjects/);
  assert.match(text,/Never merge two people into one face/);
  assert.match(text,/collage, split screen, grid, panel layout/);
  assert.doesNotMatch(text,/SAME subject/);
  assert.match(text,/Direction for this output: seat them at the same table/);
  assert.throws(()=>jobSchema.parse(spec({mode:'COMBINED_IMAGES',outputs:[out()]})),/written direction/);
  const {submit,store}=await setup();
  const job=await finish(store,(await submit(spec({mode:'COMBINED_IMAGES',outputs:[out({custom:'one table'})]}))).body.id);
  assert.equal(job.status,'complete');
});
test('Attribute Combine names each source and refuses impossible assignments',async()=>{
  const attributes=[{attribute:'FACE',reference:0},{attribute:'OUTFIT',reference:1}];
  const text=prompt('ATTRIBUTE_COMBINE',{attributes});
  assert.match(text,/ONLY the attributes assigned to it/);
  assert.match(text,/Attribute sources: Face and identity from reference 1; Outfit from reference 2/);
  assert.match(text,/Take nothing else from those references/);
  assert.throws(()=>jobSchema.parse(spec({mode:'ATTRIBUTE_COMBINE',outputs:[out({attributes:[attributes[0]]})]})),/at least two attribute sources/);
  assert.throws(()=>jobSchema.parse(spec({mode:'ATTRIBUTE_COMBINE',outputs:[out({attributes:[attributes[0],{attribute:'FACE',reference:1}]})]})),/only once/);
  assert.throws(()=>jobSchema.parse(spec({mode:'GENERATIVE_ANGLE',outputs:[out({attributes})]})),/does not use attribute sources/);
  assert.throws(()=>jobSchema.parse(spec({mode:'ATTRIBUTE_COMBINE',outputs:[out({attributes:[{attribute:'NOSE',reference:0},attributes[1]]})]})));
  const {submit,store}=await setup();
  const beyond=await submit(spec({mode:'ATTRIBUTE_COMBINE',outputs:[out({attributes:[{attribute:'FACE',reference:0},{attribute:'OUTFIT',reference:4}]})]}));
  assert.equal(beyond.status,400);assert.match(beyond.body.error,/was not uploaded/);
  const job=await finish(store,(await submit(spec({mode:'ATTRIBUTE_COMBINE',outputs:[out({attributes})]}))).body.id);
  assert.equal(job.status,'complete');
  assert.deepEqual(job.outputs[0].attributes,attributes);
  assert.ok(Object.keys(ATTRIBUTES).length>=8);
});
test('outputIssues is shared, so regeneration is validated against the saved mode',async()=>{
  assert.deepEqual(outputIssues('GENERATIVE_ANGLE',{custom:'',attributes:[]}),[]);
  assert.equal(outputIssues('COMBINED_IMAGES',{custom:'  ',attributes:[]}).length,1);
  const {submit,store,client,token}=await setup();
  const job=await finish(store,(await submit(spec({mode:'COMBINED_IMAGES',outputs:[out({custom:'one table'})]}))).body.id);
  const blank=await client.post(`/api/sessions/${job.id}/outputs/0/regenerate`).set('X-Angle-Pack-Token',token).send({execution:'MOCK',output:out({custom:''})});
  assert.equal(blank.status,400);assert.match(blank.body.error,/written direction/);
  const good=await client.post(`/api/sessions/${job.id}/outputs/0/regenerate`).set('X-Angle-Pack-Token',token).send({execution:'MOCK',output:out({custom:'stand them side by side'})});
  assert.equal(good.status,202);
  assert.equal((await finish(store,job.id)).outputs[0].history.length,1);
});
test('every generative mode still produces one prompt with the preservation controls',()=>{
  for(const mode of MODE_KEYS) {
    if(!MODES[mode].generative)continue;
    const extras=mode==='COMBINED_IMAGES'?{custom:'together'}:mode==='ATTRIBUTE_COMBINE'?{attributes:[{attribute:'FACE',reference:0},{attribute:'OUTFIT',reference:1}]}:{};
    // Model Comparison is the one mode a single-output job cannot express.
    const parsed=jobSchema.parse(mode==='MODEL_COMPARISON'
      ? spec({mode,outputs:[out(),out({model:'fal-ai/qwen-image-edit-plus'})]})
      : spec({mode,outputs:[out(extras)]}));
    const text=buildPrompt(parsed,parsed.outputs[0]);
    assert.match(text,/PRESERVE_FACE \(HIGH, identity\)/,`${mode} preservation`);
    assert.match(text,/Produce ONE photograph/,`${mode} single output`);
    assert.match(text,/Reference view labels/,`${mode} reference labels`);
    assert.ok(text.length>500,`${mode} prompt looks truncated`);
    if(MODES[mode].usesAngle)assert.match(text,/^Camera position: /m,`${mode} camera position`);
    else assert.match(text,/Keep the source camera angle/,`${mode} keeps the camera`);
  }
});
test('mock previews name the model so a comparison dry run is legible',async()=>{
  const {submit,store}=await setup();
  const job=await finish(store,(await submit(spec({mode:'GENERATIVE_ANGLE',model:'fal-ai/qwen-image-edit'}))).body.id);
  assert.equal(job.status,'complete');
  assert.equal(job.outputs[0].generationParameters.modelLabel,'Qwen Image Edit');
});
