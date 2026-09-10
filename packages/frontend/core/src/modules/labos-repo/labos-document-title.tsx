/**
 * LabOS Workspace — the window title for the LabOS routes.
 *
 * Why this exists at all, rather than reusing the upstream `DocumentTitle`:
 * `/labos/home`, `/labos/repo` and `/labos/projects` are top-level routes,
 * deliberately outside the `/workspace` layout. `DocumentTitle` is mounted by
 * that layout, so on these routes it never runs — and the window kept the
 * static `<title>AFFiNE</title>` baked into the renderer's HTML.
 *
 * The alternative — moving the LabOS routes under `/workspace` so the existing
 * title component applies — was rejected: a repository file is not part of an
 * AFFiNE workspace, and nesting them would assert a relationship that does not
 * exist.
 *
 * A hook rather than only a component, because two of the three LabOS pages
 * return from several branches (disconnected, detail, list). A hook is called
 * once at the top of the page whatever branch renders, so no branch can be
 * forgotten and no page needs a component threaded through every return.
 *
 * The title text itself is built by `formatDocumentTitle` in `brand.ts`, which
 * is unit tested, so "the window never says AFFiNE" is a checked property rather
 * than a claim about a string literal someone has to notice.
 */

import { useEffect } from 'react';

import { formatDocumentTitle } from './brand';

export function useLabosDocumentTitle(viewTitle?: string) {
  useEffect(() => {
    document.title = formatDocumentTitle({ viewTitle });
    return () => {
      // Leaving a LabOS route must not strand a LabOS title, and must not leave
      // the previous view's document name behind either.
      document.title = formatDocumentTitle();
    };
  }, [viewTitle]);
}

/** Component form, for a page that has a single return. */
export function LabosDocumentTitle({ viewTitle }: { viewTitle?: string }) {
  useLabosDocumentTitle(viewTitle);
  return null;
}
