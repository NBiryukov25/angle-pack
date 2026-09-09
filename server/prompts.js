import { MODES, ATTRIBUTES, PRESERVATION_CLASS } from '../public/presets.js';

// Explicit camera instructions.
//
// The previous labels were a single buried sentence that a model could satisfy
// by doing almost nothing. Each entry now names the rotation, the camera height,
// what must BECOME visible and what must LEAVE the frame, so whether the camera
// actually moved is checkable against the output rather than a matter of taste.
export const CAMERA = {
  FRONT: {
    move: 'Place the camera directly in front of the subject at eye height, square to them, with a level optical axis.',
    evidence: 'Both eyes, both cheeks and both shoulders read as equally visible and roughly symmetrical, and the nose sits on the centre line of the face.',
  },
  LEFT_3Q: {
    move: 'Rotate the camera approximately 45 degrees around the subject toward the SUBJECT\'S OWN LEFT side, keeping it at eye height.',
    evidence: 'The subject\'s left cheek, left ear and left shoulder become clearly more visible, the right side of the face turns away and is partly occluded, and the nose breaks the outline of the far cheek.',
  },
  RIGHT_3Q: {
    move: 'Rotate the camera approximately 45 degrees around the subject toward the SUBJECT\'S OWN RIGHT side, keeping it at eye height.',
    evidence: 'The subject\'s right cheek, right ear and right shoulder become clearly more visible, the left side of the face turns away and is partly occluded, and the nose breaks the outline of the far cheek.',
  },
  PROFILE_LEFT: {
    move: 'Rotate the camera a full 90 degrees around to the SUBJECT\'S OWN LEFT, photographing a true side profile at eye height.',
    evidence: 'Only the left side of the face is visible: one eye, one ear, and the nose, lips and chin read in silhouette against the background. The far cheek is not visible at all.',
  },
  PROFILE_RIGHT: {
    move: 'Rotate the camera a full 90 degrees around to the SUBJECT\'S OWN RIGHT, photographing a true side profile at eye height.',
    evidence: 'Only the right side of the face is visible: one eye, one ear, and the nose, lips and chin read in silhouette against the background. The far cheek is not visible at all.',
  },
  REAR_3Q_LEFT: {
    move: 'Move the camera behind and to the SUBJECT\'S OWN LEFT, about 135 degrees around from the front, at eye height.',
    evidence: 'The back, the back of the head and the left shoulder dominate the frame, and at most a sliver of the left cheek is visible past the head.',
  },
  REAR_3Q_RIGHT: {
    move: 'Move the camera behind and to the SUBJECT\'S OWN RIGHT, about 135 degrees around from the front, at eye height.',
    evidence: 'The back, the back of the head and the right shoulder dominate the frame, and at most a sliver of the right cheek is visible past the head.',
  },
  REAR: {
    move: 'Move the camera fully behind the subject, 180 degrees around from the front, at eye height.',
    evidence: 'Only the back of the head, the back and the shoulders are visible. No part of the face is visible. Do not invent a face on the back of the head.',
  },
  HIGH: {
    move: 'Raise the camera clearly above the subject\'s head, roughly 35 to 45 degrees above eye level, and tilt it downward at them.',
    evidence: 'The top of the head and the shoulders dominate, the body is visibly foreshortened below them, the floor or ground fills the background, and the horizon sits high in the frame or leaves it entirely.',
  },
  LOW: {
    move: 'Lower the camera to roughly waist height or below and tilt it upward at the subject.',
    evidence: 'The underside of the jaw and chin becomes visible, the subject looms and reads as taller, and more ceiling, sky or upper wall appears behind them.',
  },
  OVERHEAD: {
    move: 'Position the camera almost directly above the subject, looking nearly straight down at them.',
    evidence: 'The top of the head and the tops of the shoulders fill the frame, the face is strongly foreshortened, the floor or ground is the entire background, and the body recedes directly beneath the head.',
  },
  EYE_LEVEL: {
    move: 'Place the camera exactly at the subject\'s eye height with a level optical axis and a natural frontal view.',
    evidence: 'The eye line sits on the horizontal centre of the frame, with no upward or downward tilt and no vertical foreshortening.',
  },
};

