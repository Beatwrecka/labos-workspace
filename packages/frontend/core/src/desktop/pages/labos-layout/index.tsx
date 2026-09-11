import { Outlet } from 'react-router-dom';

import { AppContainer } from '../../components/app-container';

/**
 * Reuse the desktop tabs/title-bar frame, including its platform-specific window
 * controls and drag regions. Do not compensate for native controls with a fixed
 * macOS padding: that breaks in fullscreen and misses the other LabOS routes.
 * AppContainer also supplies the existing browser layout outside Electron.
 */
export const Component = () => (
  <AppContainer>
    <Outlet />
  </AppContainer>
);
