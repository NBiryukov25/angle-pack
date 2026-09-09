import { fakeFal } from './fake-fal.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { getConfig } from '../server/config.js';
import { editImage } from '../server/fal.js';
import { normalizeReference } from '../server/imaging.js';
import { buildPrompt } from '../server/prompts.js';
import { jobSchema } from '../server/schema.js';
import { getModel, resolveOutputSize, MODEL_IDS, MODELS, KONTEXT_RATIOS } from '../server/models.js';
import { DEFAULT_PRESERVATION, ANGLES } from '../public/presets.js';

const photo = (w,h) => sharp({create:{width:w,height:h,channels:3,background:'#8a6a55'}}).jpeg({quality:92}).toBuffer();
const spec = jobSchema.parse({mode:'GENERATIVE_ANGLE',execution:'LIVE',preservation:DEFAULT_PRESERVATION,referenceAngles:['FRONT'],outputs:[{angle:'PROFILE_LEFT',framing:'WAIST'}]});
const live = model => ({...getConfig({}),mockOnly:false,apiKey:'k',model});
async function payload(model, reference, prompt='PROMPT') {
  let input=null;const uploaded=[];
  const transport=fakeFal(await sharp({create:{width:8,height:8,channels:3,background:'#fff'}}).png().toBuffer(),{onSubmit:b=>{input=b;}});
  const rawUpload=transport.upload;
  transport.upload=async file=>{uploaded.push(Buffer.from(await file.arrayBuffer()));return rawUpload(file);};
  await editImage(live(model),[reference],prompt,null,transport,undefined,{preservation:DEFAULT_PRESERVATION});
  return {input,uploaded};
}

// 1. A 3:4 source is not forced into 2:3 output.
test('a 3:4 source is never forced into the configured 2:3 output',async()=>{
  const reference=await normalizeReference(await photo(3024,4032));
  const {input}=await payload('fal-ai/flux-2/edit',reference);
  const out=input.image_size.width/input.image_size.height;
  assert.notEqual(`${input.image_size.width}x${input.image_size.height}`,'1024x1536','the old forced frame must be gone');
  assert.ok(Math.abs(out-0.75)/0.75<0.03,`output aspect ${out.toFixed(4)} must track the 0.75 source, not 0.6667`);
  assert.ok(Math.abs(out-2/3)>0.05,'the output must not land on the configured 2:3');
  for(const side of [input.image_size.width,input.image_size.height]) {
    assert.ok(side>=512&&side<=2048,`${side} is outside fal's documented 512-2048 range`);
    assert.equal(side%32,0,`${side} must be a multiple of 32`);
  }
  const megapixels=input.image_size.width*input.image_size.height/1e6;
  assert.ok(megapixels>1.2&&megapixels<2.1,`pixel budget drifted to ${megapixels.toFixed(2)} MP`);
});
test('every source shape is tracked, and each model expresses it the way it can',async()=>{
  const shapes=[[3024,4032,0.75],[4032,3024,4/3],[2048,2048,1],[1080,1920,0.5625],[1920,1080,16/9]];
  for(const [w,h,aspect] of shapes) {
    const reference=await normalizeReference(await photo(w,h));
    const {input}=await payload('fal-ai/qwen-image-edit-plus',reference);
    const out=input.image_size.width/input.image_size.height;
    assert.ok(Math.abs(out-aspect)/aspect<0.04,`${w}x${h}: output ${out.toFixed(3)} strayed from source ${aspect.toFixed(3)}`);
    // Kontext takes a ratio string, so it snaps to the nearest it supports.
    const kontext=await payload('fal-ai/flux-pro/kontext/max/multi',reference);
    assert.ok(KONTEXT_RATIOS.includes(kontext.input.aspect_ratio),`${kontext.input.aspect_ratio} is not a documented ratio`);
    const [rw,rh]=kontext.input.aspect_ratio.split(':').map(Number);
    assert.ok(Math.abs(Math.log(rw/rh)-Math.log(aspect))<0.25,`${w}x${h} snapped to ${kontext.input.aspect_ratio}, too far from source`);
    assert.equal('image_size' in kontext.input,false,'Kontext documents no image_size');
  }
  assert.deepEqual(resolveOutputSize(getModel('fal-ai/photomaker'),0.75,{width:1024,height:1536}),{},'PhotoMaker has no size control');
});
test('outpaint keeps its own canvas shape and the configured size remains the fallback',async()=>{
  const flux=getModel('fal-ai/flux-2/edit');
  // No readable source: the configured frame is still the fallback.
  assert.deepEqual(resolveOutputSize(flux,NaN,{width:1024,height:1536}),{width:1024,height:1536});
  // An outpaint canvas is already built at the configured shape, so it round-trips.
  const canvas=resolveOutputSize(flux,1024/1536,{width:1024,height:1536});
  assert.deepEqual(canvas,{width:1024,height:1536});
});

