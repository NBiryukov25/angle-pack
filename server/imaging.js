import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { defaultCrop } from '../public/presets.js';

export async function normalizeReference(buffer) {
  try {
    const meta = await sharp(buffer, { limitInputPixels: 40000000 }).metadata();
    if (!['jpeg','png','webp'].includes(meta.format) || (meta.pages || 1) !== 1) throw new Error('Unsupported image');
    const normalized = await sharp(buffer, { limitInputPixels: 40000000 }).rotate().png().toBuffer();
    if (normalized.length >= 50 * 1024 * 1024) throw new Error('Normalized image exceeds API limit');
    return normalized;
  } catch {
    throw Object.assign(new Error('Could not prepare this reference. Use a readable single-frame JPEG, PNG or WebP, at most 40 megapixels and under 50 MB when converted to PNG. Try a smaller export.'),{status:400});
  }
}
export async function cropImage(buffer, output) {
  const {width, height} = await sharp(buffer).metadata();
  const c = output.crop || defaultCrop(output.framing);
  const left = Math.min(width-1, Math.floor(c.x*width));
  const top = Math.min(height-1, Math.floor(c.y*height));
  const rectangle = {left, top, width:Math.max(1,Math.min(width-left,Math.round(c.w*width))), height:Math.max(1,Math.min(height-top,Math.round(c.h*height)))};
  return {buffer:await sharp(buffer).extract(rectangle).png().toBuffer(), rectangle};
}
export async function outpaintInputs(buffer, output, size) {
  const [width,height] = size.split('x').map(Number);
  const scaled = await sharp(buffer).resize({width:Math.round(width/output.expansion),height:Math.round(height/output.expansion),fit:'inside'}).ensureAlpha().png().toBuffer();
  const meta = await sharp(scaled).metadata();
  const left = Math.floor((width-meta.width)/2), top = Math.floor((height-meta.height)/2);
  const blank = {create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}};
  const canvas = await sharp(blank).composite([{input:scaled,left,top}]).png().toBuffer();
  const opaque = await sharp({create:{width:meta.width,height:meta.height,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).png().toBuffer();
  const mask = await sharp(blank).composite([{input:opaque,left,top}]).png().toBuffer();
  return {canvas,mask,placement:{left,top,width:meta.width,height:meta.height,canvasWidth:width,canvasHeight:height}};
}
const escapeXml = value => String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export async function mockImage(buffer, output, mode, size, modelLabel='') {
  const [width,height] = size.split('x').map(Number);
  const caption = escapeXml(`${mode} / ${output.angle} / ${output.framing}${modelLabel?` / ${modelLabel}`:''}`);
  const label = `<svg width="${width}" height="${height}"><rect y="${height-150}" width="${width}" height="150" fill="#102722" fill-opacity="0.94"/><text x="40" y="${height-90}" fill="#b9f778" font-family="sans-serif" font-size="32">MOCK · NO AI RECONSTRUCTION</text><text x="40" y="${height-40}" fill="white" font-family="sans-serif" font-size="24">${caption}</text></svg>`;
  return sharp(buffer).resize(width,height,{fit:'contain',background:'#ddd9cd'}).composite([{input:Buffer.from(label)}]).png().toBuffer();
}
export { generateImage as editImage } from './provider.js';
export async function referenceBuffers(folder, refs) {
  return Promise.all(refs.map(ref => readFile(`${folder}/${ref.normalizedFile}`)));
}
