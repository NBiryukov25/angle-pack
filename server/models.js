// Still-image model registry for fal.ai.
//
// Every field below mirrors the documented input schema of that endpoint, so no
// request payload is assembled by guesswork. Each entry records the docs URL it
// was transcribed from. Adding a model is a data change here, never a change in
// server/fal.js.
//
//   kind      'edit'    one or more reference images are sent as image inputs
//             'archive' references are sent as a single uploaded ZIP archive
//             'text'    the endpoint accepts no image input at all
//   sizing    'dimensions' image_size:{width,height} · 'aspect' aspect_ratio
//             string · 'none' the endpoint has no output-size control
//   maxImages how many separate image inputs the endpoint accepts. Extra
//             reference views are merged into one labelled contact sheet.
//   negative  the endpoint documents a negative_prompt field, so identity and
//             garment prohibitions can be sent as a hard exclusion list rather
//             than relying on prose alone. Endpoints without one are not
//             weaker: every prohibition is also stated in the positive prompt.
//   strength  image-to-image denoising. Sent only where documented; derived
//             from the FACE preservation level, because a high value redraws
//             the subject and destroys the identity the reference establishes.

export const DEFAULT_MODEL = 'fal-ai/flux-2/edit';

// The three supported FAL_IMAGE_SIZE values as provider aspect-ratio strings.
export const ASPECT = {'1024x1024':'1:1','1024x1536':'2:3','1536x1024':'3:2'};

// fal endpoints return either images:[…] (most) or a single image:{…} (WAN).
const listed = result => Array.isArray(result?.images) ? result.images : result?.image ? [result.image] : [];

// PhotoMaker only applies the reference identity where the prompt carries its
// class-word trigger, so the adapter guarantees one is present.
export const PHOTOMAKER_TRIGGER = 'A photorealistic photograph of a person img.';

export const MODELS = {
  'fal-ai/flux-2/edit': {
    label:'FLUX.2 [dev] Edit', family:'FLUX', kind:'edit', sizing:'dimensions', maxImages:4,
    docs:'https://fal.ai/models/fal-ai/flux-2/edit/api',
    note:'Default. Multi-reference photo edit, up to four separate image inputs.',
    guidance:3.5,
    build:({prompt,urls,width,height,guidance})=>({prompt,image_urls:urls,image_size:{width,height},num_images:1,output_format:'png',enable_safety_checker:true,guidance_scale:guidance}),
  },
  'fal-ai/flux-2-pro/edit': {
    label:'FLUX.2 [pro] Edit', family:'FLUX', kind:'edit', sizing:'dimensions', maxImages:4,
    docs:'https://fal.ai/models/fal-ai/flux-2-pro/edit/api',
    note:'Higher-fidelity FLUX.2 edit. The endpoint documents no num_images field.',
    build:({prompt,urls,width,height})=>({prompt,image_urls:urls,image_size:{width,height},output_format:'png',enable_safety_checker:true,safety_tolerance:'2'}),
  },
  'fal-ai/flux-pro/kontext/max/multi': {
    label:'FLUX.1 Kontext [max] Multi', family:'FLUX', kind:'edit', sizing:'aspect', maxImages:4,
    docs:'https://fal.ai/models/fal-ai/flux-pro/kontext/max/multi/api',
    note:'Kontext multi-image edit. Output size is an aspect ratio, not exact pixels.',
    guidance:4,
    build:({prompt,urls,aspect,guidance})=>({prompt,image_urls:urls,aspect_ratio:aspect,num_images:1,output_format:'png',safety_tolerance:'2',guidance_scale:guidance}),
  },
  'fal-ai/qwen-image-edit-plus': {
    label:'Qwen Image Edit Plus', family:'Qwen', kind:'edit', sizing:'dimensions', maxImages:4,
    docs:'https://fal.ai/models/fal-ai/qwen-image-edit-plus/api',
    note:'Qwen multi-image edit. Accepts several reference views in one request.',
    negative:true,
    build:({prompt,negative,urls,width,height})=>({prompt,negative_prompt:negative,image_urls:urls,image_size:{width,height},num_images:1,output_format:'png',enable_safety_checker:true,acceleration:'regular'}),
  },
  'fal-ai/qwen-image-edit': {
    label:'Qwen Image Edit', family:'Qwen', kind:'edit', sizing:'dimensions', maxImages:1,
    docs:'https://fal.ai/models/fal-ai/qwen-image-edit/api',
    note:'Single-image Qwen edit. Extra reference views arrive as one contact sheet.',
    negative:true,
    build:({prompt,negative,urls,width,height})=>({prompt,negative_prompt:negative,image_url:urls[0],image_size:{width,height},num_images:1,output_format:'png',enable_safety_checker:true,acceleration:'regular'}),
  },
  'fal-ai/qwen-image': {
    label:'Qwen Image (text to image)', family:'Qwen', kind:'text', sizing:'dimensions', maxImages:0,
    docs:'https://fal.ai/models/fal-ai/qwen-image/api',
    note:'Text to image only. Your reference photographs are NOT sent to this endpoint.',
    negative:true,
    build:({prompt,negative,width,height})=>({prompt,negative_prompt:negative,image_size:{width,height},num_images:1,output_format:'png',enable_safety_checker:true}),
  },
  'fal-ai/wan/v2.2-a14b/image-to-image': {
    label:'WAN 2.2 A14B Image to Image', family:'WAN', kind:'edit', sizing:'dimensions', maxImages:1,
    docs:'https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-image/api',
    note:'Single-image WAN redraw. strength 0.5 keeps roughly half of the source.',
    negative:true, strength:{HIGH:0.35,MEDIUM:0.5,OFF:0.7},
    build:({prompt,negative,urls,width,height,strength})=>({prompt,negative_prompt:negative,image_url:urls[0],image_size:{width,height},strength,image_format:'png',enable_safety_checker:true,enable_output_safety_checker:true}),
  },
  'fal-ai/wan/v2.2-a14b/text-to-image': {
    label:'WAN 2.2 A14B (text to image)', family:'WAN', kind:'text', sizing:'dimensions', maxImages:0,
    docs:'https://fal.ai/models/fal-ai/wan/v2.2-a14b/text-to-image/api',
    note:'Text to image only. Your reference photographs are NOT sent to this endpoint.',
    negative:true,
    build:({prompt,negative,width,height})=>({prompt,negative_prompt:negative,image_size:{width,height},enable_safety_checker:true,enable_output_safety_checker:true}),
  },
  'fal-ai/photomaker': {
    label:'PhotoMaker (identity)', family:'PhotoMaker', kind:'archive', sizing:'none', maxImages:5, promptLimit:900,
    docs:'https://fal.ai/models/fal-ai/photomaker/api',
    note:'Identity model. References upload as one ZIP archive; the endpoint has no output-size control and returns roughly square images.',
    negative:true,
    build:({prompt,negative,archiveUrl})=>({image_archive_url:archiveUrl,prompt:`${PHOTOMAKER_TRIGGER} ${prompt}`,negative_prompt:negative,base_pipeline:'photomaker',style:'Photographic',num_images:1,style_strength:15}),
  },
};

