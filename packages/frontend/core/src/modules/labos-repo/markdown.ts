/**
 * LabOS Workspace — Markdown rendering safety for repository documents.
 *
 * A repository file is UNTRUSTED input. It may have been written by an agent, a
 * cloned dependency, or someone else entirely, and repository Markdown is
 * rendered inside the application's own window. This module is the boundary.
 *
 * What it refuses, and why each matters:
 *
 *  - **Raw HTML is escaped, not rendered.** A `.md` file with an inline
 *    `<img onerror=...>` or `<script>` would otherwise execute with the app's
 *    privileges. Escaping means the text is still visible and still editable.
 *  - **`javascript:` and other non-http(s) link schemes are defused.** A link
 *    that runs script on click is a code-execution path that does not need HTML.
 *  - **Remote images are not fetched.** An `<img src="https://tracker/...">`
 *    reports the reader's IP and reading habits to a third party. The URL is
 *    shown as text instead, so the information is not silently lost.
 *  - **MDX and component syntax is not executed.** `{expression}` and `<Component />`
 *    are shown verbatim; this build has no MDX runtime at all.
 *  - **`iframe`, `object`, `embed`, `form` and `base` are dropped** rather than
 *    escaped, because their presence in a document is always a mistake at best.
 *
 * The output is a plain data structure, never an HTML string, so the renderer
 * builds DOM nodes from values it controls. There is no `dangerouslySetInnerHTML`
 * anywhere in this feature.
 */

export type LabosInline =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'em'; value: string }
  | { kind: 'del'; value: string }
  | { kind: 'link'; value: string; href: string | null; blocked?: string }
  /**
   * Markdown this build deliberately does not render — an image it will not
   * fetch, or MDX it will not execute. `value` is shown as text so nothing is
   * silently lost from the user's document.
   */
  | {
      kind: 'unsupported';
      syntax: 'remote-image' | 'local-image' | 'mdx';
      value: string;
    };

export type LabosBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: LabosInline[] }
  | { kind: 'paragraph'; content: LabosInline[] }
  | { kind: 'list'; ordered: boolean; items: LabosInline[][] }
  | { kind: 'task'; items: { checked: boolean; content: LabosInline[] }[] }
  | { kind: 'code'; language: string | null; value: string }
  | { kind: 'quote'; content: LabosInline[] }
  | {
      kind: 'table';
      header: LabosInline[][];
      rows: LabosInline[][][];
    }
  | { kind: 'rule' }
  | { kind: 'raw-html'; value: string }
  | { kind: 'unsupported'; syntax: string; value: string };

export interface LabosRenderedDocument {
  blocks: LabosBlock[];
  /** Distinct headings, for a table of contents. */
  toc: { level: number; text: string; id: string; blockIndex: number }[];
  frontmatter: string | null;
}

/** Schemes safe to navigate to. Everything else becomes inert text. */
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

const DROPPED_HTML_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'base',
  'meta',
  'link',
]);

/**
 * Decide what to do with a link target.
 *
 * Returns a safe href, or null with a reason so the UI can say why the link is
 * inert rather than silently dropping it.
 */
export function sanitizeLinkTarget(
  raw: string
): { href: string | null; blocked?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { href: null, blocked: 'empty link' };

  // A relative link or a fragment is resolved against the document, not a
  // remote origin, so it is safe to keep as an inert anchor.
  if (
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) &&
    !trimmed.startsWith('//')
  ) {
    return { href: trimmed };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { href: null, blocked: 'unparseable link' };
  }

  if (!SAFE_LINK_SCHEMES.has(parsed.protocol)) {
    return { href: null, blocked: `blocked ${parsed.protocol} link` };
  }
  return { href: parsed.toString() };
}

/** True when an image source would cause a network request to a third party. */
export function isRemoteImageSource(raw: string): boolean {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (trimmed.startsWith('//')) return true;
  return false;
}

/**
 * Escape a raw HTML fragment for display.
 *
 * The angle brackets are replaced with lookalike characters rather than entity
 * references, because the result is rendered as a text node and must never be
 * interpreted as markup even if a future caller changes how it is inserted.
 */
export function escapeForDisplay(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '\u2039')
    .replaceAll('>', '\u203a');
}

/** Detect which HTML tags a raw fragment mentions, for the drop decision. */
export function findDroppedTags(html: string): string[] {
  const found: string[] = [];
  const tagPattern = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    if (DROPPED_HTML_TAGS.has(tag) && !found.includes(tag)) found.push(tag);
  }
  return found;
}

interface InlineParseResult {
  content: LabosInline[];
}

