// The renderer: a code map as SVG (static, for embedding) or as a self-contained HTML page (pan, zoom,
// hover, folder names that appear as you zoom in). Extra properties go on top as an Overlay: a colour,
// label, badge or note per file, ghosts for files that are not on the map (say, deleted in a PR), and
// arcs between files. The base map never changes for an overlay; it only fades so the overlay stands out.

import { fileColour, folderColour, legendEntries } from './groups.ts';
import type { CodeMap } from './layout.ts';
import { buildSnapshot, cmp } from './snapshot.ts';

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
 * gone; for a folder, [step, svgPathD] or [step]. Without frames every file is where the map has it.
 */
export interface Stack {
  steps: StackStep[];
  files: Record<string, StackFile>;
  frames?: { files?: Record<string, ([number] | [number, number, number, number])[]>; folders?: Record<string, ([number] | [number, string])[]> };
  start?: number; // the step the page opens on (default: the last)
  unit?: string; // what a step is called: "PR" (default "step")
}

/** Where a file or folder is at step s, from its frames: [geometry, present]. */
function frameAt<T>(list: ([number] | [number, ...T[]])[] | undefined, s: number, dflt: T[]): [T[], boolean] {
  let g = dflt;
  let on = true;
  for (const e of list ?? []) {
    if (e[0] > s) break;
    if (e.length > 1) {
      g = e.slice(1) as T[];
      on = true;
    } else on = false;
  }
  return [g, on];
}

/** The last touch of a file at or before step s. */
const touchAt = (f: StackFile | undefined, s: number) => {
  let t: StackFile['touches'][number] | null = null;
  for (const x of f?.touches ?? []) if (x.step <= s) t = x;
  return t;
};
const haloR = (r: number) => r * 2.6 + 0.9;

export const ringD = (rings: number[][]) => rings.map((r) => 'M' + r.map(n2).join(' ').replace(/^(\S+ \S+)/, '$1L') + 'Z').join('');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (v: number) => String(Math.round(v * 100) / 100);
const isTone = (t: string | undefined): t is string => !!t && (TONES as readonly string[]).includes(t.toLowerCase());
const toneVar = (t: string) => {
  const k = t.toLowerCase();
  return `var(--${k === 'muted' ? 'muted-tone' : k === 'grey' ? 'gray' : k})`;
};
/** A colour name that is also a tone (green, blue...) uses the theme's version, so it reads in light and dark. */
const paint = (p: Paint, fallback = 'var(--hot)') => (p.color ? (isTone(p.color) ? toneVar(p.color) : esc(p.color)) : isTone(p.tone) ? toneVar(p.tone) : fallback);
export const fmtSize = (b: number) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB');

// ---- theme ----

const LIGHT =
  '--bg:#eef1ec;--panel:#f8faf6;--ink:#1d2a22;--muted:#5b6a60;--rule:#d3dbd2;--accent:#2f7d55;--neutral:#8b978e;' +
  '--bl0:.48;--bl1:.62;--bl2:.76;--bc:.14;' +
  '--added:#2b8a3e;--modified:#e8590c;--deleted:#c2255c;--renamed:#1971c2;--hot:#e03131;--warm:#f08c00;--cool:#1c7ed6;--muted-tone:#868e96;' +
  '--red:#e03131;--orange:#f76707;--yellow:#e8b100;--green:#2f9e44;--teal:#0c8599;--blue:#1c7ed6;--purple:#7048e8;--pink:#d6336c;--brown:#8d6e4f;--gray:#868e96;';
const DARK =
  '--bg:#0f1512;--panel:#151d18;--ink:#e3ebe4;--muted:#95a59a;--rule:#26332b;--accent:#6cc293;--neutral:#6f7c73;' +
  '--bl0:.6;--bl1:.72;--bl2:.84;--bc:.13;' +
  '--added:#69db7c;--modified:#ffa94d;--deleted:#f783ac;--renamed:#74c0fc;--hot:#ff6b6b;--warm:#ffd43b;--cool:#4dabf7;--muted-tone:#adb5bd;' +
  '--red:#ff6b6b;--orange:#ff922b;--yellow:#ffd43b;--green:#69db7c;--teal:#3bc9db;--blue:#4dabf7;--purple:#9775fa;--pink:#f783ac;--brown:#c0a080;--gray:#adb5bd;';

const GLOW = '--glow:#ffc94a;--glow-core:#fff3c9;--ember:#a8782f;';

/** Theme tokens: light on :root, dark under the OS setting and under an explicit data-theme. A stack is
 *  drawn at night in both themes (the dark tokens on the map), so its lights read as lights. */
export const THEME_CSS = `:root{${LIGHT}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK}color-scheme:dark}}
:root[data-theme="dark"]{${DARK}color-scheme:dark}
.night{${DARK}${GLOW}}`;

const MAP_CSS = `.cm-map{display:block;background:var(--panel)}
.cm-map .cell{stroke:none}
.cm-map .dot{stroke:none;fill:var(--c)}
.cm-map .ring{fill:none;stroke-width:2px;vector-effect:non-scaling-stroke}
.cm-map .ghost{stroke-width:1.5px;stroke-dasharray:3 2;vector-effect:non-scaling-stroke}
.cm-map .arc{fill:none;vector-effect:non-scaling-stroke;stroke-linecap:round;opacity:.85}
.cm-map text{font-family:Inter,system-ui,-apple-system,sans-serif;fill:var(--muted);paint-order:stroke;stroke:var(--panel);stroke-linejoin:round}
.cm-map text.flab{fill:var(--ink)}
.cm-map .hot{stroke:var(--ink);stroke-width:2px;vector-effect:non-scaling-stroke}
.cm-map .cell.hot{stroke-width:1.5px}
.cm-map .absent{display:none}
.cm-map .halo{pointer-events:none;opacity:0;transition:opacity .6s}
.cm-map .halo{fill:url(#cm-glow);transform-box:fill-box;transform-origin:center}
.cm-map .halo.now{opacity:1}.cm-map .halo.past{opacity:.22;fill:url(#cm-ember)}
.cm-map .dot.now,.cm-map .dot.past{transition:fill .6s}
.cm-map .dot.now{fill:var(--glow-core)}.cm-map .dot.past{fill:color-mix(in srgb,var(--ember) 60%,var(--c))}
.cm-map .dot.gone{fill:none;stroke:var(--ember);stroke-width:1.2px;stroke-dasharray:2 2;vector-effect:non-scaling-stroke}
.cm-map .dot.gone.now{stroke:var(--glow-core)}
.cm-map .halo.flare{animation:cm-flare 1.1s ease-out}
@keyframes cm-flare{from{transform:scale(1.9)}to{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.cm-map .halo.flare{animation:none}.cm-map .halo,.cm-map .dot.now,.cm-map .dot.past{transition:none}}`;

