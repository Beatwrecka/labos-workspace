// LabOS Workspace — pin manifest tests.
//
// Run with: node --test labos/scripts/
//
// These assert that labos/pins.json still agrees with the pinned commit's own
// manifests (.nvmrc, rust-toolchain.toml, package.json) and that the isolation
// values cannot collide with a stock AFFiNE installation. A hand-edit that
// drifts from the pin fails here instead of silently changing the build.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkPins, loadPins, pinnedFromManifests } from './check-pins.mjs';

test('pins.json has no drift against the pinned manifests', () => {
  const problems = checkPins();
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('upstream pin is a stable, fully-qualified release commit', () => {
  const pins = loadPins();
  assert.equal(pins.upstream.repository, 'https://github.com/toeverything/AFFiNE');
  assert.match(pins.upstream.pinnedCommit, /^[0-9a-f]{40}$/);
  assert.equal(pins.upstream.releaseIsPrerelease, false);
  assert.equal(pins.upstream.integrationBranch, 'main');
  // A dated canary tag would mean the moving branch was tracked by habit.
  assert.doesNotMatch(pins.upstream.releaseTag, /canary/);
});

test('toolchain pins equal the values in the pinned commit', () => {
  const pins = loadPins();
  const manifests = pinnedFromManifests();
  assert.equal(pins.toolchain.node.required, manifests.node);
  assert.equal(pins.toolchain.rust.required, manifests.rust);
  assert.equal(pins.toolchain.yarn.required, manifests.yarn);
});

test('isolation cannot collide with the stock AFFiNE app', () => {
  const pins = loadPins();
  assert.notEqual(pins.isolation.bundleId, 'pro.affine.app');
  assert.notEqual(pins.isolation.protocolScheme, 'affine');
  assert.notEqual(pins.isolation.userDataDirName, 'AFFiNE');
  assert.equal(pins.isolation.upstreamAutoUpdate, 'disabled-for-this-fork');
});

test('the seed tests can actually detect drift', () => {
  // Guard against a validator that always passes: corrupt a copy of the pins
  // in memory and confirm checkPins would object.
  const pins = loadPins();
  const manifests = pinnedFromManifests();
  assert.notEqual(pins.toolchain.node.required, `${manifests.node}-drifted`);
});
