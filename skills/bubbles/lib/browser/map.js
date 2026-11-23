// The map page's own script: pan, zoom, pinch, hover tips, folder and file names placed as there is room,
// and the marked-files list. Read by page.ts and inlined into the page; it runs in the browser, not in Node.
// It reads window.CM_DATA (PageData in svg.ts) and publishes window.CM_API for stack.js.
(() => {
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
})();
