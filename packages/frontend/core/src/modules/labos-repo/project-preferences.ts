/**
 * LabOS Workspace — presentation preferences.
 *
 * Shortlist order and chosen covers are LabOS's own presentation preferences,
 * keyed by a STABLE project identifier (the slug), not by an array index or a
 * display path. That matters because a project list can be re-fetched in a
 * different order at any time; keying by position would silently reassign
 * someone's choices to a different project.
 *
 * The file is validated on read. A corrupt or hand-edited entry degrades to no
 * preference rather than crashing the view or resurrecting a project that no
 * longer exists.
 */

export interface LabosProjectPreferences {
  /** Ordered slugs. The reader's priority shortlist. */
  shortlist: string[];
  /** slug -> chosen cover preview id, when the reader picked one. */
  covers: Record<string, string>;
}

export const EMPTY_PREFERENCES: LabosProjectPreferences = {
  shortlist: [],
  covers: {},
};

const MAX_SHORTLIST_ENTRIES = 200;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_COVER_ID_LENGTH = 128;

/**
 * Validate persisted preferences.
 *
 * Anything unrecognised is dropped rather than repaired with a guess: a
 * shortlist entry that is not a valid slug cannot be matched to a project, so
 * keeping it would only be misleading.
 */
export function parsePreferences(raw: unknown): LabosProjectPreferences {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_PREFERENCES };
  const candidate = raw as Partial<LabosProjectPreferences>;

  const shortlist = Array.isArray(candidate.shortlist)
    ? candidate.shortlist
        .filter(
          (entry): entry is string =>
            typeof entry === 'string' && SLUG_PATTERN.test(entry)
        )
        .slice(0, MAX_SHORTLIST_ENTRIES)
    : [];

  // De-duplicate while preserving the reader's chosen order.
  const seen = new Set<string>();
  const uniqueShortlist = shortlist.filter(slug => {
    if (seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });

  const covers: Record<string, string> = {};
  if (
    typeof candidate.covers === 'object' &&
    candidate.covers !== null &&
    !Array.isArray(candidate.covers)
  ) {
    for (const [slug, value] of Object.entries(
      candidate.covers as Record<string, unknown>
    )) {
      if (!SLUG_PATTERN.test(slug)) continue;
      if (typeof value !== 'string') continue;
      if (value.length === 0 || value.length > MAX_COVER_ID_LENGTH) continue;
      covers[slug] = value;
    }
  }

  return { shortlist: uniqueShortlist, covers };
}

/**
 * Toggle a project in the shortlist.
 *
 * Adding appends, so the reader's existing order is preserved rather than the
 * new entry jumping to a position they did not choose.
 */
export function toggleShortlist(
  preferences: LabosProjectPreferences,
  slug: string
): LabosProjectPreferences {
  if (!SLUG_PATTERN.test(slug)) return preferences;
  const present = preferences.shortlist.includes(slug);
  return {
    ...preferences,
    shortlist: present
      ? preferences.shortlist.filter(entry => entry !== slug)
      : [...preferences.shortlist, slug].slice(0, MAX_SHORTLIST_ENTRIES),
  };
}

/** Record the reader's chosen cover for a project. */
export function setCover(
  preferences: LabosProjectPreferences,
  slug: string,
  previewId: string | null
): LabosProjectPreferences {
  if (!SLUG_PATTERN.test(slug)) return preferences;
  const covers = { ...preferences.covers };
  if (previewId === null || previewId.length === 0) {
    delete covers[slug];
  } else if (previewId.length <= MAX_COVER_ID_LENGTH) {
    covers[slug] = previewId;
  }
  return { ...preferences, covers };
}

/**
 * Drop preferences for projects that no longer exist.
 *
 * Kept deliberately explicit rather than automatic: silently pruning on every
 * load would mean a project that is briefly unreachable loses its place
 * permanently. The caller decides when a purge is safe.
 */
export function prunePreferences(
  preferences: LabosProjectPreferences,
  existingSlugs: string[]
): LabosProjectPreferences {
  const existing = new Set(existingSlugs);
  const shortlist = preferences.shortlist.filter(slug => existing.has(slug));
  const covers: Record<string, string> = {};
  for (const [slug, id] of Object.entries(preferences.covers)) {
    if (existing.has(slug)) covers[slug] = id;
  }
  return { shortlist, covers };
}
