import { MODES, ATTRIBUTES } from '../public/presets.js';

const positions = {
  FRONT:'Directly in front of the subject, facing their front.',
  LEFT_3Q:'Move the camera approximately 45 degrees toward the SUBJECT\'S anatomical left from a frontal view.',
  RIGHT_3Q:'Move the camera approximately 45 degrees toward the SUBJECT\'S anatomical right from a frontal view.',
  PROFILE_LEFT:'Move the camera 90 degrees to the SUBJECT\'S anatomical left, photographing their left-side profile.',
  PROFILE_RIGHT:'Move the camera 90 degrees to the SUBJECT\'S anatomical right, photographing their right-side profile.',
  REAR_3Q_LEFT:'Move behind and to the SUBJECT\'S anatomical left, about 135 degrees from the front. Show the back and left side.',
  REAR_3Q_RIGHT:'Move behind and to the SUBJECT\'S anatomical right, about 135 degrees from the front. Show the back and right side.',
  REAR:'Move behind the subject, 180 degrees from the front, looking at their back. Do not invent a face on the back of the head.',
  HIGH:'Raise the camera above head height and aim downward at roughly 35 degrees.',
  LOW:'Lower the camera to around waist height, looking slightly upward.',
  OVERHEAD:'Position the camera directly above the subject, looking vertically downward.',
  EYE_LEVEL:'Position the camera at the subject\'s eye height, with a level optical axis and a natural frontal view.',
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
export function buildPrompt(job, output) {
  const rules = MODES[job.mode] || {};
  const camera = output.angle === 'CUSTOM' ? output.custom : positions[output.angle];
  const base = [
    ...(subjects[rules.subject] || subjects.same),
    operations[job.mode],
    rules.usesAngle ? `Camera position: ${camera}` : 'Keep the source camera angle; only move the framing outward.',
    `Requested framing: ${frames[output.framing]}`,
    job.mode === 'ATTRIBUTE_COMBINE' && output.attributes.length
      ? `Attribute sources: ${output.attributes.map(a => `${ATTRIBUTES[a.attribute]} from reference ${a.reference+1}`).join('; ')}. Take nothing else from those references.`
      : '',
    // For Generative Angle the free text IS the camera position, already stated above.
    job.mode !== 'GENERATIVE_ANGLE' && output.custom.trim() ? `Direction for this output: ${output.custom.trim()}` : '',
    'Left/right mean the subject\'s own anatomical sides, not the viewer\'s screen sides.',
    ...Object.entries(job.preservation).map(([k,v]) => `PRESERVE_${k}: ${v}. ${v === 'HIGH' ? 'Strongly retain established characteristics; do not redesign because the camera moved.' : v === 'MEDIUM' ? 'Retain the recognizable overall appearance; allow small natural view-dependent differences.' : 'No extra preservation constraint for this attribute; maintain a coherent photograph.'}`),
    `${rules.subject === 'same' ? 'Preserve facial identity only where the face would naturally be visible. ' : ''}Background perspective, occlusion, highlights and shadows should change physically plausibly with the camera. Do not duplicate people, limbs, jewelry or furniture. Produce ONE photograph, without text, borders or comparison panels.`,
    `Reference view labels (user supplied; UNKNOWN means unspecified): ${JSON.stringify(job.referenceAngles)}`,
    job.notes ? `Additional session instructions: ${job.notes}` : '',
  ];
  return base.filter(Boolean).join('\n\n');
}
