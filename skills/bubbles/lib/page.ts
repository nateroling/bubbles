// The map as a self-contained HTML page: header, legend, the SVG from svg.ts, the marked-files list, and the
// scripts in browser/ (pan, zoom, hover, names that appear as you zoom in; a stack's slider). Opens from
// disk, or publishes as a claude.ai Artifact.

import { readFileSync } from 'node:fs';
import { legendEntries } from './groups.ts';
import type { CodeMap } from './layout.ts';
import { applyRules, type Overlay, type Paint } from './overlay.ts';
import { buildSnapshot, cmp } from './snapshot.ts';
import { esc, MAP_CSS, paint, prepare, THEME_CSS } from './svg.ts';

/** The page's scripts, read once. */
const script = (name: string) => readFileSync(new URL(`./browser/${name}`, import.meta.url), 'utf8').replace(/^(\/\/.*\n)+/, '').trim();
export const PAGE_JS = script('map.js');
export const STACK_JS = script('stack.js');

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
