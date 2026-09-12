// Shared provider-diagnostic sanitizer. Both the fal.ai and Segmind adapters
// run every upstream error through this before it can reach a log or a browser.
// Diagnostics inspect responses only, never request headers, bodies, or image buffers.
export function sanitizeText(value, config) {
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

export async function logHttpError(response,url,options,config) {
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
export function summarize(body) {
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

