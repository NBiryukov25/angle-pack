import { createFalClient } from '@fal-ai/client';
import sharp from 'sharp';
import { ASPECT, getModel, resultImages } from './models.js';
import { zipArchive } from './archive.js';

// Diagnostics inspect responses only, never request headers, bodies, or image buffers.
function sanitizeText(value, config) {
  let text=String(value);
  for(const secret of [config.apiKey,config.password].filter(Boolean)) {
    for(const encoded of new Set([secret,encodeURIComponent(secret)]))text=text.split(encoded).join('[REDACTED]');
  }
  // Drop credential-bearing prose rather than guessing where a secret ends.
  if(/authorization|\b(?:bearer|password|passwd|secret|(?:access[_ -]?)?token|api[_ -]?key|fal_key|credentials?|cookies?|base64|image_data|image_urls)\b|data:image|-----BEGIN .*PRIVATE KEY/i.test(text))return '[REDACTED sensitive content]';
  return text.replace(/https?:\/\/[^\s"<>]+/gi,'[URL omitted]')
    .replace(/\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]+/g,'[REDACTED]')
    .replace(/[A-Za-z0-9+/_=-]{80,}/g,'[opaque data omitted]')
    .replace(/[\x00-\x1f\x7f\x1b]/g,' ').slice(0,2000);
}

async function logHttpError(response,url,options,config) {
  let body='[response body unavailable]';
  try {
    const copy=response.clone(), reader=copy.body?.getReader();
    if(reader){let length=0,chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65536){void reader.cancel().catch(()=>{});chunks=null;break;}chunks.push(value);}
      if(!chunks)body='[response body exceeds diagnostic limit]';
      else {
        const raw=Buffer.concat(chunks).toString('utf8');
        // Only diagnostic fields survive. Provider echoes of input, headers,
        // passwords, image URLs and other arbitrary payload fields are omitted.
        const clean=(value,depth=0)=>{
          if(depth>6)return '[nested content omitted]';
          if(typeof value==='string')return sanitizeText(value,config);
          if(Array.isArray(value))return value.slice(0,10).map(v=>clean(v,depth+1));
          if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>['error','message','detail','msg','code','type','status'].includes(key)).map(([key,v])=>[key,clean(v,depth+1)]));
          return typeof value==='number'||typeof value==='boolean'?value:null;
        };
        try{body=clean(JSON.parse(raw));}catch{body=/^(text\/|application\/(json|problem\+json))/i.test(response.headers.get('content-type')||'')?sanitizeText(raw,config):'[non-text response omitted]';}
      }
    }
  } catch { /* Logging must not replace the original HTTP failure. */ }
  let endpoint='[endpoint unavailable]';try{const parsed=new URL(String(url));endpoint=sanitizeText(parsed.hostname+parsed.pathname,config);}catch{}
  const ids={};for(const name of ['x-request-id','x-fal-request-id','x-error-id','x-fal-error-id','request-id']){const value=response.headers.get(name);if(value)ids[name]=sanitizeText(value,config);}
  console.error('fal.ai HTTP error', {status:response.status,method:options?.method||'GET',endpoint,ids,body});
  return summarize(body);
}

// Reduce a sanitized diagnostic to one short line for the manifest and the UI.
// Only a parsed JSON body qualifies: clean() has already reduced that to the
// whitelisted error/message/detail/code fields. A plain-text or unknown body is
// arbitrary upstream prose and is still never echoed back to the browser.
function summarize(body) {
  if (!body || typeof body !== 'object') return '';
  const found=[];
  const walk=(value,depth=0)=>{
    if(depth>5 || found.length>=4)return;
    if(typeof value==='string'){if(value.trim())found.push(value.trim());return;}
    if(Array.isArray(value)){for(const item of value)walk(item,depth+1);return;}
    if(value && typeof value==='object')for(const item of Object.values(value))walk(item,depth+1);
  };
  walk(body);
  const text=[...new Set(found)].join(' · ').replace(/\s+/g,' ').trim();
  return text.startsWith('[REDACTED') ? '' : text.slice(0,300);
}

