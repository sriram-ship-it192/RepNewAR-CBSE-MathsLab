import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const catalogPath = path.join(root, 'src/content/cbseMathsLabActivities.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const expected = 26;
const ids = new Set();
const errors = [];
for (const activity of catalog) {
  if (ids.has(activity.id)) errors.push(`Duplicate lesson id: ${activity.id}`);
  ids.add(activity.id);
  const file = path.join(root, 'src/content/lessons', activity.id, 'lesson.js');
  if (!fs.existsSync(file)) errors.push(`Missing lesson module: ${activity.id}`);
  else {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('export class Lesson')) errors.push(`Invalid lesson export: ${activity.id}`);
    if (!source.includes('supportedMarkerIds')) errors.push(`No marker declaration: ${activity.id}`);
  }
  if (!Array.isArray(activity.markerTags) || activity.markerTags.length !== 5) errors.push(`Marker configuration invalid: ${activity.id}`);
}
if (catalog.length !== expected) errors.push(`Expected ${expected} lessons, found ${catalog.length}`);

const manager = fs.readFileSync(path.join(root,'src/content/LessonManager.js'),'utf8');
if (!manager.includes("import.meta.glob('./lessons/*/lesson.js')")) errors.push('LessonManager is not using Vite build-time lesson discovery.');
if (manager.includes("import(`./lessons/${id}/lesson.js`)") || manager.includes("import(`./lessons/${id}.js`)")) errors.push('Unsafe runtime lesson import still present.');

if (errors.length) {
  console.error('\nCBSE build verification FAILED:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log(`CBSE build verification PASSED: ${catalog.length}/26 lesson modules, marker maps, and packaged loader are valid.`);
