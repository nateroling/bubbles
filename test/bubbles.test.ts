// bubbles: stable maps, the cache, the PR overlay, rendering and the CLI,
// on a small temp repo built with real git.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapAt, type CodeMap } from '../skills/bubbles/lib/layout.ts';
import { changeMap } from '../skills/bubbles/lib/pr.ts';
import { fileColour, folderColour, folderHue } from '../skills/bubbles/lib/groups.ts';
import { applyRules, globMatcher, renderHtml, renderSvg } from '../skills/bubbles/lib/render.ts';
import { stackMap, type StackMap } from '../skills/bubbles/lib/stack.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'skills', 'bubbles', 'bubbles.ts');
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};
const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { env: ENV, encoding: 'utf8' });

let day = 0;
/** Commit the working tree, one day after the previous commit. */
function commit(repo: string, msg: string) {
  day++;
  const date = new Date(Date.UTC(2024, 0, 1) + day * 86400000).toISOString();
  git(repo, 'add', '-A');
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg], { env: { ...ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return git(repo, 'rev-parse', 'HEAD').trim();
}
function put(repo: string, path: string, size: number) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  // distinct content per path, so git's rename detection only pairs real moves
  writeFileSync(join(repo, path), (path + ' ').repeat(Math.ceil(size / (path.length + 1))).slice(0, size));
}

/** ~40 commits over ~6 weeks: folders grow, a file moves folder, a folder is renamed, files are deleted. */
function buildRepo(): { repo: string; shas: string[] } {
  const repo = mkdtempSync(join(tmpdir(), 'codemap-'));
  git(repo, 'init', '-q', '-b', 'main');
  const shas: string[] = [];
  put(repo, 'README.md', 300);
  shas.push(commit(repo, 'init'));
  for (let k = 0; k < 36; k++) {
    put(repo, `src/core/f${k % 9}.ts`, 200 + k * 40);
    if (k % 3 === 0) put(repo, `src/ui/w${k}.ts`, 500 + k * 10);
    if (k % 4 === 0) put(repo, `docs/d${k}.md`, 900);
    if (k % 5 === 0) put(repo, `test/t${k}.test.ts`, 400);
    if (k === 20) git(repo, 'mv', 'src/ui/w3.ts', 'src/core/w3.ts');
    if (k === 25) git(repo, 'mv', 'docs', 'guide');
    if (k === 30) rmSync(join(repo, 'test', 't5.test.ts'));
    shas.push(commit(repo, `step ${k}`));
  }
  return { repo, shas };
}

const { repo, shas } = buildRepo();
const S = (m: CodeMap) => JSON.stringify(m);

test('a map is the same with or without the cache, and wherever the cache was left', () => {
  const cache = mkdtempSync(join(tmpdir(), 'codemap-cache-'));
  const cold = S(mapAt(repo, 'HEAD', { cacheDir: null }));
  mapAt(repo, shas[12], { cacheDir: cache }); // leaves a checkpoint mid-history
  assert.equal(S(mapAt(repo, 'HEAD', { cacheDir: cache })), cold);
  assert.equal(S(mapAt(repo, 'HEAD', { cacheDir: cache })), cold); // resumed from the latest checkpoint
  for (const every of ['day', 'commit'] as const) assert.equal(S(mapAt(repo, shas[30], { every, cacheDir: cache })), S(mapAt(repo, shas[30], { every, cacheDir: null })));
});

test('a cache entry that only partly reads is ignored, not half-used', () => {
  const cold = S(mapAt(repo, 'HEAD', { cacheDir: null, every: 'commit' }));
  for (const broken of [(s: any) => delete s.dots.off, (s: any) => delete s.tree.nextId, () => '{"tree":']) {
    const cache = mkdtempSync(join(tmpdir(), 'codemap-cache-'));
    mapAt(repo, shas[20], { cacheDir: cache, every: 'commit' });
    for (const f of readdirSync(cache)) {
      const s = JSON.parse(readFileSync(join(cache, f), 'utf8'));
      const r = broken(s);
      writeFileSync(join(cache, f), typeof r === 'string' ? r : JSON.stringify(s));
    }
    const logs: string[] = [];
    assert.equal(S(mapAt(repo, 'HEAD', { cacheDir: cache, every: 'commit', log: (m) => logs.push(m) })), cold);
    assert.ok(logs.some((m) => m.startsWith('ignoring an unreadable cache entry')), logs.join('\n'));
  }
});

