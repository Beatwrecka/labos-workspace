import { DesktopApiService } from '@affine/core/modules/desktop-api';
import {
  formatDocumentTitle,
  isLabosScheme,
} from '@affine/core/modules/labos-repo/brand';
import { NotificationCountService } from '@affine/core/modules/notification';
import { WorkbenchService } from '@affine/core/modules/workbench';
import {
  useLiveData,
  useService,
  useServiceOptional,
} from '@toeverything/infra';
import { useEffect } from 'react';

export const DocumentTitle = () => {
  const notificationCountService = useService(NotificationCountService);
  const notificationCount = useLiveData(notificationCountService.count$);
  const workbenchService = useService(WorkbenchService);
  const workbenchView = useLiveData(workbenchService.workbench.activeView$);
  const viewTitle = useLiveData(workbenchView.title$);
  // Optional on purpose: this component also runs in the web build, where there
  // is no desktop API and therefore no build type to read. Absent means "not the
  // LabOS build", so an upstream build keeps upstream's title.
  const desktopApi = useServiceOptional(DesktopApiService);
  const isLabos = isLabosScheme(desktopApi?.appInfo?.scheme);

  useEffect(() => {
    if (isLabos) {
      document.title = formatDocumentTitle({ viewTitle, notificationCount });
    } else {
      const prefix = notificationCount > 0 ? `(${notificationCount}) ` : '';
      document.title = prefix + (viewTitle ? `${viewTitle} · AFFiNE` : 'AFFiNE');
    }

    return () => {
      // Unmounting in an upstream build restores upstream's title. A LabOS
      // build shows the product name rather than stranding the last document's
      // name in the window title.
      document.title = isLabos ? formatDocumentTitle() : 'AFFiNE';
    };
  }, [notificationCount, viewTitle, isLabos]);

  return null;
};
