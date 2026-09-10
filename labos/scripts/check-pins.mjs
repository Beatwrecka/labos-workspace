// LabOS Workspace — pin manifest consistency check.
//
// Verifies labos/pins.json against the pinned commit's own manifest files, so a
// hand-edit that drifts from .nvmrc / rust-toolchain.toml / package.json fails
// loudly instead of silently changing what the build is expected to use.
//
// Run with: node --test labos/scripts/pins.test.mjs
//       or: node labos/scripts/check-pins.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const read = (...segments) =>
  readFileSync(resolve(repoRoot, ...segments), 'utf8');

export function loadPins() {
  return JSON.parse(read('labos', 'pins.json'));
}

export function pinnedFromManifests() {
  const nvmrc = read('.nvmrc').trim();
  const rustChannel = read('rust-toolchain.toml').match(
    /^\s*channel\s*=\s*"([^"]+)"/m
  )?.[1];
  const packageManager = JSON.parse(read('package.json')).packageManager;
  const yarn = packageManager?.replace(/^yarn@/, '');
  return { node: nvmrc, rust: rustChannel, yarn, packageManager };
}

export function checkPins() {
  const pins = loadPins();
  const manifests = pinnedFromManifests();
  const problems = [];

  const expect = (label, actual, expected) => {
    if (actual !== expected) {
      problems.push(`${label}: pins.json has ${actual}, manifest has ${expected}`);
    }
  };

  expect('toolchain.node.required', pins.toolchain.node.required, manifests.node);
  expect('toolchain.rust.required', pins.toolchain.rust.required, manifests.rust);
  expect('toolchain.yarn.required', pins.toolchain.yarn.required, manifests.yarn);

  if (!/^[0-9a-f]{40}$/.test(pins.upstream.pinnedCommit)) {
    problems.push(
      `upstream.pinnedCommit is not a full 40-char SHA: ${pins.upstream.pinnedCommit}`
    );
  }
  if (pins.upstream.releaseIsPrerelease !== false) {
    problems.push('upstream.releaseIsPrerelease must be false for a stable pin');
  }
  if (pins.fork.codeOnly !== true || pins.fork.visibility !== 'public') {
    problems.push('fork must be recorded as public and code-only');
  }
  if (pins.isolation.bundleId === 'pro.affine.app') {
    problems.push('isolation.bundleId collides with the stock AFFiNE app');
  }
  if (!pins.isolation.protocolScheme || pins.isolation.protocolScheme === 'affine') {
    problems.push('isolation.protocolScheme must not reuse the upstream affine scheme');
  }
  if (!pins.isolation.userDataDirName || pins.isolation.userDataDirName === 'AFFiNE') {
    problems.push('isolation.userDataDirName must not collide with stock AFFiNE');
  }
  if (pins.isolation.upstreamAutoUpdate !== 'disabled-for-this-fork') {
    problems.push('upstream auto-update must be disabled for this fork');
  }

  return problems;
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const problems = checkPins();
  if (problems.length) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('pins.json matches the pinned commit manifests');
  }
}

export { assert };
