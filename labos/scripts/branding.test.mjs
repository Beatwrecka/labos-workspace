/**
 * LabOS Workspace — branding tests.
 *
 * Run with: node --test labos/scripts/branding.test.mjs
 *
 * Branding is the part of this feature an agent context cannot check by looking
 * at it, so the checks that *can* be automated are the ones that carry the
 * weight:
 *
 *  - the window title is built by one pure function, and that function cannot
 *    emit `AFFiNE` for an ordinary title
 *  - the brand orange is *measured* against the WCAG thresholds rather than
 *    asserted to look fine
 *  - the wiring exists, because the LabOS routes sit outside the layout that
 *    mounts the upstream title component — so a missing call is a silent
 *    regression back to the static `AFFiNE` title
 *
 * Explicitly NOT covered here: anything that requires seeing the screen. The
 * mark's shape, the header's spacing and the accent's feel still need a human.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..'
);

const BRAND = 'packages/frontend/core/src/modules/labos-repo/brand.ts';
const LABOS_PAGES = [
  'packages/frontend/core/src/desktop/pages/labos-home/index.tsx',
  'packages/frontend/core/src/desktop/pages/labos-repo/index.tsx',
  'packages/frontend/core/src/desktop/pages/labos-projects/index.tsx',
];

const read = relativePath =>
  fs.readFile(path.join(repoRoot, relativePath), 'utf8');

/**
 * Load a pure TypeScript module the way the rest of this suite does: transpile
 * with the repo's own TypeScript and import the result. Only works for modules
 * with no React, DOM or Electron import — which is exactly why `brand.ts` is
 * kept pure.
 */
