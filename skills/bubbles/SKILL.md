---
name: bubbles
description: Draw a stable spatial map of a git repository (files as dots, folders as nested cells) and overlay data on it, such as the files a pull request or branch changes, or a stack of PRs with a slider. Use when asked to map, visualise or picture a codebase, or to show where a PR, a stack of PRs, a branch or set of files sits in it.
---

# Bubbles: a code map

A code map is a picture of a repository that holds still as the code grows. Every file is a dot (bigger
files make bigger dots) and every folder is the cell grown around its files, so subfolders sit inside their
parents. The layout is replayed from the repository's first-parent history, keeping every file where it was
and putting new files at the nearest free spot in their folder, so the same file is in the same place on
every map you draw of that repo. That makes it a base map: other data goes on top as an overlay.

Its colours hold still too. Each top-level folder, and each folder one level inside it, has a colour that
comes from its path alone (deeper folders share their second-level folder's colour, files their folder's,
root files are grey). So a folder is the same colour at every commit, in `map`, `pr`, `stack` and `--path`
maps alike, in light and dark themes. With nothing marked, the legend lists the biggest of these districts.

## Find the tool

The tool is `bubbles.ts` (Node 22.18 or newer, plus git; no install). Use the first of these that exists:

1. `bubbles.ts` in the same folder as this SKILL.md.
2. `~/.cache/bubbles/skills/bubbles/bubbles.ts`. If it is missing, run
   `git clone --depth 1 https://github.com/nateroling/bubbles ~/.cache/bubbles`; if it is there but older than a
   week, `git -C ~/.cache/bubbles pull --ff-only`.

Below, `bubbles` means `node <that path>`. Check `node --version` first; older Node cannot run `.ts` files.

## Commands

```sh
bubbles map    [repo] [--ref REF] [--title T] [--overlay FILE] [--out FILE]...  # the map at a commit (default HEAD)
bubbles pr     [repo] --pr N [--base REF] [--title T] [--link URL] [--out FILE]...   # a GitHub PR
bubbles pr     [repo] --head REF [--base REF] [--out FILE]...           # any branch or commit
bubbles stack  [repo] --pr N[=TITLE] --pr N[=TITLE]... [--base REF] [--title T] [--out FILE]...  # a stack of PRs
bubbles stack  [repo] --head REF[=TITLE]... [--base REF] [--out FILE]...  # a stack of branches or commits
bubbles stack  [repo] --commits A..B [--out FILE]...                      # each commit in A..B is a step
bubbles render MAP.json [--overlay FILE] [--out FILE]...                # draw a saved map with an overlay
```

`map` and `pr` also take `--path DIR` (map one folder) and `--color PATTERN=COLOR[=LABEL]` (repeatable).

## Reading a request

Requests come in plain words, like "/bubbles src and make storybook files green". Turn them into options:

- A folder ("src", "the api package") is `--path src`. A folder map is exactly that folder's part of the
  whole-repo map (every folder is laid out on its own and only moves as a whole), moved so the folder sits at
  its own origin. It looks the same as in the full map, and holds still even when the folder shifts there.
- "Make X files COLOR" is `--color 'PATTERN=COLOR=Label'`, one per kind of file, first match wins. Pick globs
  that fit the repo; look at its file names first (`git ls-files | grep -i story | head`). Examples:
  storybook files `'*.stories.*=green=Stories'` plus `'.storybook/=green=Stories'`; tests `'*.test.*=blue=Tests'`,
  `'*_test.go=blue=Tests'`, `'**/tests/**=blue=Tests'`; config `'*.{json,yml,yaml,toml}=gray=Config'`;
  docs `'*.md=purple=Docs'`; a folder `'src/api/=orange=API'`.
- Colour names red, orange, yellow, green, teal, blue, purple, pink, brown and gray use the page's theme-aware
  versions; any other CSS colour (`#7048e8`) is used as is. Everything not coloured fades into the background.
- A PR ("show PR 123 in src/api") combines: `pr --pr 123 --path src/api`. PR marks win over colour rules.