// ---- the SVG ----

export interface SvgOptions {
  standalone?: boolean; // a complete .svg file with its own styles (default true)
  width?: number; // standalone only: the drawing's width in px (default 1200)
}

interface Prepared {
  svg: string;
  data: PageData;
}

/** Data the page's script needs, in compact arrays. */
interface PageData {
  bounds: [number, number, number, number];
  files: [string, number, number, number, number][]; // path, size, x, y, r
  marks: Record<number, [string, string, string, string, string]>; // file index -> label, badge, note, group, colour
  ghosts: [string, number, number, number, string, string, string, string, string][]; // path, x, y, r, label, badge, note, group, colour
  folders: [string, number, number][]; // path, depth, files
  stack?: {
    steps: StackStep[];
    unit: string;
    start: number;
    touch: Record<number, [number, string, string, string][]>; // file index -> [step, kind, badge, note]
    ff: Record<number, unknown[]>; // file index -> frames
    fd: Record<string, unknown[]>; // folder path -> frames
  };
}

function prepare(map: CodeMap, ov: Overlay, opt: SvgOptions): Prepared {
  const marks = ov.files ?? {};
  const ghosts = ov.ghosts ?? [];
  const arcs = ov.arcs ?? [];
  const st = ov.stack;
  const S = st ? Math.max(0, Math.min(st.steps.length, st.start ?? st.steps.length)) : 0;
  const ff = st?.frames?.files ?? {};
  const fd = st?.frames?.folders ?? {};
  const dim = st ? true : (ov.dim ?? (Object.keys(marks).length > 0 || ghosts.length > 0 || arcs.length > 0));
  // base colours come from paths alone (lib/groups.ts), so every map of a repo agrees; each distinct colour
  // is a custom property on the map (--k0, --k1...) to keep the page small
  const palette = new Map<string, string>();
  const kv = (css: string) => {
    let k = palette.get(css);
    if (k === undefined) palette.set(css, (k = `var(--k${palette.size})`));
    return k;
  };
  const cOf = map.files.map((f) => kv(fileColour(f.path)));
  const index = new Map(map.files.map((f, i) => [f.path, i]));

  const [x0, y0, x1, y1] = map.bounds;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.03;
  const vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  const standalone = opt.standalone ?? true;
  const W = opt.width ?? 1200;
  const out: string[] = [];
  out.push(
    standalone
      ? `<svg xmlns="http://www.w3.org/2000/svg" class="cm-map${st ? ' night' : ''}" viewBox="${vb.map(n2).join(' ')}" width="${W}" height="${Math.round((W * vb[3]) / vb[2])}" role="img" aria-label="${esc(`Code map of ${map.repo}`)}">`
      : `<svg class="cm-map${st ? ' night' : ''}" id="cm-map" viewBox="${vb.map(n2).join(' ')}" style="aspect-ratio:${n2(Math.max(0.6, Math.min(2.2, vb[2] / vb[3])))}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(`Code map of ${map.repo}`)}">`,
  );
  if (standalone) out.push(`<style>${THEME_CSS}\n${MAP_CSS}</style><rect x="${n2(vb[0])}" y="${n2(vb[1])}" width="${n2(vb[2])}" height="${n2(vb[3])}" fill="var(--panel)"/>`);
  if (st)
    out.push(
      '<defs>' +
        [['cm-glow', 'var(--glow)', '.75'], ['cm-ember', 'var(--ember)', '.9']].map(([id, c, o]) => `<radialGradient id="${id}"><stop offset="0" style="stop-color:${c};stop-opacity:${o}"/><stop offset=".3" style="stop-color:${c};stop-opacity:${+o * 0.5}"/><stop offset="1" style="stop-color:${c};stop-opacity:0"/></radialGradient>`).join('') +
        '</defs>',
    );

  // a stack's state at the step drawn: where each file is, and how it is lit
  const geo = (f: CodeMap['files'][number]) => frameAt<number>(ff[f.path], S, [f.x, f.y, f.r]);
  const lightOf = (path: string) => {
    if (!st?.files[path]) return '';
    const t = touchAt(st.files[path], S);
    return t ? (t.step === S ? ' now' : ' past') : '';
  };
  const stateOf = (f: CodeMap['files'][number]) => {
    if (!st) return '';
    const on = geo(f)[1];
    const t = touchAt(st.files[f.path], S);
    return lightOf(f.path) + (on ? '' : t?.kind === 'deleted' ? ' gone' : ' absent');
  };

  // folder cells, shallow first so each subfolder sits on its parent
  out.push('<g class="cells">');
  const folders = [...map.folders].sort((a, b) => a.depth - b.depth || cmp(a.path, b.path));
  for (const f of folders) {
    const col = kv(folderColour(f.path));
    const pct = Math.min(70, 16 + 9 * (f.depth - 1)) * (dim ? 0.6 : 1);
    const [[d], on] = frameAt<string>(fd[f.path], S, [ringD(f.outline)]);
    out.push(`<path class="cell${on ? '' : ' absent'}" data-d="${esc(f.path)}" fill-rule="evenodd" style="fill:color-mix(in srgb,${col} ${(st ? pct * 0.7 : pct).toFixed(0)}%,var(--panel))" d="${d}"/>`);
  }
  out.push('</g>');

  // a stack's lights: a halo under every touched file (only files light up, never folders)
  if (st) {
    out.push('<g class="halos">');
    map.files.forEach((f, i) => {
      if (!st.files[f.path]) return;
      const [[x, y, r]] = geo(f);
      out.push(`<circle class="halo${stateOf(f)}" data-h="${i}" cx="${n2(x)}" cy="${n2(y)}" r="${n2(haloR(r))}"/>`);
    });
    out.push('</g>');
  }

  // dots
  out.push('<g class="dots">');
  map.files.forEach((f, i) => {
    if (marks[f.path]) return;
    const col = cOf[i];
    const fill = dim ? `color-mix(in srgb,${col} ${st ? 30 : 38}%,var(--panel))` : col;
    const [[x, y, r]] = geo(f);
    out.push(`<circle class="dot${stateOf(f)}" data-i="${i}" cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" style="--c:${fill}"/>`);
  });
  out.push('</g>');

  // ghosts
  const ghostAt = new Map<string, [number, number]>();
  if (ghosts.length) {
    out.push('<g class="ghosts">');
    ghosts.forEach((g, k) => {
      const c = paint(g, 'var(--deleted)');
      ghostAt.set(g.path, [g.x, g.y]);
      out.push(`<circle class="ghost" data-g="${k}" cx="${n2(g.x)}" cy="${n2(g.y)}" r="${n2(g.r)}" style="stroke:${c};fill:color-mix(in srgb,${c} 18%,transparent)"/>`);
    });
    out.push('</g>');
  }

  // arcs: a gentle curve bending to the left of travel, a small dot at the end
  if (arcs.length) {
    out.push('<g class="arcs">');
    const pos = (e: string | [number, number]): [number, number] | null => {
      if (Array.isArray(e)) return e;
      const i = index.get(e);
      return i !== undefined ? [map.files[i].x, map.files[i].y] : (ghostAt.get(e) ?? null);
    };
    for (const a of arcs) {
      const p = pos(a.from);
      const q = pos(a.to);
      if (!p || !q) continue;
      const c = paint(a, 'var(--accent)');
      const mx = (p[0] + q[0]) / 2;
      const my = (p[1] + q[1]) / 2;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const k = 0.22;
      out.push(
        `<path class="arc" style="stroke:${c};stroke-width:${a.width ?? 1.5}px" d="M${n2(p[0])} ${n2(p[1])}Q${n2(mx + dy * k)} ${n2(my - dx * k)} ${n2(q[0])} ${n2(q[1])}"><title>${esc(a.note ?? '')}</title></path>`,
        `<circle cx="${n2(q[0])}" cy="${n2(q[1])}" r="0.3" style="fill:${c}"/>`,
      );
    }
    out.push('</g>');
  }

  // marked files on top, each with a ring so a small file is still easy to spot
  const markData: PageData['marks'] = {};
  const marked = Object.keys(marks)
    .filter((p) => index.has(p))
    .sort(cmp);
  if (marked.length) {
    out.push('<g class="marks">');
    for (const p of marked) {
      const i = index.get(p)!;
      const f = map.files[i];
      const m = marks[p];
      const c = paint(m);
      markData[i] = [m.label ?? '', m.badge ?? '', m.note ?? '', m.group ?? m.tone ?? '', c];
      out.push(`<circle class="ring" cx="${n2(f.x)}" cy="${n2(f.y)}" r="${n2(f.r + 0.45)}" style="stroke:${c}"/>`);
      out.push(`<circle class="dot" data-i="${i}" cx="${n2(f.x)}" cy="${n2(f.y)}" r="${n2(f.r)}" style="fill:${c}"/>`);
    }
    out.push('</g>');
  }

  // folder names; the page script shows them as there is room, a standalone SVG shows the top level
  const size = Math.max(x1 - x0, y1 - y0) / 70;
  out.push('<g class="labels">');
  for (const f of folders) {
    const name = f.path.slice(f.path.lastIndexOf('/') + 1) + '/';
    if (standalone) {
      if (f.depth > 1 || f.bbox[2] - f.bbox[0] < name.length * size * 0.6) continue;
      out.push(`<text x="${n2(f.label[0])}" y="${n2(f.label[1] + size * 1.1)}" font-size="${n2(size)}" stroke-width="${n2(size * 0.25)}" text-anchor="middle" font-weight="600">${esc(name)}</text>`);
    } else
      out.push(
        `<text data-k="d"${st && fd[f.path] ? ` data-dp="${esc(f.path)}"${frameAt(fd[f.path], S, [''])[1] ? '' : ' class="off"'}` : ''} data-x="${n2(f.label[0])}" data-y="${n2(f.label[1])}" data-w="${n2(f.bbox[2] - f.bbox[0])}" data-h="${n2(f.bbox[3] - f.bbox[1])}" data-depth="${f.depth}" text-anchor="middle" font-weight="600" visibility="hidden">${esc(name)}</text>`,
      );
  }
  if (!standalone) {
    for (const p of marked) {
      const m = marks[p];
      if (!m.label) continue;
      const f = map.files[index.get(p)!];
      out.push(`<text class="flab" data-k="f" data-x="${n2(f.x)}" data-y="${n2(f.y)}" data-r="${n2(f.r)}" visibility="hidden">${esc(m.label)}</text>`);
    }
    if (st)
      map.files.forEach((f, i) => {
        if (!st.files[f.path] || marks[f.path]) return;
        const [[x, y, r]] = geo(f);
        const state = stateOf(f);
        out.push(`<text class="flab${state.includes('now') && !state.includes('absent') ? '' : ' off'}" data-k="f" data-fi="${i}" data-x="${n2(x)}" data-y="${n2(y)}" data-r="${n2(r)}" visibility="hidden">${esc(f.path.slice(f.path.lastIndexOf('/') + 1))}</text>`);
      });
    for (const g of ghosts) {
      if (!g.label) continue;
      out.push(`<text class="flab" data-k="f" data-x="${n2(g.x)}" data-y="${n2(g.y)}" data-r="${n2(g.r)}" visibility="hidden">${esc(g.label)}</text>`);
    }
  }
  out.push('</g></svg>');
  // the base colours, as custom properties on the map (resolved against the map's own theme tokens)
  const ks = [...palette].map(([css, k]) => `${k.slice(4, -1)}:${css}`).join(';');
  out[0] = out[0].includes(' style="') ? out[0].replace(' style="', ` style="${ks};`) : out[0].replace(' role="img"', ` style="${ks}" role="img"`);

  return {
    svg: out.join('\n'),
    data: {
      bounds: vb as PageData['bounds'],
      files: map.files.map((f) => [f.path, f.size, f.x, f.y, f.r]),
      marks: markData,
      ghosts: ghosts.map((g) => [g.path, g.x, g.y, g.r, g.label ?? '', g.badge ?? '', g.note ?? '', g.group ?? g.tone ?? '', paint(g, 'var(--deleted)')]),
      folders: map.folders.map((f) => [f.path, f.depth, f.files]),
      ...(st
        ? {
            stack: {
              steps: st.steps,
              unit: st.unit ?? 'step',
              start: S,
              touch: Object.fromEntries(
                Object.entries(st.files)
                  .filter(([p]) => index.has(p))
                  .map(([p, t]) => [index.get(p)!, [...t.touches].sort((a, b) => a.step - b.step).map((x) => [x.step, x.kind, x.badge ?? '', x.note ?? ''])]),
              ),
              ff: Object.fromEntries(Object.entries(ff).filter(([p]) => index.has(p)).map(([p, l]) => [index.get(p)!, l])),
              fd,
            },
          }
        : {}),
    },
  };
}

