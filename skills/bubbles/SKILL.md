---
name: bubbles
description: Draw a stable spatial map of a git repository (files as dots, folders as nested cells) and overlay data on it, such as the files a pull request or branch changes. Use when asked to map, visualise or picture a codebase, or to show where a PR, branch or set of files sits in it.
---

# Bubbles: a code map

A code map is a picture of a repository that holds still as the code grows. Every file is a dot (bigger
files make bigger dots) and every folder is the cell grown around its files, so subfolders sit inside their
parents. The layout is replayed from the repository's first-parent history, keeping every file where it was
and putting new files at the nearest free spot in their folder, so the same file is in the same place on
every map you draw of that repo. That makes it a base map: other data goes on top as an overlay.

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
  "legend": [{ "tone": "hot", "label": "most commits" }]
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
   since those are the ghosts and arcs on the map.

Write a local file instead (no `--artifact`, `--out` where the user wants it) when the user asks for a file,
wants the `.svg` or `.json`, or there is no Artifact tool. A page without `--artifact` opens straight from disk.

## As a building block

Other skills can use bubbles as one step: `map --out map.json` (or `pr --out pr.json`) gives positions and
folder outlines to compute on, and `render map.json --overlay layer.json` draws any layer on the same map.
Keep the map settings at their defaults so maps from different runs line up.
