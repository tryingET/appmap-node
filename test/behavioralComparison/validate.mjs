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
  assert.equal(bundle.kind, 'appmap.comparison');
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.capabilities?.views?.sequence, 1);
  assert(bundle.scenario?.id);
  assert(bundle.recordings?.base && bundle.recordings?.head);
  assert(bundle.views?.sequence?.base?.actors && bundle.views.sequence.base.rootActions);
  assert(bundle.views?.sequence?.head?.actors && bundle.views.sequence.head.rootActions);
  assert(bundle.views?.sequence?.diff?.actors && bundle.views.sequence.diff.rootActions);
  assert(Array.isArray(bundle.views.sequence.alignment?.actorOrder));
  assert(Array.isArray(bundle.changes));
  assert.equal(new Set(bundle.changes.map((change) => change.id)).size, bundle.changes.length);
  bundle.changes.forEach((change) => {
    assert.match(change.id, /^chg_[0-9a-f]{20}(?:_[1-9][0-9]*)?$/);
    assert(change.views?.sequence);
  });
}

assert.equal(
  control.changes.length,
  0,
  `control recording drifted unexpectedly: ${JSON.stringify(control.changes, null, 2)}`
);
assert(demo.changes.length > 0, 'demo comparison should contain a visible behavioral change');
assert(
  demo.changes.some((change) => {
    const name = change.details?.name;
    const searchable = [change.summary, name?.before, name?.after]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return change.kind === 'call-added' && searchable.includes('authorize');
  }),
  `expected an added authorize call: ${JSON.stringify(demo.changes, null, 2)}`
);

const summary =
  `# AppMap PR comparison dogfood\n\n` +
  `- Contract: **appmap.comparison schema v1**.\n` +
  `- Control scenario: **no runtime drift** across the base and PR builds.\n` +
  `- Visual scenario: **${demo.changes.length} semantic change(s)** detected.\n` +
  `- Added authorization call: **confirmed**.\n` +
  `- Change IDs: **deterministic, non-positional hashes**.\n` +
  `- Artifact: download \`appmap-pr-comparison\` and open either ` +
  `\`*.compare.diff.sequence.json\` file with the companion VS Code extension PR.\n`;

await writeFile(summaryFile, summary);
console.log(summary);