test("a person's git config can't change or break the map", () => {
  const plain = S(mapAt(repo, 'HEAD', { cacheDir: null }));
  const saved = { ...process.env };
  try {
    // added after any GIT_CONFIG_* entries already in the environment
    let n = Number(process.env.GIT_CONFIG_COUNT ?? 0);
    for (const [k, v] of [['log.showSignature', 'true'], ['diff.renameLimit', '1'], ['color.ui', 'always'], ['core.quotePath', 'true']]) {
      process.env[`GIT_CONFIG_KEY_${n}`] = k;
      process.env[`GIT_CONFIG_VALUE_${n++}`] = v;
    }
    process.env.GIT_CONFIG_COUNT = String(n);
    assert.equal(S(mapAt(repo, 'HEAD', { cacheDir: null })), plain);
    // log.showSignature only bites on a signed commit: git then mixes gpg's lines into `git log` output.
    // A commit with a made-up signature is enough (and needs no key), when gpg is installed.
    let gpg = true;
    try {
      execFileSync('gpg', ['--version'], { stdio: 'ignore' });
    } catch {
      gpg = false;
    }
    if (gpg) {
      const r2 = mkdtempSync(join(tmpdir(), 'codemap-signed-'));
      execFileSync('git', ['clone', '-q', repo, r2], { env: ENV });
      const tree = git(r2, 'rev-parse', 'HEAD^{tree}').trim();
      const parent = git(r2, 'rev-parse', 'HEAD').trim();
      const body = `tree ${tree}\nparent ${parent}\nauthor T <t@example.invalid> 1800000000 +0000\ncommitter T <t@example.invalid> 1800000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEz\n -----END PGP SIGNATURE-----\n\nsigned\n`;
      const sha = execFileSync('git', ['-C', r2, 'hash-object', '-t', 'commit', '-w', '--stdin'], { env: ENV, input: body, encoding: 'utf8' }).trim();
      git(r2, 'update-ref', 'HEAD', sha);
      assert.equal(mapAt(r2, 'HEAD', { cacheDir: null }).commit, sha);
    }
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('the map of a commit does not change when later commits arrive', () => {
  const before = S(mapAt(repo, shas[20], { cacheDir: null }));
  const r2 = mkdtempSync(join(tmpdir(), 'codemap-clone-'));
  execFileSync('git', ['clone', '-q', repo, r2], { env: ENV });
  put(r2, 'src/core/later.ts', 5000);
  commit(r2, 'later');
  assert.equal(S(mapAt(r2, shas[20], { cacheDir: null, name: mapAt(repo, shas[20], { cacheDir: null }).repo })), before);
});

test('files hold still from commit to commit, dots never overlap, and every folder outline holds its files', () => {
  const maps = shas.slice(1).map((s) => mapAt(repo, s, { cacheDir: null, every: 'commit' }));
  let moved = 0;
  let n = 0;
  for (let k = 1; k < maps.length; k++) {
    const prev = new Map(maps[k - 1].files.map((f) => [f.path, f]));
    for (const f of maps[k].files) {
      const p = prev.get(f.path);
      if (!p) continue;
      moved += Math.hypot(f.x - p.x, f.y - p.y);
      n++;
    }
  }
  assert.ok(moved / n < 0.3, `mean move per step ${(moved / n).toFixed(3)}`);
  const m = maps.at(-1)!;
  for (let i = 0; i < m.files.length; i++)
    for (let j = i + 1; j < m.files.length; j++) {
      const a = m.files[i];
      const b = m.files[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 0.05, `${a.path} overlaps ${b.path}`);
    }
  const inside = (rings: number[][], x: number, y: number) => {
    let c = false;
    for (const r of rings)
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2)
        if (r[i + 1] > y !== r[j + 1] > y && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
    return c;
  };
  for (const d of m.folders) {
    assert.ok(d.outline.length >= 1, `${d.path} has an outline`);
    for (const f of m.files) if (f.path.startsWith(d.path + '/')) assert.ok(inside(d.outline, f.x, f.y), `${f.path} inside ${d.path}/`);
  }
  assert.equal(m.files.find((f) => f.path === 'src/core/w3.ts') !== undefined, true);
});

test('the PR overlay marks added, modified, deleted and moved files', () => {
  git(repo, 'checkout', '-q', '-b', 'feature');
  put(repo, 'src/ui/new.ts', 1200);
  put(repo, 'src/core/f1.ts', 7777);
  rmSync(join(repo, 'guide', 'd0.md'));
  git(repo, 'add', '-A');
  git(repo, 'mv', 'src/ui/w9.ts', 'test/w9.ts');
  commit(repo, 'feature work');
  git(repo, 'checkout', '-q', 'main');
  const r = changeMap(repo, 'main', 'feature', { cacheDir: null });
  assert.deepEqual(r.counts, { added: 1, modified: 1, deleted: 1, renamed: 1 });
  assert.equal(r.overlay.files!['src/ui/new.ts'].tone, 'added');
  assert.equal(r.overlay.files!['src/core/f1.ts'].tone, 'modified');
  assert.equal(r.overlay.ghosts![0].path, 'guide/d0.md');
  assert.equal(r.overlay.arcs!.length, 1);
  // the base map is the map of the merge base: unchanged files sit where they were
  const base = new Map(mapAt(repo, r.base, { cacheDir: null }).files.map((f) => [f.path, f]));
  let worst = 0;
  for (const f of r.map.files) {
    const b = base.get(f.path);
    if (b) worst = Math.max(worst, Math.hypot(f.x - b.x, f.y - b.y));
  }
  assert.ok(worst < 2, `worst move ${worst.toFixed(2)}`);
  const html = renderHtml(r.map, r.overlay);
  const svg = renderSvg(r.map, r.overlay);
  const page = html.slice(0, html.lastIndexOf('<script>')); // the page's own script says `undefined`
  for (const out of [page, svg]) assert.ok(!/NaN|undefined/.test(out), 'no NaN or undefined in the output');
  assert.match(html, /src\/ui\/<\/em><b>new\.ts<\/b>/);
  assert.match(svg, /^<svg xmlns/);
});

test('the CLI writes json, svg and html, and renders a saved map', () => {
  const out = mkdtempSync(join(tmpdir(), 'codemap-out-'));
  const run = (...a: string[]) => execFileSync(process.execPath, [CLI, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  run('map', repo, '--no-cache', '--quiet', '--out', join(out, 'm.json'), '--out', join(out, 'm.svg'));
  const m = JSON.parse(readFileSync(join(out, 'm.json'), 'utf8')) as CodeMap;
  assert.equal(m.format, 'bubbles/1');
  writeFileSync(join(out, 'o.json'), JSON.stringify({ title: 'Hot files', files: { 'README.md': { tone: 'hot', badge: '!' } }, arcs: [{ from: 'README.md', to: 'src/core/f1.ts' }] }));
  run('render', join(out, 'm.json'), '--overlay', join(out, 'o.json'), '--out', join(out, 'r.html'));
  const html = readFileSync(join(out, 'r.html'), 'utf8');
  assert.match(html, /<title>Hot files<\/title>/);
  assert.match(html, /class="arc"/);
  run('pr', repo, '--head', 'feature', '--base', 'main', '--no-cache', '--quiet', '--out', join(out, 'p.json'));
  const p = JSON.parse(readFileSync(join(out, 'p.json'), 'utf8'));
  assert.equal(p.counts.added, 1);
  run('pr', repo, '--head', 'feature', '--base', 'main', '--no-cache', '--quiet', '--artifact', '--out', join(out, 'a.html'));
  const art = readFileSync(join(out, 'a.html'), 'utf8');
  assert.match(art, /^<title>[^<]+ feature changes<\/title>/);
  assert.ok(!/<!doctype|<html|<head>|<body>|<\/body>|<\/html>/i.test(art), 'an artifact page has no document skeleton');
  assert.match(art, /<script>window\.CM_DATA = /);
  assert.match(art, /href="https:\/\/github\.com\/nateroling\/bubbles"/);
  assert.throws(() => run('map', repo, '--bogus', '1'), /unknown option --bogus/);
});

test('a folder map is exactly that folder of the whole-repo map, moved to its own origin', () => {
  for (const sha of [shas[15], shas[30], 'HEAD']) {
    const whole = mapAt(repo, sha, { cacheDir: null });
    const part = mapAt(repo, sha, { cacheDir: null, path: './src/' });
    assert.equal(part.root, 'src');
    const at = new Map(whole.files.map((f) => [f.path, f]));
    assert.deepEqual(part.files.map((f) => f.path), whole.files.filter((f) => f.path.startsWith('src/')).map((f) => f.path));
    for (const f of part.files) {
      const w = at.get(f.path)!;
      assert.ok(Math.abs(f.x + part.origin![0] - w.x) < 0.02 && Math.abs(f.y + part.origin![1] - w.y) < 0.02, f.path);
    }
    assert.equal(part.folders[0].path, 'src');
    assert.equal(part.folders[0].depth, 1);
  }
  assert.throws(() => mapAt(repo, 'HEAD', { cacheDir: null, path: 'nope' }), /not a folder/);
});

test('colour rules: globs by name, by path and by folder; explicit marks win', () => {
  const P = ['src/a/Button.stories.tsx', 'src/a/Button.tsx', '.storybook/main.ts', 'docs/x.md', 'src/docs/y.md', 'Cargo.toml', 'crates/a/Cargo.toml'];
  const hits = (p: string) => P.filter(globMatcher(p));
  assert.deepEqual(hits('*.stories.*'), ['src/a/Button.stories.tsx']);
  assert.deepEqual(hits('.storybook/'), ['.storybook/main.ts']);
  assert.deepEqual(hits('docs/'), ['docs/x.md']);
  assert.deepEqual(hits('docs'), ['docs/x.md', 'src/docs/y.md']);
  assert.deepEqual(hits('src/**/*.{ts,tsx}'), ['src/a/Button.stories.tsx', 'src/a/Button.tsx']);
  assert.deepEqual(hits('Cargo.toml'), ['Cargo.toml', 'crates/a/Cargo.toml']);
  const m = mapAt(repo, 'HEAD', { cacheDir: null });
  const o = applyRules(m, { files: { 'README.md': { tone: 'hot' } }, rules: [{ match: '*.md', color: 'green', label: 'docs' }, { match: 'src/core/', tone: 'blue' }] });
  assert.equal(o.files!['README.md'].tone, 'hot');
  assert.equal(o.files!['guide/d4.md'].group, 'docs');
  assert.equal(o.files!['src/core/f1.ts'].group, 'src/core/');
  assert.match(renderSvg(m, { rules: [{ match: '*.md', color: 'green' }] }), /var\(--green\)/);
});

/** Where every file is at step s of a stack (absent files left out). */
function stackAt(r: StackMap, s: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const f of r.map.files) {
    let g = [f.x, f.y, f.r];
    let on = true;
    for (const e of r.overlay.stack!.frames!.files![f.path] ?? []) {
      if (e[0] > s) break;
      if (e.length > 1) {
        g = e.slice(1) as number[];
        on = true;
      } else on = false;
    }
    if (on) out.set(f.path, g);
  }
  return out;
}

test('a stack: each step lights what it touches, nothing moves, and no step looks ahead', () => {
  git(repo, 'checkout', '-q', '-b', 's1', 'main');
  put(repo, 'src/ui/s1.ts', 900);
  put(repo, 'src/core/f2.ts', 900);
  commit(repo, 's1');
  git(repo, 'checkout', '-q', '-b', 's2');
  put(repo, 'src/net/a.ts', 1500);
  put(repo, 'src/net/b.ts', 700);
  rmSync(join(repo, 'guide', 'd4.md'));
  commit(repo, 's2');
  git(repo, 'checkout', '-q', '-b', 's3');
  git(repo, 'mv', 'src/ui/s1.ts', 'src/net/s1.ts');
  put(repo, 'src/net/a.ts', 1600);
  put(repo, 'lib/x/y.ts', 2000);
  commit(repo, 's3');
  git(repo, 'checkout', '-q', 'main');
  const items = ['s1', 's2', 's3'].map((ref) => ({ ref, label: ref }));
  const r = stackMap(repo, 'main', items, { cacheDir: null });
  const st = r.overlay.stack!;
  assert.deepEqual(st.steps.map((s) => s.counts), [{ added: 1, modified: 1 }, { added: 2, deleted: 1 }, { renamed: 1, modified: 1, added: 1 }]);
  assert.deepEqual(st.files['src/net/a.ts'].touches.map((t) => [t.step, t.kind]), [[2, 'added'], [3, 'modified']]);
  assert.equal(st.files['guide/d4.md'].touches[0].kind, 'deleted');
  assert.equal(st.files['src/net/s1.ts'].touches[0].note, 'renamed from src/ui/s1.ts');

  // step 0 is the base map; a file keeps its spot from the step it appears; dots never overlap
  const base = mapAt(repo, r.base, { cacheDir: null });
  const g0 = stackAt(r, 0);
  assert.equal(g0.size, base.files.length);
  for (const f of base.files) assert.deepEqual(g0.get(f.path)!.slice(0, 2), [f.x, f.y], f.path);
  const seen = new Map<string, number[]>();
  for (let s = 0; s <= 3; s++) {
    const g = stackAt(r, s);
    for (const [p, v] of g) {
      if (seen.has(p)) assert.deepEqual(v.slice(0, 2), seen.get(p)!.slice(0, 2), `${p} moved at step ${s}`);
      seen.set(p, v);
    }
    for (const p of seen.keys()) if (!g.has(p)) seen.delete(p);
    const list = [...g];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [pa, a] = list[i];
        const [pb, b] = list[j];
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= a[2] + b[2] - 0.05, `${pa} overlaps ${pb} at step ${s}`);
      }
  }
  assert.ok(!stackAt(r, 2).has('guide/d4.md') && stackAt(r, 1).has('guide/d4.md'));
  assert.ok(!stackAt(r, 1).has('src/net/a.ts') && stackAt(r, 2).has('src/net/a.ts'));

  // the first two steps of the stack are the same without the third
  const r2 = stackMap(repo, 'main', items.slice(0, 2), { cacheDir: null });
  for (let s = 0; s <= 2; s++) assert.deepEqual([...stackAt(r2, s)].filter(([p]) => p !== 'lib/x/y.ts'), [...stackAt(r, s)], `step ${s}`);

  const html = renderHtml(r.map, r.overlay);
  const svg = renderSvg(r.map, r.overlay);
  const page = html.slice(0, html.indexOf('<script>'));
  for (const out of [page, svg]) assert.ok(!/NaN|undefined/.test(out), 'no NaN or undefined in the output');
  assert.match(html, /id="st-range" min="0" max="3"/);
  assert.match(svg, /class="cm-map night"/);
  assert.match(svg, /class="halo now"/);
});

test('the CLI draws a stack from branches, in the order given', () => {
  const out = mkdtempSync(join(tmpdir(), 'codemap-out-'));
  const run = (...a: string[]) => execFileSync(process.execPath, [CLI, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  run('stack', repo, '--head', 's1=First', '--head', 's2', '--head', 's3', '--base', 'main', '--no-cache', '--quiet', '--out', join(out, 's.json'), '--artifact', '--out', join(out, 's.html'));
  const j = JSON.parse(readFileSync(join(out, 's.json'), 'utf8'));
  assert.deepEqual(j.overlay.stack.steps.map((s: { label: string; title: string }) => [s.label, s.title]), [['s1', 'First'], ['s2', 's2'], ['s3', 's3']]);
  assert.equal(j.heads.length, 3);
  const html = readFileSync(join(out, 's.html'), 'utf8');
  assert.match(html, /^<title>[^<]+ stack of 3<\/title>/);
  run('render', join(out, 's.json'), '--out', join(out, 'r.html'));
  assert.match(readFileSync(join(out, 'r.html'), 'utf8'), /id="st-range"/);
  run('stack', repo, '--commits', 'main..s3', '--no-cache', '--quiet', '--out', join(out, 'c.json'));
  assert.equal(JSON.parse(readFileSync(join(out, 'c.json'), 'utf8')).overlay.stack.unit, 'commit');
});

/** The base colour of every folder cell and every unmarked file dot in a drawn map, as CSS. */
function coloursOf(svg: string, map: CodeMap): Map<string, string> {
  const vars = new Map<string, string>();
  for (const m of svg.slice(0, svg.indexOf('>')).matchAll(/(--k\d+):([^;"]+)/g)) vars.set(m[1], m[2]);
  const out = new Map<string, string>();
  const k = (s: string) => vars.get(/var\((--k\d+)\)/.exec(s)![1])!;
  for (const m of svg.matchAll(/<path class="cell[^"]*" data-d="([^"]+)"[^>]*style="([^"]+)"/g)) out.set(m[1] + '/', k(m[2]));
  for (const m of svg.matchAll(/<circle class="dot[^"]*" data-i="(\d+)"[^>]*style="([^"]+)"/g)) out.set(map.files[+m[1]].path, k(m[2]));
  return out;
}

test('base colours depend only on the path: the same folder has the same colour on every map', () => {
  // the colour function: only the first two levels of the path count, the root is grey, and the rule is pinned
  assert.equal(folderColour('src/core/deep/er'), folderColour('src/core'));
  assert.equal(fileColour('src/core/deep/x.ts'), folderColour('src/core'));
  assert.equal(fileColour('README.md'), 'var(--neutral)');
  assert.notEqual(folderColour('src'), folderColour('src/core'));
  assert.deepEqual(folderHue('crates'), folderHue('crates'));
  assert.deepEqual([folderHue('crates'), folderHue('crates/core'), folderHue('tests')], [{ h: 203, l: 0 }, { h: 250, l: 1 }, { h: 227, l: 1 }]);

  // drawn: two commits, a folder map, a PR and a stack (whose lib/x/ is new in the stack) all agree
  const early = mapAt(repo, shas[10], { cacheDir: null });
  const late = mapAt(repo, 'HEAD', { cacheDir: null });
  const part = mapAt(repo, 'HEAD', { cacheDir: null, path: 'src' });
  const pr = changeMap(repo, 'main', 's3', { cacheDir: null });
  const st = stackMap(repo, 'main', ['s1', 's2', 's3'].map((ref) => ({ ref, label: ref })), { cacheDir: null });
  const drawn = [
    coloursOf(renderSvg(early), early),
    coloursOf(renderSvg(late), late),
    coloursOf(renderSvg(part), part),
    coloursOf(renderSvg(pr.map, { dim: false }), pr.map),
    coloursOf(renderSvg(st.map, st.overlay), st.map),
  ];
  const all = new Map<string, string>();
  let shared = 0;
  for (const d of drawn)
    for (const [p, c] of d) {
      const want = p.endsWith('/') ? folderColour(p.slice(0, -1)) : fileColour(p);
      assert.equal(c, want, p);
      if (all.has(p)) shared++;
      all.set(p, c);
    }
  assert.ok(shared > 50, `${shared} folders and files drawn more than once`);
  for (const p of ['src/', 'src/core/', 'src/ui/', 'test/', 'lib/', 'lib/x/']) assert.ok(all.has(p), `${p} drawn`);
});
