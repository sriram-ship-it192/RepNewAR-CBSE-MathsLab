import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root,'src/content/cbseMathsLabActivities.json'),'utf8'));
const errors=[]; const warnings=[];
const requiredIds = catalog.map(x=>x.id);
if (catalog.length !== 26) errors.push(`Catalog contains ${catalog.length} lessons; expected 26.`);
if (new Set(requiredIds).size !== requiredIds.length) errors.push('Duplicate lesson IDs found.');

for (const [i,a] of catalog.entries()) {
  if (!a.id || !a.title) errors.push(`Lesson ${i+1}: missing id/title.`);
  if (!Array.isArray(a.markerTags) || a.markerTags.length !== 5 || a.markerTags.some(n=>![1,2,3,4,5].includes(Number(n))))
    errors.push(`${a.id}: markerTags must be exactly [1,2,3,4,5].`);
  const file=path.join(root,'src/content/lessons',a.id,'lesson.js');
  if (!fs.existsSync(file)) { errors.push(`${a.id}: lesson.js missing.`); continue; }
  const s=fs.readFileSync(file,'utf8');
  if (!/export\s+(?:default\s+)?class\s+Lesson/.test(s) && !/export\s+class\s+Lesson/.test(s)) errors.push(`${a.id}: Lesson class export missing.`);
  if (!s.includes('supportedMarkerIds')) errors.push(`${a.id}: supportedMarkerIds missing.`);
  if (!s.includes("from '../PhysicalMathLabLessonBase.js'")) warnings.push(`${a.id}: does not directly import the physical AR base.`);
}
const manager=fs.readFileSync(path.join(root,'src/content/LessonManager.js'),'utf8');
if (!manager.includes("import.meta.glob('./lessons/*/lesson.js')")) errors.push('LessonManager does not use build-time glob discovery.');
if (/import\(`\.\/lessons\/\$\{id\}/.test(manager)) errors.push('Unsafe runtime lesson import remains.');

const lessonLines = catalog.map((a,i) => `${i+1}. ${a.title} — \`${a.id}\` — markers ${a.markerTags.join(', ')}`).join('\n');
const warningLines = warnings.length ? warnings.map(x => '- ' + x).join('\n') : 'None.';
const report = [
  '# CBSE Maths Lab Phase 6 QA Report', '',
  `Generated: ${new Date().toISOString()}`, '',
  `- Catalog: **${catalog.length}/26**`,
  `- Marker schema: **${errors.some(e => e.includes('marker')) ? 'FAIL' : 'PASS'}**`,
  `- Lesson modules: **${errors.some(e => e.includes('lesson.js')) ? 'FAIL' : 'PASS'}**`,
  `- Build-time loader: **${manager.includes("import.meta.glob('./lessons/*/lesson.js')") ? 'PASS' : 'FAIL'}**`,
  `- Static QA: **${errors.length ? 'FAIL' : 'PASS'}**`, '',
  '## Lessons', '', lessonLines, '',
  '## Manual classroom checks', '',
  '1. Start camera and verify live feed.',
  '2. Verify Tag #1 is the physical reference/base.',
  '3. Verify required tags change to LIVE PHYSICAL TRACKING.',
  '4. Move one physical piece and verify the AR visualization follows.',
  '5. Remove the piece and verify its overlay disappears/updates.',
  '6. Confirm 3D/Rotate/Zoom/Info/Reset controls.',
  '7. Enter fullscreen on the IFP.',
  '8. Repeat for all 26 lessons.', '',
  '## Warnings', '', warningLines, ''
].join('\n');
fs.writeFileSync(path.join(root,'PHASE-6-QA-REPORT.md'),report);
if(errors.length){console.error('QA FAILED'); errors.forEach(e=>console.error('- '+e)); process.exit(1);}
console.log(`QA PASSED: ${catalog.length}/26 lessons, marker schema, and build-time loader validated.`);