// Endpoints cap how many separate image inputs they accept. Preserve every
// supplied view by merging the surplus into one labelled contact sheet.
//
// `primary` marks the first buffer as the image the operation acts on rather
// than evidence about it: an outpaint canvas is the thing being extended, so
// burying it in a contact sheet would hand the endpoint a grid to extend. A
// single-input endpoint therefore receives the canvas alone, and the omitted
// reference views are reported so the caller can say so in the prompt and the
// manifest instead of silently claiming they were sent.
export async function packEvidence(buffers, limit = 4, primary = false) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid image input limit');
  if (buffers.length <= limit) return {buffers, mapping:buffers.map((_,i)=>[i]), omitted:[]};
  if (primary && limit === 1) return {buffers:[buffers[0]], mapping:[[0]], omitted:buffers.slice(1).map((_,i)=>i+1)};
  const keep=limit-1, rest=buffers.slice(keep), tile=768, columns=Math.min(2,rest.length), rows=Math.ceil(rest.length/columns);
  const layers=[];
  for(let i=0;i<rest.length;i++) {
    const photo=await sharp(rest[i]).resize(tile,tile-40,{fit:'contain',background:'#808080'}).png().toBuffer();
    layers.push({input:photo,left:(i%columns)*tile,top:Math.floor(i/columns)*tile+40});
    const label=Buffer.from(`<svg width="${tile}" height="40"><text x="12" y="28" font-size="24" fill="white">Input view ${i+keep+1}</text></svg>`);
    layers.push({input:label,left:(i%columns)*tile,top:Math.floor(i/columns)*tile});
  }
  const sheet=await sharp({create:{width:columns*tile,height:rows*tile,channels:3,background:'#808080'}}).composite(layers).png().toBuffer();
  return {buffers:[...buffers.slice(0,keep),sheet],mapping:[...buffers.slice(0,keep).map((_,i)=>[i]),rest.map((_,i)=>i+keep)],omitted:[]};
}