/**
 * Parse inline Markdown into structured spans.
 *
 * Deliberately hand-written and small rather than a full CommonMark engine: the
 * feature must render repository files attractively, and a smaller parser has a
 * far smaller attack surface. Anything it does not understand is preserved as
 * text, so nothing is lost from the user's file.
 */
export function parseInline(source: string): InlineParseResult {
  const content: LabosInline[] = [];
  let index = 0;
  let buffer = '';

  const flush = () => {
    if (buffer) {
      content.push({ kind: 'text', value: buffer });
      buffer = '';
    }
  };

  while (index < source.length) {
    const rest = source.slice(index);

    // Backslash escape: the next character is literal.
    if (rest.startsWith('\\') && index + 1 < source.length) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }

    // Inline code wins over other markers, so `a *b*` stays literal.
    if (rest.startsWith('`')) {
      const ticks = /^`+/.exec(rest)?.[0] ?? '`';
      const closing = source.indexOf(ticks, index + ticks.length);
      if (closing !== -1) {
        flush();
        content.push({
          kind: 'code',
          value: source.slice(index + ticks.length, closing),
        });
        index = closing + ticks.length;
        continue;
      }
    }

    // Image syntax: never fetched remotely. Rendered as an inert note.
    const imageMatch = /^!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(rest);
    if (imageMatch) {
      flush();
      const alt = imageMatch[1];
      const src = imageMatch[2];
      content.push({
        kind: 'unsupported',
        syntax: isRemoteImageSource(src) ? 'remote-image' : 'local-image',
        value: alt ? `${alt} — ${src}` : src,
      });
      index += imageMatch[0].length;
      continue;
    }

    // Links.
    const linkMatch = /^\[([^\]]*)\]\(([^)]*)\)/.exec(rest);
    if (linkMatch) {
      flush();
      const label = linkMatch[1];
      const target = sanitizeLinkTarget(linkMatch[2]);
      content.push({
        kind: 'link',
        value: label || linkMatch[2],
        href: target.href,
        ...(target.blocked ? { blocked: target.blocked } : {}),
      });
      index += linkMatch[0].length;
      continue;
    }

    // Reference-style links have no target here; keep the visible text.
    const refMatch = /^\[([^\]]*)\]\[[^\]]*\]/.exec(rest);
    if (refMatch) {
      flush();
      content.push({ kind: 'text', value: refMatch[1] });
      index += refMatch[0].length;
      continue;
    }

    const wrap = (
      marker: string,
      kind: 'strong' | 'em' | 'del'
    ): boolean => {
      if (!rest.startsWith(marker)) return false;
      const closing = source.indexOf(marker, index + marker.length);
      if (closing === -1) return false;
      const inner = source.slice(index + marker.length, closing);
      if (!inner) return false;
      flush();
      content.push({ kind, value: inner });
      index = closing + marker.length;
      return true;
    };

    if (wrap('**', 'strong')) continue;
    if (wrap('__', 'strong')) continue;
    if (wrap('~~', 'del')) continue;
    if (wrap('*', 'em')) continue;
    if (wrap('_', 'em')) continue;

    // Inline HTML anywhere in a paragraph, not only at the start of a line.
    // A tag such as `<img onerror="...">` embedded mid-sentence is exactly as
    // dangerous as one on its own line, so the angle brackets are neutralised
    // here too. The text stays readable; it simply cannot be markup.
    if (rest.startsWith('<')) {
      const tagEnd = rest.indexOf('>');
      const candidate = tagEnd === -1 ? rest.slice(0, 1) : rest.slice(0, tagEnd + 1);
      if (/^<\/?[a-zA-Z][\s\S]*>$/.test(candidate) || candidate.startsWith('<!--')) {
        buffer += escapeForDisplay(candidate);
        index += candidate.length;
        continue;
      }
      if (rest.startsWith('<![CDATA[')) {
        buffer += escapeForDisplay(rest.slice(0, 1));
        index += 1;
        continue;
      }
      buffer += escapeForDisplay('<');
      index += 1;
      continue;
    }

    buffer += source[index];
    index += 1;
  }

  flush();
  return { content };
}