const frames = {FACE:'Tight facial close-up.', HEAD_SHOULDERS:'Head and shoulders, with natural headroom.',CHEST:'Chest-up portrait.',WAIST:'Waist-up portrait.',THREE_QUARTER:'Three-quarter body portrait, approximately head to knees.',FULL_BODY:'Entire body including head and feet, with a small margin.',WIDE:'Wide environmental photograph, with room around the entire subject.'};

// How the references relate to each other, per mode.
const subjects = {
  same: [
    'Treat ALL supplied reference photographs as evidence of the SAME subject and, unless session notes explicitly say otherwise, the SAME photo session. Use every reference, not just the first.',
    'Resolve facial appearance, apparent age, skin tone, body proportions, hairstyle, outfit, accessories, visible scene geometry, environment, lighting and photographic treatment jointly from the references.',
  ],
  distinct: [
    'The supplied reference photographs show DIFFERENT subjects, objects or scenes. Use every reference, and keep each one recognisably itself: its own face, apparent age, skin tone, proportions, hair, outfit and colouring.',
    'Never merge two people into one face, never swap features between them, and never silently drop a reference.',
  ],
  attributes: [
    'Each supplied reference photograph contributes ONLY the attributes assigned to it below. Use every reference that has an assignment.',
    'Take nothing else from a reference beyond its assigned attributes, and never merge two people into one face.',
  ],
};

const operations = {
  GENERATIVE_ANGLE: 'GENERATIVE CAMERA ANGLE RECONSTRUCTION: create a genuinely new virtual camera position. Do not merely crop, rotate, mirror, perspective-warp or reframe a reference. Move the photographer around the subject; keep the subject pose and world orientation consistent where possible. Infer newly visible surfaces naturally from ALL references. The result should look like another photograph taken during the same session.',
  OUTPAINT_ZOOM: 'OUTPAINT ZOOM: the FIRST input is an expanded canvas containing the selected reference; its empty margins identify areas to reconstruct (prompt-guided extension, no native mask input). Continue the photograph beyond its boundaries. Keep the existing camera direction and perspective. Reconstruct missing clothing, body, floor, walls, furniture and environment using ALL remaining original references. Do not leave empty margins or make a collage.',
  MULTI_REFERENCE: 'MULTI-REFERENCE SYNTHESIS: produce ONE new photograph of this subject, using every reference jointly as evidence of who they are and how the session looked. Do not reproduce any single reference wholesale and do not average the faces into a stranger; the person must stay recognisably the same in a genuinely new frame.',
  COMBINED_IMAGES: 'COMBINED IMAGES: compose ONE coherent photograph that contains the separate subjects, objects or scenes from the references together, at consistent scale, perspective, colour and lighting, as though photographed at the same moment by one camera. Do not produce a collage, split screen, grid, panel layout or picture-in-picture.',
  ATTRIBUTE_COMBINE: 'ATTRIBUTE COMBINE: build ONE new photograph by taking each listed attribute from the reference named for it. The result must be a single plausible photograph, not a diagram, comparison or panel layout showing the sources.',
  MODEL_COMPARISON: 'MODEL COMPARISON: produce the photograph described here exactly as specified. Every output in this session receives an identical instruction and differs only in the model that renders it, so add no stylistic interpretation of your own.',
};

// "Same person, same session, camera moved" is a materially different request
// from "a new image inspired by the reference". The model is told which it is.
const TASK = {
  same: 'TASK: this is ONE MORE PHOTOGRAPH FROM AN EXISTING PHOTO SESSION. The same person, wearing the same clothes, in the same place, photographed again with the camera in a different position. It is NOT a new image inspired by the reference, NOT a lookalike, and NOT a restyled version. If a viewer could not identify the result as the same individual from the same session, the result is wrong.',
  distinct: 'TASK: photograph the supplied subjects together in ONE frame. Each keeps their own identity and their own clothes exactly as supplied; only the shared framing and viewpoint are new.',
  attributes: 'TASK: assemble ONE photograph from the assigned attributes. Every assigned attribute is reproduced from its named reference exactly as supplied, not reinterpreted.',
};