/** A static SVG file. */
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

export function renderSvg(map: CodeMap, overlay: Overlay = {}, opt: SvgOptions = {}): string {
  overlay = applyRules(map, overlay);
  return prepare(map, overlay, { ...opt, standalone: true }).svg + '\n';
}

// ---- the page ----

const PAGE_CSS = `*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.5 Inter,system-ui,-apple-system,sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding-block:24px 40px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:14px}
.wrap>*{min-width:0}
header{display:grid;gap:4px;max-width:80ch}
.eyebrow{font:12px "JetBrains Mono",ui-monospace,Menlo,monospace;color:var(--muted);letter-spacing:.02em;overflow-wrap:anywhere}
h1{font-family:"Bricolage Grotesque","Avenir Next",system-ui,sans-serif;font-weight:700;font-size:clamp(26px,4vw,40px);line-height:1.08;margin:0;letter-spacing:-.01em;text-wrap:balance}
header p{margin:0;color:var(--muted)}
header a{color:var(--accent)}
.bar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font:12px "JetBrains Mono",ui-monospace,Menlo,monospace;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:10px;height:10px;border-radius:50%;display:inline-block}
.tools{display:flex;gap:8px}
.tools button{font:500 13px Inter,system-ui,sans-serif;color:var(--muted);background:var(--panel);border:1px solid var(--rule);border-radius:999px;padding:4px 12px;cursor:pointer}
.tools button:hover{color:var(--ink);border-color:var(--muted)}
.tools button[aria-pressed="false"]{opacity:.6}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.body{display:grid;gap:14px;grid-template-columns:minmax(0,1fr)}
.body.has-list{grid-template-columns:minmax(0,1fr)}
@media (min-width:1000px){.body.has-list{grid-template-columns:minmax(0,1fr) 340px}}
.plate{position:relative;background:var(--panel);border:1px solid var(--rule);border-radius:6px;overflow:hidden;min-width:0}
#cm-map{width:100%;height:auto;max-height:min(78vh,960px);min-height:280px;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
#cm-map.dragging{cursor:grabbing}
.hint{position:absolute;left:12px;bottom:10px;font-size:12px;color:var(--muted);pointer-events:none;background:color-mix(in srgb,var(--panel) 80%,transparent);padding:2px 8px;border-radius:4px}
aside{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:12px 0;max-height:min(78vh,960px);overflow:auto;min-width:0}
aside h2{font:600 11px Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:10px 14px 4px}
aside h2:first-child{margin-top:0}
aside ul{list-style:none;margin:0;padding:0}
aside li button{all:unset;box-sizing:border-box;display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:8px;align-items:center;width:100%;padding:3px 14px;cursor:pointer;font-size:13px}
aside li button:hover,aside li button:focus-visible{background:color-mix(in srgb,var(--ink) 7%,transparent)}
aside li i{width:10px;height:10px;border-radius:50%}
aside .p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
aside .p span{direction:ltr;unicode-bidi:embed}
aside .p b{font-weight:600}
aside .p em{font-style:normal;color:var(--muted)}
aside .b{font:12px "JetBrains Mono",ui-monospace,Menlo,monospace;color:var(--muted);font-variant-numeric:tabular-nums}
#tip{position:fixed;pointer-events:none;z-index:20;background:var(--ink);color:var(--panel);font:12px "JetBrains Mono",ui-monospace,Menlo,monospace;padding:6px 9px;border-radius:4px;max-width:min(440px,80vw);overflow-wrap:anywhere}
footer{color:var(--muted);font-size:13px;max-width:84ch}
footer a{color:var(--accent)}
footer code{font:12px "JetBrains Mono",ui-monospace,Menlo,monospace}`;

