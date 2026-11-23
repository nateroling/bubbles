// The map as SVG: one code path for the static .svg file and for the map inside the HTML page (page.ts).
// Also the theme tokens both use. The base map never changes for an overlay; it only fades so the overlay
// stands out. A stack (overlay.ts) is drawn at the step the page opens on; browser/stack.js moves it.

import { fileColour, folderColour } from './groups.ts';
import type { CodeMap } from './layout.ts';
import { applyRules, TONES, type Overlay, type Paint, type Stack, type StackFile, type StackStep } from './overlay.ts';
import { cmp } from './snapshot.ts';

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
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (v: number) => String(Math.round(v * 100) / 100);
const isTone = (t: string | undefined): t is string => !!t && (TONES as readonly string[]).includes(t.toLowerCase());
const toneVar = (t: string) => {
  const k = t.toLowerCase();
  return `var(--${k === 'muted' ? 'muted-tone' : k === 'grey' ? 'gray' : k})`;
};
/** A colour name that is also a tone (green, blue...) uses the theme's version, so it reads in light and dark. */
export const paint = (p: Paint, fallback = 'var(--hot)') => (p.color ? (isTone(p.color) ? toneVar(p.color) : esc(p.color)) : isTone(p.tone) ? toneVar(p.tone) : fallback);

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

export const MAP_CSS = `.cm-map{display:block;background:var(--panel)}
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

export interface Prepared {
  svg: string;
  data: PageData;
}

/** Data the page's script needs, in compact arrays. */
export interface PageData {
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

export function prepare(map: CodeMap, ov: Overlay, opt: SvgOptions): Prepared {
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
export function renderSvg(map: CodeMap, overlay: Overlay = {}, opt: SvgOptions = {}): string {
  overlay = applyRules(map, overlay);
  return prepare(map, overlay, { ...opt, standalone: true }).svg + '\n';
}