const IDENTITY_LOCK = {
  same: 'IDENTITY LOCK - the reference photograph is the AUTHORITATIVE SOURCE for who this person is. Reproduce the same facial structure and proportions, eye shape, eye spacing and eye colour, eyebrow shape and thickness, nose shape, width and bridge, lip shape and fullness, jawline, chin, cheekbones, ears, hairline, and hair length, colour, parting and texture. Reproduce the same skin tone and complexion, including moles, freckles, scars, lines and blemishes. Keep the same apparent age, the same ethnicity, and the same body proportions, height, build and posture.',
  distinct: 'IDENTITY LOCK - each reference is the AUTHORITATIVE SOURCE for its own subject. Reproduce each face, skin tone, apparent age, hair and body proportions from its own reference. Do not blend features between subjects and do not give one subject another subject\'s face.',
  attributes: 'IDENTITY LOCK - the reference assigned to a facial or body attribute is the AUTHORITATIVE SOURCE for it. Reproduce that facial structure, eye shape, nose, lips, jawline, skin tone, hair and body proportions exactly from the reference named for it.',
};

const NO_IMPROVEMENT = 'DO NOT IMPROVE THE SUBJECT. No beautification, idealisation, airbrushing, skin smoothing or evening, blemish removal, teeth whitening, eye enlargement or symmetrising, nose straightening or narrowing, jaw sharpening, face or body slimming, muscle or bust reshaping, height changes, posture correction, or making the subject younger or older. Do not change their ethnicity or racial features. An attractive stranger is a FAILED result: the individual must remain recognisably themselves, including the features a retoucher would be tempted to fix.';

const GARMENT_LOCK = 'GARMENT LOCK - the clothing in the reference is the AUTHORITATIVE SOURCE. Reproduce the same garments AS CONSTRUCTED: the same cut and silhouette, the same sleeve presence and sleeve length, the same neckline shape and depth, the same shoulder line and strap width, the same waist position and fit, the same hem length, and the same closures, seams, darts, pleats, pattern, print placement, fabric texture and colour. Do NOT redesign, restyle or substitute a similar-looking garment, do NOT add or remove sleeves, do NOT raise, lower or reshape the neckline, do NOT change the hem length, do NOT cinch, loosen or reposition the waist, and do NOT add, remove or restyle accessories.';

// The sentence that stops preservation from fighting the camera move. Without
// it, "retain the background" and "move the camera" are contradictory orders and
// the model resolves the contradiction by not moving the camera.
const MUST_CHANGE = 'WHAT MUST CHANGE WITH THE CAMERA: perspective and foreshortening, which surfaces face the lens, which are occluded and which come into view, the parallax between the subject and the background, the visible background crop, and the placement of highlights, shadows and specular reflections. These changes are REQUIRED and are NOT violations of the preservation rules below. What must not change is WHO the person is and WHAT they are wearing.';

const levels = {
  identity: {
    HIGH: 'BINDING. Reproduce it from the reference exactly; any deviation is a failed result.',
    MEDIUM: 'STRONG. Keep it clearly and immediately recognisable; allow only the small differences the new camera position genuinely causes.',
    OFF: 'not separately constrained, but never redesign or idealise it gratuitously.',
  },
  scene: {
    HIGH: 'BINDING AS TO WHAT IT IS: the same physical location, the same objects, the same light sources and the same photographic treatment as the reference. It must still be RE-RENDERED for the new camera position, so perspective, parallax, occlusion and shadow placement change. Do not substitute a different place, relight the scene differently, or invent new scenery.',
    MEDIUM: 'keep the same kind of place, lighting and treatment; small differences are acceptable.',
    OFF: 'not separately constrained; keep the photograph coherent.',
  },
};