// 2 & 3. The compact prompt keeps the obligations and is materially shorter.
test('the compact prompt keeps angle, identity and garment instructions',()=>{
  const text=buildPrompt(spec,spec.outputs[0],{compact:true});
  assert.match(text,/^Camera position: Rotate the camera a full 90 degrees around to the SUBJECT'S OWN LEFT/,'the camera must lead');
  assert.match(text,/Do NOT reproduce the reference viewpoint/);
  assert.match(text,/cropping, mirroring, rotating or warping/);
  assert.match(text,/SAME PERSON as the reference/);
  for(const feature of ['face shape','eye shape','nose','lips','jawline','skin tone','apparent age','ethnicity','body proportions'])
    assert.ok(text.toLowerCase().includes(feature),`identity lock lost ${feature}`);
  assert.match(text,/Do not beautify, smooth, slim, symmetrise, or change age or ethnicity/);
  assert.match(text,/SAME CLOTHING as the reference, as constructed/);
  for(const part of ['sleeve length','neckline','shoulder line','waist','hem','closures','pattern','fabric'])
    assert.ok(text.toLowerCase().includes(part),`garment lock lost ${part}`);
  assert.match(text,/Binding: FACE, BODY, HAIR, OUTFIT, ACCESSORIES/,'the preservation controls that are set must be named');
  assert.match(text,/FINAL CHECK: camera actually moved as instructed/);
  assert.match(text,/Framing: Waist-up portrait/);
  // Every angle still yields a distinct instruction.
  const angles=Object.keys(ANGLES).filter(a=>a!=='CUSTOM');
  const built=angles.map(a=>{const j=jobSchema.parse({...structuredClone(spec),outputs:[{angle:a,framing:'WAIST'}]});return buildPrompt(j,j.outputs[0],{compact:true});});
  assert.equal(new Set(built).size,angles.length);
});
test('the compact prompt is materially shorter and fits the encoder budget',()=>{
  const full=buildPrompt(spec,spec.outputs[0]);
  const compact=buildPrompt(spec,spec.outputs[0],{compact:true});
  assert.ok(full.length>7000,`the full prompt should still be the long one, got ${full.length}`);
  assert.ok(compact.length<full.length*0.3,`compact is ${compact.length} vs full ${full.length}; expected under 30%`);
  // FLUX.2's pipeline caps the text encoder at 512 tokens; ~3.6 chars/token is
  // the conservative estimate, so stay clear of the cap with margin.
  assert.ok(compact.length/3.6<512,`~${Math.round(compact.length/3.6)} tokens still exceeds the 512-token cap`);
  assert.ok(compact.split(/\s+/).length<260,'compact prompt is still too wordy');
  // Nothing is silently discarded any more: every block fits.
  assert.equal(compact.endsWith('same garment construction.'),true,'the final check must survive, unlike in the full prompt');
});
test('a tighter documented limit drops only droppable blocks, never the locks',()=>{
  const limit=getModel('fal-ai/photomaker').promptLimit;
  const trimmed=buildPrompt(spec,spec.outputs[0],{compact:true,limit});
  assert.ok(trimmed.length<=limit,`${trimmed.length} exceeds the ${limit} limit`);
  assert.match(trimmed,/Camera position: Rotate the camera a full 90 degrees/);
  assert.match(trimmed,/Do NOT reproduce the reference viewpoint/);
  assert.match(trimmed,/SAME PERSON as the reference/);
  assert.match(trimmed,/SAME CLOTHING as the reference/);
  assert.match(trimmed,/FINAL CHECK/);
});

// 4. The original reference is still sent unchanged.
test('the original reference still reaches the provider unaltered',async()=>{
  const original=await photo(3024,4032);
  const reference=await normalizeReference(original);
  const before=await sharp(reference).metadata();
  const {input,uploaded}=await payload('fal-ai/flux-2/edit',reference);
  assert.equal(uploaded.length,1,'exactly one image is uploaded');
  assert.equal(Buffer.compare(uploaded[0],reference),0,'the uploaded bytes must be the normalized reference, byte for byte');
  const after=await sharp(uploaded[0]).metadata();
  assert.equal(after.width,3024);assert.equal(after.height,4032);
  assert.equal(after.width,before.width);assert.equal(after.height,before.height);
  assert.equal(after.format,'png','no recompression to a lossy format');
  assert.equal(input.image_urls.length,1,'no contact sheet for a single reference');
  assert.equal(input.image_urls[0],'https://fal.media/ref1.png');
});
test('guidance_scale and the model roster are untouched by Stage A2',()=>{
  assert.equal(getModel('fal-ai/flux-2/edit').guidance,3.5,'A2 must not change guidance_scale');
  assert.equal(getModel('fal-ai/flux-pro/kontext/max/multi').guidance,4);
  assert.equal(MODEL_IDS.length,9,'A2 must not add or remove models');
  assert.equal(Object.keys(MODELS)[0],'fal-ai/flux-2/edit','the default model is unchanged');
});
