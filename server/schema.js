import { z } from 'zod';
import { ANGLES, FRAMINGS, PRESERVATIONS } from '../public/presets.js';
import { MODEL_IDS } from './models.js';
const modelId = z.enum(MODEL_IDS);
const crop = z.object({x:z.number().min(0).max(1), y:z.number().min(0).max(1), w:z.number().positive().max(1), h:z.number().positive().max(1)}).refine(c => c.x+c.w <= 1.00001 && c.y+c.h <= 1.00001, 'Crop must remain inside the reference');
export const outputSchema = z.object({
  angle:z.enum(Object.keys(ANGLES)), framing:z.enum(Object.keys(FRAMINGS)),
  custom:z.string().max(1500).default(''), sourceIndex:z.number().int().min(0).max(4).default(0),
  crop:crop.optional(), expansion:z.number().min(1.1).max(3).default(1.6),
  model:modelId.optional(),
}).refine(o => o.angle !== 'CUSTOM' || o.custom.trim().length > 0, 'Describe the custom camera position');
export const jobSchema = z.object({
  mode:z.enum(['CROP_ZOOM','OUTPAINT_ZOOM','GENERATIVE_ANGLE']),
  execution:z.enum(['MOCK','LIVE']).default('MOCK'),
  outputs:z.array(outputSchema).min(1).max(5),
  preservation:z.object(Object.fromEntries(PRESERVATIONS.map(k => [k,z.enum(['OFF','MEDIUM','HIGH'])]))),
  referenceAngles:z.array(z.enum(['UNKNOWN',...Object.keys(ANGLES)])).max(5).default([]),
  notes:z.string().max(2000).default(''),
  model:modelId.optional(),
});
export const regenerateSchema = z.object({output:outputSchema, execution:z.enum(['MOCK','LIVE'])});