function cameraBlock(job, output, rules) {
  if (!rules.usesAngle) return ['Keep the source camera angle; only move the framing outward.'];
  const spec = output.angle === 'CUSTOM'
    ? {move: output.custom, evidence: 'The described viewpoint must be unmistakably different from the reference viewpoint.'}
    : CAMERA[output.angle];
  // Only demand a moved camera when the requested view differs from the labelled
  // source view; demanding a change from FRONT to FRONT would be nonsense.
  const source = job.referenceAngles?.[output.sourceIndex] || job.referenceAngles?.[0] || 'UNKNOWN';
  const known = source !== 'UNKNOWN' && CAMERA[source];
  const block = [
    `CAMERA POSITION - THIS IS THE PRIMARY INSTRUCTION. It outranks every instruction below except the identity and garment locks.\n\nCamera position: ${spec.move}`,
    `Required visible evidence that the camera actually moved: ${spec.evidence}`,
  ];
  if (!known || source !== output.angle) {
    block.push(known
      ? `The reference was photographed from this position: ${CAMERA[source].move} The output MUST NOT reproduce that viewpoint. Move away from it to the position requested above.`
      : 'The output MUST NOT retain or reproduce the reference photograph\'s original camera viewpoint. A result showing the same viewpoint as the reference is a FAILED result, however good it looks.');
    block.push('Do not attempt this by cropping, zooming, mirroring, flipping, rotating or perspective-warping the reference: all of those preserve the original viewpoint and are failures. Re-photograph the subject from the new camera position, inferring the newly visible surfaces.');
  }
  return block;
}

function preservationLedger(job) {
  return Object.entries(job.preservation).map(([key, value]) => {
    const kind = PRESERVATION_CLASS[key] || 'identity';
    return `PRESERVE_${key} (${value}, ${kind}): ${levels[kind][value]}`;
  });
}

// The enforcement prompt the production path actually sends.
//
// The full prompt below is ~7,150 characters, roughly 1,800 tokens. FLUX.2's
// pipeline caps the text encoder at 512 tokens, so about 70% of it — the
// garment lock, the beautification ban, the preservation ledger and the final
// check — was discarded before the model ever saw it. Length was not strength.
//
// This carries the same five obligations in a fraction of the budget: the
// camera move, the identity lock, the garment lock, the preservation controls
// that are actually set, and a closing camera check. Blocks are ordered by
// priority and, when an endpoint documents a tighter limit, the lowest-priority
// blocks are dropped rather than the text being blindly truncated. The camera,
// identity and garment blocks are never droppable.
const compactIdentity = {
  same: 'SAME PERSON as the reference, exactly: face shape and proportions, eye shape and spacing, eyebrows, nose, lips, jawline, chin, ears, hairline and hair, skin tone and every mark, apparent age, ethnicity, body proportions. Do not beautify, smooth, slim, symmetrise, or change age or ethnicity.',
  distinct: 'Each reference keeps its OWN subject exactly: its own face, skin tone, age, hair and proportions. Do not blend faces between them or beautify any of them.',
  attributes: 'Take each assigned attribute exactly from its named reference: that face shape, eye shape, nose, lips, jawline, skin tone, hair and proportions. Do not beautify or idealise them.',
};
const compactGarment = 'SAME CLOTHING as the reference, as constructed: same cut, sleeve length, neckline, shoulder line, waist, hem, closures, pattern, fabric and colour. Do not redesign, restyle, or add or remove sleeves.';

