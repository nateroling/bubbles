// The stack page's script: the slider, Play, and lighting each step's files. Inlined after map.js, whose
// window.CM_API it uses. Runs in the browser, not in Node.
(() => {
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
})();
