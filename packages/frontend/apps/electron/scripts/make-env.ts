import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import debug from 'debug';
import { z } from 'zod';

const log = debug('affine:make-env');

const ReleaseTypeSchema = z.enum([
  'stable',
  'beta',
  'canary',
  'internal',
  'labos',
]);

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const ROOT = path.resolve(__dirname, '..');

const envBuildType = (process.env.BUILD_TYPE || 'canary').trim().toLowerCase();
const buildType = ReleaseTypeSchema.parse(envBuildType);
const stableBuild = buildType === 'stable';

// LabOS Workspace is a separate product that must be installable alongside a
// stock AFFiNE build without sharing data, a bundle identifier or an update
// channel. It is modelled as its own release type so the existing upstream
// mechanisms carry the isolation instead of a parallel code path.
const labosBuild = buildType === 'labos';
const notStableBuild = !stableBuild;

const productName = labosBuild
  ? 'LabOS Workspace'
  : notStableBuild
    ? `AFFiNE-${buildType}`
    : 'AFFiNE';

const icoPath = path.join(
  ROOT,
  labosBuild
    ? './resources/icons/icon.ico'
    : notStableBuild
      ? `./resources/icons/icon_${buildType}.ico`
      : './resources/icons/icon.ico'
);

const iconX64PngPath = path.join(
  ROOT,
  labosBuild
    ? './resources/icons/icon_64x64.png'
    : `./resources/icons/icon_${buildType}_64x64.png`
);

const iconX512PngPath = path.join(
  ROOT,
  labosBuild
    ? './resources/icons/icon_512x512.png'
    : `./resources/icons/icon_${buildType}_512x512.png`
);

const icnsPath = path.join(
  ROOT,
  labosBuild
    ? './resources/icons/icon.icns'
    : notStableBuild
      ? `./resources/icons/icon_${buildType}.icns`
      : './resources/icons/icon.icns'
);

const iconPngPath = path.join(ROOT, './resources/icons/icon.png');

const iconUrl = `https://cdn.affine.pro/app-icons/icon_${buildType}.ico`;

log(`buildType=${buildType}, productName=${productName}, icoPath=${icoPath}`);

const {
  values: { arch, platform },
} = parseArgs({
  options: {
    arch: {
      type: 'string',
      description: 'The architecture to build for',
      default: process.arch,
    },
    platform: {
      type: 'string',
      description: 'The platform to build for',
      default: process.platform,
    },
  },
  allowPositionals: true,
  strict: false,
});

log(`parsed args: arch=${arch}, platform=${platform}`);

const appIdMap = {
  internal: 'pro.affine.internal',
  canary: 'pro.affine.canary',
  beta: 'pro.affine.beta',
  stable: 'pro.affine.app',
  // Distinct bundle identifier: macOS treats this as its own application, so
  // LabOS and a stock AFFiNE install occupy separate bundle containers.
  labos: 'app.labos.workspace',
};

/**
 * URL scheme the packaged app registers.
 *
 * Upstream derives this as `productName.toLowerCase()`, which is fine for
 * `AFFiNE` but produces `"labos workspace"` for a name containing a space. A URL
 * scheme must be a single token, so the schedule is stated explicitly here and
 * must stay in step with `src/main/config.ts` and `src/preload/electron-api.ts`.
 */
const protocolScheme = labosBuild ? 'labos' : productName.toLowerCase();

export {
  appIdMap,
  arch,
  buildType,
  icnsPath,
  iconPngPath,
  iconUrl,
  iconX64PngPath,
  iconX512PngPath,
  icoPath,
  labosBuild,
  platform,
  productName,
  protocolScheme,
  REPO_ROOT,
  ROOT,
  stableBuild,
};