function compactLedger(job) {
  const byLevel = {HIGH: [], MEDIUM: []};
  for (const [key, value] of Object.entries(job.preservation)) if (byLevel[value]) byLevel[value].push(key);
  const lines = [];
  if (byLevel.HIGH.length) lines.push(`Binding: ${byLevel.HIGH.join(', ')}.`);
  if (byLevel.MEDIUM.length) lines.push(`Keep recognisable: ${byLevel.MEDIUM.join(', ')}.`);
  return lines.length ? `${lines.join(' ')} Identity and clothing must not change; perspective, occlusion and shadows must change with the camera.` : '';
}

function compactPrompt(job, output, rules, limit) {
  const kind = rules.subject || 'same';
  const spec = output.angle === 'CUSTOM' ? {move: output.custom, evidence: ''} : CAMERA[output.angle] || {move: '', evidence: ''};
  const source = job.referenceAngles?.[output.sourceIndex] || job.referenceAngles?.[0] || 'UNKNOWN';
  const moved = rules.usesAngle && (source === 'UNKNOWN' || source !== output.angle);
  const direction = job.mode !== 'GENERATIVE_ANGLE' && output.custom.trim() ? `Direction: ${output.custom.trim()}` : '';
  const attributes = job.mode === 'ATTRIBUTE_COMBINE' && output.attributes.length
    ? `Attribute sources: ${output.attributes.map(a => `${ATTRIBUTES[a.attribute]} from reference ${a.reference+1}`).join('; ')}.`
    : '';
  // [text, droppable] — dropped from the end when a tighter limit applies.
  const blocks = [
    [rules.usesAngle ? `Camera position: ${spec.move}` : 'Keep the source camera angle; only move the framing outward.', false],
    [moved ? 'Do NOT reproduce the reference viewpoint, and do not fake the move by cropping, mirroring, rotating or warping it.' : '', false],
    [compactIdentity[kind], false],
    [compactGarment, false],
    [kind === 'same' ? 'Same person, same clothes, same place, same photo session; only the camera has moved. Not a lookalike and not a restyle.' : '', true],
    [attributes, true],
    [rules.usesAngle && spec.evidence ? `Evidence the camera moved: ${spec.evidence}` : '', true],
    [compactLedger(job), true],
    [`Framing: ${frames[output.framing]}`, true],
    [direction, true],
    [job.notes ? `Notes (must not change the camera, the identity or the clothing): ${job.notes}` : '', true],
    [rules.usesAngle ? `FINAL CHECK: camera actually moved as instructed; same individual, un-beautified; same garment construction.` : '', false],
  ].filter(([text]) => text);
  const join = list => list.map(([text]) => text).join('\n\n');
  let kept = blocks;
  while (limit && join(kept).length > limit) {
    const index = kept.map(([, droppable]) => droppable).lastIndexOf(true);
    if (index === -1) break;
    kept = kept.filter((_, i) => i !== index);
  }
  return join(kept);
}

