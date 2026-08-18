#!/usr/bin/env node

import assert from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';

const [controlFile, demoFile, summaryFile] = process.argv.slice(2);
if (!controlFile || !demoFile || !summaryFile) {
  console.error('usage: validate.mjs <control-bundle> <demo-bundle> <summary-file>');
  process.exit(2);
}

const control = JSON.parse(await readFile(controlFile, 'utf8'));
const demo = JSON.parse(await readFile(demoFile, 'utf8'));

for (const bundle of [control, demo]) {
  assert.equal(bundle.kind, 'appmap.sequence-comparison');
  assert.equal(bundle.schemaVersion, 1);
  assert(bundle.base?.actors && bundle.base?.rootActions);
  assert(bundle.head?.actors && bundle.head?.rootActions);
  assert(bundle.diff?.actors && bundle.diff?.rootActions);
  assert(Array.isArray(bundle.changes));
}

assert.equal(
  control.changes.length,
  0,
  `control recording drifted unexpectedly: ${JSON.stringify(control.changes, null, 2)}`
);
assert(demo.changes.length > 0, 'demo comparison should contain a visible behavioral change');
assert(
  demo.changes.some(
    (change) => change.kind === 'added' && String(change.name).toLowerCase().includes('authorize')
  ),
  `expected an added authorize call: ${JSON.stringify(demo.changes, null, 2)}`
);

const summary = `# AppMap PR comparison dogfood\n\n` +
  `- Control scenario: **no runtime drift** across the base and PR builds.\n` +
  `- Visual scenario: **${demo.changes.length} semantic change(s)** detected.\n` +
  `- Added authorization call: **confirmed**.\n` +
  `- Artifact: download \`appmap-pr-comparison\` and open either ` +
  `\`*.compare.diff.sequence.json\` file with the companion VS Code extension PR.\n`;

await writeFile(summaryFile, summary);
console.log(summary);
