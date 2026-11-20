# Judgment calls (defaults made without asking; revisit)

- **Checkpoints = last commit of each calendar week (UTC, weeks from Monday)**, plus a final step on the
  commit asked for. Whether commit i is a checkpoint depends only on commits i and i+1, so the map of a commit
  never changes when later commits arrive. `--every day|commit` exists; maps made with different settings
  don't line up, so the default should rarely change. Weekly keeps ripgrep at ~300 steps (3 s).
- **Cache** in `<git common dir>/bubbles/`: the replay state (tree with file ids + Dot Cells memory) at the
  last checkpoint before the commit asked for, keyed by layout version, `every` and a hash of the params;
  the 12 newest kept. Resumes from the latest cached checkpoint on the commit's first-parent line. Tested to
  give byte-identical maps. Bump `LAYOUT_VERSION` in `lib/layout.ts` whenever the layout of a history changes.
- **Symlinks are dropped** (the experiments' extractor kept them as files); submodules too.
- **PR map** = the map at the merge base, then one more layout step on the branch head's tree. The page shows
  the head's files; unchanged files may nudge a little in that step (on ripgrep #2483, by ~0). Deleted files are
  ghosts at their merge-base spot. A rename gets an arc only when the file moved more than 1 unit (a rename
  within a folder keeps its spot). Line counts from `git diff --numstat`.
- **Base colours** are folder groups computed from the commit being drawn (as in the dots viewer), so a
  colour can change between commits even though positions don't. Alternative: a hue per top-level folder from
  its name (stable, and it would match the name-angle placement). With an overlay the base fades to ~40%.
- **Folder outlines** are traced (marching squares at ~1/400 of the folder's size, then simplified) from the
  same shape the viewer paints: dots grown one margin per level, plus bands between overlapping dots.
  Coordinates rounded to 0.01 in the JSON.
- **Renderer is SVG** (one code path for the static `.svg` and the page) rather than canvas. Fine up to a few
  thousand files; a 20k-file repo would want a canvas page.
- **Delivery** (Nate, 2026-11-20: publish a self-contained artifact by default): SKILL.md has Claude render with
  `--artifact` (the page body without a document skeleton, as the Artifact host wants) into a scratch folder
  and publish it with the Artifact tool; a local file only when asked, or with no Artifact tool. Plain
  (non-`--artifact`) HTML still opens from disk. Default `<title>`s are short names ("ripgrep PR 2483",
  "ripgrep code map"); `--page-title` overrides.
- **Installing**: SKILL.md looks for `codemap.ts` beside itself, else clones this repo to `~/.cache/bubbles`,
  so the same SKILL.md works copied into `~/.claude/skills/bubbles/` or saved as an account skill alone.
- **Folder maps (`--path`)** crop the whole-repo map rather than laying the folder out on its own. Every folder
  is laid out in its own frame and only moves as a whole inside its parent, so the crop is exactly the folder's
  region of the full map. It is then moved so the folder's anchor is at (0, 0), which also hides the folder
  drifting inside its parent: on ripgrep, over steps of 200 commits, files in crates/core move 2.0 units on the
  folder map against 4.8 on the full map. The cost is that the whole repo is still replayed. Folder depth is
  renumbered from the folder; base colours are worked out within the folder.
- **Colour rules** (`--color PATTERN=COLOR[=LABEL]`, overlay `rules`): gitignore-like globs; a pattern without a
  slash matches file names anywhere, a bare name with no wildcard also matches a folder of that name anywhere.
  First matching rule wins; explicit `files` marks (and PR marks) win over rules. Colour names (green, blue...)
  map to theme-aware palette colours rather than CSS's literal ones. Everything uncoloured fades, as for a PR.