export function buildPrompt(job, output, {usesReferences = true, compact = false, limit = 0} = {}) {
  const rules = MODES[job.mode] || {};
  const spec = output.angle === 'CUSTOM' ? {move: output.custom} : CAMERA[output.angle] || {move: ''};
  const direction = job.mode !== 'GENERATIVE_ANGLE' && output.custom.trim() ? `Direction for this output: ${output.custom.trim()}` : '';

  // A text-to-image endpoint receives no image at all. Every instruction about
  // reference photographs, preservation and view labels would describe evidence
  // it never gets, so it is replaced rather than merely ignored.
  if (!usesReferences) return [
    'No reference photograph is sent to this endpoint; it accepts a text description only. Produce ONE photograph from the description below alone. There is no established subject to match or preserve.',
    rules.usesAngle ? `Camera position: ${spec.move}` : '',
    `Requested framing: ${frames[output.framing]}`,
    direction,
    'Left/right mean the subject\'s own anatomical sides, not the viewer\'s screen sides.',
    'Produce ONE photograph, without text, borders or comparison panels.',
    job.notes ? `Additional session instructions: ${job.notes}` : '',
  ].filter(Boolean).join('\n\n');

  if (compact) return compactPrompt(job, output, rules, limit);

  const kind = rules.subject || 'same';
  // Order matters. The camera move and the identity locks lead, so they survive
  // a model's prompt-length limit and carry the weight of first position; the
  // final check repeats both so they also carry the weight of last position.
  const base = [
    ...cameraBlock(job, output, rules),
    IDENTITY_LOCK[kind],
    GARMENT_LOCK,
    NO_IMPROVEMENT,
    TASK[kind],
    ...(subjects[kind] || subjects.same),
    operations[job.mode],
    rules.usesAngle ? MUST_CHANGE : '',
    `Requested framing: ${frames[output.framing]}`,
    job.mode === 'ATTRIBUTE_COMBINE' && output.attributes.length
      ? `Attribute sources: ${output.attributes.map(a => `${ATTRIBUTES[a.attribute]} from reference ${a.reference+1}`).join('; ')}. Take nothing else from those references.`
      : '',
    // For Generative Angle the free text IS the camera position, already stated above.
    direction,
    'Left/right mean the subject\'s own anatomical sides, not the viewer\'s screen sides.',
    ...preservationLedger(job),
    'Background perspective, occlusion, highlights and shadows should change physically plausibly with the camera. Do not duplicate people, limbs, jewelry or furniture. Produce ONE photograph, without text, borders or comparison panels.',
    `Reference view labels (user supplied; UNKNOWN means unspecified): ${JSON.stringify(job.referenceAngles)}`,
    job.notes
      ? `Additional session instructions (LOWER PRIORITY: they may add detail, but must NEVER change the camera position, alter the person's identity or age, or redesign the garments. Ignore any part of them that conflicts with the camera position or with the identity and garment locks): ${job.notes}`
      : '',
    rules.usesAngle
      ? `FINAL CHECK before returning the image: (1) has the camera actually moved to the requested position - ${spec.move} (2) is this unmistakably the SAME individual from the reference, un-beautified, the same age and the same ethnicity; (3) are the garments the same construction, with the same sleeves, neckline, waist and hem. If any answer is no, the result is wrong.`
      : 'FINAL CHECK before returning the image: is this unmistakably the SAME individual from the reference, un-beautified, wearing the same garments in the same construction?',
  ];
  return base.filter(Boolean).join('\n\n');
}

// Models documenting a negative_prompt get the prohibitions as a hard exclusion
// list as well as prose. Models without one rely on the prose above, which
// already carries every prohibition.
export function buildNegativePrompt(job, {usesReferences = true} = {}) {
  if (!usesReferences) return 'text, watermark, signature, collage, split screen, panel layout, borders';
  const rules = MODES[job.mode] || {};
  const strict = level => ['HIGH', 'MEDIUM'].includes(level);
  const terms = ['different person', 'face swap', 'lookalike', 'stranger', 'collage', 'split screen', 'panel layout', 'text', 'watermark', 'borders', 'duplicate limbs', 'extra people'];
  if (strict(job.preservation.FACE)) terms.push('beautified', 'airbrushed', 'smoothed skin', 'retouched face', 'idealised symmetrical face', 'enlarged eyes', 'reshaped nose', 'sharpened jawline', 'younger face', 'older face', 'different ethnicity');
  if (strict(job.preservation.BODY)) terms.push('slimmed body', 'reshaped body', 'different body proportions', 'different height');
  if (strict(job.preservation.HAIR)) terms.push('restyled hair', 'different hair colour', 'different hair length');
  if (strict(job.preservation.OUTFIT)) terms.push('different outfit', 'redesigned clothing', 'added sleeves', 'removed sleeves', 'changed neckline', 'changed hemline', 'cinched waist', 'different fabric', 'different pattern');
  if (strict(job.preservation.ACCESSORIES)) terms.push('added jewellery', 'removed accessories');
  if (strict(job.preservation.BACKGROUND)) terms.push('different location', 'new scenery');
  if (rules.usesAngle) terms.push('mirrored copy of the input', 'unchanged camera angle');
  return terms.join(', ');
}
