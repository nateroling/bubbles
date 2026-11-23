// The overlay model: what goes on top of a code map (marks, colour rules, ghosts, arcs, a legend, a stack of
// changes) and the helpers that combine overlays and turn rules into marks. Pure data; drawing is in svg.ts
// and page.ts.

import type { CodeMap } from './layout.ts';

/** Named colours that follow the page's light/dark theme. Anything else is used as a CSS colour. */
export const TONES = ['added', 'modified', 'deleted', 'renamed', 'hot', 'warm', 'cool', 'muted', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'gray', 'grey'] as const;

export interface Paint {
  tone?: string; // one of TONES
  color?: string; // any CSS colour; wins over tone
}

export interface FileMark extends Paint {
  label?: string; // shown beside the dot when zoomed in (default: none)
  badge?: string; // short text in the list and tooltip, e.g. "+12 −3"
  note?: string; // tooltip line
  group?: string; // list heading (default: the tone's name)
}

export interface Ghost extends Paint {
  path: string;
  x: number;
  y: number;
  r: number;
  label?: string;
  badge?: string;
  note?: string;
  group?: string;
}

export interface Arc extends Paint {
  from: string | [number, number]; // a file path (on the map or a ghost) or a point
  to: string | [number, number];
  width?: number; // screen pixels (default 1.5)
  note?: string;
}

/** Colour every file whose path matches a glob: `*.stories.*` (no slash: matches the file name anywhere),
 *  `src/**\/*.test.ts` (with a slash: matches the repo-relative path), `docs/` or `docs` (a folder and everything in it).
 *  `*` stays within one folder, `**` crosses folders, `?` is one character, `{a,b}` is either. */
export interface Rule extends Paint {
  match: string;
  label?: string; // legend and list heading (default: the pattern)
}

export interface Overlay {
  title?: string;
  subtitle?: string;
  link?: string; // e.g. the PR's URL, shown under the title
  dim?: boolean; // fade the base map (default: true when the overlay marks anything)
  files?: Record<string, FileMark>;
  rules?: Rule[]; // the first matching rule colours a file the `files` entries don't mention
  ghosts?: Ghost[];
  arcs?: Arc[];
  legend?: ({ label: string } & Paint)[];
  list?: boolean; // list the marked files beside the map (default true)
  stack?: Stack; // a sequence of changes with a slider across them (see Stack)
}

export type TouchKind = 'added' | 'modified' | 'deleted' | 'renamed';

/** One step of a stack: a PR, a branch or a commit. */
export interface StackStep {
  label: string; // short: "#123", a branch, a short sha
  title?: string;
  link?: string;
  commit?: string;
  counts?: Partial<Record<TouchKind, number>>;
}

export interface StackFile {
  touches: { step: number; kind: TouchKind; badge?: string; note?: string }[]; // step 1 = the first step
}

/**
 * A stack of changes on one map, with a slider from step 0 (the base, nothing lit) to the last step. Files
 * a step touches light up brightly at that step and stay dimly lit after (only files light up, never
 * folders). Deleted files stay as dashed outlines. `frames` hold how the map differs at each step from the map
 * the stack is drawn on: for a file, [step, x, y, r] means it is there from that step on, [step] that it is
 * gone; for a folder, [step, outline rings] (as MapFolder.outline) or [step]. (Saved stacks from before
 * v0.4.2 hold an SVG path string in place of the rings; they still render.) Without frames every file is where the map has it.
 */
export interface Stack {
  steps: StackStep[];
  files: Record<string, StackFile>;
  frames?: { files?: Record<string, ([number] | [number, number, number, number])[]>; folders?: Record<string, ([number] | [number, number[][] | string])[]> };
  start?: number; // the step the page opens on (default: the last)
  unit?: string; // what a step is called: "PR" (default "step")
}


/** A glob as a matcher over repo-relative paths (see Rule). */
export function globMatcher(pattern: string): (path: string) => boolean {
  let p = pattern.trim().replace(/^\.\//, '');
  const hasGlob = /[*?{]/.test(p);
  if (p.endsWith('/')) p += '**';
  else if (!hasGlob && p.includes('/')) p += '{,/**}';
  const byName = !p.includes('/');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') re += '(?:';
    else if (c === '}') re += ')';
    else if (c === ',' && re.lastIndexOf('(?:') > re.lastIndexOf(')')) re += '|';
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  const rx = new RegExp(`^${re}$`);
  if (byName && hasGlob) return (path) => rx.test(path.slice(path.lastIndexOf('/') + 1));
  if (byName) return (path) => path.slice(path.lastIndexOf('/') + 1) === p || path === p || path.startsWith(p + '/') || path.includes('/' + p + '/');
  return (path) => rx.test(path);
}

/** Turn an overlay's rules into per-file marks (explicit `files` entries win). */
export function applyRules(map: CodeMap, overlay: Overlay): Overlay {
  if (!overlay.rules?.length) return overlay;
  const rules = overlay.rules.map((r) => ({ r, m: globMatcher(r.match) }));
  const files: Record<string, FileMark> = { ...overlay.files };
  for (const f of map.files) {
    if (files[f.path]) continue;
    const hit = rules.find((x) => x.m(f.path));
    if (hit) files[f.path] = { tone: hit.r.tone, color: hit.r.color, group: hit.r.label ?? hit.r.match, label: f.path.slice(f.path.lastIndexOf('/') + 1) };
  }
  return { ...overlay, files };
}

/** `b` on top of `a`: its fields win, its file marks are added over `a`'s, its ghosts, arcs and rules are
 *  appended. `a`'s stack is kept unless `b` has one. */
export function mergeOverlay(a: Overlay, b: Overlay): Overlay {
  const cat = <T,>(x: T[] | undefined, y: T[] | undefined) => (x || y ? [...(x ?? []), ...(y ?? [])] : undefined);
  const out: Overlay = { ...a, ...b };
  if (a.files || b.files) out.files = { ...a.files, ...b.files };
  const ghosts = cat(a.ghosts, b.ghosts);
  const arcs = cat(a.arcs, b.arcs);
  const rules = cat(a.rules, b.rules);
  if (ghosts) out.ghosts = ghosts;
  if (arcs) out.arcs = arcs;
  if (rules) out.rules = rules;
  if (!b.stack && a.stack) out.stack = a.stack;
  return out;
}
