// A stack of pull requests (or branches, or commits) on one map, with a slider across them.
//
// The base is the stable map at the merge base of the base branch and the first PR. Each PR in the stack
// is then one more layout step, on that PR's head, and files added by a PR take the nearest free spot as
// of that PR. Nothing moves while you slide: every file and folder keeps the spot it had when it first
// appeared in the stack (the base map's spot, for files already there), held relative to its folder, so
// the small drift a layout step gives whole folders is left out. Only sizes change, and folder cells
// reshape around files that come and go. Nothing a later PR does can change an earlier step's frame.
// The page holds one frame per step as differences from the last one; files a PR touches light up at
// its step and stay dimly lit after.

import { cleanPath, cropMap, replay, snapshotOf, toMap, type CodeMap, type Engine, type LayoutOptions, type MapFile, type MapFolder } from './layout.ts';
import { commitInfo, diff, git, revParse, tryGit } from './git.ts';
import { ringD, type Overlay, type Stack, type StackFile, type StackStep, type TouchKind } from './render.ts';
import { cmp } from './snapshot.ts';
import { round } from './contour.ts';
import { applyChanges, cloneTree } from './tree.ts';

export interface StackItem {
  ref: string; // a commit-ish (for a PR: refs/bubbles/pr/N after fetchPr)
  label: string; // short name: "#123", a branch name, a short sha
  title?: string; // default: the head commit's subject
  link?: string;
}

export interface StackOptions extends LayoutOptions {
  title?: string;
  link?: string;
}

export interface StackMap {
  map: CodeMap; // every file and folder that exists at any step, where it last was
  overlay: Overlay; // with `stack`
  base: string; // merge base sha
  heads: string[];
  warnings: string[];
}

const KIND: Record<string, TouchKind> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' };
const MAX_STEPS = 60;

