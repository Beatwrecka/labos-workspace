import { z } from 'zod';

export const ReleaseTypeSchema = z.enum([
  'stable',
  'beta',
  'canary',
  'internal',
  'labos',
]);

declare global {
  // THIS variable should be replaced during the build process
  const REPLACE_ME_BUILD_ENV: string;
}

export const envBuildType = (process.env.BUILD_TYPE || REPLACE_ME_BUILD_ENV)
  .trim()
  .toLowerCase();

export const overrideSession = process.env.BUILD_TYPE === 'internal';

export const buildType = ReleaseTypeSchema.parse(envBuildType);

/**
 * LabOS Workspace is a distinct product built from this fork.
 *
 * Its isolation is derived from a single flag so there is one place to read the
 * answer to "is this the LabOS build?" rather than a set of scattered checks:
 *
 * - `appDataFolderName` and `sessionDataFolderName` keep the native workspace
 *   store, caches and logs apart from a stock AFFiNE install.
 * - `protocolScheme` avoids claiming AFFiNE's `affine://` links.
 * - `upstreamUpdatesEnabled` stays false: this fork has no update channel of its
 *   own, and inheriting upstream's would let an official AFFiNE release replace
 *   the LabOS app.
 */
export const isLabosBuild = buildType === 'labos';

export const appDataFolderName = isLabosBuild
  ? 'LabOS Workspace'
  : buildType === 'stable'
    ? 'AFFiNE'
    : `AFFiNE-${buildType}`;

export const sessionDataFolderName = appDataFolderName;

export const protocolScheme = isLabosBuild ? 'labos' : 'affine';

export const upstreamUpdatesEnabled = !isLabosBuild;

export const mode = process.env.NODE_ENV;
export const isDev = mode === 'development';
