// LabOS Workspace — pre-push leak scanner for the public fork.
//
// Run with: node --test labos/scripts/leak-scan.test.mjs
//      scan: node labos/scripts/leak-scan.mjs [--staged|--tree]
//
// .gitignore is one layer, not proof. This inspects the actual candidate paths
// that a commit would publish and rejects the classes of content that must never
// reach a public repository: the private briefing pack, real user content,
// MeMCP internals, credentials and absolute machine paths.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const git = args =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Paths a commit would publish, relative to the repo root. */
export function candidatePaths(mode = 'staged') {
  const raw =
    mode === 'tree'
      ? git(['ls-files'])
      : git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return raw.split('\n').map(line => line.trim()).filter(Boolean);
}

const PRIVATE_PATH_RULES = [
  {
    id: 'private-briefing-pack',
    re: /(^|\/)labos-workspace-brief\//,
    why: 'the unredacted LabOS briefing pack is private handoff material',
  },
  {
    id: 'private-briefing-file',
    re: /(^|\/)(START_HERE|BUILD_PLAN|QA_CHECKLIST|REFERENCES)\.md$/,
    why: 'a named briefing document is being published',
  },
  {
    id: 'memcp-internals',
    re: /(^|\/)(MeMCP|\.memcp)\//,
    why: 'MeMCP source, database and projections are private',
  },
  {
    id: 'memcp-projection',
    re: /(^|\/)(PROJECT_CONTEXT|PROJECT_TASKS)\.md$/,
    why: 'a generated MeMCP projection is not LabOS source',
  },
  {
    id: 'sqlite-database',
    re: /\.(sqlite|sqlite3|db)(-shm|-wal)?$/,
    why: 'a database file may contain real user records',
  },
  {
    id: 'native-workspace-store',
    re: /workspaces\/affine-cloud\//,
    why: 'an AFFiNE native workspace store holds real note content',
  },
  {
    id: 'credential-file',
    re: /(^|\/)(\.env(\..*)?|credentials[^/]*|secrets[^/]*|id_rsa|id_dsa|\.npmrc|\.pypirc)$/,
    // `.env.example` / `.env.sample` / `.env.template` are templates upstream
    // tracks on purpose; only real values files are rejected.
    allow: /(^|\/)\.env\.(example|sample|template)$/,
    why: 'credential material must never be committed',
  },
  {
    id: 'key-material',
    re: /\.(pem|key|p12|jks|keystore)$/,
    why: 'key material must never be committed',
  },
  {
    id: 'audio-capture',
    re: /\.(wav|aiff|mov|mp4)$/,
    why: 'recordings are private evidence, not source',
  },
];

const ALLOWED_PATH_EXCEPTIONS = [
  // Upstream ships `.env.example`-style templates and CI audio is not present;
  // keep this list empty unless a real, reviewed exception appears, so the
  // default posture stays "reject".
];

const CONTENT_RULES = [
  {
    id: 'absolute-user-home-path',
    re: /\/Users\/[A-Za-z0-9._-]+\//,
    why: 'absolute machine paths must stay in private configuration, not source',
  },
  {
    id: 'macos-user-library-path',
    re: /\/Library\/Application Support\/(AFFiNE|LabOS Workspace)/,
    why: 'a live local data-store path must not be baked into source',
  },
  {
    id: 'openai-style-key',
    re: /\b(sk|gho|ghp|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
    why: 'a real-looking credential token appears in content',
  },
  {
    id: 'private-key-block',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    why: 'a private key block appears in content',
  },
];

const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tgz|woff2?|ttf|otf|wasm|node|dylib|so)$/i;

export function scanPaths(paths) {
  const findings = [];
  for (const path of paths) {
    if (ALLOWED_PATH_EXCEPTIONS.includes(path)) continue;
    for (const rule of PRIVATE_PATH_RULES) {
      if (rule.allow?.test(path)) continue;
      if (rule.re.test(path)) {
        findings.push({ rule: rule.id, path, detail: rule.why });
      }
    }
  }
  return findings;
}