const PAGE_JS = String.raw`(() => {
const D = window.CM_DATA, svg = document.getElementById('cm-map'), tip = document.getElementById('tip');
const labels = [...svg.querySelectorAll('.labels text')];
let v = null, showLabels = true;
function aspect() { return svg.clientWidth / Math.max(1, svg.clientHeight); }
function fit() {
  const [x, y, w, h] = D.bounds, a = aspect();
  if (w / h > a) v = { x, y: y + h / 2 - w / a / 2, w, h: w / a }; else v = { x: x + w / 2 - h * a / 2, y, w: h * a, h };
  apply();
}
function apply() {
  svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h);
  place();
}
const scale = () => svg.clientWidth / v.w;
function place() {
  const s = scale(), boxes = [];
  for (const t of labels) {
    let show = false;
    if (showLabels && !t.classList.contains('off')) {
      const k = t.dataset.k, x = +t.dataset.x, y = +t.dataset.y;
      const px = k === 'd' ? Math.max(10, 15 - +t.dataset.depth) : 11.5;
      const tw = t.textContent.length * px * 0.58;
      let sx = (x - v.x) * s, sy = (y - v.y) * s, box;
      if (k === 'd') {
        const w = +t.dataset.w * s, h = +t.dataset.h * s;
        if (Math.min(w, h) >= 70 && tw <= w * 0.9) { sy += px * 0.95; box = [sx - tw / 2 - 3, sy - px / 2 - 2, sx + tw / 2 + 3, sy + px / 2 + 2]; }
      } else if (+t.dataset.r * s >= 2.5) { sx += +t.dataset.r * s + 5; box = [sx - 2, sy - px / 2 - 2, sx + tw + 2, sy + px / 2 + 2]; }
      if (box && box[2] > 0 && box[0] < svg.clientWidth && box[3] > 0 && box[1] < svg.clientHeight && !boxes.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) {
        boxes.push(box); show = true;
        t.setAttribute('x', v.x + sx / s); t.setAttribute('y', v.y + sy / s);
        t.setAttribute('font-size', px / s); t.setAttribute('stroke-width', 3 / s);
        t.setAttribute('dominant-baseline', 'central');
      }
    }
    t.setAttribute('visibility', show ? 'visible' : 'hidden');
  }
}
// file labels first so the overlay's names win over folder names
labels.sort((a, b) => (a.dataset.k === b.dataset.k ? (+(a.dataset.depth || 0)) - (+(b.dataset.depth || 0)) : a.dataset.k === 'f' ? -1 : 1));

function zoomAt(cx, cy, f) {
  const r = svg.getBoundingClientRect(), s = scale();
  const wx = v.x + (cx - r.left) / s, wy = v.y + (cy - r.top) / s;
  const nw = Math.min(Math.max(v.w / f, 2), D.bounds[2] * 4), k = nw / v.w;
  v = { x: wx - (wx - v.x) * k, y: wy - (wy - v.y) * k, w: nw, h: v.h * k };
  apply();
}
function centreOn(x, y, w) { const a = aspect(); v = { x: x - w / 2, y: y - w / a / 2, w, h: w / a }; apply(); }

const ptrs = new Map(); let pinch = 0, moved = false;
svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))); }, { passive: false });
svg.addEventListener('pointerdown', (e) => { svg.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } svg.classList.add('dragging'); });
svg.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) { if (e.pointerType === 'mouse') hover(e); return; }
  if (ptrs.size === 1) { const s = scale(), dx = e.clientX - p.x, dy = e.clientY - p.y; if (dx || dy) { moved = true; v.x -= dx / s; v.y -= dy / s; apply(); } }
  p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch); pinch = d; moved = true; }
  hideTip();
});
const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; if (!ptrs.size) svg.classList.remove('dragging'); if (e.pointerType !== 'mouse' && !moved) hover(e); };
svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
svg.addEventListener('pointerleave', hideTip);
svg.addEventListener('dblclick', (e) => zoomAt(e.clientX, e.clientY, e.shiftKey ? 0.5 : 2));
new ResizeObserver(() => { if (!v) return fit(); const a = aspect(), cx = v.x + v.w / 2, cy = v.y + v.h / 2; v.h = v.w / a; v.y = cy - v.h / 2; v.x = cx - v.w / 2; apply(); }).observe(svg);

const size = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
let hot = null;
function setHot(el) { if (hot === el) return; if (hot) hot.classList.remove('hot'); hot = el; if (el) el.classList.add('hot'); }
function hideTip() { tip.hidden = true; setHot(null); }
function describe(el) {
  if (el.dataset.i !== undefined) {
    const i = +el.dataset.i, f = D.files[i], m = D.marks[i];
    return [f[0] + ' · ' + size(f[1]) + (m && m[1] ? ' · ' + m[1] : ''), m && m[2], window.CM_EXTRA && window.CM_EXTRA(i)].filter(Boolean).join('\n');
  }
  if (el.dataset.g !== undefined) { const g = D.ghosts[+el.dataset.g]; return [g[0] + (g[5] ? ' · ' + g[5] : ''), g[6]].filter(Boolean).join('\n'); }
  if (el.dataset.d !== undefined) { const f = D.folders.find((x) => x[0] === el.dataset.d); return f[0] + '/ · ' + f[2] + ' file' + (f[2] === 1 ? '' : 's'); }
  return null;
}
function showTip(text, x, y) {
  tip.hidden = false; tip.textContent = text; tip.style.whiteSpace = 'pre-line';
  tip.style.left = Math.min(x + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(y + 16, innerHeight - tip.offsetHeight - 8) + 'px';
}
function hover(e) {
  const el = e.target.closest && e.target.closest('[data-i],[data-g],[data-d]');
  const text = el && describe(el);
  if (!text) return hideTip();
  setHot(el); showTip(text, e.clientX, e.clientY);
}

document.getElementById('fit').addEventListener('click', fit);
const lb = document.getElementById('names');
lb.addEventListener('click', () => { showLabels = !showLabels; lb.setAttribute('aria-pressed', showLabels); place(); });
for (const b of document.querySelectorAll('aside button[data-i],aside button[data-g]')) {
  const el = () => svg.querySelector(b.dataset.i !== undefined ? '.marks [data-i="' + b.dataset.i + '"]' : '[data-g="' + b.dataset.g + '"]');
  b.addEventListener('mouseenter', () => setHot(el()));
  b.addEventListener('mouseleave', () => setHot(null));
  b.addEventListener('focus', () => setHot(el()));
  b.addEventListener('blur', () => setHot(null));
  b.addEventListener('click', () => {
    const f = b.dataset.i !== undefined ? D.files[+b.dataset.i] : D.ghosts[+b.dataset.g];
    const x = b.dataset.i !== undefined ? f[2] : f[1], y = b.dataset.i !== undefined ? f[3] : f[2];
    centreOn(x, y, Math.max(24, D.bounds[2] / 6)); setHot(el());
  });
}
fit();
window.CM_API = { centreOn, setHot, place };
})();`;

