#!/usr/bin/env node

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const [targetRepositoryArg, variant, outputFileArg] = process.argv.slice(2);
if (!targetRepositoryArg || !variant || !outputFileArg) {
  console.error('usage: record.mjs <appmap-node-checkout> <control|before|after> <output-file>');
  process.exit(2);
}
if (!['control', 'before', 'after'].includes(variant)) {
  console.error(`unknown variant: ${variant}`);
  process.exit(2);
}

const targetRepository = resolve(targetRepositoryArg);
const outputFile = resolve(outputFileArg);
const appmapNode = join(targetRepository, 'bin', 'appmap-node.js');
const fixtureDir = await mkdtemp(join(tmpdir(), 'appmap-pr-comparison-'));

async function findAppMaps(directory) {
  const matches = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name.endsWith('.appmap.json')) matches.push(path);
    }
  };
  await visit(directory);
  return matches;
}

function fixtureSource(selectedVariant) {
  const authorizationCall =
    selectedVariant === 'after'
      ? `
function authorize(request) {
  return request.userId > 0;
}
`
      : '';
  const authorizationUse = selectedVariant === 'after' ? 'authorize(request);' : '';

  return `
function parseRequest() {
  return { userId: 42 };
}
${authorizationCall}
function loadUser(request) {
  return { id: request.userId, role: 'reader' };
}

const request = parseRequest();
${authorizationUse}
const user = loadUser(request);
console.log(user.id);
`;
}

try {
  await writeFile(
    join(fixtureDir, 'appmap.yml'),
    `name: appmap-pr-comparison\nlanguage: javascript\nappmap_dir: tmp/appmap\npackages:\n  - path: .\n    exclude:\n      - node_modules\n`
  );
  await writeFile(join(fixtureDir, 'index.mjs'), fixtureSource(variant));

  const result = spawnSync(process.execPath, [appmapNode, 'index.mjs'], {
    cwd: fixtureDir,
    env: {
      ...process.env,
      APPMAP_RECORDER_PROCESS_ALWAYS: 'true',
      TZ: 'UTC',
    },
    stdio: 'inherit',
  });
  assert.equal(result.status, 0, `appmap-node exited with status ${result.status}`);

  const maps = await findAppMaps(join(fixtureDir, 'tmp'));
  const processMaps = [];
  for (const path of maps) {
    const appmap = JSON.parse(await readFile(path, 'utf8'));
    if (appmap.metadata?.recorder?.type === 'process') processMaps.push(path);
  }
  assert.equal(
    processMaps.length,
    1,
    `expected one process AppMap, found ${processMaps.length}: ${maps.join(', ')}`
  );

  await mkdir(dirname(outputFile), { recursive: true });
  await cp(processMaps[0], outputFile);
  console.log(`Recorded ${variant} behavior to ${outputFile}`);
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}