function slugifyHeading(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'section';
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function inlineToText(content: LabosInline[]): string {
  return content
    .map(part => {
      if ('value' in part) return part.value;
      return '';
    })
    .join('');
}

/**
 * Render repository Markdown into blocks.
 *
 * Frontmatter is preserved as its own block and shown verbatim rather than
 * parsed: repository frontmatter carries meaning for other tools, and rendering
 * it as prose would misrepresent the file.
 */
export function renderMarkdown(source: string): LabosRenderedDocument {
  const lines = source.split(/\r?\n/);
  const blocks: LabosBlock[] = [];
  const toc: LabosRenderedDocument['toc'] = [];
  const usedSlugs = new Set<string>();
  let frontmatter: string | null = null;

  let index = 0;

  // Frontmatter must open the file to count.
  if (lines[0]?.trim() === '---') {
    const closing = lines.findIndex(
      (line, i) => i > 0 && (line.trim() === '---' || line.trim() === '...')
    );
    if (closing !== -1) {
      frontmatter = lines.slice(0, closing + 1).join('\n');
      index = closing + 1;
    }
  }

  while (index < lines.length) {
    const line = lines[index];

    // Fenced code, including fences with more than three backticks that contain
    // shorter fences inside them.
    const fenceMatch = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      const language = fenceMatch[3].trim() || null;
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const candidate = lines[index];
        if (new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(candidate)) {
          index += 1;
          break;
        }
        body.push(candidate);
        index += 1;
      }
      blocks.push({ kind: 'code', language, value: body.join('\n') });
      continue;
    }

    // Blank line.
    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Horizontal rule.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    // Heading.
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const { content } = parseInline(headingMatch[2].trim());
      const text = inlineToText(content);
      blocks.push({ kind: 'heading', level, content });
      toc.push({
        level,
        text,
        id: slugifyHeading(text, usedSlugs),
        blockIndex: blocks.length - 1,
      });
      index += 1;
      continue;
    }

    // Task list.
    if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
      const items: { checked: boolean; content: LabosInline[] }[] = [];
      while (index < lines.length && /^\s*[-*+]\s+\[[ xX]\]\s+/.test(lines[index])) {
        const itemMatch = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(lines[index]);
        if (!itemMatch) break;
        items.push({
          checked: itemMatch[1].toLowerCase() === 'x',
          content: parseInline(itemMatch[2]).content,
        });
        index += 1;
      }
      blocks.push({ kind: 'task', items });
      continue;
    }

    // Unordered or ordered list.
    const listMatch = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const items: LabosInline[][] = [];
      while (index < lines.length) {
        const itemMatch = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]);
        if (!itemMatch) break;
        // A task item inside a plain list is still a list item, not a task block.
        items.push(parseInline(itemMatch[2]).content);
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // Block quote.
    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({
        kind: 'quote',
        content: parseInline(quoted.join(' ')).content,
      });
      continue;
    }

    // Table: a header row followed by a delimiter row.
    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[index + 1])
    ) {
      const splitRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map(cell => cell.trim());

      const header = splitRow(lines[index]).map(cell => ({
        kind: 'text' as const,
        value: cell,
      }));
      index += 2;
      const rows: LabosInline[][][] = [];
      while (index < lines.length && lines[index].includes('|')) {
        rows.push(
          splitRow(lines[index]).map(cell => ({
            kind: 'text' as const,
            value: cell,
          }))
        );
        index += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    // Raw HTML: escaped and shown, never rendered. Dropped tags are called out
    // so the reader knows something was removed rather than seeing nothing.
    if (/^\s*<[a-zA-Z!/]/.test(line)) {
      const html: string[] = [];
      while (index < lines.length && lines[index].trim()) {
        html.push(lines[index]);
        index += 1;
      }
      const raw = html.join('\n');
      const dropped = findDroppedTags(raw);
      if (dropped.length > 0) {
        blocks.push({
          kind: 'unsupported',
          syntax: `html:${dropped.join(',')}`,
          value: escapeForDisplay(raw),
        });
      } else {
        blocks.push({ kind: 'raw-html', value: escapeForDisplay(raw) });
      }
      continue;
    }

    // MDX or component syntax: shown verbatim, never executed.
    if (/^\s*\{.*\}\s*$/.test(line) || /^\s*<[A-Z]/.test(line)) {
      blocks.push({
        kind: 'unsupported',
        syntax: 'mdx',
        value: line,
      });
      index += 1;
      continue;
    }

    // Paragraph: consume until a blank line or a line that starts a new block.
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      const candidate = lines[index];
      if (
        /^(#{1,6})\s+/.test(candidate) ||
        /^(\s*)(`{3,}|~{3,})/.test(candidate) ||
        /^\s*[-*+]\s+\[[ xX]\]\s+/.test(candidate) ||
        /^\s*([-*+]|\d+[.)])\s+/.test(candidate) ||
        /^\s*>\s?/.test(candidate)
      ) {
        break;
      }
      paragraph.push(candidate);
      index += 1;
    }
    if (paragraph.length) {
      blocks.push({
        kind: 'paragraph',
        content: parseInline(paragraph.join('\n')).content,
      });
    } else {
      // Defensive: never spin without consuming a line.
      index += 1;
    }
  }

  return { blocks, toc, frontmatter };
}
