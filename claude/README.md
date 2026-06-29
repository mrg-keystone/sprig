# claude/ — Claude Code assets shipped by sprig

Everything under this folder is deployed into the user's **`~/.claude`** scope by
`sprig install` / `sprig update` (and `deno task install:dev` from a checkout). It
rides inside the runtime bundle (see `.github/workflows/release.yml`) and is installed
by `framework/.sprig/skills.ts`.

Two siblings, each installed with the same base-level (whole-entry) replace keyed by
name — an entry that already exists is replaced outright; unrelated entries are left
untouched; new ones are created. A destination holding a `.git` checkout is never
clobbered (so a dev symlink survives).

| source            | installs to                                  | unit            |
| ----------------- | -------------------------------------------- | --------------- |
| `claude/skills/`  | `${CLAUDE_SKILLS_DIR:-~/.claude/skills}`     | one **folder** per skill (needs `SKILL.md`) |
| `claude/agents/`  | `${CLAUDE_AGENTS_DIR:-~/.claude/agents}`     | one **`.md` file** per subagent             |

Notes:

- **Skills** are folders. Each top-level dir under `claude/skills/` must contain a
  `SKILL.md` (the `interfaces/` shared-contracts sibling is the one exception — it is
  carried wholesale so each skill resolves `../interfaces/<artifact>.md`).
- **Agents** are flat markdown files. Claude Code only discovers `~/.claude/agents/*.md`
  (one subagent per file, frontmatter `name`/`description`/`tools`), so drop agent
  definitions directly in `claude/agents/` as `<name>.md`.
- Dotfiles (e.g. `.gitkeep`) are skipped by the installer; this README lives one level
  up so it is never copied into either destination.
