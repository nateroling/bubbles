// Base colours. A folder's colour comes from its own path and nothing else (not counts, sizes, siblings or
// the commit), so a folder has the same colour on every map of its repo: at any commit, in a PR, a stack, a
// saved map or a folder map. Each top-level folder, and each folder one level inside it, takes a hue and
// one of three lightnesses from a hash of its path; deeper folders share their second-level folder's colour
// (their cells still deepen with nesting, so the structure shows). Root files are neutral grey.
//
// The colour is oklch(var(--blL) var(--bc) H): L (0, 1 or 2) picks one of three theme lightnesses and --bc
// is the theme's chroma, so the same folder reads in the light and the dark theme (tokens in svg.ts).
// Why not hue = nameAngle (colour following direction on the map)? Siblings sit on their parent's ring in
// name order, so names that sort together sit together and would get near-equal hues (ripgrep's ci/ and
// crates/ 2 degrees apart, .cargo/ and .github/ 1, benchsuite/, ci/, crates/ and doc/ all within 21). See NOTES.md.

import { cmp, hash, type SDir, type Snapshot } from './snapshot.ts';

/** A 32-bit hash of a string, finalised so that every bit depends on every character. */
function mix(s: string): number {
  let h = hash(s);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export interface Hue {
  h: number; // degrees, 0..360, whole
  l: number; // lightness step: 0 (deep), 1, 2 (light)
}

/** The hue of a folder (repo-relative path, no trailing slash); null for the root. Depends only on `dir`. */
export function folderHue(dir: string): Hue | null {
  if (!dir) return null;
  const v = mix(dir.split('/', 2).join('/'));
  return { h: Math.round((v % 3600) / 10) % 360, l: (v >>> 20) % 3 };
}

/** The CSS colour of a hue (theme-aware); grey for none. */
export const hueCss = (c: Hue | null) => (c ? `oklch(var(--bl${c.l}) var(--bc) ${c.h})` : 'var(--neutral)');

/** The CSS colour of a folder, from its path alone. */
export const folderColour = (dir: string) => hueCss(folderHue(dir));

/** The CSS colour of a file: its folder's. */
export const fileColour = (path: string) => folderColour(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

export const LEGEND_MAX = 10;

/**
 * The legend of a map with no overlay: its biggest districts, largest first. Top-level folders, the biggest
 * split into its subfolders until none holds over an eighth of the files (but never below the second level,
 * where colours stop changing). Counts only choose what the legend lists; they never change a colour.
 */
export function legendEntries(s: Snapshot): { label: string; colour: string }[] {
  type Unit = { label: string; dir: string; count: number; d?: SDir };
  const whole = (d: SDir): Unit => ({ label: d.path + '/', dir: d.path, count: d.count, d });
  const units: Unit[] = [...(s.root.files.length ? [{ label: '(root files)', dir: '', count: s.root.files.length }] : []), ...s.root.dirs.map(whole)];
  for (;;) {
    const big = units.reduce((m, u, i) => (u.count > units[m].count ? i : m), 0);
    const u = units[big];
    if (!u || !u.d || u.count <= s.files.length / 8 || !u.d.dirs.length || u.d.depth >= 2 || units.length >= LEGEND_MAX + 2) break;
    const d = u.d;
    units.splice(big, 1, ...(d.files.length ? [{ label: d.path + '/ (files)', dir: d.path, count: d.files.length }] : []), ...d.dirs.map(whole));
  }
  units.sort((a, b) => b.count - a.count || cmp(a.label, b.label));
  return units.slice(0, LEGEND_MAX).map((u) => ({ label: u.label, colour: folderColour(u.dir) }));
}