const STACK_CSS = `.plate.night{background:var(--panel)}
.stackbar{display:grid;gap:6px;background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:10px 12px}
.stackbar .row{display:flex;align-items:center;gap:8px}
.stackbar button{font:500 13px Inter,system-ui,sans-serif;color:var(--ink);background:var(--bg);border:1px solid var(--rule);border-radius:999px;min-width:34px;height:30px;padding:0 10px;cursor:pointer;flex:none}
.stackbar button:hover{border-color:var(--muted)}
.stackbar #st-play{min-width:64px}
.stackbar input[type=range]{flex:1;min-width:0;accent-color:#e0a21b;height:30px;margin:0}
.st-now{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;min-height:1.5em}
.st-now b{font-weight:600}
.st-now a{color:var(--accent)}
.st-now .c{font:12px "JetBrains Mono",ui-monospace,Menlo,monospace;color:var(--muted)}
aside .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
aside .t b{font-weight:600;margin-right:6px}
aside li.cur button{background:color-mix(in srgb,#e0a21b 16%,transparent)}
aside li.later{opacity:.55}
aside i.lt-now{background:#f5b82e;box-shadow:0 0 6px 1px #f5b82e}
aside i.lt-past{background:#a8782f}
aside i.lt-off{background:var(--rule)}
aside .k{font:11px "JetBrains Mono",ui-monospace,Menlo,monospace;color:var(--muted);margin:0 14px 6px}`;

