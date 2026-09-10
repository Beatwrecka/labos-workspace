// Tests for the public-fork leak scanner.
//
// Run with: node --test labos/scripts/leak-scan.test.mjs
//
// The scanner is only useful if it actually rejects things. Each test below
// feeds a synthetic path or file body and asserts the matching rule fires — so a
// future edit that neuters a rule fails here rather than in a public push.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { candidatePaths, classifyPaths, scanPaths } from './leak-scan.mjs';

const ruleIds = paths => scanPaths(paths).map(f => f.rule);

test('rejects the private briefing pack and its named documents', () => {
  assert.deepEqual(ruleIds(['labos-workspace-brief/BUILD_PLAN.md']), [
    'private-briefing-pack',
    'private-briefing-file',
  ]);
  assert.ok(ruleIds(['START_HERE.md']).includes('private-briefing-file'));
  assert.ok(
    ruleIds(['docs/QA_CHECKLIST.md']).includes('private-briefing-file')
  );
  assert.ok(ruleIds(['docs/REFERENCES.md']).includes('private-briefing-file'));
});

test('rejects MeMCP internals and generated projections', () => {
  assert.ok(ruleIds(['MeMCP/README.md']).includes('memcp-internals'));
  assert.ok(ruleIds(['.memcp/state.json']).includes('memcp-internals'));
  assert.ok(ruleIds(['proj/PROJECT_CONTEXT.md']).includes('memcp-projection'));
  assert.ok(ruleIds(['proj/PROJECT_TASKS.md']).includes('memcp-projection'));
});

test('rejects databases, workspace stores and recordings', () => {
  assert.ok(ruleIds(['memory.sqlite']).includes('sqlite-database'));
  assert.ok(ruleIds(['x/storage.db-wal']).includes('sqlite-database'));
  assert.ok(
    ruleIds(['workspaces/affine-cloud/a/storage.db']).includes(
      'native-workspace-store'
    )
  );
  assert.ok(ruleIds(['captures/note.wav']).includes('audio-capture'));
});

test('rejects credentials and key material', () => {
  assert.ok(ruleIds(['.env']).includes('credential-file'));
  assert.ok(ruleIds(['config/.env.local']).includes('credential-file'));
  assert.ok(ruleIds(['secrets.json']).includes('credential-file'));
  assert.ok(ruleIds(['certs/server.pem']).includes('key-material'));
  assert.ok(ruleIds(['release/team.p12']).includes('key-material'));
});

test('allows ordinary upstream-style source paths', () => {
  assert.deepEqual(ruleIds(['packages/frontend/core/src/app.ts']), []);
  assert.deepEqual(ruleIds(['labos/pins.json']), []);
  assert.deepEqual(ruleIds(['docs/BUILDING.md']), []);
  assert.deepEqual(ruleIds(['packages/backend/server/README.md']), []);
  // `env.example` is a template, not a credential file.
  assert.deepEqual(ruleIds(['packages/backend/server/.env.example']), []);
});

test('an upstream path MODIFIED by this fork is audited, not skipped', () => {
  // Regression guard: classification was history-only, so an upstream file that
  // this fork edits (e.g. src/main/config.ts during isolation work) was treated
  // as "already public upstream" and skipped — hiding anything the edit added.
  //
  // The real commit is asserted in the CLI integration below; here the
  // classifier rule is tested directly against a real upstream file so the test
  // does not depend on transient staging state (staging is empty right after a
  // commit, which would make a state-dependent assertion meaningless).
  const pin = JSON.parse(
    readFileSync(new URL('../pins.json', import.meta.url), 'utf8')
  ).upstream.pinnedCommit;

  // Forge an upstream-owned path and assert the classifier treats it as
  // inherited only when it is NOT part of the change under review.
  const upstreamFile = 'packages/frontend/core/src/utils/channel.ts';

  assert.deepEqual(
    classifyPaths([upstreamFile], pin, new Set()).authored,
    [],
    'an unmodified upstream path is inherited'
  );
  assert.deepEqual(
    classifyPaths([upstreamFile], pin, new Set([upstreamFile])).authored,
    [upstreamFile],
    'a modified upstream path must be audited rather than trusted from history'
  );
});

test('the CLI audits every path the commit actually changes', () => {
  // Integration check on real staged state: whatever is staged must be audited,
  // including upstream files this fork edits.
  const pin = JSON.parse(
    readFileSync(new URL('../pins.json', import.meta.url), 'utf8')
  ).upstream.pinnedCommit;
  const staged = candidatePaths('staged');
  const { authored } = classifyPaths(staged, pin);
  for (const path of staged) {
    assert.ok(
      authored.includes(path),
      `staged path ${path} must be audited, not skipped as upstream-owned`
    );
  }
});

test('a brand-new path is audited, not silently skipped', () => {
  // Regression guard: an earlier revision classified paths solely from commit
  // history, so a brand-new file had no history and was treated as "inherited"
  // — the scanner went quiet on exactly the content it exists to catch.
  const pin = JSON.parse(
    readFileSync(new URL('../pins.json', import.meta.url), 'utf8')
  ).upstream.pinnedCommit;

  const { authored, inherited } = classifyPaths(
    [
      'labos-workspace-brief/BUILD_PLAN.md',
      'packages/frontend/core/src/__tests__/ai/effects.spec.ts',
    ],
    pin
  );

  assert.ok(
    authored.includes('labos-workspace-brief/BUILD_PLAN.md'),
    'a path with no upstream history must be classified as authored'
  );
  assert.ok(
    inherited.includes(
      'packages/frontend/core/src/__tests__/ai/effects.spec.ts'
    ),
    'a path published by upstream before the pin must be classified as inherited'
  );
  assert.ok(
    scanPaths(authored).some(
      f => f.path === 'labos-workspace-brief/BUILD_PLAN.md'
    ),
    'the authored path must then be rejected by the briefing rules'
  );
  assert.deepEqual(
    scanPaths(inherited),
    [],
    'an inherited upstream path must not be reported as a leak'
  );
});
