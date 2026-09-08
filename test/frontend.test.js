import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODE_KEYS, MODES, ATTRIBUTES, comparisonPack } from '../public/presets.js';

const local=await readFile('public/app.js','utf8');
const markup=await readFile('public/index.html','utf8');
// The GitHub Pages build is a custom element carrying its markup as a string
// literal, so its template is read the same way the browser would.
const hosted=await readFile(new URL('../../joyce-photos-gallery/assets/angle-pack/app.js',import.meta.url),'utf8').catch(()=>null);
const ids=source=>new Set([...source.matchAll(/\$\('([a-z-]+)'\)/g)].map(m=>m[1]));
const functions=source=>new Set([...source.matchAll(/function ([A-Za-z]+)\(/g)].map(m=>m[1]));

test('every element the local app addresses exists in its page',()=>{
  for(const id of ids(local))assert.ok(markup.includes(`id="${id}"`),`index.html is missing #${id}`);
  for(const id of ['modes','model','model-note','mode-note','compare','submission-issues'])assert.ok(ids(local).has(id),`app.js never uses #${id}`);
});
test('the app drives its controls from the shared mode table, not a hard-coded list',()=>{
  assert.match(local,/import \{[^}]*\bMODES\b[^}]*\} from '\.\/presets\.js'/);
  assert.match(local,/import \{[^}]*\bMODE_KEYS\b[^}]*\} from '\.\/presets\.js'/);
  assert.match(local,/import \{[^}]*\bATTRIBUTES\b[^}]*\} from '\.\/presets\.js'/);
  assert.match(local,/import \{[^}]*\bcomparisonPack\b[^}]*\} from '\.\/presets\.js'/);
  assert.match(local,/for\(const key of MODE_KEYS\)/,'the mode buttons must be generated from the table');
  assert.doesNotMatch(markup,/data-mode="/,'no mode may be hard-coded in the markup');
  // A mode added to presets.js must not need a matching edit here.
  for(const mode of MODE_KEYS)assert.doesNotMatch(local,new RegExp(`state\\.mode===.${mode}.`),`${mode} is special-cased instead of using its rules`);
});
test('the browser mirrors the rules the server enforces',()=>{
  assert.match(local,/rules\.requiresDirection&&!out\.custom\.trim\(\)/,'missing direction check');
  assert.match(local,/rules\.requiresAttributes/,'missing attribute check');
  assert.match(local,/rules\.requiresModels&&new Set/,'missing distinct-model check');
  assert.match(local,/state\.refs\.length<rules\.minReferences/,'missing reference-count check');
  assert.match(local,/\$\('generate'\)\.disabled=.*problems\.length>0/,'submission must be blocked while a rule fails');
});
test('the shot list, submission and results carry the model through',()=>{
  assert.match(local,/\.\.\.\(state\.model\?\{model:state\.model\}:\{\}\)/,'the session model must reach the API');
  assert.match(local,/attributes:rules\.requiresAttributes\?o\.attributes:\[\]/,'attributes must only be sent where they apply');
  assert.match(local,/outputControls\(state\.edit\.output,index,state\.job\.mode,refs,refresh,\{showModel:true\}\)/,'regeneration must offer a model');
  assert.match(local,/generationParameters\?\.modelLabel/,'results must name the model that made them');
});
test('the mode table and attribute list are complete enough to drive the controls',()=>{
  for(const key of MODE_KEYS){const m=MODES[key];assert.ok(m.label.length<24,`${key} label is too long for a button`);assert.ok(m.blurb.length<52,`${key} blurb is too long for a button`);}
  assert.ok(Object.keys(ATTRIBUTES).length>=2,'Attribute Combine needs choices');
  assert.equal(comparisonPack([]).length,0,'an empty catalog must not fabricate a comparison');
});
test('the GitHub Pages copy stays in step with the local app',{skip:hosted?false:'joyce-photos-gallery is not checked out beside this repository'},()=>{
  const template=JSON.parse(hosted.match(/^const template=("(?:[^"\\]|\\.)*");$/m)[1]);
  for(const id of ids(hosted))assert.ok(template.includes(`id="${id}"`),`the hosted template is missing #${id}`);
  for(const id of ids(local))assert.ok(ids(hosted).has(id),`the hosted app dropped #${id}`);
  const shared=functions(local),page=functions(hosted);
  for(const name of shared)assert.ok(page.has(name),`the hosted app is missing ${name}()`);
  // asset() is the Pages build's authenticated blob-URL helper and has no local twin.
  for(const name of page)assert.ok(shared.has(name)||name==='asset',`the local app is missing ${name}()`);
  assert.doesNotMatch(template,/data-mode="/);
  for(const marker of ['MODE_KEYS','comparisonPack','attributeControls','renderModelPicker','outputProblems','showModel:true'])assert.ok(hosted.includes(marker),`the hosted app is missing ${marker}`);
});