- A stack ("show what my stack of PRs 101-110 does", "step through these branches") is `stack`, with
  `--pr` or `--head` once per step, bottom of the stack first. The page has a slider across the stack: at
  each step the files that step touches light up brightly, files touched by earlier steps stay dimly lit
  (only files light up, not folders); added files appear and deleted ones become dashed
  outlines. It opens on the last step; Play steps through from the base. Add `=TITLE` to name a step
  (`--pr '101=Add the parser'`); without it a step is named after its head commit's subject, so pass PR
  titles when you know them. `--pr` fetches each PR as `pr` does and links it on GitHub. The base defaults
  to origin's default branch; the stack starts from its merge base with the first step. Each step's
  changes are the diff from the step before, so the steps should build on each other (a warning says
  when one does not). `--commits A..B` makes each first-parent commit in the range a step; use it for a
  local stack of commits, or to show a run of history. At most 60 steps.
- In a stack nothing moves while you slide: the base is the base map, and every file keeps the spot it
  had when it first appeared (a file a step adds goes where the layout puts it as of that step, or the
  nearest free spot to it). A step's frame depends only on the steps up to it.
- `--out` picks the format from the extension: `.html` is an interactive page (pan, zoom, hover, a list of
  marked files; one self-contained file with the map and layers baked in), `.svg` is a static picture,
  `.json` is the map data (plus the overlay for `pr`). Repeat `--out` to write several. Always pass `--out`
  with a path in a scratch or output folder; never write into the user's repo.
- `--artifact` writes `.html` as the body of a claude.ai Artifact (no doctype, html, head or body tags; the
  Artifact host adds them). `--page-title` sets the page's `<title>`; the default is already a short name
  such as "ripgrep PR 2483" or "ripgrep code map".
- `pr --pr N` fetches `refs/pull/N/head` from `origin` into `refs/bubbles/pr/N` (no `gh` needed; `--remote`
  picks another remote). `--base` defaults to origin's default branch. The map is the base map at the merge
  base, with the branch's changes applied: added files get a spot, modified files are lit, deleted files
  stay as dashed ghosts where they were, files moved to another folder get an arc from their old spot. Pass
  the PR's title with `--title` and its URL with `--link` when you know them.
- `--every week|day|commit` sets how often the replay takes a layout step (default `week`: the last commit of
  each calendar week). Keep the default unless asked: maps made with different settings don't line up.
- The replay state is cached in the repo's git directory under `bubbles/` (never in the work tree), so the
  second map of a repo takes a moment. `--no-cache` skips it. A cached map is identical to an uncached one.
- First run on a big repo replays its whole history: about 1 s per 100 weekly steps on a repo of a few
  hundred files. Tell the user if it will take a while. Very large repos (tens of thousands of files) will be
  slow and the page heavy; say so rather than waiting silently.
- The repo must have its history: a shallow clone maps only what it has. Run `git fetch --unshallow` first
  if the user agrees.

## Overlays

An overlay is JSON. Everything is optional; paths are repo-relative, as in the map.

```json
{
  "title": "Hot spots",
  "subtitle": "Files with the most commits this quarter",
  "link": "https://example.com/report",
  "dim": true,
  "files": {
    "src/main.rs": { "tone": "hot", "label": "main.rs", "badge": "42 commits", "note": "tooltip line", "group": "hottest" },
    "src/lib.rs": { "color": "#7048e8", "badge": "17 commits" }
  },
  "rules": [{ "match": "*.stories.*", "color": "green", "label": "Stories" }],
  "ghosts": [{ "path": "old/gone.rs", "x": 3.2, "y": -1.5, "r": 0.6, "tone": "deleted" }],
  "arcs": [{ "from": "src/main.rs", "to": "src/lib.rs", "tone": "cool", "width": 2, "note": "calls" }],
  "legend": [{ "tone": "hot", "label": "most commits" }],
  "stack": {
    "unit": "PR",
    "steps": [{ "label": "#101", "title": "Add the parser", "link": "https://...", "counts": { "added": 2 } }],
    "files": { "src/parse.rs": { "touches": [{ "step": 1, "kind": "added", "badge": "+120 −0" }] } },
    "frames": { "files": { "src/parse.rs": [[0], [1, 4.2, -3.1, 0.8]] }, "folders": { "src": [[1, [[0, 0, 4, 0, 4, 3]]]] } },
    "start": 1
  }
}
```

