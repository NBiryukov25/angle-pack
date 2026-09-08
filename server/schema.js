import { z } from 'zod';
import { ANGLES, FRAMINGS, PRESERVATIONS, ATTRIBUTES, MODES, MODE_KEYS } from '../public/presets.js';
import { MODEL_IDS } from './models.js';
const modelId = z.enum(MODEL_IDS);
const crop = z.object({x:z.number().min(0).max(1), y:z.number().min(0).max(1), w:z.number().positive().max(1), h:z.number().positive().max(1)}).refine(c => c.x+c.w <= 1.00001 && c.y+c.h <= 1.00001, 'Crop must remain inside the reference');
const attribute = z.object({attribute:z.enum(Object.keys(ATTRIBUTES)), reference:z.number().int().min(0).max(4)});
export const outputSchema = z.object({
  angle:z.enum(Object.keys(ANGLES)), framing:z.enum(Object.keys(FRAMINGS)),
  custom:z.string().max(1500).default(''), sourceIndex:z.number().int().min(0).max(4).default(0),
  crop:crop.optional(), expansion:z.number().min(1.1).max(3).default(1.6),
  model:modelId.optional(), attributes:z.array(attribute).max(10).default([]),
}).refine(o => o.angle !== 'CUSTOM' || o.custom.trim().length > 0, 'Describe the custom camera position');

// Shared by submission and by regeneration, which carries no mode of its own.
export function outputIssues(mode, output) {
  const rules = MODES[mode] || {}, issues = [];
  if (rules.requiresDirection && !output.custom.trim()) issues.push(`${rules.label} needs a written direction for each output`);
  if (rules.requiresAttributes) {
    if (output.attributes.length < 2) issues.push(`${rules.label} needs at least two attribute sources for each output`);
    const named = output.attributes.map(a => a.attribute);
    if (new Set(named).size !== named.length) issues.push('Assign each attribute only once per output');
  } else if (output.attributes.length) issues.push(`${rules.label} does not use attribute sources`);
  return issues;
}
export const jobSchema = z.object({
  mode:z.enum(MODE_KEYS),
  execution:z.enum(['MOCK','LIVE']).default('MOCK'),
  outputs:z.array(outputSchema).min(1).max(5),
  preservation:z.object(Object.fromEntries(PRESERVATIONS.map(k => [k,z.enum(['OFF','MEDIUM','HIGH'])]))),
  referenceAngles:z.array(z.enum(['UNKNOWN',...Object.keys(ANGLES)])).max(5).default([]),
  notes:z.string().max(2000).default(''),
  model:modelId.optional(),
}).superRefine((job,ctx) => {
  job.outputs.forEach((output,index) => {
    for (const message of outputIssues(job.mode,output)) ctx.addIssue({code:'custom',message,path:['outputs',index]});
  });
  const rules = MODES[job.mode];
  if (rules?.requiresModels) {
    const chosen = new Set(job.outputs.map(o => o.model || job.model || 'session default'));
    if (chosen.size < rules.requiresModels) ctx.addIssue({code:'custom',message:`${rules.label} needs at least ${rules.requiresModels} different models across the outputs`,path:['outputs']});
  }
});
export const regenerateSchema = z.object({output:outputSchema, execution:z.enum(['MOCK','LIVE'])});
