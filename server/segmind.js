import sharp from 'sharp';
import { packEvidence } from './fal.js';
import { getModel, resolveOutputSize } from './models.js';
import { sanitizeText, logHttpError } from './sanitize.js';

// Segmind adapter.
//
// Segmind has no asset store in our stack and our own file routes require
// authentication, so there is no URL we could hand it. Its image fields accept
// a base64 payload directly in the JSON body, which is the documented
// alternative, so references travel inline.
//
// Endpoints are synchronous: a successful POST returns the image bytes, not a
// job id, so there is no queue to poll and no ambiguous in-flight state.
//
// Documented per endpoint in server/models.js. Neither Qwen Image Edit Plus nor
// Next Scene documents negative_prompt, steps or guidance, so none is sent.

// A reference is transported byte-for-byte unless the encoded body would be
// unreasonable, in which case the longest edge is reduced and the manifest says
// so. Aspect is never altered.
export const TRANSPORT_BYTE_BUDGET = 6 * 1024 * 1024;
export const TRANSPORT_MAX_EDGE = 2048;

export async function prepareForTransport(buffer, budget = TRANSPORT_BYTE_BUDGET) {
  if (buffer.length <= budget) return {buffer, resized: false};
  const meta = await sharp(buffer).metadata();
  const longest = Math.max(meta.width, meta.height);
  if (longest <= TRANSPORT_MAX_EDGE) return {buffer, resized: false};
  const resized = await sharp(buffer)
    .resize({width: meta.width >= meta.height ? TRANSPORT_MAX_EDGE : null,
             height: meta.height > meta.width ? TRANSPORT_MAX_EDGE : null,
             fit: 'inside', withoutEnlargement: true})
    .png().toBuffer();
  return {buffer: resized, resized: true, from: {width: meta.width, height: meta.height}};
}

const dataUri = buffer => `data:image/png;base64,${buffer.toString('base64')}`;

export async function editImage(config, buffers, prompt, _mask, transport, onProgress = async () => {}, extras = {}) {
  if (config.mockOnly) throw new Error('Paid provider calls are disabled in mock mode.');
  const model = getModel(config.model);
  const signal = AbortSignal.timeout(config.timeoutMs);
  const rawNetwork = transport?.fetch || fetch;
  let diagnostic = '';
  const network = async (url, options = {}) => {
    const response = await rawNetwork(url, options);
    if (!response.ok) diagnostic = await logHttpError(response, url, options, config) || diagnostic;
    return response;
  };
  try {
    const prepared = _mask
      ? [await sharp(buffers[0]).flatten({background: '#808080'}).png().toBuffer(), ...buffers.slice(1)]
      : buffers;
    const [budgetWidth, budgetHeight] = config.size.split('x').map(Number);
    let sourceAspect;
    try { const meta = await sharp(prepared[0]).metadata(); sourceAspect = meta.width / meta.height; } catch { /* fall back to the configured shape */ }
    const size = resolveOutputSize(model, sourceAspect, {width: budgetWidth, height: budgetHeight});

    const evidence = await packEvidence(prepared, model.maxImages, !!_mask);
    await onProgress({phase: 'Encoding references for Segmind'});
    const images = {}; let resizedForTransport = 0;
    for (let i = 0; i < evidence.buffers.length && i < model.fields.length; i++) {
      const carried = await prepareForTransport(evidence.buffers[i]);
      if (carried.resized) resizedForTransport++;
      images[model.fields[i]] = dataUri(carried.buffer);
    }
    const input = model.build({prompt, images, aspect: size.aspect, seed: extras.seed});

    await onProgress({phase: 'Generating at Segmind'});
    const response = await network(model.endpoint, {
      method: 'POST', signal,
      headers: {'x-api-key': config.segmindKey, 'Content-Type': 'application/json'},
      body: JSON.stringify(input),
    });
    if (!response.ok) throw Object.assign(new Error('Provider request failed'), {status: response.status});

    const type = response.headers.get('content-type') || '';
    // `ours` marks a message this adapter wrote, which is safe to surface;
    // upstream prose is never treated this way.
    if (!/^image\//i.test(type) && !/octet-stream/i.test(type)) throw Object.assign(new Error(`Expected an image, received ${sanitizeText(type, config) || 'an unknown content type'}.`), {ours: true});
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 50 * 1024 * 1024) throw new Error('Image too large'); chunks.push(chunk); }
    if (!bytes) throw Object.assign(new Error('Provider returned no image.'), {ours: true});
    const buffer = await sharp(Buffer.concat(chunks), {limitInputPixels: 40000000}).png().toBuffer();
    const out = await sharp(buffer).metadata();

    // Normalised into the same shape the fal adapter returns.
    return {buffer, requestId: sanitizeText(response.headers.get('x-request-id') || '', config) || null, usage: null, returned: {
      provider: 'segmind', model: model.id, modelLabel: model.label, modelKind: model.kind,
      seed: input.seed ?? null, timings: null,
      inputMapping: evidence.mapping, inputCount: Object.keys(images).length, omittedInputs: evidence.omitted,
      imagesReturned: 1, prompt: input.prompt, negativePrompt: null, guidanceScale: null, strength: null,
      requestedSize: size.aspect, sourceAspect: sourceAspect ?? null,
      outputSize: {width: out.width, height: out.height},
      resizedForTransport, imageFields: Object.keys(images),
    }};
  } catch (error) {
    const reason = error.ours ? error.message
      : signal.aborted ? 'Timed out; the job may still be running and billed.'
      : error.status === 401 || error.status === 403 ? 'Authentication failed or access denied; check SEGMIND_API_KEY and the model entitlement.'
      : error.status === 404 ? 'Endpoint not found; the model slug may have changed.'
      : error.status === 406 ? 'Insufficient Segmind credits.'
      : error.status === 422 ? 'Image or parameters rejected by Segmind.'
      : error.status === 429 ? 'Rate limit reached.'
      : 'Encoding, generation or download failed.';
    const explained = diagnostic ? sanitizeText(diagnostic, config) : '';
    throw new Error(`Segmind${error.status ? ` HTTP ${error.status}` : ''}: ${reason}${explained && !explained.startsWith('[REDACTED') ? ` Segmind said: ${explained}` : ''} No automatic resubmission was made.`);
  }
}
