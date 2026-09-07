import path from 'node:path';
import os from 'node:os';
import { MODELS } from './fal.js';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function getConfig(env = process.env) {
  const production = env.NODE_ENV === 'production' || env.RENDER === 'true';
  const password=env.APP_PASSWORD || '';
  const authEnabled=production || !!password;
  if(authEnabled && (password.length<12 || password.length>256))throw new Error('Set APP_PASSWORD to a password of 12–256 characters.');
  const integer=(key,fallback,min,max)=>{const value=Number(env[key] ?? fallback);if(!Number.isInteger(value)||value<min||value>max)throw new Error(`Invalid ${key}`);return value;};
  const quality = 'standard';
  const size = env.FAL_IMAGE_SIZE || '1024x1536';
  if (!['1024x1024','1024x1536','1536x1024'].includes(size)) throw new Error('Invalid FAL_IMAGE_SIZE');
  const model=env.FAL_IMAGE_MODEL || 'fal-ai/flux-2/edit';
  if(!MODELS.includes(model))throw new Error('Unsupported FAL_IMAGE_MODEL; use fal-ai/flux-2/edit or fal-ai/flux-2-pro/edit.');
  return {
    production, authEnabled, password,
    host:production?'0.0.0.0':'127.0.0.1',
    mockOnly: process.argv.includes('--mock') || env.ANGLE_PACK_MOCK !== 'false',
    apiKey: env.FAL_KEY || '',
    model, quality, size,
    provider:'fal.ai', endpoint: `https://queue.fal.run/${model}`,
    timeoutMs: 600000,
    dataDir: production ? path.join(os.tmpdir(),'angle-pack') : path.resolve(env.ANGLE_PACK_DATA_DIR || path.join(root,'sessions')),
    port: integer('PORT',3210,1,65535),
  };
}