/** A GitHub pull request URL for `pr` on `remote`, when the remote is on github.com. */
export function prLink(repo: string, pr: number, remote = 'origin'): string | undefined {
  const url = tryGit(repo, ['remote', 'get-url', remote])?.trim();
  const m = url?.match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/pull/${pr}` : undefined;
}

/** The first-parent commits in `a..b`, oldest first, as stack items. */
export function commitItems(repo: string, range: string): { base: string; items: StackItem[] } {
  const m = range.match(/^(.+?)\.\.(.+)$/);
  if (!m || m[1].endsWith('.')) throw new Error('bubbles: --commits takes a range A..B');
  const shas = git(repo, ['rev-list', '--first-parent', '--reverse', `${m[1]}..${m[2]}`]).split('\n').filter(Boolean);
  if (!shas.length) throw new Error(`bubbles: no commits in ${range}`);
  return { base: m[1], items: shas.map((s) => ({ ref: s, label: s.slice(0, 7) })) };
}



export function stackMap(repo: string, baseRef: string, items: StackItem[], opts: StackOptions = {}): StackMap {
  if (!items.length) throw new Error('bubbles: the stack is empty');
  if (items.length > MAX_STEPS) throw new Error(`bubbles: a stack of ${items.length} is too long (at most ${MAX_STEPS})`);
  const heads = items.map((it) => revParse(repo, it.ref));
  const base = git(repo, ['merge-base', revParse(repo, baseRef), heads[0]]).trim();
  const e = replay(repo, base, opts);
  const every = e.opts.every!;
  const dir = cleanPath(opts.path);
  const inside = (p: string) => !dir || p.startsWith(dir + '/');
  // fixed spots: a folder's anchor is its parent's plus its offset when it first appeared; a file's spot
  // is where the layout put it when it (re)appeared, relative to its folder's anchor then
  const fixedAnchor = new Map<string, [number, number]>([['', [0, 0]]]);
  const spot = new Map<string, [number, number]>(); // gone files are dropped: a later return is placed anew
  const radius = new Map<string, number>();
  const { margin, gapIn, gapOut } = e.dots.p;
  type Dot = { x: number; y: number; r: number; dir: string; depth: number };
  /** How far apart two dots must be, as in the layout: a gap inside a folder, else each dot's reach
   *  (one margin per level below the folder they share) plus a gap between cells. */
  const clearance = (p: Dot, q: Dot) => {
    if (p.dir === q.dir) return p.r + q.r + gapIn;
    let c = p.dir;
    while (c && !(q.dir === c || q.dir.startsWith(c + '/'))) c = c.includes('/') ? c.slice(0, c.lastIndexOf('/')) : '';
    const depth = c ? c.split('/').length : 0;
    return p.r + margin * (p.depth - depth) + q.r + margin * (q.depth - depth) + gapOut;
  };
  let first = true; // the base frame is the layout's own
  const frameOf = (eng: Pick<Engine, 'snap' | 'scene' | 'dots' | 'name'>, info: { sha: string; date: string; subject: string }): CodeMap => {
    const { snap, scene, dots } = eng;
    const live = new Map<string, [number, number]>([['', [0, 0]]]); // this step's anchors
    for (const d of snap.dirs) {
      if (!d.parent) continue;
      const o = dots.off.get(d.path) ?? [0, 0];
      const pl = live.get(d.parent.path)!;
      live.set(d.path, [pl[0] + o[0], pl[1] + o[1]]);
      if (!fixedAnchor.has(d.path)) {
        const pf = fixedAnchor.get(d.parent.path)!;
        fixedAnchor.set(d.path, [pf[0] + o[0], pf[1] + o[1]]);
      }
    }
    const here = new Set<string>();
    const fresh: number[] = [];
    for (const m of scene.marks) {
      const f = snap.files[m.f];
      here.add(f.path);
      if (!spot.has(f.path)) fresh.push(m.f);
    }
    for (const k of [...spot.keys()]) if (!here.has(k)) spot.delete(k);
    // a file new to the stack goes where the layout put it, in its folder's fixed frame; if the
    // still-standing dots are in the way there, to the free spot nearest it
    const byPath = new Map(snap.files.map((f) => [f.path, f]));
    const placed = [...spot].map(([p, xy]) => {
      const f = byPath.get(p)!;
      return { x: xy[0], y: xy[1], r: radius.get(p)!, dir: f.dir.path, depth: f.dir.depth };
    });
    const markOf = new Map(scene.marks.map((m) => [m.f, m]));
    for (const fi of fresh) {
      const f = snap.files[fi];
      const m = markOf.get(fi)!;
      const a = live.get(f.dir.path)!;
      const b = fixedAnchor.get(f.dir.path)!;
      const me = { x: m.x - a[0] + b[0], y: m.y - a[1] + b[1], r: m.r, dir: f.dir.path, depth: f.dir.depth };
      if (!first) {
        const free = (x: number, y: number) => placed.every((o) => Math.hypot(o.x - x, o.y - y) >= clearance(me, o) - 1e-9);
        if (!free(me.x, me.y)) {
          let found = false;
          for (let k = 1; k <= 400 && !found; k++) {
            const rad = k * 0.1;
            const steps = Math.max(8, Math.ceil((2 * Math.PI * rad) / 0.1));
            for (let j = 0; j < steps; j++) {
              const t = (2 * Math.PI * j) / steps;
              const x = me.x + rad * Math.cos(t);
              const y = me.y + rad * Math.sin(t);
              if (free(x, y)) {
                me.x = x;
                me.y = y;
                found = true;
                break;
              }
            }
          }
        }
      }
      placed.push(me);
      spot.set(f.path, [round(me.x), round(me.y)]);
    }
    for (const m of scene.marks) radius.set(snap.files[m.f].path, m.r);
    const marks = scene.marks.map((m) => {
      const p = spot.get(snap.files[m.f].path)!;
      return { ...m, x: p[0], y: p[1] };
    });
    for (const k of [...fixedAnchor.keys()]) if (k && !live.has(k)) fixedAnchor.delete(k);
    first = false;
    const whole = toMap({ snap, scene: { ...scene, marks }, dots, name: eng.name }, info, every);
    if (!dir) return whole;
    if (!fixedAnchor.has(dir)) throw new Error(`bubbles: ${dir} is not a folder at ${info.sha.slice(0, 7)}`);
    return cropMap(whole, dir, fixedAnchor.get(dir)!);
  };
  const frames: CodeMap[] = [frameOf(e, commitInfo(e.repo, base))];
  const tree = cloneTree(e.tree);
  const steps: StackStep[] = [];
  const touched: Record<string, StackFile> = {};
  const warnings: string[] = [];
  let prev = base;
  heads.forEach((h, k) => {
    const it = items[k];
    if (tryGit(e.repo, ['merge-base', '--is-ancestor', prev, h]) === null) warnings.push(`${it.label} does not build on ${k ? items[k - 1].label : 'the base'}; its step shows everything that differs between the two`);
    const { changes, lines } = diff(e.repo, prev, h);
    applyChanges(tree, changes);
    if (!tree.files.size) throw new Error(`bubbles: ${it.label} has no files`);
    const { snap, ids } = snapshotOf(tree, e.name);
    const scene = e.dots.step(snap, ids);
    const info = commitInfo(e.repo, h);
    frames.push(frameOf({ snap, scene, dots: e.dots, name: e.name }, info));
    const counts: Partial<Record<TouchKind, number>> = {};
    for (const ch of changes) {
      if (!inside(ch.path)) continue;
      const kind = KIND[ch.type];
      counts[kind] = (counts[kind] ?? 0) + 1;
      const l = lines.get(ch.path);
      const note = ch.type === 'R' ? `renamed from ${ch.oldPath}` : undefined;
      (touched[ch.path] ??= { touches: [] }).touches.push({ step: k + 1, kind, ...(l ? { badge: `+${l[0]} −${l[1]}` } : {}), ...(note ? { note } : {}) });
    }
    steps.push({ label: it.label, title: it.title ?? info.subject, ...(it.link ? { link: it.link } : {}), commit: h, counts });
    prev = h;
  });

  // the union map: every file and folder at its last position; frames record where each differs
  const last = frames.at(-1)!;
  const files = new Map<string, MapFile>();
  const folders = new Map<string, MapFolder>();
  for (const f of frames) {
    for (const x of f.files) files.set(x.path, x);
    for (const x of f.folders) folders.set(x.path, x);
  }
  const fileAt = frames.map((fr) => new Map(fr.files.map((x) => [x.path, x])));
  const folderAt = frames.map((fr) => new Map(fr.folders.map((x) => [x.path, x])));
  const fileFrames: Record<string, ([number] | [number, number, number, number])[]> = {};
  for (const [p, def] of files) {
    const list: ([number] | [number, number, number, number])[] = [];
    let cur: string = `${def.x},${def.y},${def.r}`;
    frames.forEach((_, s) => {
      const g = fileAt[s].get(p);
      const key = g ? `${g.x},${g.y},${g.r}` : '-';
      if (key !== cur) list.push(g ? [s, g.x, g.y, g.r] : [s]);
      cur = key;
    });
    if (list.length) fileFrames[p] = list;
  }
  const folderFrames: Record<string, ([number] | [number, string])[]> = {};
  for (const [p, def] of folders) {
    const list: ([number] | [number, string])[] = [];
    let cur = ringD(def.outline);
    frames.forEach((_, s) => {
      const g = folderAt[s].get(p);
      const key = g ? ringD(g.outline) : '-';
      if (key !== cur) list.push(g ? [s, key] : [s]);
      cur = key;
    });
    if (list.length) folderFrames[p] = list;
  }
  let b = last.bounds;
  for (const f of frames) b = [Math.min(b[0], f.bounds[0]), Math.min(b[1], f.bounds[1]), Math.max(b[2], f.bounds[2]), Math.max(b[3], f.bounds[3])];
  const depthOf = (p: string) => folders.get(p)!.depth;
  const map: CodeMap = {
    ...last,
    bounds: b,
    files: [...files.values()].sort((p, q) => cmp(p.path, q.path)),
    folders: [...folders.values()].sort((p, q) => depthOf(p.path) - depthOf(q.path) || cmp(p.path, q.path)),
  };

  const n = items.length;
  const all = new Map<TouchKind, number>();
  for (const t of Object.values(touched)) for (const x of t.touches) all.set(x.kind, (all.get(x.kind) ?? 0) + 1);
  const what = ['added', 'modified', 'deleted', 'renamed'].filter((k) => all.get(k as TouchKind)).map((k) => `${all.get(k as TouchKind)} ${k}`);
  const stack: Stack = { steps, files: touched, frames: { files: fileFrames, folders: folderFrames } };
  const overlay: Overlay = {
    title: opts.title ?? `A stack of ${n} on ${e.name}${dir ? `/${dir}` : ''}`,
    subtitle: `${Object.keys(touched).length} files touched${what.length ? ` (${what.join(', ')})` : ''}${dir ? ` in ${dir}/` : ''}, on top of ${baseRef} (merge base ${base.slice(0, 7)}). Each step lights up the files it touches; they stay dimly lit after.`,
    ...(opts.link ? { link: opts.link } : {}),
    stack,
  };
  return { map, overlay, base, heads, warnings };
}