- `tone` is a theme-aware colour: `added`, `modified`, `deleted`, `renamed`, `hot`, `warm`, `cool`, `muted`,
  or a colour name (red, orange, yellow, green, teal, blue, purple, pink, brown, gray). `color` takes any CSS
  colour instead (colour names still get the theme-aware version).
- `rules` colour every file whose path matches a glob; the first match wins, and `files` entries win over
  rules. A pattern without a slash matches file names anywhere (`*.stories.*`, `Cargo.toml`); with a slash it
  matches the repo-relative path (`src/**/*.test.ts`); a trailing slash means a folder and everything in it
  (`docs/`). `*` stays in one folder, `**` crosses folders, `?` is one character, `{a,b}` is either.
  `--color` adds rules from the command line.
- Marked files are drawn on top with a ring and listed beside the map, grouped by `group` (default: the
  tone's name), with `badge` on the right. `label` names the dot when zoomed in.
- `dim` fades the base map (default: on whenever the overlay marks anything).
- Ghosts are for files that are not on the map; they need a position, so they mostly come from `pr`.
- Arc ends are file paths (on the map or a ghost) or `[x, y]` points.
- `stack` turns the page into a slider over `steps` (step 0 is the base, step k is `steps[k-1]`). A file in
  `files` lights up at each step that touches it (`kind`: added, modified, deleted, renamed) and stays
  dimly lit after; `start` is the step the page opens on (default: the last). `frames` say how the map
  differs at each step from the map it is drawn on: for a file `[step, x, y, r]` (there from that step
  on) or `[step]` (gone from that step on); for a folder `[step, rings]` (rings as in the map's `outline`) or `[step]`. Without frames,
  every file is where the map has it at every step. `bubbles stack --out stack.json` writes the map and a
  full stack overlay to start from. The map is drawn at night (dark, in either theme) so the lights read.

To build your own layer: run `bubbles map --out map.json`, read the `files` array for paths and positions,
write an overlay, then `bubbles render map.json --overlay overlay.json --out page.html`. `pr` and `map`
also take `--overlay`, merged over their own marks.

## The map file (`bubbles/1`)

```
{ format, repo, commit, date, subject, every, params, bounds: [x0, y0, x1, y1],
  root, origin,                                                // only for a --path map: the folder, and its anchor
                                                               // in the whole-repo map (subtracted from every x, y)
  files:   [{ path, x, y, r, size }],                          // sorted by path; y points down
  folders: [{ path, depth, files, outline: [[x0, y0, x1, y1, ...], ...], bbox, label: [x, y] }] }
```

Units are arbitrary but stable; the root (or, for a `--path` map, the folder) is pinned at (0, 0), and in a
`--path` map `depth` counts from the folder (depth 1). A folder's `outline` rings are filled with the
even-odd rule; `label` is the top of its cell. Parents come before children in `folders`.

## Delivering the result

By default, publish the map as an Artifact:

1. Run the command with `--artifact --out <scratch dir>/<name>.html`.
2. Publish that file with the Artifact tool: icon `map`, and a one-sentence description such as "ripgrep
   PR 2483 on its code map: 2 files added, 17 modified." The page is self-contained, so it needs no other files.
3. Give the user the link and say in a line what is marked. For a PR, mention any deleted or moved files,
   since those are the ghosts and arcs on the map. For a stack, say how many steps and files, and that the
   slider (or Play, or the arrow keys) steps through it.

Write a local file instead (no `--artifact`, `--out` where the user wants it) when the user asks for a file,
wants the `.svg` or `.json`, or there is no Artifact tool. A page without `--artifact` opens straight from disk.

## As a building block

Other skills can use bubbles as one step: `map --out map.json` (or `pr --out pr.json`) gives positions and
folder outlines to compute on, and `render map.json --overlay layer.json` draws any layer on the same map.
Keep the map settings at their defaults so maps from different runs line up.
