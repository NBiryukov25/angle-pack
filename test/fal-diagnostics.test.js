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

// A queued fal job that fails returns its reason on the result endpoint, which
// is exactly the shape of a live 422 seen after a request id was issued.
function failingResult(body,status=422){
  let calls=0;
  return {calls:()=>calls,upload:async()=>'https://fal.media/test.png',sleep:async()=>{},fetch:async(url,options={})=>{
    calls++;
    if(options.method==='POST')return Response.json({request_id:'01a07fad-b08a-7ca3-9cb8-0996e93ebd08',status_url:'https://queue.fal.run/fal-ai/flux-2/requests/fake/status',response_url:'https://queue.fal.run/fal-ai/flux-2/requests/fake'});
    if(String(url).endsWith('/status'))return Response.json({status:'COMPLETED'});
    return typeof body==='string'?new Response(body,{status,headers:{'content-type':'text/plain'}}):Response.json(body,{status});
  }};
}

test('a failed job reports the provider reason, the request id and no resubmission',async t=>{
  t.mock.method(console,'error',()=>{});
  const fake=failingResult({detail:[{loc:['body','prompt'],msg:'Prompt exceeds the maximum supported length',type:'value_error'}]});
  await assert.rejects(editImage(config,[fixture],'a very long prompt',null,fake),error=>{
    assert.match(error.message,/HTTP 422/);
    assert.match(error.message,/fal\.ai said: Prompt exceeds the maximum supported length/,'the operator must be told why');
    assert.match(error.message,/Request ID: 01a07fad-b08a-7ca3-9cb8-0996e93ebd08/);
    assert.match(error.message,/No automatic resubmission was made/);
    return true;
  });
  assert.equal(fake.calls(),3,'submit, poll, read the failure — and stop');
});
test('a nested provider message is still found and bounded',async t=>{
  t.mock.method(console,'error',()=>{});
  const fake=failingResult({error:{message:'Content flagged by the safety system',code:'content_policy_violation'}});
  await assert.rejects(editImage(config,[fixture],'test',null,fake),error=>{
    assert.match(error.message,/Content flagged by the safety system/);
    assert.match(error.message,/content_policy_violation/);
    return true;
  });
  const long=failingResult({detail:'x'.repeat(900)});
  await assert.rejects(editImage(config,[fixture],'test',null,long),error=>{
    const said=error.message.split('fal.ai said: ')[1].split(' No automatic')[0];
    assert.ok(said.length<=300,`provider text must stay bounded, got ${said.length}`);
    return true;
  });
});
test('arbitrary upstream prose and credentials are still never echoed to the browser',async t=>{
  t.mock.method(console,'error',()=>{});
  // A plain-text body is unstructured upstream prose: logged, never surfaced.
  const text=failingResult('SECRET internal stack trace',429);
  await assert.rejects(editImage(config,[fixture],'test',null,text),error=>{
    assert.ok(!error.message.includes('SECRET'));
    assert.doesNotMatch(error.message,/fal\.ai said/);
    return true;
  });
  // Structured, but credential-bearing: the sanitizer drops it wholesale.
  const leaky=failingResult({message:`Authorization failed for token ${config.apiKey}`});
  await assert.rejects(editImage(config,[fixture],'test',null,leaky),error=>{
    assert.ok(!error.message.includes(config.apiKey));
    assert.doesNotMatch(error.message,/fal\.ai said/);
    return true;
  });
  // Fields outside the diagnostic whitelist, such as an echoed prompt, never appear.
  const echoed=failingResult({prompt:'my private prompt text',image_urls:['https://fal.media/private.png'],detail:'Invalid parameters'});
  await assert.rejects(editImage(config,[fixture],'my private prompt text',null,echoed),error=>{
    assert.ok(!error.message.includes('my private prompt'));
    assert.ok(!error.message.includes('fal.media'));
    assert.match(error.message,/fal\.ai said: Invalid parameters/);
    return true;
  });
});
