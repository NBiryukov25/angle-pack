import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { root } from './config.js';
import { JobStore } from './jobs.js';
import { jobSchema, regenerateSchema } from './schema.js';
import { createAuth } from './auth.js';
import { modelCatalog } from './models.js';

export async function createApp(config,transport) {
  const app=express(), store=new JobStore(config,transport), token=randomUUID();
  await store.init(); app.disable('x-powered-by');
  if(config.production)app.set('trust proxy',1);
  const auth=createAuth(config);
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"});
    if(config.production)res.set('Strict-Transport-Security','max-age=31536000');
    next();
  });
  app.use((req,res,next)=>{
    const origin=req.headers.origin;
    const sameOrigin=origin===`${req.protocol}://${req.headers.host}`;
    const allowed=origin==='https://nbiryukov25.github.io' || (!config.production && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin||''));
    if(origin && !allowed && !sameOrigin)return res.status(403).json({error:'Origin not allowed'});
    if(origin && allowed)res.set({'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Angle-Pack-Token','Access-Control-Expose-Headers':'Content-Disposition'});
    if(req.method==='OPTIONS')return res.sendStatus(204);
    next();
  });
  // Deployment identity only: the commit Render checked out. No configuration,
  // no secrets, and nothing that is not already public in the repository.
  app.get('/healthz',(req,res)=>res.json({status:'ok',commit:config.commit||'unknown'}));
  app.use((req,res,next)=>{
    const allowed=config.production ? true : /^((localhost|127\.0\.0\.1)(:\d+)?)$/.test(req.headers.host || '');
    if(!allowed)return res.status(403).json({error:'Host not allowed'});
    if(config.production && !req.secure)return res.status(400).json({error:'HTTPS required'});
    if(!['GET','HEAD'].includes(req.method) && config.authEnabled && !req.headers.origin && !req.headers.authorization)return res.status(403).json({error:'Origin required'});
    next();
  });
  app.use(express.json({limit:'32kb'}));
  app.get('/login',(req,res)=>config.authEnabled?res.sendFile(path.join(root,'public','login.html')):res.redirect('/'));
  for(const filename of ['login.js','style.css'])app.get(`/${filename}`,(req,res)=>res.sendFile(path.join(root,'public',filename)));
  app.post('/api/auth/login',(req,res)=>auth.login(req,res));
  app.use((req,res,next)=>{
    req.auth=config.authEnabled?auth.session(req):{token};
    if(!req.auth)return req.path.startsWith('/api/') || req.method!=='GET' ? res.status(401).json({error:'Sign in to continue.'}) : res.redirect('/login');
    if(!['GET','HEAD'].includes(req.method) && req.headers['x-angle-pack-token']!==req.auth.token)return res.status(403).json({error:'Refresh ANGLE PACK before submitting.'});
    next();
  });
  app.post('/api/auth/logout',(req,res)=>auth.logout(req,res));
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:15*1024*1024,files:5,fields:1,fieldSize:32000}});
  app.get('/api/config',(req,res)=>res.json({token:req.auth.token,authEnabled:config.authEnabled,hosted:config.production,mockOnly:config.mockOnly,liveAvailable:!config.mockOnly&&!!config.apiKey,model:config.model,models:modelCatalog(),size:config.size,quality:config.quality,dataDir:config.production?'temporary storage':config.dataDir}));
  let receiving=false;
  app.use(['/api/jobs','/api/sessions/:id/outputs/:index/regenerate'],(req,res,next)=>{
    if(req.method!=='POST')return next();
    if(store.active || receiving)return res.status(409).json({error:'Another submission is active, or the server is restarting. Wait before submitting.'});
    receiving=true;
    const release=()=>{receiving=false;};res.once('finish',release);res.once('close',release);next();
  });
  app.get('/api/sessions',(req,res)=>res.json([...store.jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(j=>({id:j.id,createdAt:j.createdAt,mode:j.mode,execution:j.execution,status:j.status,count:j.outputs.length}))));
  app.get('/api/sessions/:id',(req,res)=>res.json(store.get(req.params.id)));
  app.post('/api/jobs',upload.array('references',5),async(req,res)=>{
    let raw;try {raw=JSON.parse(req.body.spec);} catch {throw Object.assign(new Error('Invalid job settings'),{status:400});}
    const spec=jobSchema.parse(raw);res.status(202).json(await store.create(spec,req.files || []));
  });
  app.post('/api/sessions/:id/outputs/:index/regenerate',async(req,res)=>{
    if (!/^[0-4]$/.test(req.params.index)) return res.status(404).json({error:'Output not found'});
    res.status(202).json(await store.regenerate(req.params.id,Number(req.params.index),regenerateSchema.parse(req.body),req.headers['idempotency-key']));
  });
  app.get('/api/sessions/:id/file/:filename',(req,res)=>{
    const job=store.get(req.params.id), name=req.params.filename;
    const allowed=['manifest.json',...job.outputs.flatMap(o=>[o,...o.history]).filter(o=>o.status==='complete').map(o=>o.generatedFilename)];
    if (!allowed.includes(name)) return res.status(404).json({error:'File not found'});
    if (req.query.download==='1') res.attachment(name);
    res.sendFile(path.join(store.folder(job.id),name));
  });
  app.get('/api/sessions/:id/reference/:index',(req,res)=>{
    const job=store.get(req.params.id);
    if (!/^[0-4]$/.test(req.params.index) || !job.references[Number(req.params.index)]) return res.status(404).end();
    res.sendFile(path.join(store.folder(job.id),job.references[Number(req.params.index)].normalizedFile));
  });
  app.use(express.static(path.join(root,'public')));
  app.use((error,req,res,next)=>{
    if (res.headersSent) return next(error);
    const validation=error.name==='ZodError';
    const status=validation || error instanceof multer.MulterError ? 400 : error.status || 500;
    res.status(status).json({error:validation ? error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ') : config.production && status===500 ? 'Internal request failure. Check the service and storage status before retrying.' : error.message || 'Request failed'});
  });
  return {app,store};
}
