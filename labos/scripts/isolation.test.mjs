// LabOS Workspace — app isolation tests.
//
// Run with: node --test labos/scripts/isolation.test.mjs
//
// The single most dangerous mistake in this fork is letting LabOS Workspace open
// a stock AFFiNE profile as its live database, or letting an upstream AFFiNE
// update replace the LabOS app. These read the real build files and assert the
// isolation values, so an edit that quietly reintroduces a collision fails here.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const electronRoot = resolve(repoRoot, 'packages/frontend/apps/electron');

const read = (...segments) => readFileSync(resolve(...segments), 'utf8');

const runtimeConfig = read(electronRoot, 'src/main/config.ts');
const makeEnv = read(electronRoot, 'scripts/make-env.ts');
const mainIndex = read(electronRoot, 'src/main/index.ts');
const deepLink = read(electronRoot, 'src/main/deep-link.ts');
const updater = read(electronRoot, 'src/main/updater/electron-updater.ts');
const pins = JSON.parse(read(repoRoot, 'labos/pins.json'));

test('the labos release type is a first-class build type', () => {
  assert.match(runtimeConfig, /'labos',/);
  assert.match(makeEnv, /'labos',/);
  assert.match(makeEnv, /labos:\s*'app\.labos\.workspace'/);
});

test('the LabOS bundle identifier is distinct from every AFFiNE identifier', () => {
  const ids = [...makeEnv.matchAll(/'pro\.affine\.[a-z]+'/g)].map(m => m[0]);
  assert.ok(ids.length >= 4, 'expected the upstream app id map to be present');
  assert.ok(
    !ids.includes("'app.labos.workspace'"),
    'the LabOS id must not be one of the pro.affine.* ids'
  );
  assert.equal(pins.isolation.bundleId, 'app.labos.workspace');
  assert.notEqual(pins.isolation.bundleId, 'pro.affine.app');
});

