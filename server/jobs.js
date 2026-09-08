import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { buildPrompt } from './prompts.js';
import { normalizeReference, cropImage, outpaintInputs, mockImage, editImage, referenceBuffers } from './imaging.js';
import { getModel } from './models.js';

const now = () => new Date().toISOString();
const modelSlug = id => id.split('/').slice(1).join('-').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase();
export class JobStore {
  constructor(config, transport) { this.config=config; this.transport=transport; this.active=false; this.jobs=new Map(); }
  folder(id) { if (!/^[0-9T_Z-]+_[a-f0-9-]{36}$/.test(id)) throw Object.assign(new Error('Session not found'),{status:404}); return path.join(this.config.dataDir,id); }
  async persist(job) {
    job.updatedAt=now(); const filename=path.join(this.folder(job.id),'manifest.json');
    await writeFile(`${filename}.tmp`, JSON.stringify(job,null,2)); await rename(`${filename}.tmp`,filename);
  }
  async init() {
    await mkdir(this.config.dataDir,{recursive:true});
    for (const entry of await readdir(this.config.dataDir,{withFileTypes:true})) {
      if (!entry.isDirectory()) continue;
      try {
        const job=JSON.parse(await readFile(path.join(this.folder(entry.name),'manifest.json'),'utf8'));
        if (['running','queued'].includes(job.status)) {
          job.status='interrupted';
          for (const out of job.outputs) if (['running','queued'].includes(out.status)) { out.status='interrupted'; out.error='Server stopped before completion. Check saved files before explicitly retrying; a provider request may have been billed.'; }
          await this.persist(job);
        }
        this.jobs.set(job.id,job);
      } catch { /* Ignore unrelated folders or incomplete initial uploads. */ }
    }
  }
  get(id) { const job=this.jobs.get(id); if (!job) throw Object.assign(new Error('Session not found'),{status:404}); return job; }
  assertLive(execution,mode) {
    if (execution==='LIVE' && mode!=='CROP_ZOOM' && (this.config.mockOnly || !this.config.apiKey)) throw Object.assign(new Error('Live generation is disabled. Set ANGLE_PACK_MOCK=false and FAL_KEY in .env, then restart.'),{status:400});
  }
  // Outpaint sends the expanded canvas as an image input, so a text-only
  // endpoint would silently discard the very thing being extended.
  assertModels(mode,ids) {
    if (mode==='CROP_ZOOM') return;
    for (const id of ids) {
      const model=getModel(id);
      if (mode==='OUTPAINT_ZOOM' && model.kind==='text') throw Object.assign(new Error(`${model.label} accepts no image input, so it cannot outpaint a canvas. Choose a model that uses your references.`),{status:400});
    }
  }
  async create(spec,files) {
    if (this.active) throw Object.assign(new Error('Another job is running. Wait for it to finish.'),{status:409});
    this.assertLive(spec.execution,spec.mode);
    this.assertModels(spec.mode,[spec.model||this.config.model,...spec.outputs.map(o=>o.model).filter(Boolean)]);
    if (!files.length || files.length>5) throw Object.assign(new Error('Upload 1–5 reference photographs.'),{status:400});
    if (spec.outputs.some(o => o.sourceIndex>=files.length)) throw Object.assign(new Error('Selected reference does not exist.'),{status:400});
    this.active=true;
    try {
      const normalized=[];
      for (const f of files) normalized.push(await normalizeReference(f.buffer));
      const id=`${now().replace(/[:.]/g,'-')}_${randomUUID()}`;
      const folder=this.folder(id); await mkdir(path.join(folder,'references'),{recursive:true});
      const references=[];
      for (let i=0;i<files.length;i++) {
        const originalFile=`references/ref_${i+1}.original`;
        const normalizedFile=`references/ref_${i+1}.png`;
        await writeFile(path.join(folder,originalFile),files[i].buffer);
        await writeFile(path.join(folder,normalizedFile),normalized[i]);
        const meta=await sharp(normalized[i]).metadata();
        references.push({originalName:files[i].originalname,originalFile,normalizedFile,sha256:createHash('sha256').update(files[i].buffer).digest('hex'),width:meta.width,height:meta.height,angle:spec.referenceAngles[i] || 'UNKNOWN'});
      }
      const job={schemaVersion:1,id,createdAt:now(),...spec,references,config:{provider:'fal.ai',model:spec.model||this.config.model,size:this.config.size,quality:this.config.quality,endpoint:this.config.endpoint},status:'queued',limitation:'AI camera angles are plausible reconstructions, not exact scene geometry. Identical inputs do not guarantee identical outputs.',outputs:spec.outputs.map((o,i)=>({...o,index:i,status:'queued',history:[]}))};
      await this.persist(job); this.jobs.set(id,job);
      this.run(job,job.outputs.map((_,i)=>i)).catch(()=>{});
      return job;
    } catch (error) { this.active=false; throw error; }
  }
  async regenerate(id,index,spec) {
    if (this.active) throw Object.assign(new Error('Another job is running.'),{status:409});
    const job=this.get(id); const out=job.outputs[index];
    if (!out) throw Object.assign(new Error('Output not found'),{status:404});
    this.assertLive(spec.execution,job.mode);
    this.assertModels(job.mode,[spec.output.model||job.config.model]);
    if (spec.output.sourceIndex>=job.references.length) throw Object.assign(new Error('Reference not found'),{status:400});
    this.active=true;
    try {
      const {history,...previous}=out;
      job.outputs[index]={...spec.output,index,status:'queued',history:[...history,previous]};
      job.execution=spec.execution; job.status='queued';
      if(job.config.provider!=='fal.ai')job.config={provider:'fal.ai',model:this.config.model,size:this.config.size,quality:this.config.quality,endpoint:this.config.endpoint};
      await this.persist(job); this.run(job,[index]).catch(()=>{}); return job;
    } catch (error) { this.active=false; throw error; }
  }
  async run(job,indices) {
    try {
      job.status='running'; await this.persist(job);
      const folder=this.folder(job.id), buffers=await referenceBuffers(folder,job.references);
      for (const index of indices) {
        const out=job.outputs[index]; out.status='running';out.startedAt=now();out.execution=job.execution;
        out.mode=job.mode;out.preservation={...job.preservation};
        // An output may override the session model; CROP_ZOOM never uses one.
        const modelId=job.mode==='CROP_ZOOM'?null:out.model||job.config.model;
        const variant=out.model&&out.model!==job.config.model?`_${modelSlug(out.model)}`:'';
        out.generatedFilename=`${job.execution==='MOCK' && job.mode!=='CROP_ZOOM' ? 'mock_' : ''}angle_${String(index+1).padStart(2,'0')}_${job.mode==='GENERATIVE_ANGLE' ? out.angle.toLowerCase() : 'source'}_${out.framing.toLowerCase()}${variant}${out.history.length ? `_v${out.history.length+1}` : ''}.png`;
        await this.persist(job);
        try {
          let buffer;
          if (job.mode==='CROP_ZOOM') {
            const cropped=await cropImage(buffers[out.sourceIndex],out);buffer=cropped.buffer;
            out.generationParameters={engine:'sharp',rectangle:cropped.rectangle,n:1,apiRequests:0};
          } else {
            // Resolved here so an unknown saved model fails one output, not the session.
            const model=getModel(modelId);
            out.prompt=buildPrompt(job,out);
            let inputs=buffers,mask;
            if (job.mode==='OUTPAINT_ZOOM') {
              const padded=await outpaintInputs(buffers[out.sourceIndex],out,job.config.size);
              const prefix=`outpaint_${index+1}_v${out.history.length+1}`;
              await writeFile(path.join(folder,`${prefix}_canvas.png`),padded.canvas);
              await writeFile(path.join(folder,`${prefix}_mask.png`),padded.mask);
              out.outpaint={...padded.placement,canvasFile:`${prefix}_canvas.png`,maskFile:`${prefix}_mask.png`};
              inputs=[padded.canvas,...buffers];mask=padded.mask;
            }
            const parameters={model:model.id,modelLabel:model.label,modelFamily:model.family,usesReferences:model.kind!=='text',size:job.config.size,quality:job.config.quality,n:1,output_format:'png',referenceCount:buffers.length,inputImageCount:model.kind==='text'?0:inputs.length,mask:false,promptGuidedOutpaint:!!mask};
            out.generationParameters={...parameters,apiRequests:job.execution==='LIVE'?1:0};
            await this.persist(job);
            if (job.execution==='MOCK') buffer=await mockImage(buffers[out.sourceIndex],out,job.mode,job.config.size);
            else {
              const result=await editImage({...this.config,...job.config,model:model.id},inputs,out.prompt,mask,this.transport,async progress=>{out.providerProgress=progress.phase;if(progress.requestId)out.requestId=progress.requestId;await this.persist(job);});
              buffer=result.buffer;out.requestId=result.requestId;out.usage=result.usage;out.returnedParameters=result.returned;out.generationParameters.inputMapping=result.returned.inputMapping;out.generationParameters.inputImageCount=result.returned.inputCount;
            }
          }
          await writeFile(path.join(folder,out.generatedFilename),buffer,{flag:'wx'});
          out.sha256=createHash('sha256').update(buffer).digest('hex');out.status='complete';
        } catch (error) {
          out.status='failed';out.error=error.name==='TimeoutError' ? 'Request timed out. It may have been billed. No automatic retry was made.' : error.message;
        }
        out.completedAt=now();await this.persist(job);
      }
      job.status=job.outputs.every(o=>o.status==='complete')?'complete':'partial';
      await this.persist(job);
    } catch { job.status='interrupted'; await this.persist(job).catch(()=>{}); }
    finally { this.active=false; }
  }
}