const STACK_JS = String.raw`(() => {
const D = window.CM_DATA, K = D.stack, api = window.CM_API, svg = document.getElementById('cm-map');
const n = K.steps.length, U = K.unit;
const q = (s) => [...svg.querySelectorAll(s)];
const byAttr = (sel, a) => { const m = {}; for (const el of q(sel)) (m[el.getAttribute(a)] ||= []).push(el); return m; };
const dot = byAttr('.dots .dot[data-i]', 'data-i'), halo = byAttr('.halo', 'data-h'), flab = byAttr('text[data-fi]', 'data-fi');
const cell = byAttr('.cells .cell', 'data-d'), dlab = byAttr('text[data-dp]', 'data-dp');
const keys = new Set([...Object.keys(K.ff), ...Object.keys(K.touch)]);
const home = {}; for (const i of keys) { const f = D.files[i]; home[i] = [f[2], f[3], f[4]]; }
const homeD = {}; for (const p in K.fd) homeD[p] = cell[p] ? cell[p][0].getAttribute('d') : '';
function at(list, s, d) { let g = d, on = true; for (const e of list || []) { if (e[0] > s) break; if (e.length > 1) { g = e.slice(1); on = true; } else on = false; } return [g, on]; }
function touchAt(i, s) { let t = null; for (const x of K.touch[i] || []) if (x[0] <= s) t = x; return t; }
const tog = (els, c, on) => { for (const el of els || []) el.classList.toggle(c, !!on); };
const r = document.getElementById('st-range'), now = document.getElementById('st-now'), steps = document.getElementById('st-steps'), list = document.getElementById('st-files'), head = document.getElementById('st-files-h');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const counts = (c) => ['added', 'modified', 'deleted', 'renamed'].filter((k) => c && c[k]).map((k) => c[k] + ' ' + k).join(', ') || 'no file changes';
const total = (c) => Object.values(c || {}).reduce((a, b) => a + b, 0);
const haloR = (x) => x * 2.6 + 0.9;
let cur = -1;
function setStep(s, flare) {
  s = Math.max(0, Math.min(n, s));
  if (s === cur) return;
  cur = s;
  for (const i of keys) {
    const [g, on] = at(K.ff[i], s, home[i]), t = touchAt(i, s);
    const lit = t ? (t[0] === s ? 'now' : 'past') : '', gone = !on && t && t[1] === 'deleted';
    const f = D.files[i]; f[2] = g[0]; f[3] = g[1]; f[4] = g[2];
    for (const el of dot[i] || []) { el.setAttribute('cx', g[0]); el.setAttribute('cy', g[1]); el.setAttribute('r', g[2]); }
    for (const el of halo[i] || []) {
      el.setAttribute('cx', g[0]); el.setAttribute('cy', g[1]); el.setAttribute('r', haloR(g[2]));
      if (flare && lit === 'now' && !el.classList.contains('now')) { el.classList.remove('flare'); void el.getBBox(); el.classList.add('flare'); }
    }
    for (const el of flab[i] || []) { el.dataset.x = g[0]; el.dataset.y = g[1]; el.dataset.r = g[2]; el.classList.toggle('off', lit !== 'now' || !(on || gone)); }
    for (const els of [dot[i], halo[i]]) { tog(els, 'now', lit === 'now'); tog(els, 'past', lit === 'past'); tog(els, 'gone', gone); tog(els, 'absent', !on && !gone); }
  }
  for (const p in K.fd) {
    const [g, on] = at(K.fd[p], s, [homeD[p]]);
    for (const el of cell[p] || []) { el.setAttribute('d', g[0]); el.classList.toggle('absent', !on); }
    tog(dlab[p], 'off', !on);
  }
  api.place();
  ui(s);
}
function ui(s) {
  r.value = s;
  const st = K.steps[s - 1];
  r.setAttribute('aria-valuetext', s ? U + ' ' + s + ' of ' + n + ': ' + st.label : 'the base');
  now.innerHTML = s
    ? '<b>' + U + ' ' + s + ' of ' + n + '</b>' + (st.link ? '<a href="' + esc(st.link) + '" target="_blank" rel="noopener">' + esc(st.label) + '</a>' : '<span>' + esc(st.label) + '</span>') + '<span>' + esc(st.title || '') + '</span><span class="c">' + esc(counts(st.counts)) + '</span>'
    : '<b>Base</b><span>before the stack: nothing lit yet</span>';
  for (const li of steps.children) { const k = +li.dataset.s; li.classList.toggle('cur', k === s); li.classList.toggle('later', k > s); const i = li.querySelector('i'); i.className = k === s && k ? 'lt-now' : k < s && k ? 'lt-past' : 'lt-off'; }
  const rows = [];
  for (const i in K.touch) for (const x of K.touch[i]) if (x[0] === s && s) rows.push([D.files[i][0], i, x]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  head.textContent = s ? 'Lit by ' + st.label + ' · ' + rows.length : 'Lit · 0';
  list.innerHTML = rows.map(([p, i, x]) => { const c = p.lastIndexOf('/'); return '<li><button type="button" data-i="' + i + '"><i class="lt-now"></i><span class="p"><span><em>' + esc(p.slice(0, c + 1)) + '</em><b>' + esc(p.slice(c + 1)) + '</b></span></span><span class="b">' + esc(x[1] + (x[2] ? ' ' + x[2] : '')) + '</span></button></li>'; }).join('');
}
steps.innerHTML = [-1, ...K.steps.keys()].map((k) => { const st = K.steps[k]; return '<li data-s="' + (k + 1) + '"><button type="button"><i></i><span class="t">' + (st ? '<b>' + esc(st.label) + '</b>' + esc(st.title || '') : '<b>Base</b>before the stack') + '</span><span class="b">' + (st ? total(st.counts) : '') + '</span></button></li>'; }).join('');
steps.addEventListener('click', (e) => { const li = e.target.closest('li[data-s]'); if (li) { stop(); setStep(+li.dataset.s, true); } });
list.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (!b) return; const f = D.files[+b.dataset.i]; api.centreOn(f[2], f[3], Math.max(24, D.bounds[2] / 6)); api.setHot((dot[b.dataset.i] || [])[0]); });
list.addEventListener('mouseover', (e) => { const b = e.target.closest('button[data-i]'); api.setHot(b ? (dot[b.dataset.i] || [])[0] : null); });
list.addEventListener('mouseleave', () => api.setHot(null));
r.addEventListener('input', () => { stop(); setStep(+r.value, true); });
document.getElementById('st-prev').addEventListener('click', () => { stop(); setStep(cur - 1, true); });
document.getElementById('st-next').addEventListener('click', () => { stop(); setStep(cur + 1, true); });
const pb = document.getElementById('st-play');
let timer = null;
function stop() { if (timer) clearInterval(timer); timer = null; pb.textContent = 'Play'; pb.setAttribute('aria-pressed', 'false'); }
pb.addEventListener('click', () => {
  if (timer) return stop();
  if (cur >= n) setStep(0, false);
  pb.textContent = 'Pause'; pb.setAttribute('aria-pressed', 'true');
  timer = setInterval(() => { setStep(cur + 1, true); if (cur >= n) stop(); }, 1600);
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
  if (e.key === 'ArrowRight' || e.key === ']') { stop(); setStep(cur + 1, true); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || e.key === '[') { stop(); setStep(cur - 1, true); e.preventDefault(); }
});
window.CM_EXTRA = (i) => (K.touch[i] || []).map((x) => (x[0] === cur ? '● ' : x[0] < cur ? '○ ' : '  ') + K.steps[x[0] - 1].label + ': ' + x[1] + (x[2] ? ' ' + x[2] : '') + (x[3] ? ' (' + x[3] + ')' : '')).join('\n');
setStep(K.start, false);
})();`;

