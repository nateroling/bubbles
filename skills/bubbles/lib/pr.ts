// The first overlay: what a pull request (or any branch, or any range of commits) changes.
//
// The base map is the stable map at the merge base. The branch's changes are then applied to it as one
// more layout step, so added files appear at the free spot nearest their folder and everything else
// stays put. Deleted files stay on the map as ghosts where they were; a file renamed into another
// folder gets an arc from its old spot to its new one.

import { badgeOf, KIND, mergeBase, stepTo } from './change.ts';
import { revParse } from './git.ts';
import { cleanPath, replay, type CodeMap, type LayoutOptions, toMap } from './layout.ts';
import type { FileMark, Ghost, Arc, Overlay } from './overlay.ts';
import { fileName, inFolder } from './snapshot.ts';
import { cloneTree } from './tree.ts';

export interface ChangeOptions extends LayoutOptions {
  title?: string;
  link?: string;
}

export interface ChangeMap {
  map: CodeMap; // the map at the branch's head
  overlay: Overlay;
  base: string; // merge base sha
  head: string;
  counts: Record<'added' | 'modified' | 'deleted' | 'renamed', number>;
}

export function changeMap(repo: string, baseRef: string, headRef: string, opts: ChangeOptions = {}): ChangeMap {
  const head = revParse(repo, headRef);
  const base = mergeBase(repo, baseRef, head);
  const e = replay(repo, base, opts);
  const before = new Map<number, { x: number; y: number; r: number }>();
  e.scene.marks.forEach((m) => before.set(e.ids[m.f], m));
  const pathBefore = new Map([...e.tree.files].map(([p, f]) => [p, f.id]));

  const { snap, scene, info, changes, lines } = stepTo(e, cloneTree(e.tree), base, head, headRef);
  const map = toMap({ snap, scene, dots: e.dots, name: e.name }, info, e.opts.every!, opts.path);
  const dir = cleanPath(opts.path);
  const [ox, oy] = map.origin ?? [0, 0];

  const files: Record<string, FileMark> = {};
  const ghosts: Ghost[] = [];
  const arcs: Arc[] = [];
  const counts = { added: 0, modified: 0, deleted: 0, renamed: 0 };
  const at = new Map(map.files.map((f) => [f.path, f]));
  const spotBefore = (path: string) => {
    const id = pathBefore.get(path);
    return id !== undefined ? before.get(id) : undefined;
  };
  for (const ch of changes) {
    if (!inFolder(dir, ch.path)) continue; // outside the folder being mapped
    const kind = KIND[ch.type];
    const mark = { tone: kind, label: fileName(ch.path), badge: badgeOf(lines, ch.path), note: kind as string };
    if (ch.type === 'D') {
      counts.deleted++;
      const b = spotBefore(ch.path);
      if (b) ghosts.push({ path: ch.path, x: b.x - ox, y: b.y - oy, r: b.r, ...mark });
      continue;
    }
    const now = at.get(ch.path);
    if (!now) continue;
    counts[kind]++;
    if (ch.type === 'R') {
      const l = lines.get(ch.path);
      mark.note = `renamed from ${ch.oldPath}${l && l[0] + l[1] > 0 ? ' and edited' : ''}`;
      const b = spotBefore(ch.oldPath!);
      if (b && Math.hypot(b.x - ox - now.x, b.y - oy - now.y) > 1) arcs.push({ from: [b.x - ox, b.y - oy], to: ch.path, tone: 'renamed', note: `${ch.oldPath} → ${ch.path}` });
    }
    files[ch.path] = mark;
  }
  const parts = (Object.keys(counts) as (keyof typeof counts)[]).filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`);
  const overlay: Overlay = {
    title: opts.title ?? info.subject,
    subtitle: `${parts.join(', ') || 'no file changes'}${dir ? ` in ${dir}/` : ''} against ${baseRef} (merge base ${base.slice(0, 7)}).`,
    link: opts.link,
    files,
    ghosts,
    arcs,
  };
  return { map, overlay, base, head, counts };
}
