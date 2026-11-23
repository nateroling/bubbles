#!/usr/bin/env node
// bubbles: a stable, spatial map of a git repository, with overlays.
//
//   node bubbles.ts map    [repo] [--ref REF] [--overlay FILE] [--out FILE]
//   node bubbles.ts pr     [repo] (--pr N | --head REF) [--base REF] [--title T] [--link URL] [--out FILE]
//   node bubbles.ts stack  [repo] (--pr N[=TITLE]... | --head REF[=TITLE]... | --commits A..B) [--base REF] [--out FILE]
//   node bubbles.ts render MAP.json [--overlay FILE] [--out FILE]
//
// --out picks the format from its extension: .html (interactive page, the default), .svg (static
// picture) or .json (the map, plus the overlay for `pr`). Repeat --out for several outputs.
// Common options: --every week|day|commit (checkpoint spacing, default week), --no-cache, --cache DIR,
// --name LABEL, --quiet. --artifact writes .html as the body of a claude.ai Artifact (no document
// skeleton; publish it with the Artifact tool); --page-title sets the page's <title>.
// Needs Node 22.18+ and git; nothing to install.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { mapAt, type CodeMap, type Every, type LayoutOptions } from './lib/layout.ts';
import { changeMap, defaultBase, fetchPr } from './lib/pr.ts';
import { mergeOverlay, type Overlay } from './lib/overlay.ts';
import { renderHtml } from './lib/page.ts';
import { renderSvg } from './lib/svg.ts';
import { commitItems, prLink, stackMap, type StackItem } from './lib/stack.ts';

const USAGE = `usage:
  node bubbles.ts map    [repo] [--ref REF] [--overlay FILE] [--out FILE]...
  node bubbles.ts pr     [repo] (--pr N | --head REF) [--base REF] [--title T] [--link URL] [--out FILE]...
  node bubbles.ts stack  [repo] (--pr N[=TITLE]... | --head REF[=TITLE]... | --commits A..B) [--base REF] [--title T] [--out FILE]...
  node bubbles.ts render MAP.json [--overlay FILE] [--out FILE]...
options: --every week|day|commit  --no-cache  --cache DIR  --name LABEL  --quiet
         --artifact (.html as an Artifact page body)  --page-title TITLE
         --path DIR (map one folder; it looks exactly as it does in the whole-repo map)
         --color PATTERN=COLOR[=LABEL] (repeatable; e.g. '*.stories.*=green', 'docs/=blue=Docs')
--out: .html (default), .svg or .json; repeat for several.`;

const argv = process.argv.slice(2);
const cmd = argv.shift();
const opts = new Map<string, string[]>();
const ordered: [string, string][] = []; // every option in command-line order (a stack's --pr and --head)
const pos: string[] = [];
const BOOL = new Set(['--no-cache', '--quiet', '--help', '--artifact']);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : BOOL.has(k) ? 'true' : argv[++i];
    if (v === undefined) fail(`${k} needs a value`);
    opts.set(k, [...(opts.get(k) ?? []), v]);
    ordered.push([k, v]);
  } else pos.push(a);
}
const one = (k: string) => opts.get(k)?.at(-1);
function fail(msg: string): never {
  console.error(`bubbles: ${msg}\n\n${USAGE}`);
  process.exit(2);
}
if (!cmd || cmd === '--help' || cmd === 'help' || opts.has('--help')) {
  console.log(USAGE);
  process.exit(0);
}
const known = new Set(['--ref', '--overlay', '--out', '--pr', '--head', '--base', '--title', '--link', '--every', '--no-cache', '--cache', '--name', '--quiet', '--remote', '--artifact', '--page-title', '--path', '--color', '--commits']);
for (const k of opts.keys()) if (!known.has(k)) fail(`unknown option ${k}`);
const every = (one('--every') ?? 'week') as Every;
if (!['week', 'day', 'commit'].includes(every)) fail('--every must be week, day or commit');
const quiet = opts.has('--quiet');
const lopts: LayoutOptions = {
  every,
  cacheDir: opts.has('--no-cache') ? null : one('--cache'),
  name: one('--name'),
  path: one('--path'),
  log: quiet ? undefined : (m) => console.error(`bubbles: ${m}`),
};
const rules = (opts.get('--color') ?? []).map((c) => {
  const [match, color, ...label] = c.split('=');
  if (!match || !color) fail(`--color takes PATTERN=COLOR[=LABEL], got ${c}`);
  return { match, color, ...(label.length ? { label: label.join('=') } : {}) };
});
const readOverlay = (): Overlay => {
  const o: Overlay = one('--overlay') ? (JSON.parse(readFileSync(resolve(one('--overlay')!), 'utf8')) as Overlay) : {};
  if (one('--title')) o.title = one('--title');
  if (one('--link')) o.link = one('--link');
  return rules.length ? mergeOverlay(o, { rules }) : o;
};