export function scanContent(paths) {
  const findings = [];
  for (const path of paths) {
    if (BINARY_EXTENSIONS.test(path)) continue;
    let text;
    try {
      text = readFileSync(resolve(repoRoot, path), 'utf8');
    } catch {
      continue; // deleted or unreadable: not part of the published payload
    }
    for (const rule of CONTENT_RULES) {
      const match = text.match(rule.re);
      if (match) {
        findings.push({
          rule: rule.id,
          path,
          detail: rule.why,
          sample: match[0].slice(0, 60),
        });
      }
    }
  }
  return findings;
}

export function scan(mode = 'staged') {
  const paths = candidatePaths(mode);
  return { paths: paths.length, findings: [...scanPaths(paths), ...scanContent(paths)] };
}

/**
 * Split a path list into LabOS-authored paths and paths inherited from upstream.
 *
 * The inheritance test is deliberately authorship-based rather than
 * content-based: a path whose newest commit predates the pinned upstream commit
 * was published by someone else and is already part of the world-readable
 * upstream history. Flagging those produces noise that trains people to ignore
 * the scanner. A path added or modified by a LabOS commit is what we audit.
 */
export function classifyPaths(paths, pinCommit) {
  if (paths.length === 0) return { authored: [], inherited: [] };

  // One `git log` pass over the candidate set, rather than one subprocess per
  // path. A 10k-file tracked tree makes per-path `git log` take minutes.
  //
  // Only paths git already knows about can appear here. A brand-new path has no
  // history to find, so anything the log does not mention is treated as newly
  // authored and audited. That default matters: a scanner must fail towards
  // inspection, never towards silence.
  let raw = '';
  try {
    raw = execFileSync(
      'git',
      [
        'log',
        '--format=%x00%H',
        '--name-only',
        '--diff-filter=ACMR',
        '--no-renames',
        pinCommit,
        '--',
        ...paths,
      ],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
    );
  } catch {
    raw = '';
  }

  // Newest commit touching each path, since git log is newest-first.
  const lastTouch = new Map();
  let current = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('\u0000')) {
      current = line.slice(1).trim();
      continue;
    }
    const path = line.trim();
    if (!path || !current) continue;
    if (!lastTouch.has(path)) lastTouch.set(path, current);
  }

  // One batched `ls-files` for the whole candidate set, for the same reason as
  // the log pass above: a per-path subprocess is minutes over a 10k-file tree.
  const tracked = new Set(
    execFileSync('git', ['ls-files', '-z', '--', ...paths], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
      .split('\u0000')
      .map(p => p.trim())
      .filter(Boolean)
  );

  // A path is inherited only if it is still tracked AND its newest commit is
  // reachable from the pin. Files deleted since the pin, unmerged paths and
  // anything git cannot place fall through to `authored` — fail towards
  // inspection, never towards silence.
  const inherited = [];
  const authored = [];
  for (const path of paths) {
    if (tracked.has(path) && lastTouch.has(path)) {
      inherited.push(path);
    } else {
      authored.push(path);
    }
  }
  return { authored, inherited };
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const mode = process.argv.includes('--tree') ? 'tree' : 'staged';
  const pins = JSON.parse(readFileSync(resolve(repoRoot, 'labos', 'pins.json'), 'utf8'));
  const pinCommit = pins.upstream.pinnedCommit;
  const paths = candidatePaths(mode);
  const { authored, inherited } = classifyPaths(paths, pinCommit);
  const findings = [...scanPaths(authored), ...scanContent(authored)];

  if (findings.length) {
    for (const f of findings) {
      console.error(`LEAK [${f.rule}] ${f.path} — ${f.detail}`);
      if (f.sample) console.error(`       matched: ${f.sample}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `leak scan clean: ${authored.length} LabOS-authored path(s) audited, ` +
        `${inherited.length} inherited upstream path(s) skipped ` +
        `(already public before ${pinCommit.slice(0, 12)})`
    );
  }
}
