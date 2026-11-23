// What a branch, a pull request or a range of commits changes, as one more layout step. Shared by the PR
// layer (pr.ts: one step) and the stack layer (stack.ts: a step per PR, branch or commit).

import { commitInfo, diff, git, revParse, tryGit, type Change, type ChangeType } from './git.ts';
import { snapshotOf, type Engine } from './layout.ts';
import type { TouchKind } from './overlay.ts';
import type { Snapshot } from './snapshot.ts';
import type { DotScene } from './dots.ts';
import { applyChanges, type Tree } from './tree.ts';

/** The default branch to compare against: origin's HEAD, else main or master. */
export function defaultBase(repo: string): string {
  const sym = tryGit(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])?.trim();
  if (sym) return sym.replace(/^refs\/remotes\//, '');
  for (const b of ['origin/main', 'origin/master', 'main', 'master']) if (tryGit(repo, ['rev-parse', '--verify', '--quiet', b + '^{commit}'])) return b;
  throw new Error('bubbles: no base branch found; pass --base');
}

/** Fetch a GitHub pull request's head into refs/bubbles/pr/N (works for any GitHub remote, no gh needed). */
export function fetchPr(repo: string, pr: number, remote = 'origin'): string {
  const ref = `refs/bubbles/pr/${pr}`;
  git(repo, ['fetch', '--quiet', '--no-tags', remote, `+refs/pull/${pr}/head:${ref}`]);
  return ref;
}

/** A GitHub pull request URL for `pr` on `remote`, when the remote is on github.com. */
export function prLink(repo: string, pr: number, remote = 'origin'): string | undefined {
  const url = tryGit(repo, ['remote', 'get-url', remote])?.trim();
  const m = url?.match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/pull/${pr}` : undefined;
}

/** Where a branch starts: the merge base of `baseRef` and commit `head`. */
export const mergeBase = (repo: string, baseRef: string, head: string) => git(repo, ['merge-base', revParse(repo, baseRef), head]).trim();

export const KIND: Record<ChangeType, TouchKind> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' };

/** "+12 −3" for a path in a diff's line counts, or '' when it has none. */
export function badgeOf(lines: Map<string, [number, number]>, path: string): string {
  const l = lines.get(path);
  return l ? `+${l[0]} −${l[1]}` : '';
}

export interface Step {
  snap: Snapshot;
  ids: number[];
  scene: DotScene;
  info: { sha: string; time: number; date: string; subject: string };
  changes: Change[];
  lines: Map<string, [number, number]>; // lines added and removed per path
}

/**
 * One more layout step on the engine: `tree` (the files as of commit `from`) is brought to commit `to` by
 * their diff, and the engine lays it out. Changes `tree` and the engine's layout memory, so steps chain.
 */
export function stepTo(e: Engine, tree: Tree, from: string, to: string, label = to.slice(0, 7)): Step {
  const { changes, lines } = diff(e.repo, from, to);
  applyChanges(tree, changes);
  if (!tree.files.size) throw new Error(`bubbles: ${label} has no files`);
  const { snap, ids } = snapshotOf(tree, e.name);
  const scene = e.dots.step(snap, ids);
  return { snap, ids, scene, info: commitInfo(e.repo, to), changes, lines };
}
