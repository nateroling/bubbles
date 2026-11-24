# bubbles

A stable, spatial map of a git repository. Every file is a dot (bigger files make bigger dots) and every
folder is the cell grown around its files, so subfolders sit inside their parents. The layout is replayed
from the repository's history and holds still as the code grows: files keep their places, and new files
take the nearest free spot in their folder. That makes it a base map that other data can be drawn on, such
as the files a pull request changes.

It is a Claude Code plugin with one skill (`skills/bubbles/SKILL.md`) and a command-line tool
(`skills/bubbles/bubbles.ts`). Node 22.18+ and git; no
dependencies, nothing to install.

Demo: ripgrep PR #2483 on its map, https://claude.ai/artifact/CWN6z14TETzgAn7XmXonJ4
Stack demo: ten ripgrep commits as a stack, with a slider, https://claude.ai/artifact/Wz7ZdrKs1B3B8ytbWumqDN

## Install

As a Claude Code plugin (updatable):

```
/plugin marketplace add nateroling/bubbles
/plugin install bubbles@bubbles
```

Get new versions with `/plugin marketplace update bubbles`, or turn on auto-update for the marketplace in
`/plugin`. The skill shows up as `bubbles:bubbles`.

Or as a plain skill, without the plugin system:

```sh
git clone https://github.com/nateroling/bubbles ~/src/bubbles
ln -s ~/src/bubbles/skills/bubbles ~/.claude/skills/bubbles   # update with: git -C ~/src/bubbles pull
```

Or save `skills/bubbles/SKILL.md` alone as a skill: when `bubbles.ts` is not beside it, it clones this repo
to `~/.cache/bubbles` and runs from there.

## Use it directly

```sh
node skills/bubbles/bubbles.ts map    [repo] [--ref REF] [--overlay FILE] [--out FILE]...
node skills/bubbles/bubbles.ts pr     [repo] (--pr N | --head REF) [--base REF] [--title T] [--link URL] [--out FILE]...
node skills/bubbles/bubbles.ts stack  [repo] (--pr N[=TITLE]... | --head REF[=TITLE]... | --commits A..B) [--base REF] [--out FILE]...
node skills/bubbles/bubbles.ts render MAP.json [--overlay FILE] [--out FILE]...
```

`--out` picks the format from its extension: `.html` (interactive page), `.svg` (static picture) or `.json`
(the map data). `--artifact` writes the HTML as the body of a claude.ai Artifact. See `SKILL.md` for every
option, the overlay format and the map format (`bubbles/1`).

## How it works

All paths below are in `skills/bubbles/`.

- `lib/git.ts`: the first-parent history and diffs, read with the git command line.
- `lib/tree.ts`: what exists at a commit; a renamed file keeps its identity.
- `lib/dots.ts`: the layout. Each folder lays out its own files (as one clump in the middle) and its
  subfolders (as rigid clusters on a ring, each at a fixed angle from its name) in its own frame, deepest
  first. Survivors keep their offsets; newcomers take the free spot nearest their folder's anchor; the root
  is pinned at the origin.
- `lib/layout.ts`: replays the layout at weekly checkpoints, caches the state in `.git/bubbles/`, and writes
  the map file: file positions and radii, folder outlines (`lib/contour.ts`).
- `lib/overlay.ts`: the overlay model (per-file colour, label, badge and note; colour rules; ghosts; arcs; a
  stack), merging overlays, and turning rules into marks.
- `lib/svg.ts`: the map as SVG, and the theme tokens. `lib/page.ts`: the HTML page around it, with the
  browser scripts in `lib/browser/` (`map.js`: pan, zoom, hover, names; `stack.js`: the slider).
- `lib/groups.ts`: the base colours. A folder's colour comes from its path alone (a hash of its first two
  levels picks a hue and one of three lightnesses), so the same folder has the same colour on every map.
- `lib/change.ts`: what a branch changes, as one more layout step (shared by the PR and stack layers);
  finding the base branch, fetching a PR.
- `lib/pr.ts`: the pull request layer.
- `lib/stack.ts`: the stack layer: several PRs (or branches, or commits) in order, with a slider. Each one
  lights up the files it touches; they stay dimly lit after.

The layout core knows nothing about drawing, and the renderer only needs file positions and folder outlines,
so another stable layout (rectangles, say) could feed the same renderer and overlays.

`npm test` runs the tests. `NOTES.md` lists the judgment calls made along the way.

Started in [nateroling/layout](https://github.com/nateroling/layout), which holds the experiments that led
here (`src/nature/dots.ts` is the same layout engine).
