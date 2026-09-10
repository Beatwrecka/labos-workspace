import path from 'node:path';

import * as Sentry from '@sentry/electron/main';
import { IPCMode } from '@sentry/electron/main';
import { app, protocol } from 'electron';

import { createApplicationMenu } from './application-menu/create';
import {
  appDataFolderName,
  isDev,
  isLabosBuild,
  overrideSession,
  sessionDataFolderName,
} from './config';
import { persistentConfig } from './config-storage/persist';
import { setupDeepLink } from './deep-link';
import { registerEvents } from './events';
import { registerHandlers } from './handlers';
import { closeLabosRepoWatcher, restoreLabosRoots } from './labos/handlers';
import { closeLabosAgents } from './labos/agent-handlers';
import { logger } from './logger';
import { registerProtocol } from './protocol';
import { setupRecordingFeature } from './recording/feature';
import { registerSecurityRestrictions } from './security-restrictions';
import { setupTrayState } from './tray';
import { registerUpdater } from './updater';
import { launch } from './windows-manager/launcher';
import { launchStage } from './windows-manager/stage';

app.enableSandbox();

if (isDev) {
  // In electron the dev server will be resolved to 0.0.0.0, but it
  // might be blocked by electron.
  // See https://github.com/webpack/webpack-dev-server/pull/384
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP 0.0.0.0 127.0.0.1');
}
// https://github.com/electron/electron/issues/43556
// // `CalculateNativeWinOcclusion` - Disable native window occlusion tracker (https://groups.google.com/a/chromium.org/g/embedder-dev/c/ZF3uHHyWLKw/m/VDN2hDXMAAAJ)
const disabledFeatures = [
  'PlzDedicatedWorker',
  'CalculateNativeWinOcclusion',
  // Disable Chrome autofill and password save prompts
  'AutofillServerCommunication',
  'AutofillProfileCleanup',
  'AutofillAddressProfileSavePrompt',
  'AutofillPaymentCards',
  'AutofillEnableAccountWalletStorage',
  'SavePasswordBubble',
].join(',');
app.commandLine.appendSwitch('disable-features', disabledFeatures);
app.commandLine.appendSwitch('disable-blink-features', 'Autofill');

// Following features are enabled from the runtime:
// `DocumentPolicyIncludeJSCallStacksInCrashReports` - https://www.electronjs.org/docs/latest/api/web-frame-main#framecollectjavascriptcallstack-experimental
// `EarlyEstablishGpuChannel` - Refs https://issues.chromium.org/issues/40208065
// `EstablishGpuChannelAsync` - Refs https://issues.chromium.org/issues/40208065
const enabledFeatures = [
  'DocumentPolicyIncludeJSCallStacksInCrashReports',
  'EarlyEstablishGpuChannel',
  'EstablishGpuChannelAsync',
].join(',');
app.commandLine.appendSwitch('enable-features', enabledFeatures);
const enabledBlinkFeatures = ['CSSTextAutoSpace', 'WebCodecs'].join(',');
app.commandLine.appendSwitch('enable-blink-features', enabledBlinkFeatures);
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// The application name must be set before anything resolves a path from it.
// electron-log, Chromium's log directory and several Electron APIs derive their
// location from app.getName() at import time, so redirecting only userData below
// would still leave LabOS writing into the stock AFFiNE log directory.
if (appDataFolderName !== 'AFFiNE') {
  app.setName(appDataFolderName);
}

// LabOS Workspace must never open a stock AFFiNE profile as its live database,
// so it always redirects userData/sessionData to its own application-data
// folder. A stock AFFiNE build keeps the upstream behaviour of sharing data
// between internal & beta for testing.
if (overrideSession || appDataFolderName !== 'AFFiNE') {
  const userDataPath = path.join(app.getPath('appData'), appDataFolderName);
  app.setPath('userData', userDataPath);
  app.setPath(
    'sessionData',
    path.join(app.getPath('appData'), sessionDataFolderName)
  );
  app.setPath(
    'logs',
    path.join(app.getPath('appData'), appDataFolderName, 'logs')
  );
}

// oxlint-disable-next-line typescript/no-var-requires
if (require('electron-squirrel-startup')) app.quit();

if (process.env.SKIP_ONBOARDING) {
  launchStage.value = 'main';
  persistentConfig.set({
    onBoarding: false,
  });
}

/**
 * Prevent multiple instances
 */
const isSingleInstance = app.requestSingleInstanceLock();
if (!isSingleInstance) {
  logger.info(
    'Another instance is running or responding deep link, exiting...'
  );
  app.quit();
  process.exit(0);
}

/**
 * Shout down background process if all windows was closed
 */
app.on('window-all-closed', () => {
  app.quit();
});

/**
 * @see https://www.electronjs.org/docs/latest/api/app#event-activate-macos Event: 'activate'
 */
app.on('activate', () => {
  if (app.isReady()) {
    launch().catch(e => console.error('Failed launch:', e));
  }
});

setupDeepLink(app);
registerSecurityRestrictions();

/**
 * Create app window when background process will be ready
 */
app
  .whenReady()
  .then(registerProtocol)
  .then(registerHandlers)
  .then(registerEvents)
  // Restore trusted roots before the first window so a document opened from a
  // previous session resolves immediately rather than appearing missing.
  .then(async () => {
    if (!isLabosBuild) return;
    try {
      await restoreLabosRoots();
    } catch (error) {
      console.error('[labos] failed to restore trusted roots:', error);
    }
  })
  .then(launch)
  .then(createApplicationMenu)
  .then(registerUpdater)
  .then(setupRecordingFeature)
  .then(setupTrayState)
  .catch(e => console.error('Failed create window:', e));

// The watcher holds OS file handles; release them explicitly on the way out
// rather than relying on process teardown.
app.on('will-quit', () => {
  try {
    closeLabosRepoWatcher();
    // A running agent job is a child process; it must not outlive the app.
    closeLabosAgents();
  } catch {
    // Shutting down: a failure here must not block quit.
  }
});

if (process.env.SENTRY_RELEASE) {
  // https://docs.sentry.io/platforms/javascript/guides/electron/
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.BUILD_TYPE ?? 'development',
    ipcMode: IPCMode.Protocol,
    transportOptions: {
      maxAgeDays: 30,
      maxQueueSize: 100,
    },
  });
  Sentry.setTags({
    distribution: 'electron',
    appVersion: app.getVersion(),
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'assets',
    privileges: {
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true,
      standard: true,
      stream: true,
    },
  },
]);