function write(map: CodeMap, overlay: Overlay, stem: string, pageTitle: string, extra?: object) {
  const outs = opts.get('--out') ?? [`${stem}.html`];
  for (const o of outs) {
    const file = resolve(o);
    mkdirSync(dirname(file), { recursive: true });
    const ext = extname(file).toLowerCase();
    if (ext === '.svg') writeFileSync(file, renderSvg(map, overlay));
    else if (ext === '.json') writeFileSync(file, JSON.stringify(extra ? { map, overlay, ...extra } : Object.keys(overlay).length ? { map, overlay } : map));
    else writeFileSync(file, renderHtml(map, overlay, { artifact: opts.has('--artifact'), pageTitle: one('--page-title') ?? pageTitle }));
    console.log(file);
  }
}

try {
  if (cmd === 'map') {
    const repo = resolve(pos[0] ?? '.');
    const map = mapAt(repo, one('--ref') ?? 'HEAD', lopts);
    write(map, readOverlay(), `bubbles-${map.repo}-${map.commit.slice(0, 7)}`, `${map.repo}${map.root ? "/" + map.root : ""} code map`);
  } else if (cmd === 'pr') {
    const repo = resolve(pos[0] ?? '.');
    const pr = one('--pr');
    let head = one('--head');
    if (pr) {
      if (!/^\d+$/.test(pr)) fail('--pr takes a pull request number');
      head = fetchPr(repo, Number(pr), one('--remote') ?? 'origin');
    }
    if (!head) fail('pr needs --pr N or --head REF');
    const base = one('--base') ?? defaultBase(repo);
    const r = changeMap(repo, base, head, { ...lopts, title: one('--title'), link: one('--link') });
    const overlay = mergeOverlay(r.overlay, readOverlay());
    write(r.map, overlay, `bubbles-${r.map.repo}-${pr ? 'pr' + pr : r.head.slice(0, 7)}`, pr ? `${r.map.repo} PR ${pr}` : `${r.map.repo} ${head} changes`, { base: r.base, head: r.head, counts: r.counts });
  } else if (cmd === 'stack') {
    const repo = resolve(pos[0] ?? '.');
    const remote = one('--remote') ?? 'origin';
    let items: StackItem[] = [];
    let base = one('--base');
    let unit = 'step';
    if (one('--commits')) {
      if (opts.has('--pr') || opts.has('--head')) fail('stack takes --commits, or --pr/--head, not both');
      const c = commitItems(repo, one('--commits')!);
      items = c.items;
      base ??= c.base;
      unit = 'commit';
    } else {
      const kinds = new Set<string>();
      for (const [k, v] of ordered) {
        if (k !== '--pr' && k !== '--head') continue;
        kinds.add(k);
        const eq = v.indexOf('=');
        const ref = eq < 0 ? v : v.slice(0, eq);
        const title = eq < 0 ? undefined : v.slice(eq + 1);
        if (k === '--pr') {
          if (!/^\d+$/.test(ref)) fail(`--pr takes a pull request number, got ${ref}`);
          items.push({ ref: fetchPr(repo, Number(ref), remote), label: `#${ref}`, title, link: prLink(repo, Number(ref), remote) });
        } else items.push({ ref, label: ref, title });
      }
      if (!items.length) fail('stack needs --pr N (repeat it, bottom of the stack first), --head REF, or --commits A..B');
      unit = kinds.size === 1 && kinds.has('--pr') ? 'PR' : 'step';
    }
    const r = stackMap(repo, base ?? defaultBase(repo), items, { ...lopts, title: one('--title'), link: one('--link') });
    for (const w of r.warnings) if (!quiet) console.error(`bubbles: warning: ${w}`);
    r.overlay.stack!.unit = unit;
    const overlay = mergeOverlay(r.overlay, { ...readOverlay(), stack: r.overlay.stack });
    const n = items.length;
    write(r.map, overlay, `bubbles-${r.map.repo}-stack-${r.heads[n - 1].slice(0, 7)}`, `${r.map.repo} stack of ${n}`, { base: r.base, heads: r.heads });
  } else if (cmd === 'render') {
    if (!pos[0]) fail('render needs a map .json file');
    const raw = JSON.parse(readFileSync(resolve(pos[0]), 'utf8'));
    const map: CodeMap = raw.format ? raw : raw.map;
    if (map?.format !== 'bubbles/1') fail(`${pos[0]} is not a bubbles/1 file`);
    const base: Overlay = raw.format ? {} : (raw.overlay ?? {});
    const overlay = mergeOverlay(base, readOverlay());
    write(map, overlay, basename(pos[0], extname(pos[0])), overlay.title ?? `${map.repo}${map.root ? "/" + map.root : ""} code map`);
  } else fail(`unknown command ${cmd}`);
} catch (e) {
  const err = e as Error & { stderr?: Buffer | string };
  console.error(`bubbles: ${err.message.split('\n')[0]}${err.stderr ? '\n' + String(err.stderr).trim() : ''}`);
  process.exit(1);
}
