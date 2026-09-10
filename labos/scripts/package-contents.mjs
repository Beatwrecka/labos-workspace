// Inspect a packaged LabOS .app for runtime dependencies the bundle marks external.
//
// Run with: node --test labos/scripts/package-contents.test.mjs
//     check: node labos/scripts/package-contents.mjs <path-to-app-or-asar>
//
// Why this exists: esbuild marks `electron`, `electron-updater`, `yjs` and
// `semver` as external, so they are required at runtime rather than inlined. If
// electron-forge prunes them out of the bundle, the packaged app dies at startup
// with "Cannot find module 'electron-updater'" — which is exactly what happened
// before the workspace hoisting settings were aligned with CI. A packaged app is
// only useful if the modules it requires are inside it.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/** Modules the esbuild layer leaves external and therefore must ship. */
export const REQUIRED_RUNTIME_MODULES = [
  'electron-updater',
  'async-call-rpc',
  'link-preview-js',
  'set-cookie-parser',
  'yjs',
];

/** Read package.json#dependencies of the electron app. */
export function declaredRuntimeDependencies() {
  const pkg = JSON.parse(
    readFileSync(
      resolve(repoRoot, 'packages/frontend/apps/electron/package.json'),
      'utf8'
    )
  );
  return Object.keys(pkg.dependencies ?? {});
}

/** Locate the newest packaged .app under the electron out directory. */
export function findPackagedApp(flavour = 'labos') {
  const outDir = resolve(
    repoRoot,
    'packages/frontend/apps/electron/out',
    flavour
  );
  if (!existsSync(outDir)) return null;
  const found = execFileSync(
    'find',
    [outDir, '-maxdepth', '2', '-name', '*.app'],
    {
      encoding: 'utf8',
    }
  )
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);
  return found ?? null;
}

/** List asar entries using the asar CLI shipped with electron-forge. */
export function listAsar(asarPath) {
  const output = execFileSync(
    'node',
    [
      resolve(
        repoRoot,
        'packages/frontend/apps/electron/node_modules/.bin/asar'
      ),
      'list',
      asarPath,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  return output
    .split('\n')
    .map(line => line.trim().replace(/^[/\\]/, ''))
    .filter(Boolean);
}

export function missingRuntimeModules(entries) {
  const missing = [];
  for (const name of declaredRuntimeDependencies()) {
    // Accept a module bundled under any nested node_modules path.
    const present = entries.some(
      entry =>
        entry === `node_modules/${name}` ||
        entry.startsWith(`node_modules/${name}/`) ||
        entry.includes(`/node_modules/${name}/`)
    );
    if (!present) missing.push(name);
  }
  return missing;
}
