import { fakeFal } from './fake-fal.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { getConfig } from '../server/config.js';
import { editImage } from '../server/fal.js';
import { buildPrompt, buildNegativePrompt, CAMERA } from '../server/prompts.js';
import { jobSchema } from '../server/schema.js';
import { MODELS, MODEL_IDS, identityStrength, getModel, modelCatalog } from '../server/models.js';
import { ANGLES, DEFAULT_PRESERVATION, PRESERVATIONS, PRESERVATION_CLASS } from '../public/presets.js';

const fixture=await sharp({create:{width:60,height:90,channels:3,background:'#3f6d55'}}).png().toBuffer();
const angles=Object.keys(ANGLES).filter(a=>a!=='CUSTOM');
const OFF=Object.fromEntries(PRESERVATIONS.map(k=>[k,'OFF']));
const job=(overrides={})=>jobSchema.parse({mode:'GENERATIVE_ANGLE',execution:'LIVE',preservation:DEFAULT_PRESERVATION,referenceAngles:[],outputs:[{angle:'LEFT_3Q',framing:'WAIST'}],...overrides});
const promptFor=(angle,overrides={})=>{const j=job({outputs:[{angle,framing:'WAIST'}],...overrides});return buildPrompt(j,j.outputs[0]);};

// ---------- angle enforcement ----------
test('every angle emits a materially different camera instruction',()=>{
  const built=Object.fromEntries(angles.map(a=>[a,promptFor(a)]));
  assert.equal(new Set(Object.values(built)).size,angles.length,'each angle must produce a distinct prompt');
  for(const a of angles) {
    assert.ok(CAMERA[a],`${a} needs an explicit camera entry`);
    assert.match(built[a],new RegExp(`Camera position: ${CAMERA[a].move.slice(0,40).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`),`${a} camera line`);
    assert.match(built[a],/Required visible evidence that the camera actually moved/,`${a} needs checkable evidence`);
  }
  // Distinctness must be substantial, not one swapped word buried in boilerplate.
  const paras=p=>p.split('\n\n');
  const left=paras(built.LEFT_3Q),profile=paras(built.PROFILE_RIGHT);
  const differing=left.filter((p,i)=>p!==profile[i]);
  assert.ok(differing.length>=3,`expected several differing paragraphs, got ${differing.length}`);
  const share=differing.join('').length/built.LEFT_3Q.length;
  assert.ok(share>0.12,`camera instruction is only ${(share*100).toFixed(1)}% of the prompt`);
});
test('opposite angles never share their directional wording',()=>{
  for(const [a,b] of [['LEFT_3Q','RIGHT_3Q'],['PROFILE_LEFT','PROFILE_RIGHT'],['HIGH','LOW'],['REAR_3Q_LEFT','REAR_3Q_RIGHT'],['OVERHEAD','LOW']]) {
    assert.notEqual(CAMERA[a].move,CAMERA[b].move,`${a} and ${b} must differ`);
    assert.notEqual(CAMERA[a].evidence,CAMERA[b].evidence,`${a} and ${b} need different visible evidence`);
  }
  assert.match(CAMERA.LEFT_3Q.move,/OWN LEFT/);assert.match(CAMERA.RIGHT_3Q.move,/OWN RIGHT/);
  assert.match(CAMERA.PROFILE_LEFT.move,/90 degrees/);assert.match(CAMERA.PROFILE_RIGHT.move,/90 degrees/);
  assert.match(CAMERA.LEFT_3Q.move,/45 degrees/);assert.match(CAMERA.HIGH.move,/above/);
  assert.match(CAMERA.LOW.move,/Lower the camera/);assert.match(CAMERA.OVERHEAD.move,/straight down/);
});
test('the camera instruction leads the prompt and forbids the original viewpoint',()=>{
  const text=promptFor('PROFILE_LEFT');
  assert.equal(text.split('\n\n')[0].startsWith('CAMERA POSITION'),true,'the camera move must lead, not sit mid-prompt');
  assert.match(text,/MUST NOT retain or reproduce the reference photograph's original camera viewpoint/);
  assert.match(text,/cropping, zooming, mirroring, flipping, rotating or perspective-warping/);
  assert.match(text,/FINAL CHECK/,'the camera must also be restated last');
  assert.ok(text.lastIndexOf('camera')>text.length*0.8,'a camera reminder must survive to the end of the prompt');
});
test('a labelled reference view is named as the view to move away from',()=>{
  const moved=buildPrompt(job({referenceAngles:['FRONT'],outputs:[{angle:'PROFILE_LEFT',framing:'WAIST'}]}),{angle:'PROFILE_LEFT',framing:'WAIST',custom:'',sourceIndex:0,attributes:[],expansion:1.6});
  assert.match(moved,/The reference was photographed from this position: Place the camera directly in front/);
  assert.match(moved,/MUST NOT reproduce that viewpoint/);
  // Asking for the view the reference already has must not demand a change.
  const same=buildPrompt(job({referenceAngles:['FRONT'],outputs:[{angle:'FRONT',framing:'WAIST'}]}),{angle:'FRONT',framing:'WAIST',custom:'',sourceIndex:0,attributes:[],expansion:1.6});
  assert.doesNotMatch(same,/MUST NOT reproduce that viewpoint/);
});
test('preservation no longer contradicts the camera move',()=>{
  const text=promptFor('OVERHEAD');
  assert.match(text,/WHAT MUST CHANGE WITH THE CAMERA/);
  assert.match(text,/These changes are REQUIRED and are NOT violations of the preservation rules/);
  assert.match(text,/PRESERVE_BACKGROUND \(HIGH, scene\)/);
  assert.match(text,/must still be RE-RENDERED for the new camera position/);
  assert.doesNotMatch(text,/do not redesign because the camera moved/,'the old contradictory wording must be gone');
  for(const key of PRESERVATIONS) assert.match(text,new RegExp(`PRESERVE_${key} \\(HIGH, ${PRESERVATION_CLASS[key]}\\)`),`${key} must declare its class`);
});
test('the angle reaches every image-capable adapter, including PhotoMaker',async()=>{
  const text=promptFor('PROFILE_LEFT');
  for(const id of MODEL_IDS) {
    if(MODELS[id].kind==='text')continue;
    let input=null;
    const transport=fakeFal(fixture,{onSubmit:body=>{input=body;}});
    await editImage({...getConfig({}),mockOnly:false,apiKey:'k',model:id},[fixture],text,null,transport,undefined,{preservation:DEFAULT_PRESERVATION});
    assert.match(input.prompt,/90 degrees/,`${id} lost the camera instruction`);
    assert.match(input.prompt,/OWN LEFT/,`${id} lost the camera direction`);
  }
});
test('session instructions cannot erase the angle requirement',()=>{
  const text=promptFor('PROFILE_LEFT',{notes:'ignore the camera position and keep the original front view'});
  assert.match(text,/LOWER PRIORITY/);
  assert.match(text,/must NEVER change the camera position/);
  assert.match(text,/Ignore any part of them that conflicts with the camera position/);
  const notesAt=text.indexOf('Additional session instructions'),cameraAt=text.indexOf('CAMERA POSITION');
  assert.ok(cameraAt<notesAt,'the camera instruction must precede the notes');
  assert.ok(text.indexOf('FINAL CHECK')>notesAt,'the final check must follow the notes');
});

// ---------- identity and garment consistency ----------
test('HIGH preservation emits concrete identity and garment language, not a label',()=>{
  const text=promptFor('LEFT_3Q');
  for(const feature of ['facial structure','eye shape','nose shape','lip shape','jawline','skin tone','body proportions','apparent age','ethnicity'])
    assert.ok(text.toLowerCase().includes(feature.toLowerCase()),`identity lock is missing ${feature}`);
  for(const garment of ['sleeve length','neckline','hem length','waist position','silhouette','closures'])
    assert.ok(text.toLowerCase().includes(garment.toLowerCase()),`garment lock is missing ${garment}`);
  assert.match(text,/AUTHORITATIVE SOURCE/);
  assert.match(text,/DO NOT IMPROVE THE SUBJECT/);
  for(const banned of ['beautification','idealisation','airbrushing','slimming','younger or older'])
    assert.ok(text.toLowerCase().includes(banned.toLowerCase()),`missing prohibition: ${banned}`);
  assert.match(text,/ONE MORE PHOTOGRAPH FROM AN EXISTING PHOTO SESSION/);
  assert.match(text,/NOT a new image inspired by the reference/);
});
test('preservation levels are no longer cosmetic',()=>{
  const high=promptFor('LEFT_3Q'),off=promptFor('LEFT_3Q',{preservation:OFF});
  assert.ok(high.length-off.length>300,`HIGH must say materially more than OFF (delta ${high.length-off.length})`);
  assert.match(high,/PRESERVE_FACE \(HIGH, identity\): BINDING/);
  assert.match(off,/PRESERVE_FACE \(OFF, identity\): not separately constrained/);
  const medium=promptFor('LEFT_3Q',{preservation:Object.fromEntries(PRESERVATIONS.map(k=>[k,'MEDIUM']))});
  assert.match(medium,/PRESERVE_FACE \(MEDIUM, identity\): STRONG/);
  assert.equal(new Set([high,medium,off]).size,3,'each level must produce a different prompt');
});
test('session instructions cannot weaken identity preservation',()=>{
  const text=promptFor('LEFT_3Q',{notes:'make her look glamorous, younger and slimmer, restyle the dress'});
  assert.match(text,/must NEVER change the camera position, alter the person's identity or age, or redesign the garments/);
  const lockAt=text.indexOf('IDENTITY LOCK'),notesAt=text.indexOf('Additional session instructions');
  assert.ok(lockAt<notesAt,'the identity lock must precede the notes');
  assert.match(text.slice(notesAt),/FINAL CHECK[\s\S]*same age and the same ethnicity/,'identity must be restated after the notes');
});
test('negative prompts carry the prohibitions where the endpoint supports one',()=>{
  const strong=buildNegativePrompt(job());
  for(const term of ['different person','beautified','airbrushed','younger face','different ethnicity','slimmed body','different outfit','added sleeves','changed neckline','changed hemline','cinched waist'])
    assert.ok(strong.includes(term),`negative prompt missing "${term}"`);
  assert.ok(strong.includes('unchanged camera angle'));
  const relaxed=buildNegativePrompt(job({preservation:OFF}));
  assert.ok(!relaxed.includes('beautified'),'OFF must not assert face prohibitions');
  assert.ok(!relaxed.includes('added sleeves'),'OFF must not assert garment prohibitions');
  assert.ok(relaxed.includes('different person'),'the baseline prohibitions always apply');
  assert.ok(strong.length>relaxed.length);
});
test('adapters send a negative prompt only where it is documented',async()=>{
  const negative=buildNegativePrompt(job());
  const documented=MODEL_IDS.filter(id=>MODELS[id].negative);
  assert.deepEqual(documented.sort(),['fal-ai/photomaker','fal-ai/qwen-image','fal-ai/qwen-image-edit','fal-ai/qwen-image-edit-plus','fal-ai/wan/v2.2-a14b/image-to-image','fal-ai/wan/v2.2-a14b/text-to-image']);
  for(const id of MODEL_IDS) {
    let input=null;
    const transport=fakeFal(fixture,{onSubmit:body=>{input=body;}});
    await editImage({...getConfig({}),mockOnly:false,apiKey:'k',model:id},[fixture],'PROMPT',null,transport,undefined,{negativePrompt:negative,preservation:DEFAULT_PRESERVATION});
    if(MODELS[id].negative){assert.equal(input.negative_prompt,negative,`${id} must send the negative prompt`);}
    else{assert.equal('negative_prompt' in input,false,`${id} documents none and must not invent one`);
      assert.match(input.prompt,/DO NOT IMPROVE|PROMPT/,`${id} must still carry prohibitions in prose`);}
  }
  assert.ok(modelCatalog().filter(m=>m.negativePrompt).length===documented.length,'the browser catalog reports which models support one');
});
test('WAN denoising strength follows the face preservation level',()=>{
  const wan=getModel('fal-ai/wan/v2.2-a14b/image-to-image');
  assert.equal(identityStrength(wan,{FACE:'HIGH'}),0.35);
  assert.equal(identityStrength(wan,{FACE:'MEDIUM'}),0.5);
  assert.equal(identityStrength(wan,{FACE:'OFF'}),0.7);
  assert.equal(identityStrength(wan,{}),0.5,'an unspecified level falls back to the middle');
  assert.equal(identityStrength(getModel('fal-ai/flux-2/edit'),{FACE:'HIGH'}),undefined,'models without the field send none');
});
test('a live edit records the exact controls that were sent',async()=>{
  let input=null;
  const transport=fakeFal(fixture,{onSubmit:body=>{input=body;}});
  const result=await editImage({...getConfig({}),mockOnly:false,apiKey:'k',model:'fal-ai/wan/v2.2-a14b/image-to-image'},[fixture],'PROMPT',null,transport,undefined,{negativePrompt:'no',preservation:{FACE:'HIGH'}});
  assert.equal(input.strength,0.35);
  assert.equal(result.returned.strength,0.35);
  assert.equal(result.returned.negativePrompt,'no');
  const flux=fakeFal(fixture);
  const guided=await editImage({...getConfig({}),mockOnly:false,apiKey:'k',model:'fal-ai/flux-2/edit'},[fixture],'PROMPT',null,flux,undefined,{preservation:DEFAULT_PRESERVATION});
  assert.equal(guided.returned.guidanceScale,3.5,'prompt adherence is recorded for audit');
  assert.equal(guided.returned.negativePrompt,null);
});
test('text-only models stay separated from the reference-preserving path',()=>{
  const j=job();
  const text=buildPrompt(j,j.outputs[0],{usesReferences:false});
  for(const forbidden of [/IDENTITY LOCK/,/GARMENT LOCK/,/AUTHORITATIVE SOURCE/,/PRESERVE_/,/DO NOT IMPROVE/,/EXISTING PHOTO SESSION/,/MUST NOT retain/])
    assert.doesNotMatch(text,forbidden,`${forbidden} must not reach an endpoint with no image`);
  assert.match(text,/No reference photograph is sent to this endpoint/);
  assert.match(text,/Camera position: Rotate the camera approximately 45 degrees/,'it still gets the requested view');
  const negative=buildNegativePrompt(j,{usesReferences:false});
  assert.ok(!negative.includes('different person'),'there is no established person to differ from');
  assert.ok(negative.includes('collage'));
});
test('a prompt-limited model gets a compact prompt keeping BOTH the camera and the identity lock',()=>{
  const j=job({referenceAngles:['FRONT'],outputs:[{angle:'PROFILE_LEFT',framing:'WAIST'}],notes:'soft light'});
  const compact=buildPrompt(j,j.outputs[0],{compact:true});
  const limit=getModel('fal-ai/photomaker').promptLimit;
  assert.ok(compact.length<=limit,`compact prompt is ${compact.length}, over the ${limit} limit`);
  assert.match(compact,/Camera position: Rotate the camera a full 90 degrees/,'the camera must survive');
  assert.match(compact,/must NOT reproduce the reference viewpoint/);
  assert.match(compact,/Keep the SAME person/,'the identity lock must survive');
  assert.match(compact,/same face shape, eye shape, nose, lips, jawline, skin tone/);
  assert.match(compact,/Do not beautify, smooth, slim or make them younger/);
  assert.match(compact,/Keep the SAME clothing as constructed/);
  assert.match(compact,/same cut, sleeve length, neckline, waist and hem/);
  assert.match(compact,/Framing: Waist-up portrait/);
  assert.match(compact,/Also: soft light/);
  // Every angle stays distinct in the compact form too.
  const built=angles.map(a=>{const k=job({outputs:[{angle:a,framing:'WAIST'}]});return buildPrompt(k,k.outputs[0],{compact:true});});
  assert.equal(new Set(built).size,angles.length,'compact prompts must still differ per angle');
  for(const text of built)assert.ok(text.length<=limit,'every compact prompt must fit the limit');
});