export const MODEL_IDS = Object.keys(MODELS);

// The aspect ratios Kontext accepts; it takes no pixel dimensions.
export const KONTEXT_RATIOS = ['21:9','16:9','4:3','3:2','1:1','2:3','3:4','9:16','9:21'];

const clamp32 = n => Math.max(512, Math.min(2048, Math.round(n / 32) * 32));
const nearestRatio = aspect => KONTEXT_RATIOS.reduce((best, ratio) => {
  const [w, h] = ratio.split(':').map(Number);
  const distance = Math.abs(Math.log(aspect) - Math.log(w / h));
  return distance < best.distance ? {ratio, distance} : best;
}, {ratio: '1:1', distance: Infinity}).ratio;

// Output size follows the SOURCE aspect rather than a fixed configured frame.
// Forcing a 3:4 photograph into a 2:3 output makes the model re-compose the
// picture, and re-composition is exactly when identity drifts. FAL_IMAGE_SIZE
// now sets the pixel budget and the fallback, not the shape.
export function resolveOutputSize(model, aspect, fallback) {
  if (model.sizing === 'none') return {};
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : fallback.width / fallback.height;
  if (model.sizing === 'aspect') return {aspect: nearestRatio(ratio)};
  const budget = fallback.width * fallback.height;
  const width = clamp32(Math.sqrt(budget * ratio));
  return {width, height: clamp32(width / ratio)};
}

// Identity survives an image-to-image pass only at a low denoising strength, so
// the level is taken from how hard the operator asked for the face to be kept.
export function identityStrength(model, preservation = {}) {
  if (!model.strength) return undefined;
  return model.strength[preservation.FACE] ?? model.strength.MEDIUM;
}

export function getModel(id) {
  const model = MODELS[id];
  if (!model) throw new Error(`Unsupported model ${id}. Choose one of: ${MODEL_IDS.join(', ')}`);
  return {id, ...model};
}

// Sent to the browser. Deliberately excludes build/images functions and any
// server configuration; it is safe for an unauthenticated cache.
export function modelCatalog() {
  return MODEL_IDS.map(id => {
    const m = MODELS[id];
    return {id,label:m.label,family:m.family,kind:m.kind,sizing:m.sizing,maxImages:m.maxImages,usesReferences:m.kind!=='text',exactSize:m.sizing==='dimensions',negativePrompt:!!m.negative,note:m.note,docs:m.docs};
  });
}

// Provider payload -> the image objects this adapter should read.
export function resultImages(model, result) {
  return listed(result).filter(image => typeof image?.url === 'string');
}
