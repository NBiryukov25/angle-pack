import { createFalClient } from '@fal-ai/client';
import sharp from 'sharp';

export const MODELS = ['fal-ai/flux-2/edit', 'fal-ai/flux-2-pro/edit'];

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
}

// FLUX.2 dev accepts at most four images. Preserve every view in a contact sheet.
export async function packEvidence(buffers) {
  if (buffers.length <= 4) return {buffers, mapping:buffers.map((_,i)=>[i])};
  const rest=buffers.slice(3), tile=768, columns=2, rows=Math.ceil(rest.length/columns);
  const layers=[];
  for(let i=0;i<rest.length;i++) {
    const photo=await sharp(rest[i]).resize(tile,tile-40,{fit:'contain',background:'#808080'}).png().toBuffer();
    layers.push({input:photo,left:(i%columns)*tile,top:Math.floor(i/columns)*tile+40});
    const label=Buffer.from(`<svg width="${tile}" height="40"><text x="12" y="28" font-size="24" fill="white">Input view ${i+4}</text></svg>`);
    layers.push({input:label,left:(i%columns)*tile,top:Math.floor(i/columns)*tile});
  }
  const sheet=await sharp({create:{width:columns*tile,height:rows*tile,channels:3,background:'#808080'}}).composite(layers).png().toBuffer();
  return {buffers:[...buffers.slice(0,3),sheet],mapping:[[0],[1],[2],rest.map((_,i)=>i+3)]};
}

export async function editImage(config,buffers,prompt,_mask,transport,onProgress=async()=>{}) {
  if(config.mockOnly)throw new Error('Paid provider calls are disabled in mock mode.');
  if(!MODELS.includes(config.model))throw new Error('Unsupported FAL_IMAGE_MODEL.');
  const signal=AbortSignal.timeout(config.timeoutMs);
  const rawNetwork=transport?.fetch || fetch;
  const network=async(url,options={})=>{const response=await rawNetwork(url,options);if(!response.ok)await logHttpError(response,url,options,config);return response;};
  const client=transport ? null : createFalClient({credentials:config.apiKey,retry:{maxRetries:0},fetch:(url,options)=>network(url,{...options,signal})});
  const upload=transport?.upload || (file=>client.storage.upload(file));
  const pause=transport?.sleep || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  let requestId;
  try {
    const prepared=_mask?[await sharp(buffers[0]).flatten({background:'#808080'}).png().toBuffer(),...buffers.slice(1)]:buffers;
    const evidence=await packEvidence(prepared), urls=[];
    await onProgress({phase:'Uploading references to fal.ai'});
    for(let i=0;i<evidence.buffers.length;i++)urls.push(await upload(new File([evidence.buffers[i]],`view_${i+1}.png`,{type:'image/png'})));
    const [width,height]=config.size.split('x').map(Number);
    const instructions=evidence.mapping.some(m=>m.length>1)?' The last input is an evidence contact sheet: use every panel as a separate source view. Return ONE photograph, never a collage or panel labels.':'';
    const input={prompt:prompt+instructions,image_urls:urls,image_size:{width,height},output_format:'png',enable_safety_checker:true,...(config.model==='fal-ai/flux-2/edit'?{num_images:1}:{})};
    // Native fetch performs exactly one submission. Never retry an ambiguous paid POST.
    const call=async(url,options={})=>{
      const response=await network(url,{...options,signal,headers:{Authorization:`Key ${config.apiKey}`,...options.headers}});
      if(!response.ok)throw Object.assign(new Error('Provider request failed'),{status:response.status});
      return response.json();
    };
    const queued=await call(`https://queue.fal.run/${config.model}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
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
    if(result.images?.length!==1)throw new Error('Expected one image');
    const imageUrl=new URL(result.images[0].url);
    if(imageUrl.protocol!=='https:' || !/(^|\.)(fal\.media|fal\.ai|fal\.run|fal\.space|storage\.googleapis\.com)$/.test(imageUrl.hostname))throw new Error('Unexpected result host');
    await onProgress({phase:'Downloading generated image',requestId});
    // Never attach provider credentials to image downloads.
    const response=await network(imageUrl.href,{signal,redirect:'error'});
    if(!response.ok)throw Object.assign(new Error('Download failed'),{status:response.status});
    const chunks=[];let bytes=0;
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>50*1024*1024)throw new Error('Image too large');chunks.push(chunk);}
    const buffer=await sharp(Buffer.concat(chunks),{limitInputPixels:40000000}).png().toBuffer();
    return {buffer,requestId,usage:null,returned:{provider:'fal.ai',model:config.model,seed:result.seed,timings:result.timings,inputMapping:evidence.mapping,inputCount:urls.length,prompt:input.prompt,image_size:input.image_size,num_images:1,enable_safety_checker:true,output_format:'png'}};
  } catch(error) {
    const reason=signal.aborted?'Timed out; the job may still be running and billed.':error.status===401?'Authentication failed; check the server provider key.':error.status===403?'Access denied by fal.ai. Check the server key permissions and model access.':error.status===422?'Image or parameters rejected by fal.ai.':error.status===429?'Rate limit or credit limit reached.':'Upload, queue, generation, or download failed.';
    throw new Error(`fal.ai${error.status?` HTTP ${error.status}`:''}: ${reason} No automatic resubmission was made.${requestId?` Request ID: ${sanitizeText(requestId,config)}`:''}`);
  }
}
