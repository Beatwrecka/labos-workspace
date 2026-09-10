/**
 * LabOS Workspace — repository change events.
 *
 * Follows the existing `MainEventRegister` pattern: registering returns an
 * unsubscribe, and the registrar broadcasts to every window subscribed to the
 * channel. Change events carry no absolute path.
 */

import { addLabosChangeListener } from './handlers';

export const labosRepoEvents = {
  onFileChanged: (callback: (change: unknown) => void) => {
    const unsubscribe = addLabosChangeListener(callback);
    // The event registry expects every registrar to return an unsubscribe
    // function. Returning the raw Set.delete result would be a boolean.
    return () => {
      unsubscribe();
    };
  },
};