async function loadTs(relativePath) {
  const ts = require(
    path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')
  );
  const sourcePath = path.join(repoRoot, relativePath);
  const source = await fs.readFile(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  const dataUrl =
    'data:text/javascript;base64,' +
    Buffer.from(transpiled, 'utf8').toString('base64');
  return import(dataUrl);
}

const brand = await loadTs(BRAND);
const THEMES = ['light', 'dark'];

// --- the name and the monogram ---------------------------------------------

test('the product identity is stated once and is not the upstream one', () => {
  assert.equal(brand.LABOS_PRODUCT_NAME, 'LabOS Workspace');
  assert.equal(brand.LABOS_MONOGRAM, 'LO');
  assert.ok(
    !brand.LABOS_PRODUCT_NAME.toUpperCase().includes('AFFINE'),
    'the product name still contains the upstream product name'
  );
  assert.ok(
    brand.LABOS_MONOGRAM.length <= 2,
    'a monogram longer than two characters will not read inside a 20px square'
  );
});

// --- the window title -------------------------------------------------------

test('the title is the product name when there is no view title', () => {
  assert.equal(brand.formatDocumentTitle(), 'LabOS Workspace');
  assert.equal(brand.formatDocumentTitle({}), 'LabOS Workspace');
  assert.equal(brand.formatDocumentTitle({ viewTitle: null }), 'LabOS Workspace');
  assert.equal(brand.formatDocumentTitle({ viewTitle: '' }), 'LabOS Workspace');
  assert.equal(brand.formatDocumentTitle({ viewTitle: '   ' }), 'LabOS Workspace');
});

test('a view title is prefixed to the product name, trimmed', () => {
  assert.equal(
    brand.formatDocumentTitle({ viewTitle: 'Sprint 8' }),
    'Sprint 8 · LabOS Workspace'
  );
  assert.equal(
    brand.formatDocumentTitle({ viewTitle: '  Notes  ' }),
    'Notes · LabOS Workspace'
  );
  assert.ok(
    brand.formatDocumentTitle({ viewTitle: 'Notes' }).endsWith(
      brand.LABOS_PRODUCT_NAME
    ),
    'the product name must be the half that always survives'
  );
});

test('an unread count is a prefix, never the whole title', () => {
  assert.equal(
    brand.formatDocumentTitle({ viewTitle: 'Inbox', notificationCount: 3 }),
    '(3) Inbox · LabOS Workspace'
  );
  assert.equal(
    brand.formatDocumentTitle({ notificationCount: 3 }),
    '(3) LabOS Workspace'
  );
});

test('a zero, negative or unusable count is not shown', () => {
  for (const notificationCount of [
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    null,
    undefined,
  ]) {
    assert.equal(
      brand.formatDocumentTitle({ viewTitle: 'Inbox', notificationCount }),
      'Inbox · LabOS Workspace',
      `count ${String(notificationCount)} should not have been shown`
    );
  }
});

test('an ordinary title never says AFFiNE', () => {
  for (const viewTitle of [undefined, null, '', '   ', 'Untitled', 'Repo notes']) {
    for (const notificationCount of [0, 1, 42]) {
      const title = brand.formatDocumentTitle({ viewTitle, notificationCount });
      assert.ok(
        !title.includes('AFFiNE'),
        `the LabOS window title leaked the upstream name: ${title}`
      );
    }
  }
});

// --- which build is this? ---------------------------------------------------

test('only the labos schemes count as the LabOS build', () => {
  for (const scheme of ['labos', 'labos-dev', 'labos-staging']) {
    assert.equal(brand.isLabosScheme(scheme), true, `${scheme} should be LabOS`);
  }
  for (const scheme of [
    'affine',
    'affine-dev',
    'affine-canary',
    'AFFINE',
    'AFFINE-LABOS',
    '',
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(
      brand.isLabosScheme(scheme),
      false,
      `${String(scheme)} should not be treated as the LabOS build`
    );
  }
});

// --- contrast, measured -----------------------------------------------------

test('the accent is readable as text on the app canvases', () => {
  for (const surface of brand.LABOS_REFERENCE_LIGHT_SURFACES) {
    const ratio = brand.contrastRatio(brand.LABOS_ACCENT_LIGHT, surface);
    assert.ok(
      ratio >= brand.MIN_TEXT_CONTRAST,
      `${brand.LABOS_ACCENT_LIGHT} on ${surface} measures ${ratio.toFixed(2)}:1, below ${brand.MIN_TEXT_CONTRAST}:1`
    );
  }
  for (const surface of brand.LABOS_REFERENCE_DARK_SURFACES) {
    const ratio = brand.contrastRatio(brand.LABOS_ACCENT_DARK, surface);
    assert.ok(
      ratio >= brand.MIN_TEXT_CONTRAST,
      `${brand.LABOS_ACCENT_DARK} on ${surface} measures ${ratio.toFixed(2)}:1, below ${brand.MIN_TEXT_CONTRAST}:1`
    );
  }
});

test('the monogram initials are readable inside the mark', () => {
  for (const theme of THEMES) {
    const { background, foreground } = brand.labosMarkColors(theme);
    const ratio = brand.contrastRatio(foreground, background);
    assert.ok(
      ratio >= brand.MIN_TEXT_CONTRAST,
      `${theme}: initials ${foreground} on ${background} measure ${ratio.toFixed(2)}:1, below ${brand.MIN_TEXT_CONTRAST}:1`
    );
  }
});

/**
 * The mark is a graphical object, so 3:1 is the threshold — but it still has to
 * hold, otherwise the square loses its edge and the monogram becomes a floating
 * pair of letters.
 */
test('the mark stays visible as a shape against the canvas it sits on', () => {
  for (const theme of THEMES) {
    const { background } = brand.labosMarkColors(theme);
    const surfaces =
      theme === 'dark'
        ? brand.LABOS_REFERENCE_DARK_SURFACES
        : brand.LABOS_REFERENCE_LIGHT_SURFACES;
    for (const surface of surfaces) {
      const ratio = brand.contrastRatio(background, surface);
      assert.ok(
        ratio >= brand.MIN_GRAPHIC_CONTRAST,
        `${theme}: the mark ${background} on ${surface} measures ${ratio.toFixed(2)}:1, below ${brand.MIN_GRAPHIC_CONTRAST}:1`
      );
    }
  }
});

/** Guards the measurement itself, so a wrong formula cannot pass everything. */
test('contrast is computed the WCAG way', () => {
  assert.ok(
    Math.abs(brand.contrastRatio('#000000', '#FFFFFF') - 21) < 0.01,
    'black on white should be 21:1'
  );
  assert.equal(brand.contrastRatio('#FFFFFF', '#FFFFFF'), 1);
  assert.equal(
    brand.contrastRatio('#123456', '#654321'),
    brand.contrastRatio('#654321', '#123456')
  );
  assert.ok(Math.abs(brand.relativeLuminance('#FFFFFF') - 1) < 1e-9);
  assert.equal(brand.relativeLuminance('#000000'), 0);
  // Short form is accepted, anything else is refused rather than guessed at.
  assert.equal(brand.contrastRatio('#fff', '#000'), 21);
  assert.throws(() => brand.contrastRatio('white', '#000000'));
  assert.throws(() => brand.contrastRatio('#12345', '#000000'));
});

// --- the wiring -------------------------------------------------------------

test('every LabOS route sets its own window title', async () => {
  for (const route of LABOS_PAGES) {
    const source = await read(route);
    assert.match(
      source,
      /useLabosDocumentTitle\(/,
      `${route} never sets a window title. /labos routes sit outside the /workspace layout, so nothing else will.`
    );
  }
});

test('the workspace title follows the build type, not the upstream name', async () => {
  const source = await read(
    'packages/frontend/core/src/desktop/components/document-title/index.tsx'
  );
  assert.match(
    source,
    /isLabosScheme\(/,
    'the upstream title component no longer checks which product this is'
  );
  assert.match(
    source,
    /formatDocumentTitle\(\{ viewTitle, notificationCount \}\)/,
    'the LabOS title is no longer built by the shared, tested formatter'
  );
});

test('the LabOS name is rendered from the brand module, not typed in by hand', async () => {
  const source = await read(
    'packages/frontend/core/src/modules/labos-repo/home-view.tsx'
  );
  assert.match(source, /<LabosLockup \/>/);
  assert.ok(
    !source.includes('>LabOS Workspace<'),
    'the header hard-codes the product name instead of using brand.ts'
  );
});

test('the monogram renders the shared constant and hides itself from screen readers', async () => {
  const source = await read(
    'packages/frontend/core/src/modules/labos-repo/labos-mark.tsx'
  );
  assert.match(source, /\{LABOS_MONOGRAM\}/);
  assert.match(
    source,
    /aria-hidden/,
    'a decorative mark next to the product name must not be announced'
  );
  assert.match(
    source,
    /s\.accentText/,
    'the product name is no longer carrying the brand accent'
  );
});

test('the brand styles take their colours from the measured constants', async () => {
  const source = await read(
    'packages/frontend/core/src/modules/labos-repo/brand.css.ts'
  );
  for (const constant of [
    'LABOS_MARK_BACKGROUND_LIGHT',
    'LABOS_MARK_BACKGROUND_DARK',
    'LABOS_MARK_FOREGROUND_LIGHT',
    'LABOS_MARK_FOREGROUND_DARK',
    'LABOS_ACCENT_LIGHT',
    'LABOS_ACCENT_DARK',
  ]) {
    assert.ok(
      source.includes(constant),
      `brand.css.ts does not use ${constant}`
    );
  }
  assert.ok(
    !/#[0-9a-fA-F]{3,8}\b/.test(source),
    'brand.css.ts hard-codes a colour instead of importing it from brand.ts'
  );
});
