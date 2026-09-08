import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Script} from 'node:vm';
const site=process.argv[2];if(!site)throw new Error('Provide the Joyce site directory.');
const assets=path.join(site,'assets/angle-pack');
for(const name of await readdir(assets)) {
  const file=path.join(assets,name),source=await readFile(file,'utf8');
  assert.doesNotMatch(source,/FAL_KEY|OPENAI_API_KEY|@fal-ai|sk-proj-[A-Za-z0-9]|local-preview-password/,'Secret or provider code in frontend');
  if(name.endsWith('.js')){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
}
const config=await readFile(path.join(assets,'config.js'),'utf8');
const {apiBase,ANGLE_PACK_API_BASE}=await import(`data:text/javascript,${encodeURIComponent(config)}`);
assert.equal(apiBase('127.0.0.1'),'http://127.0.0.1:3210');assert.equal(apiBase('localhost'),'http://127.0.0.1:3210');assert.equal(apiBase('nbiryukov25.github.io'),ANGLE_PACK_API_BASE);assert.match(ANGLE_PACK_API_BASE,/^https:\/\//);
for(const name of ['api-client.js','presets.js'])assert.equal(await readFile(path.join(assets,name),'utf8'),await readFile(path.join('public',name),'utf8'),`${name} shared copy has drifted`);
const html=await readFile(path.join(site,'portrait.html'),'utf8');
for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(script[1]);
// The integration is committed, so "unrelated content preserved" can no longer
// mean stripping the tool back out and matching HEAD: HEAD contains it. The
// invariant that still matters is that backend work never edits the gallery
// page at all; everything ANGLE PACK owns lives in assets/angle-pack/.
const original=spawnSync('git',['-c',`safe.directory=${path.resolve(site).replaceAll('\\','/')}`,'show','HEAD:portrait.html'],{cwd:site,encoding:'utf8'});
assert.equal(original.status,0,original.stderr);
assert.equal(html.replaceAll('\r\n','\n'),original.stdout.replaceAll('\r\n','\n'),'portrait.html changed; the ANGLE PACK tool must stay inside assets/angle-pack/');
assert.match(html,/<angle-pack-tool>/);assert.doesNotMatch(html,/<iframe[^>]+angle-pack/i);
for(const id of ['tool-card-three-faces','tool-card-transcribe','view-collection','view-form','view-portrait','view-transcribe'])assert.ok(html.includes(`id="${id}"`));
const app=await readFile(path.join(assets,'app.js'),'utf8');assert.match(app,/uploadForm\(references,/);assert.match(app,/new ApiClient\(apiBase\(\)\)/);assert.doesNotMatch(app,/https:\/\/[^\s]+onrender\.com/);
// The tool's own template ids and cross-copy drift are covered by test/frontend.test.js.
assert.match(app,/MODE_KEYS/,'the hosted app must build its modes from the shared table');
assert.match(app,/renderModelPicker/,'the hosted app must offer the model selector');
console.log('Pages checks passed: syntax, API base, multipart helper, no provider secrets, shared copies, model selector, tool anchors, and an unedited portrait.html.');
