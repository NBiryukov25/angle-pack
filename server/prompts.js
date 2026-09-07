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
export function buildPrompt(job, output) {
  const base = [
    'Treat ALL supplied reference photographs as evidence of the SAME subject and, unless session notes explicitly say otherwise, the SAME photo session. Use every reference, not just the first.',
    'Resolve facial appearance, apparent age, skin tone, body proportions, hairstyle, outfit, accessories, visible scene geometry, environment, lighting and photographic treatment jointly from the references.',
    job.mode === 'GENERATIVE_ANGLE'
      ? 'GENERATIVE CAMERA ANGLE RECONSTRUCTION: create a genuinely new virtual camera position. Do not merely crop, rotate, mirror, perspective-warp or reframe a reference. Move the photographer around the subject; keep the subject pose and world orientation consistent where possible. Infer newly visible surfaces naturally from ALL references. The result should look like another photograph taken during the same session.'
      : 'OUTPAINT ZOOM: the FIRST input is an expanded canvas containing the selected reference; its empty margins identify areas to reconstruct (prompt-guided extension, no native mask input). Continue the photograph beyond its boundaries. Keep the existing camera direction and perspective. Reconstruct missing clothing, body, floor, walls, furniture and environment using ALL remaining original references. Do not leave empty margins or make a collage.',
    job.mode === 'GENERATIVE_ANGLE' ? `Camera position: ${output.angle === 'CUSTOM' ? output.custom : positions[output.angle]}` : 'Keep the source camera angle; only move the framing outward.',
    `Requested framing: ${frames[output.framing]}`,
    'Left/right mean the subject\'s own anatomical sides, not the viewer\'s screen sides.',
    ...Object.entries(job.preservation).map(([k,v]) => `PRESERVE_${k}: ${v}. ${v === 'HIGH' ? 'Strongly retain established characteristics; do not redesign because the camera moved.' : v === 'MEDIUM' ? 'Retain the recognizable overall appearance; allow small natural view-dependent differences.' : 'No extra preservation constraint for this attribute; maintain a coherent photograph.'}`),
    'Preserve facial identity only where the face would naturally be visible. Background perspective, occlusion, highlights and shadows should change physically plausibly with the camera. Do not duplicate people, limbs, jewelry or furniture. Produce ONE photograph, without text, borders or comparison panels.',
    `Reference view labels (user supplied; UNKNOWN means unspecified): ${JSON.stringify(job.referenceAngles)}`,
    job.notes ? `Additional session instructions: ${job.notes}` : '',
  ];
  return base.filter(Boolean).join('\n\n');
}
