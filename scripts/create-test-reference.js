// Synthetic geometry for local UI smoke tests; not an example AI photograph.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
await mkdir('test-results',{recursive:true});
await sharp(Buffer.from('<svg width="600" height="900"><rect width="600" height="900" fill="#dfdccd"/><rect y="650" width="600" height="250" fill="#779485"/><circle cx="300" cy="235" r="95" fill="#b1ba83"/><rect x="210" y="340" width="180" height="300" rx="40" fill="#345b49"/><text x="90" y="810" font-family="sans-serif" font-size="28" fill="white">LOCAL TEST REFERENCE</text></svg>')).png().toFile('test-results/reference.png');
