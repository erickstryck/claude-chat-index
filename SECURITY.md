# claude-chat-index Security

## What this plugin does (and what it does not)

| Action | Supported? | Where |
|--------|-----------|-------|
| Read `~/.claude/history.jsonl` (Claude Code's local history) | **Yes** | `src/cli.js` (`fs.readFileSync` / `fs.existsSync`) |
| Write any file | **No** | — |
| Make any network request (http, https, dns, socket) | **No** | — |
| Create subprocesses | **Yes** | `__init__.py` — a **single** `subprocess.run` (see below) |
| Read environment variables | **Yes** | `HOME` (to find the history), `CLAUDE_CHAT_PLUGIN_DIR` (location override) |
| Keep a cache or state between runs | **No** | — |

## The only subprocess

`__init__.py` invokes the Node CLI to run the `list` / `search` / `absorb` commands:

```python
subprocess.run(
    ["node", str(_cli_js()), *cli_args],
    capture_output=True, text=True, timeout=timeout,
)
```

Security characteristics:

- **No shell** — the call is a list of arguments (not `shell=True`), so there is no shell injection via `cli_args`.
- **Fixed target** — always `node` + the `src/cli.js` **of this installation** (via `Path(__file__).parent`); `node` is resolved from PATH with `shutil.which`.
- **Timeout** — 60 s per call.
- `src/cli.js` (what is executed) only imports `fs.readFileSync` / `fs.existsSync` and `path` — there is **no** `http`, `net`, `child_process`, `fetch`, `exec` or `spawn` in that file.

## What the plugin reads and where it goes

- **Reads**: `~/.claude/history.jsonl` (one JSON per line — user prompt, project, timestamp).
- **Emits**: text on `stdout` (CLI) or in the tool result (Hermes). **No output leaves the machine** — the result goes only to the operator's terminal or to the context of the local agent's own session.

## Auditing

- `node scripts/verify-plugin.mjs` — 12 hermetic tests (fixture in a temporary `$HOME`).
- The repository is public; any change to `main` goes through a PR with 1 approval (ruleset `protect-main`).
- Security issues: open an **issue** in the repository (do not commit anything sensitive in public PRs).

## Note on security scanners

Installers with scanning (e.g. the Hermes Agent one) may flag:

- `execution` in `__init__.py` (the `subprocess.run` above) — **expected and documented** here; it is the mechanism by which the plugin exposes the CLI to Hermes.
- `supply_chain` on `git clone` / `npm install` instructions in the README — these are installation instructions, not code executed by the plugin.
- `exfiltration` / `persistence` in documentation sentences — text heuristics; the code contains no exfiltration instruction and does not alter any persistence settings.

None of these findings corresponds to actual plugin behavior, per the table above.