import { getModel } from './models.js';
import { editImage as falEdit } from './fal.js';
import { editImage as segmindEdit } from './segmind.js';

// One entry point for generation. The model entry names its provider, so
// selecting a model selects a provider and the frontend needs no knowledge of
// either. fal.ai stays available behind the same call.
const ADAPTERS = {fal: falEdit, segmind: segmindEdit};

export function providerFor(modelId) {
  return getModel(modelId).provider;
}

// The credential each provider authenticates with; never leaves the server.
export function keyFor(config, provider) {
  return provider === 'segmind' ? config.segmindKey : config.apiKey;
}

export function providerReady(config, provider) {
  return !!keyFor(config, provider);
}

export async function generateImage(config, buffers, prompt, mask, transport, onProgress, extras) {
  const provider = providerFor(config.model);
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`No adapter for provider ${provider}`);
  return adapter(config, buffers, prompt, mask, transport, onProgress, extras);
}
