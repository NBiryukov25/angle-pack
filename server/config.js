import path from 'node:path';
import os from 'node:os';
import { MODEL_IDS, DEFAULT_MODEL, MODELS } from './models.js';
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
  // ANGLE_PACK_MODEL is the provider-neutral name; FAL_IMAGE_MODEL still works
  // so an existing deployment keeps running after the Segmind switch.
  const model=env.ANGLE_PACK_MODEL || env.FAL_IMAGE_MODEL || DEFAULT_MODEL;
  if(!MODEL_IDS.includes(model))throw new Error(`Unsupported ANGLE_PACK_MODEL. Use one of: ${MODEL_IDS.join(', ')}`);
  return {
    production, authEnabled, password,
    commit: (env.RENDER_GIT_COMMIT || env.SOURCE_COMMIT || '').trim(),
    host:production?'0.0.0.0':'127.0.0.1',
    mockOnly: process.argv.includes('--mock') || env.ANGLE_PACK_MOCK !== 'false',
    apiKey: env.FAL_KEY || '',
    segmindKey: env.SEGMIND_API_KEY || '',
    model, quality, size,
    provider: MODELS[model].provider, endpoint: MODELS[model].endpoint || `https://queue.fal.run/${model}`,
    timeoutMs: 600000,
    dataDir: production ? path.join(os.tmpdir(),'angle-pack') : path.resolve(env.ANGLE_PACK_DATA_DIR || path.join(root,'sessions')),
    port: integer('PORT',3210,1,65535),
  };
}
