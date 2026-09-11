/** Source-level routing checks, not a replacement for macOS visual testing. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ts = require(path.join(root, 'node_modules/typescript/lib/typescript.js'));
const routerPath = path.join(root, 'packages/frontend/core/src/desktop/router.tsx');
const router = ts.createSourceFile(
  routerPath, await readFile(routerPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX
);
const property = (node, name) => node.properties.find(
  item => ts.isPropertyAssignment(item) && item.name.getText(router) === name
)?.initializer;
const routes = [];
function visit(node) {
  if (ts.isObjectLiteralExpression(node)) {
    const routePath = property(node, 'path');
    if (routePath && ts.isStringLiteral(routePath)) routes.push([routePath.text, node]);
  }
  ts.forEachChild(node, visit);
}
visit(router);

test('all three existing LabOS URLs use the shared desktop layout', () => {
  const parents = routes.filter(([routePath]) => routePath === '/labos');
  assert.equal(parents.length, 1);
  const parent = parents[0][1];
  assert.match(property(parent, 'lazy').getText(router), /pages\/labos-layout/);
  const children = property(parent, 'children');
  assert.ok(ts.isArrayLiteralExpression(children));
  assert.deepEqual(children.elements.map(node => property(node, 'path').text), [
    'repo', 'home', 'projects',
  ]);
  for (const node of children.elements) {
    const name = property(node, 'path').text;
    assert.match(property(node, 'lazy').getText(router), new RegExp(`pages/labos-${name}`));
  }
  assert.equal(routes.some(([routePath]) => /^\/labos\//.test(routePath)), false);
});

test('the layout reuses AppContainer and renders the child outlet once', async () => {
  const text = await readFile(path.join(
    root, 'packages/frontend/core/src/desktop/pages/labos-layout/index.tsx'
  ), 'utf8');
  assert.match(text, /import \{ AppContainer \} from '\.\.\/\.\.\/components\/app-container'/);
  assert.match(text, /<AppContainer>\s*<Outlet\s*\/>\s*<\/AppContainer>/);
  assert.equal((text.match(/<Outlet\s*\/>/g) ?? []).length, 1);
});
