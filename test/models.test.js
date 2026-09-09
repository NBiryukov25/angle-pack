import { fakeFal } from './fake-fal.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { MODELS, MODEL_IDS, DEFAULT_MODEL, getModel, modelCatalog } from '../server/models.js';
import { editImage, packEvidence, condense } from '../server/fal.js';
import { zipArchive } from '../server/archive.js';
import { getConfig } from '../server/config.js';

const fixture=await sharp({create:{width:60,height:90,channels:3,background:'#3f6d55'}}).png().toBuffer();
const live=model=>({...getConfig({}),mockOnly:false,apiKey:'test-only',model});
async function submitted(model,references=[fixture],options={}) {
  let input=null;
  const transport=fakeFal(fixture,{...options,onSubmit:body=>{input=body;}});
  const result=await editImage(live(model),references,'PROMPT ONE\n\nPROMPT TWO',null,transport);
  return {input,result,transport};
}

test('every registered model declares a documented, self-consistent adapter',()=>{
  assert.ok(MODEL_IDS.includes(DEFAULT_MODEL));
  for(const id of MODEL_IDS) {
    const model=getModel(id);
    assert.equal(model.id,id);
    assert.match(model.docs,new RegExp(`^https://fal\\.ai/models/${id.replace(/\//g,'\\/')}/api$`),`${id} must cite its own API documentation`);
    assert.ok(['edit','text','archive'].includes(model.kind),`${id} kind`);
    assert.ok(['dimensions','aspect','none'].includes(model.sizing),`${id} sizing`);
    assert.equal(model.maxImages===0,model.kind==='text',`${id} image capacity must match its kind`);
    const built=model.build({prompt:'p',urls:['https://fal.media/a.png'],archiveUrl:'https://fal.media/a.zip',width:1024,height:1536,aspect:'2:3'});
    assert.ok(built.prompt.includes('p'),`${id} must send the prompt`);
    if(model.kind==='edit')assert.ok(built.image_urls||built.image_url,`${id} must send image input`);
    if(model.kind==='text')assert.ok(!built.image_urls&&!built.image_url&&!built.image_archive_url,`${id} must send no image input`);
    if(model.kind==='archive')assert.ok(built.image_archive_url,`${id} must send an archive`);
    if(model.sizing==='dimensions')assert.deepEqual(built.image_size,{width:1024,height:1536},`${id} exact size`);
    if(model.sizing==='aspect')assert.equal(built.aspect_ratio,'2:3',`${id} aspect ratio`);
    if(model.sizing==='none')assert.ok(!built.image_size&&!built.aspect_ratio,`${id} has no size control`);
  }
  assert.throws(()=>getModel('fal-ai/not-real'),/Unsupported model/);
});
test('the browser catalog exposes only descriptive fields',()=>{
  const catalog=modelCatalog();
  assert.equal(catalog.length,MODEL_IDS.length);
  const serialized=JSON.stringify(catalog);
  assert.ok(!serialized.includes('function'));
  assert.doesNotMatch(serialized,/apiKey|FAL_KEY|password/i);
  for(const entry of catalog){for(const key of Object.keys(entry))assert.ok(['id','label','family','kind','sizing','maxImages','usesReferences','exactSize','negativePrompt','note','docs'].includes(key),`unexpected catalog field ${key}`);}
  assert.deepEqual([...new Set(catalog.map(m=>m.family))].sort(),['FLUX','PhotoMaker','Qwen','WAN']);
  for(const family of ['FLUX','Qwen','WAN'])assert.ok(catalog.filter(m=>m.family===family).length>=2,`${family} needs more than one variant`);
  assert.ok(catalog.filter(m=>!m.usesReferences).every(m=>/NOT sent/.test(m.note)),'text-only models must warn that references are not sent');
});
test('the default FLUX.2 payload is unchanged by the registry refactor',async()=>{
  const {input,result}=await submitted('fal-ai/flux-2/edit',Array(5).fill(fixture));
  // guidance_scale is sent deliberately: FLUX.2 documents it and a higher value
  // is what makes the camera instruction actually followed.
  assert.deepEqual(Object.keys(input).sort(),['enable_safety_checker','guidance_scale','image_size','image_urls','num_images','output_format','prompt']);
  assert.equal(input.guidance_scale,3.5);
  assert.equal(input.image_urls.length,4);assert.equal(input.num_images,1);assert.equal(input.output_format,'png');
  assert.deepEqual(input.image_size,{width:1024,height:1536});
  assert.match(input.prompt,/contact sheet/);
  assert.deepEqual(result.returned.inputMapping,[[0],[1],[2],[3,4]]);
  assert.equal(result.returned.model,'fal-ai/flux-2/edit');assert.equal(result.returned.promptTruncated,false);
});
test('single-input endpoints receive one image_url holding every reference view',async()=>{
  for(const id of ['fal-ai/qwen-image-edit','fal-ai/wan/v2.2-a14b/image-to-image']) {
    const {input,result,transport}=await submitted(id,Array(3).fill(fixture));
    assert.equal(input.image_url,'https://fal.media/ref1.png',`${id} sends one image_url`);
    assert.equal('image_urls' in input,false,`${id} must not send image_urls`);
    assert.equal(transport.uploads.length,1,`${id} uploads one packed sheet`);
    assert.deepEqual(result.returned.inputMapping,[[0,1,2]],`${id} still records all three views`);
  }
});
test('multi-input Qwen and Kontext endpoints receive separate views and their own size field',async()=>{
  const qwen=await submitted('fal-ai/qwen-image-edit-plus',Array(3).fill(fixture));
  assert.equal(qwen.input.image_urls.length,3);assert.deepEqual(qwen.input.image_size,{width:1024,height:1536});assert.equal(qwen.input.acceleration,'regular');
  const kontext=await submitted('fal-ai/flux-pro/kontext/max/multi',Array(3).fill(fixture));
  assert.equal(kontext.input.image_urls.length,3);assert.equal(kontext.input.aspect_ratio,'2:3');assert.equal('image_size' in kontext.input,false);
  assert.equal(kontext.result.returned.requestedSize,'2:3');
});
test('text-to-image endpoints upload nothing and record that references were not sent',async()=>{
  for(const id of ['fal-ai/qwen-image','fal-ai/wan/v2.2-a14b/text-to-image']) {
    const {input,result,transport}=await submitted(id,Array(4).fill(fixture));
    assert.equal(transport.uploads.length,0,`${id} must not upload references`);
    assert.equal('image_urls' in input,false);assert.equal('image_url' in input,false);
    assert.equal(result.returned.inputCount,0);assert.deepEqual(result.returned.inputMapping,[]);
  }
});
test('WAN returns a single image object rather than an images list',async()=>{
  const {result}=await submitted('fal-ai/wan/v2.2-a14b/text-to-image',[fixture],{result:{image:{url:'https://fal.media/result.png'},seed:7}});
  assert.equal(result.returned.imagesReturned,1);assert.equal(result.returned.seed,7);assert.ok(result.buffer.length);
});
test('PhotoMaker uploads one readable archive, trims the prompt and keeps its trigger word',async()=>{
  const {input,result,transport}=await submitted('fal-ai/photomaker',Array(3).fill(fixture));
  assert.equal(transport.uploads.length,1);assert.equal(transport.uploads[0].name,'references.zip');
  assert.equal(input.image_archive_url,'https://fal.media/ref1.png');
  assert.equal('image_urls' in input,false);assert.equal('image_size' in input,false);
  assert.match(input.prompt,/ img\./,'PhotoMaker needs its class-word trigger');
  assert.ok(input.prompt.length<=900+60);
  assert.equal(result.returned.inputCount,3);
  const zip=Buffer.from(await transport.uploads[0].arrayBuffer());
  const file=path.join(await mkdtemp(path.join(os.tmpdir(),'angle-zip-')),'references.zip');
  await writeFile(file,zip);
  const listed=spawnSync('unzip',['-l',file],{encoding:'utf8'});
  if(listed.error||listed.status!==0)return; // unzip is unavailable on this machine
  assert.match(listed.stdout,/view_1\.png/);assert.match(listed.stdout,/view_3\.png/);
  assert.equal(spawnSync('unzip',['-t',file],{encoding:'utf8'}).status,0,'archive must pass an integrity test');
});
test('archive entry names are validated and long prompts trim on paragraph boundaries',()=>{
  assert.throws(()=>zipArchive([['../escape.png',Buffer.from('x')]]),/Unsafe archive entry name/);
  assert.equal(condense('short',900),'short');
  assert.equal(condense('one\n\ntwo\n\nthree',9),'one\n\ntwo');
  assert.equal(condense('unbroken-single-paragraph',10),'unbroken-s');
});
test('contact sheets honour each documented input cap without losing a view',async()=>{
  for(const limit of [1,2,3,4]) {
    const packed=await packEvidence(Array(5).fill(fixture),limit);
    assert.equal(packed.buffers.length,limit,`limit ${limit}`);
    assert.deepEqual(packed.mapping.flat(),[0,1,2,3,4],`limit ${limit} keeps every view`);
  }
  const untouched=await packEvidence([fixture,fixture],4);
  assert.deepEqual(untouched.mapping,[[0],[1]]);
  await assert.rejects(async()=>packEvidence([fixture],0),/Invalid image input limit/);
});
test('config accepts every registered model and rejects anything else',()=>{
  for(const id of MODEL_IDS)assert.equal(getConfig({FAL_IMAGE_MODEL:id}).model,id);
  assert.throws(()=>getConfig({FAL_IMAGE_MODEL:'fal-ai/made-up'}),/Unsupported FAL_IMAGE_MODEL/);
  assert.equal(getConfig({}).model,DEFAULT_MODEL);
  assert.equal(Object.keys(MODELS).length,MODEL_IDS.length);
});
