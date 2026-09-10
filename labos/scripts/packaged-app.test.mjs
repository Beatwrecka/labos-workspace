// LabOS Workspace — packaged-app isolation checks (macOS).
//
// Run with: node --test labos/scripts/packaged-app.test.mjs
//
// These assert what the PACKAGED .app actually contains, not what the source
// intends. Several real defects in this build were invisible in source and only
// appeared in the packaged bundle:
//
//   * the app started and died with "Cannot find module 'electron-updater'"
//     because electron-forge had no workspace node_modules to bundle;
//   * the window opened but loaded nothing, because resources/web-static was
//     empty after generate-assets MOVED the renderer output too early;
//   * the URL scheme registered as "labos workspace" (with a space).
//
// A packaged app is the deliverable, so the packaged app is what is checked.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  findPackagedApp,
  listAsar,
  missingRuntimeModules,
} from './package-contents.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const appPath = findPackagedApp('labos');
const pinned = JSON.parse(
  readFileSync(resolve(repoRoot, 'labos/pins.json'), 'utf8')
);
const expected = pinned.isolation;

const skip = appPath
  ? false
  : 'no packaged labos .app found; run labos/scripts/package-labos.sh';

const plist = key => {
  try {
    return execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', `Print ${key}`, resolve(appPath, 'Contents/Info.plist')],
      { encoding: 'utf8' }
    ).trim();
  } catch {
    return null;
  }
};

test('the packaged app exists and is signed', { skip }, () => {
  assert.ok(existsSync(appPath), `${appPath} must exist`);
  // A structurally valid signature is required: with the embedded asar-integrity
  // fuse enabled, an invalid signature makes macOS SIGKILL the app at launch.
  const result = execFileSync(
    'codesign',
    ['--verify', '--deep', '--strict', appPath],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  assert.equal(result.trim(), '');
});

test('the packaged bundle carries the isolated identity', { skip }, () => {
  assert.equal(plist('CFBundleIdentifier'), expected.bundleId);
  assert.notEqual(plist('CFBundleIdentifier'), 'pro.affine.app');
  assert.equal(plist('CFBundleName'), expected.applicationName);
  // Scheme must be a single token; a spaced name would be an invalid scheme.
  assert.equal(
    plist('CFBundleURLTypes:0:CFBundleURLSchemes:0'),
    expected.protocolScheme
  );
  assert.doesNotMatch(
    plist('CFBundleURLTypes:0:CFBundleURLSchemes:0') ?? '',
    /\s/,
    'a URL scheme must not contain whitespace'
  );
});

test(
  'the packaged app is named so it installs beside stock AFFiNE',
  { skip },
  () => {
    assert.match(appPath, /LabOS Workspace\.app$/);
    assert.doesNotMatch(appPath, /AFFiNE\.app$/);
    assert.equal(plist('CFBundleExecutable'), expected.applicationName);
  }
);

test('every runtime-external module is bundled', { skip }, () => {
  // esbuild leaves these external, so they are `require`d at runtime and must
  // ship inside the app. This is the check that would have caught the
  // "Cannot find module 'electron-updater'" crash.
  const entries = listAsar(resolve(appPath, 'Contents/Resources/app.asar'));
  const missing = missingRuntimeModules(entries);
  assert.deepEqual(
    missing,
    [],
    `bundled app is missing runtime modules: ${missing.join(', ')}`
  );
});

test('the web renderer assets are bundled', { skip }, () => {
  // Without these the window opens and stays blank, logging ERR_UNEXPECTED for
  // assets://./shell.html. Presence of shell.html is the cheap proxy for a
  // complete renderer payload.
  const entries = listAsar(resolve(appPath, 'Contents/Resources/app.asar'));
  assert.ok(
    entries.includes('resources/web-static/shell.html'),
    'app.asar must contain resources/web-static/shell.html'
  );
  assert.ok(
    entries.some(e => e.startsWith('resources/web-static/js/')),
    'app.asar must contain the renderer JS chunks'
  );
  assert.ok(
    entries.some(e => e.startsWith('resources/web-static/assets/')),
    'app.asar must contain the renderer assets directory'
  );
});