test('product name and app-data folder cannot collide with stock AFFiNE', () => {
  // productName drives the packaged app name; a collision would mean the two
  // apps overwrite each other's bundle.
  assert.match(makeEnv, /'LabOS Workspace'/);
  // The runtime must redirect userData/sessionData, not inherit AFFiNE's path.
  assert.match(runtimeConfig, /'LabOS Workspace'/);
  assert.match(mainIndex, /app\.setPath\('userData'/);
  assert.match(mainIndex, /app\.setPath\('sessionData'/);
  assert.match(
    mainIndex,
    /appDataFolderName !== 'AFFiNE'/,
    'the redirect must be unconditional for non-AFFiNE builds'
  );
  assert.equal(pins.isolation.userDataDirName, 'LabOS Workspace');
});

test('the app name and log path are isolated, not just userData', () => {
  // Regression guard for a real defect: electron-log derives its file path from
  // app.getName() at import time. Redirecting only userData left the LabOS app
  // writing into the stock AFFiNE log directory at ~/Library/Logs/AFFiNE.
  assert.match(
    mainIndex,
    /app\.setName\(appDataFolderName\)/,
    'app.setName must run so name-derived paths cannot fall back to AFFiNE'
  );
  assert.match(
    mainIndex,
    /app\.setPath\('logs'/,
    'the log directory must be redirected too'
  );
  // setName must be applied before the userData redirect.
  const setNameAt = mainIndex.indexOf('app.setName(appDataFolderName)');
  const setUserDataAt = mainIndex.indexOf("app.setPath('userData'");
  assert.ok(setNameAt !== -1 && setUserDataAt !== -1);
  assert.ok(
    setNameAt < setUserDataAt,
    'the app name must be set before paths are derived from it'
  );
});

test('LabOS claims its own deep-link scheme instead of affine://', () => {
  assert.match(
    runtimeConfig,
    /protocolScheme\s*=\s*isLabosBuild\s*\?\s*'labos'\s*:\s*'affine'/
  );
  assert.match(deepLink, /protocolScheme/);
  assert.equal(pins.isolation.protocolScheme, 'labos');
  assert.notEqual(pins.isolation.protocolScheme, 'affine');
});

test('inherited upstream auto-update is disabled for the LabOS build', () => {
  assert.match(runtimeConfig, /upstreamUpdatesEnabled\s*=\s*!isLabosBuild/);
  assert.match(updater, /!upstreamUpdatesEnabled/);
  assert.equal(pins.isolation.upstreamAutoUpdate, 'disabled-for-this-fork');
});

test('upstream release types are preserved, not replaced', () => {
  // Isolation must not remove the stock AFFiNE identities.
  for (const id of [
    'pro.affine.app',
    'pro.affine.canary',
    'pro.affine.beta',
    'pro.affine.internal',
  ]) {
    assert.ok(makeEnv.includes(id), `${id} must remain available`);
  }
  assert.match(
    makeEnv,
    /: 'AFFiNE';/,
    'the stable product name must remain AFFiNE'
  );
});

test('the URL scheme is a valid single token, not derived from a spaced name', () => {
  // Upstream computed `schemes: [productName.toLowerCase()]`, which yields
  // "labos workspace" now that the product name contains a space. A URL scheme
  // with a space is invalid, so the scheme is stated explicitly instead.
  assert.match(
    makeEnv,
    /const protocolScheme = labosBuild \? 'labos' : productName\.toLowerCase\(\)/
  );
  const forgeConfig = read(electronRoot, 'forge.config.mjs');
  assert.match(forgeConfig, /schemes: \[protocolScheme\]/);
  assert.doesNotMatch(
    forgeConfig,
    /schemes: \[productName\.toLowerCase\(\)\]/,
    'the scheme must not be derived from a product name that can contain spaces'
  );
});

test('labos is registered in every release-type registry', () => {
  // A release type has to be declared in several places; missing one produces
  // either a build failure ("BUILD_TYPE labos is not supported") or a silently
  // wrong scheme. Each site is asserted so an omission fails here rather than at
  // packaging time.
  const registries = {
    'main/config.ts': [runtimeConfig, /'labos',/],
    'scripts/make-env.ts': [makeEnv, /'labos',/],
    'tools/utils/src/build-config.ts': [
      read(repoRoot, 'tools/utils/src/build-config.ts'),
      /labos/,
    ],
    'tools/@types/build-config/__all.d.ts': [
      read(repoRoot, 'tools/@types/build-config/__all.d.ts'),
      /'labos'/,
    ],
    'tools/cli/src/rspack/index.ts': [
      read(repoRoot, 'tools/cli/src/rspack/index.ts'),
      /'labos'/,
    ],
    'preload/electron-api.ts': [
      read(electronRoot, 'src/preload/electron-api.ts'),
      /'labos',/,
    ],
  };
  for (const [file, [contents, pattern]] of Object.entries(registries)) {
    assert.match(
      contents,
      pattern,
      `${file} must register the labos release type`
    );
  }
});

test('channel-keyed maps all carry a labos entry', () => {
  // These are Record<Channel, …> maps and appBuildType is now 'labos', so a
  // missing key is a type error at build time. Asserted here too so the intent
  // survives even if a future edit loosens the types.
  const channelMap = read(
    repoRoot,
    'packages/frontend/core/src/utils/channel.ts'
  );
  for (const map of [
    'schemeToChannel',
    'channelToScheme',
    'appIconMap',
    'appNames',
  ]) {
    const body = channelMap.slice(channelMap.indexOf(`const ${map} =`));
    assert.ok(
      body.slice(0, body.indexOf('};')).includes('labos'),
      `${map} must have a labos entry`
    );
  }
  assert.match(
    read(repoRoot, 'packages/frontend/core/src/modules/cloud/constant.ts'),
    /labos: 'https:\/\/app\.affine\.pro'/
  );
  assert.match(
    read(repoRoot, 'packages/frontend/admin/src/modules/about/about.tsx'),
    /labos: 'LabOS Workspace'/
  );
});

test('the renderer-facing scheme matches the main-process scheme', () => {
  // main/config.ts delegates to isLabosBuild; the preload derives it inline (the
  // preload bundle cannot import main-process config). If these drift, in-app
  // deep links and the registered protocol disagree.
  const preloadConfig = read(electronRoot, 'src/preload/electron-api.ts');
  assert.match(preloadConfig, /buildType === 'labos'/);
  assert.match(preloadConfig, /'labos'/);
  assert.match(runtimeConfig, /isLabosBuild \? 'labos' : 'affine'/);
});
