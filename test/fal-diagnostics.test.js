import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {editImage} from '../server/fal.js';
import {getConfig} from '../server/config.js';

const fixture=await sharp({create:{width:8,height:8,channels:3,background:'#123456'}}).png().toBuffer();
const config={...getConfig({}),mockOnly:false,apiKey:'configured-fal-value:123456',password:'configured-app-value'};
function transport(response){let calls=0;return {upload:async()=> 'https://fal.media/test.png',fetch:async()=>{calls++;return response;},get calls(){return calls;}};}

test('403 logs HTTP context and diagnostic fields, redacts secrets and never resubmits',async t=>{
  const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
  const fake=transport(Response.json({detail:[{msg:'Model access is forbidden',type:'permission_denied',input:{password:'hidden-password',image:fixture.toString('base64')}}],message:`Denied ${config.apiKey} and ${encodeURIComponent(config.apiKey)} ${config.password}`,authorization:'Key hidden-auth',password:'hidden-password',image_urls:['https://fal.media/private.png'],error:{message:'Authorization: Bearer hidden-bearer',token:'hidden-token'}},{status:403,headers:{'x-fal-request-id':'fal-request-403','x-error-id':'fal-error-403','x-request-id':config.apiKey,'set-cookie':'hidden-cookie'}}));
  await assert.rejects(editImage(config,[fixture],'private prompt',null,fake),e=>{assert.match(e.message,/HTTP 403.*Access denied/);assert.match(e.message,/No automatic resubmission/);assert.ok(!e.message.includes(config.apiKey));return true;});
  assert.equal(fake.calls,1);assert.equal(logs.length,1);
  const entry=logs[0][1];assert.equal(entry.status,403);assert.equal(entry.method,'POST');assert.equal(entry.endpoint,'queue.fal.run/fal-ai/flux-2/edit');assert.equal(entry.ids['x-fal-request-id'],'fal-request-403');assert.equal(entry.ids['x-error-id'],'fal-error-403');assert.equal(entry.ids['x-request-id'],'[REDACTED]');
  const serialized=JSON.stringify(logs);assert.match(serialized,/Model access is forbidden/);
  for(const secret of [config.apiKey,encodeURIComponent(config.apiKey),config.password,'hidden-password','hidden-auth','hidden-bearer','hidden-token','hidden-cookie',fixture.toString('base64'),'private prompt','https://fal.media/private.png'])assert.ok(!serialized.includes(secret),`Unexpected sensitive value in diagnostic`);
});

test('plain-text response sanitizes credentials and bounded diagnostics omit oversized data',async t=>{
  const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
  for(const body of ['password=do-not-log and token=do-not-log','data:image/png;base64,'+fixture.toString('base64'),'x'.repeat(70000)]){
    const fake=transport(new Response(body,{status:403,headers:{'content-type':'text/plain'}}));
    await assert.rejects(editImage(config,[fixture],'test',null,fake),/HTTP 403/);assert.equal(fake.calls,1);
  }
  const serialized=JSON.stringify(logs);assert.ok(!serialized.includes('do-not-log'));assert.ok(!serialized.includes(fixture.toString('base64')));assert.ok(serialized.length<3000);assert.match(serialized,/diagnostic limit/);
});

test('unreadable error response still fails once with sanitized 403',async t=>{
  const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
  const response=new Response('unreadable',{status:403});response.clone=()=>{throw new Error(config.apiKey);};
  const fake=transport(response);await assert.rejects(editImage(config,[fixture],'test',null,fake),/HTTP 403/);assert.equal(fake.calls,1);assert.equal(logs[0][1].body,'[response body unavailable]');assert.ok(!JSON.stringify(logs).includes(config.apiKey));
});