const ORDER = ['added', 'modified', 'renamed', 'deleted'];
const sortGroups = <T,>(e: [string, T][]) => e.sort((a, b) => (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99));

export interface HtmlOptions {
  artifact?: boolean; // the page body for a claude.ai Artifact: no doctype/html/head/body tags (the host adds them)
  pageTitle?: string; // the <title> (browser tab, artifact gallery); default: the overlay's title
}

/** A self-contained HTML page (opens from disk, or publishes as an Artifact; fonts from Google Fonts when online). */
export function renderHtml(map: CodeMap, overlay: Overlay = {}, opt: HtmlOptions = {}): string {
  overlay = applyRules(map, overlay);
  const { svg, data } = prepare(map, overlay, { standalone: false });
  const title = overlay.title ?? `${map.repo}${map.root ? "/" + map.root : ""} code map`;
  const marks = overlay.files ?? {};
  const index = new Map(map.files.map((f, i) => [f.path, i]));

  // legend: the overlay's own, else the tones it uses (with counts), else the base map's folder colours
  let legend = '';
  const item = (c: string, l: string) => `<span><i style="background:${c}"></i>${esc(l)}</span>`;
  const st = overlay.stack;
  if (overlay.legend) legend = overlay.legend.map((l) => item(paint(l), l.label)).join('');
  else if (st) {
    const u = st.unit ?? 'step';
    legend = [item('#f5b82e;box-shadow:0 0 6px 1px #f5b82e', `touched by this ${u}`), item('#a8782f', `touched by an earlier ${u}`), `<span><i style="border:1.5px dashed #a8782f"></i>deleted</span>`].join('');
  } else if (Object.keys(marks).length || overlay.ghosts?.length) {
    const count = new Map<string, [string, number]>();
    const tally = (m: Paint & { group?: string }, fallbackGroup: string, fallbackColour: string) => {
      const k = m.group ?? m.tone ?? fallbackGroup;
      const e = count.get(k) ?? [paint(m, fallbackColour), 0];
      e[1]++;
      count.set(k, e);
    };
    for (const p of Object.keys(marks)) if (index.has(p)) tally(marks[p], 'marked', 'var(--hot)');
    for (const g of overlay.ghosts ?? []) tally(g, 'not on the map', 'var(--deleted)');
    legend = sortGroups([...count]).map(([k, [c, n]]) => item(c, `${k} ${n}`)).join('');
  } else {
    legend = legendEntries(buildSnapshot(map.repo, map.files.map((f) => [f.path, f.size]))).map((e) => item(e.colour, e.label)).join('');
  }

  // the list of marked files, grouped
  let list = '';
  const rows = new Map<string, string[]>();
  const addRow = (groupName: string, attr: string, c: string, path: string, badge: string) => {
    const cut = path.lastIndexOf('/');
    const p = `<span><em>${esc(path.slice(0, cut + 1))}</em><b>${esc(path.slice(cut + 1))}</b></span>`;
    let r = rows.get(groupName);
    if (!r) rows.set(groupName, (r = []));
    r.push(`<li><button type="button" ${attr}><i style="background:${c}"></i><span class="p">${p}</span><span class="b">${esc(badge)}</span></button></li>`);
  };
  for (const p of Object.keys(marks).sort(cmp)) {
    const i = index.get(p);
    if (i === undefined) continue;
    const m = marks[p];
    addRow(m.group ?? m.tone ?? 'marked', `data-i="${i}"`, paint(m), p, m.badge ?? '');
  }
  (overlay.ghosts ?? []).forEach((g, k) => addRow(g.group ?? g.tone ?? 'not on the map', `data-g="${k}"`, paint(g, 'var(--deleted)'), g.path, g.badge ?? ''));
  const showList = !!st || ((overlay.list ?? true) && rows.size > 0);
  if (st) list = `<aside aria-label="The stack"><h2>The stack · ${st.steps.length}</h2><ol id="st-steps" style="list-style:none;margin:0;padding:0"></ol><h2 id="st-files-h">Lit</h2><ul id="st-files"></ul></aside>`;
  else if (showList) list = `<aside aria-label="Marked files">${sortGroups([...rows]).map(([g, r]) => `<h2>${esc(g)} · ${r.length}</h2><ul>${r.join('')}</ul>`).join('')}</aside>`;
  const u = st?.unit ?? 'step';
  const stackbar = st
    ? `<div class="stackbar"><div class="row"><button type="button" id="st-prev" aria-label="Previous ${esc(u)}">‹</button><button type="button" id="st-play" aria-pressed="false">Play</button><button type="button" id="st-next" aria-label="Next ${esc(u)}">›</button><input type="range" id="st-range" min="0" max="${st.steps.length}" step="1" value="${st.start ?? st.steps.length}" aria-label="${esc(u)} in the stack"></div><div class="st-now" id="st-now" aria-live="polite"></div></div>`
    : '';

  const eyebrow = `${map.repo}${map.root ? "/" + map.root + "/" : ""} · ${map.commit.slice(0, 7)} · ${map.date} · ${map.files.length.toLocaleString('en')} files`;
  const sub = overlay.subtitle ?? (Object.keys(marks).length || st ? '' : map.subject);
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(opt.pageTitle ?? title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap">
<style>
${THEME_CSS}
${PAGE_CSS}
${MAP_CSS}${st ? '\n' + STACK_CSS : ''}
</style>
</head>
<body>
<div class="wrap">
<header>
<div class="eyebrow">${esc(eyebrow)}</div>
<h1>${esc(title)}</h1>
${sub ? `<p>${esc(sub)}</p>` : ''}
${overlay.link ? `<p><a href="${esc(overlay.link)}" target="_blank" rel="noopener">${esc(overlay.link)}</a></p>` : ''}
</header>
<div class="bar"><div class="legend">${legend}</div><div class="tools"><button type="button" id="names" aria-pressed="true">Names</button><button type="button" id="fit">Fit</button></div></div>
${stackbar}
<div class="body${showList ? ' has-list' : ''}">
<div class="plate${st ? ' night' : ''}">
${svg}
<div class="hint">Drag to pan · scroll or pinch to zoom · hover for names</div>
</div>
${list}
</div>
<footer>Every file is a dot, bigger for bigger files; every folder is the cell grown around its files, so subfolders sit inside their parents. The map is replayed from the repository's history and holds still as the code grows: files keep their places, and new files take the nearest free spot in their folder. Made with <a href="https://github.com/nateroling/bubbles" target="_blank" rel="noopener">bubbles</a>, a Claude Code plugin: install it with <code>/plugin marketplace add nateroling/bubbles</code> (instructions in its README).</footer>
</div>
<div id="tip" hidden></div>
<script>window.CM_DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};</script>
<script>${PAGE_JS}</script>${st ? `\n<script>${STACK_JS}</script>` : ''}
</body>
</html>
`;
  if (!opt.artifact) return page;
  // an Artifact's host wraps the page in its own skeleton
  return page.replace(/^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport"[^\n]*\n/, '').replace('</head>\n<body>\n', '').replace(/<\/body>\n<\/html>\n$/, '');
}
