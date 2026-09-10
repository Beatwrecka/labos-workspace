/**
 * LabOS Workspace — rendered Markdown view.
 *
 * Builds DOM nodes from the structured blocks produced by `markdown.ts`. There is
 * deliberately no `dangerouslySetInnerHTML` anywhere in this feature: every string
 * that came from a repository file reaches the screen as a React text child, so
 * the browser treats it as text and never as markup.
 *
 * Accessibility notes that shaped the markup:
 *  - headings are real `h1`–`h6`, so screen-reader navigation works
 *  - links with no safe target render as text with a title, not as a dead anchor
 *    a keyboard user would tab onto for no reason
 *  - the unsupported-construct notice is a labelled group, not just a colour
 */

import { type MouseEvent, type ReactNode, useCallback } from 'react';

import type { LabosBlock, LabosInline, LabosRenderedDocument } from './markdown';
import {
  article as articleStyle,
  blockquote,
  codeBlock,
  codeLanguage,
  frontmatter as frontmatterStyle,
  frontmatterLabel,
  heading,
  inlineCode,
  list,
  listItem,
  notice,
  paragraph,
  rule,
  table,
  tableCell,
  tableHeaderCell,
  taskItem,
  taskList,
  taskMarker,
  unsupported,
  unsupportedBadge,
  visuallyHidden,
} from './styles.css';

export interface RenderedDocumentProps {
  document: LabosRenderedDocument;
  /** Called with an anchor id when a heading is activated from the TOC. */
  onNavigate?: (anchorId: string) => void;
}

function renderInline(part: LabosInline, key: number): ReactNode {
  switch (part.kind) {
    case 'text':
      return <span key={key}>{part.value}</span>;

    case 'code':
      return (
        <code key={key} className={inlineCode}>
          {part.value}
        </code>
      );

    case 'strong':
      return <strong key={key}>{part.value}</strong>;

    case 'em':
      return <em key={key}>{part.value}</em>;

    case 'del':
      return <del key={key}>{part.value}</del>;

    case 'link':
      // A link with no safe target is rendered as plain text with the reason in
      // a title. Rendering it as an anchor would let a keyboard user focus a
      // control that cannot go anywhere.
      if (!part.href) {
        return (
          <span key={key} title={part.blocked} data-labos-blocked-link="true">
            {part.value}
          </span>
        );
      }
      return (
        <a
          key={key}
          href={part.href}
          target="_blank"
          rel="noreferrer noopener nofollow"
        >
          {part.value}
        </a>
      );

    case 'unsupported':
      return (
        <span key={key} data-labos-unsupported={part.syntax}>
          <span aria-hidden="true">[not shown: {part.syntax}] </span>
          <span>{part.value}</span>
        </span>
      );
  }
}

function renderBlock(
  block: LabosBlock,
  key: number,
  anchorId: string | undefined,
  onNavigate?: (id: string) => void
) {
  switch (block.kind) {
    case 'heading': {
      // A real heading element per level, so screen-reader heading navigation
      // works exactly as it does in the rest of the app.
      const Tag = `h${block.level}` as const;
      return (
        <Tag
          key={key}
          id={anchorId}
          className={heading[block.level]}
          onClick={
            onNavigate && anchorId
              ? (event: MouseEvent<HTMLHeadingElement>) => {
                  event.preventDefault();
                  onNavigate(anchorId);
                }
              : undefined
          }
        >
          {block.content.map(renderInline)}
        </Tag>
      );
    }

    case 'paragraph':
      return (
        <p key={key} className={paragraph}>
          {block.content.map(renderInline)}
        </p>
      );

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag key={key} className={list}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex} className={listItem}>
              {item.map(renderInline)}
            </li>
          ))}
        </Tag>
      );
    }

    case 'task':
      return (
        <ul key={key} className={taskList}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex} className={taskItem}>
              <span className={taskMarker} aria-hidden="true">
                {item.checked ? '[x]' : '[ ]'}
              </span>
              {/* The checkbox state is text for screen readers, not a shape. */}
              <span className={visuallyHidden}>
                {item.checked ? 'Done: ' : 'Not done: '}
              </span>
              <span>{item.content.map(renderInline)}</span>
            </li>
          ))}
        </ul>
      );

    case 'code':
      return (
        <pre key={key} className={codeBlock}>
          {block.language ? (
            <span className={codeLanguage} aria-hidden="true">
              {block.language}
            </span>
          ) : null}
          <code>{block.value}</code>
        </pre>
      );

    case 'quote':
      return (
        <blockquote key={key} className={blockquote}>
          {block.content.map(renderInline)}
        </blockquote>
      );

    case 'table':
      return (
        <table key={key} className={table}>
          <thead>
            <tr>
              {block.header.map((cell, cellIndex) => (
                <th key={cellIndex} scope="col" className={tableHeaderCell}>
                  {renderInline(cell, cellIndex)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={tableCell}>
                    {renderInline(cell, cellIndex)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'rule':
      return <hr key={key} className={rule} />;

    case 'raw-html':
      // Escaped text. Rendered as a paragraph so the reader sees the author's
      // markup rather than a mysteriously blank area.
      return (
        <p key={key} className={notice}>
          <span aria-hidden="true">[html]</span>
          <span>{block.value}</span>
        </p>
      );

    case 'unsupported':
      return (
        <p key={key} className={unsupported} role="note">
          <span className={unsupportedBadge}>{labelForUnsupported(block.syntax)}</span>
          <span>{block.value}</span>
        </p>
      );
  }
}

function labelForUnsupported(syntax: string): string {
  if (syntax === 'mdx') return 'Not executed';
  if (syntax.startsWith('html:')) return 'Removed';
  return 'Not shown';
}

export function RenderedDocument({ document, onNavigate }: RenderedDocumentProps) {
  // Anchors come from the table of contents, which already de-duplicated them.
  // Re-deriving a slug here produced a different id for repeated headings, so the
  // links silently pointed at the wrong place.
  const anchorByBlockIndex = new Map<number, string>();
  for (const entry of document.toc) {
    anchorByBlockIndex.set(entry.blockIndex, entry.id);
  }

  const safeNavigate = useCallback(
    (anchorId: string) => {
      const target = window.document.getElementById(anchorId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        onNavigate?.(anchorId);
      }
    },
    [onNavigate]
  );

  return (
    <article className={articleStyle}>
      {document.frontmatter ? (
        <div className={frontmatterStyle}>
          <span className={frontmatterLabel}>Frontmatter (kept as written)</span>
          <code>{document.frontmatter}</code>
        </div>
      ) : null}
      {document.blocks.map((block, index) =>
        renderBlock(block, index, anchorByBlockIndex.get(index), safeNavigate)
      )}
    </article>
  );
}