export async function editImage(config,buffers,prompt,_mask,transport,onProgress=async()=>{}) {
  if(config.mockOnly)throw new Error('Paid provider calls are disabled in mock mode.');
  const model=getModel(config.model);
  const signal=AbortSignal.timeout(config.timeoutMs);
  const rawNetwork=transport?.fetch || fetch;
  let requestId,diagnostic='';
  const network=async(url,options={})=>{const response=await rawNetwork(url,options);if(!response.ok)diagnostic=await logHttpError(response,url,options,config)||diagnostic;return response;};
  const client=transport ? null : createFalClient({credentials:config.apiKey,retry:{maxRetries:0},fetch:(url,options)=>network(url,{...options,signal})});
  const upload=transport?.upload || (file=>client.storage.upload(file));
  const pause=transport?.sleep || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  try {
    const prepared=_mask?[await sharp(buffers[0]).flatten({background:'#808080'}).png().toBuffer(),...buffers.slice(1)]:buffers;
    const [width,height]=config.size.split('x').map(Number);
    const text=model.promptLimit?condense(prompt,model.promptLimit):prompt;
    const urls=[];let mapping=[],inputCount=0,omitted=[],input;
    if(model.kind==='text') {
      // Documented as accepting no image input: the references are not uploaded.
      input=model.build({prompt:text,width,height,aspect:ASPECT[config.size]});
    } else if(model.kind==='archive') {
      await onProgress({phase:'Uploading reference archive to fal.ai'});
      const views=prepared.slice(0,model.maxImages);
      const archive=zipArchive(views.map((buffer,i)=>[`view_${i+1}.png`,buffer]));
      const archiveUrl=await upload(new File([archive],'references.zip',{type:'application/zip'}));
      mapping=views.map((_,i)=>[i]);inputCount=views.length;
      input=model.build({prompt:text,archiveUrl,width,height,aspect:ASPECT[config.size]});
    } else {
      const evidence=await packEvidence(prepared,model.maxImages,!!_mask);
      await onProgress({phase:'Uploading references to fal.ai'});
      for(let i=0;i<evidence.buffers.length;i++)urls.push(await upload(new File([evidence.buffers[i]],`view_${i+1}.png`,{type:'image/png'})));
      mapping=evidence.mapping;inputCount=urls.length;omitted=evidence.omitted;
      // Never tell an endpoint to use views it did not receive.
      const instructions=evidence.omitted.length
        ?' This endpoint accepts one image, so only the expanded canvas was sent and no separate reference photographs were supplied. Reconstruct the empty margins from the canvas alone.'
        :evidence.mapping.some(m=>m.length>1)?' The last input is an evidence contact sheet: use every panel as a separate source view. Return ONE photograph, never a collage or panel labels.':'';
      input=model.build({prompt:text+instructions,urls,width,height,aspect:ASPECT[config.size]});
    }
    // Native fetch performs exactly one submission. Never retry an ambiguous paid POST.
    const call=async(url,options={})=>{
      const response=await network(url,{...options,signal,headers:{Authorization:`Key ${config.apiKey}`,...options.headers}});
      if(!response.ok)throw Object.assign(new Error('Provider request failed'),{status:response.status});
      return response.json();
    };
    const queued=await call(`https://queue.fal.run/${model.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    requestId=queued.request_id;
    const safeQueueUrl=url=>{const parsed=new URL(url);if(parsed.origin!=='https://queue.fal.run')throw new Error('Invalid queue URL');return parsed.href;};
    const statusUrl=safeQueueUrl(queued.status_url),resultUrl=safeQueueUrl(queued.response_url);
    if(typeof requestId!=='string')throw new Error('Missing request ID');
    await onProgress({phase:'Queued at fal.ai',requestId});
    while(true) {
      signal.throwIfAborted();
      const status=await call(statusUrl);
      if(status.status==='COMPLETED')break;
      if(!['IN_QUEUE','IN_PROGRESS'].includes(status.status))throw new Error('Unexpected queue status');
      await onProgress({phase:status.status==='IN_QUEUE'?'Queued at fal.ai':'Processing at fal.ai',requestId});
      await pause(1500);
    }
    const result=await call(resultUrl);
    if(result.has_nsfw_concepts?.some(Boolean))throw Object.assign(new Error('Image blocked by provider safety checks'),{status:422});
    // Endpoints differ: images:[…] for most, a single image:{…} for WAN.
    const images=resultImages(model,result);
    if(!images.length)throw new Error('Provider returned no image');
    const imageUrl=new URL(images[0].url);
    if(imageUrl.protocol!=='https:' || !/(^|\.)(fal\.media|fal\.ai|fal\.run|fal\.space|storage\.googleapis\.com)$/.test(imageUrl.hostname))throw new Error('Unexpected result host');
    await onProgress({phase:'Downloading generated image',requestId});
    // Never attach provider credentials to image downloads.
    const response=await network(imageUrl.href,{signal,redirect:'error'});
    if(!response.ok)throw Object.assign(new Error('Download failed'),{status:response.status});
    const chunks=[];let bytes=0;
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>50*1024*1024)throw new Error('Image too large');chunks.push(chunk);}
    const buffer=await sharp(Buffer.concat(chunks),{limitInputPixels:40000000}).png().toBuffer();
    return {buffer,requestId,usage:null,returned:{provider:'fal.ai',model:model.id,modelLabel:model.label,modelKind:model.kind,seed:result.seed,timings:result.timings,inputMapping:mapping,inputCount,omittedInputs:omitted,imagesReturned:images.length,prompt:input.prompt,requestedSize:model.sizing==='dimensions'?{width,height}:model.sizing==='aspect'?ASPECT[config.size]:'endpoint default',promptTruncated:text.length<prompt.length}};
  } catch(error) {
    const reason=signal.aborted?'Timed out; the job may still be running and billed.':error.status===401?'Authentication failed; check the server provider key.':error.status===403?'Access denied by fal.ai. Check the server key permissions and model access.':error.status===422?'Image or parameters rejected by fal.ai.':error.status===429?'Rate limit or credit limit reached.':'Upload, queue, generation, or download failed.';
    // The provider's own explanation is the one thing that makes a 422 actionable.
    const explained=diagnostic?sanitizeText(diagnostic,config):'';
    throw new Error(`fal.ai${error.status?` HTTP ${error.status}`:''}: ${reason}${explained&&!explained.startsWith('[REDACTED')?` fal.ai said: ${explained}`:''} No automatic resubmission was made.${requestId?` Request ID: ${sanitizeText(requestId,config)}`:''}`);
  }
}

// Some endpoints document short prompt limits. Trim on paragraph boundaries so
// a truncated prompt still ends in a complete instruction.
export function condense(prompt,limit) {
  if(prompt.length<=limit)return prompt;
  const kept=[];let used=0;
  for(const paragraph of prompt.split('\n\n')) {
    const next=used?used+2+paragraph.length:paragraph.length;
    if(next>limit)break;
    kept.push(paragraph);used=next;
  }
  return kept.length?kept.join('\n\n'):prompt.slice(0,limit);
}
