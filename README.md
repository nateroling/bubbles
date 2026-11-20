# bubbles

A stable, spatial map of a git repository. Every file is a dot (bigger files make bigger dots) and every
folder is the cell grown around its files, so subfolders sit inside their parents. The layout is replayed
from the repository's history and holds still as the code grows: files keep their places, and new files
take the nearest free spot in their folder. That makes it a base map that other data can be drawn on, such
as the files a pull request changes.

It is a Claude Code skill (`SKILL.md`) and a command-line tool (`bubbles.ts`). Node 22.18+ and git; no
dependencies, nothing to install.

Demo: ripgrep PR #2483 on its map, https://claude.ai/artifact/CWN6z14TETzgAn7XmXonJ4

## Install the skill

```sh
git clone https://github.com/nateroling/bubbles ~/.claude/skills/bubbles
```

Or save `SKILL.md` alone as a skill: when `bubbles.ts` is not beside it, it clones this repo to
`~/.cache/bubbles` and runs from there.

## Use it directly

```sh
node bubbles.ts map    [repo] [--ref REF] [--overlay FILE] [--out FILE]...
node bubbles.ts pr     [repo] (--pr N | --head REF) [--base REF] [--title T] [--link URL] [--out FILE]...
node bubbles.ts render MAP.json [--overlay FILE] [--out FILE]...
```

`--out` picks the format from its extension: `.html` (interactive page), `.svg` (static picture) or `.json`
(the map data). `--artifact` writes the HTML as the body of a claude.ai Artifact. See `SKILL.md` for every
option, the overlay format and the map format (`bubbles/1`).

## How it works

- `lib/git.ts`: the first-parent history and diffs, read with the git command line.
- `lib/tree.ts`: what exists at a commit; a renamed file keeps its identity.
- `lib/dots.ts`: the layout. Each folder lays out its own files (as one clump in the middle) and its
  subfolders (as rigid clusters on a ring, each at a fixed angle from its name) in its own frame, deepest
  first. Survivors keep their offsets; newcomers take the free spot nearest their folder's anchor; the root
  is pinned at the origin.
- `lib/layout.ts`: replays the layout at weekly checkpoints, caches the state in `.git/bubbles/`, and writes
  the map file: file positions and radii, folder outlines (`lib/contour.ts`).
- `lib/render.ts`: SVG and HTML, with overlays (per-file colour, label, badge and note; ghosts; arcs).
- `lib/pr.ts`: the pull request layer.

The layout core knows nothing about drawing, and the renderer only needs file positions and folder outlines,
so another stable layout (rectangles, say) could feed the same renderer and overlays.

`npm test` runs the tests. `NOTES.md` lists the judgment calls made along the way.

Started in [nateroling/layout](https://github.com/nateroling/layout), which holds the experiments that led
here (`src/nature/dots.ts` is the same layout engine).
