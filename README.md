# Claude Chat Index

A CLI plugin to **catalog, index, and retrieve Claude Code conversations** — built to integrate with the [Hermes Agent](https://hermes-agent.nousresearch.com/docs).

It lets you list Claude Code conversations ordered by date, search by term, and **absorb** the context of a specific conversation to continue the work in another agent (e.g. resume in Hermes from where Claude stopped).

- **Zero dependencies** — just Node.js (>= 18, uses native ESM)
- **100% local** — no data leaves the machine
- **Language**: output in en-US

---

## How it works (architecture)

```
┌─────────────────────────┐         ┌──────────────────────────────────┐
│  ~/.claude/history.jsonl │         │        claude-chat CLI           │
│  (written by Claude Code │ reads   │                                  │
│   on each user prompt)   │ ──────▶ │  loadHistory()  → parse JSONL    │
└─────────────────────────┘         │  groupBySession() → group        │
                                    │  by sessionId                    │
┌─────────────────────────┐         │  sort by lastSeen desc           │
│  ~/.claude/projects/**/  │ not     │                                  │
│  <sessionId>.jsonl       │ read    │  list / search / absorb          │
│  (full transcripts,      │ ◀────── │                                  │
│   incl. assistant        │         └──────────────────────────────────┘
│   responses)             │
└─────────────────────────┘
```

1. **Data source**: Claude Code writes each user prompt to `~/.claude/history.jsonl` (one JSON per line). The plugin reads **only** that file — see [Data schema](#data-schema).
2. **Grouping**: `groupBySession()` groups lines by `sessionId`, computing `firstSeen`/`lastSeen`, a message count, and a heuristic title (the first long message that does not start with `/`, truncated to 80 chars).
3. **Ordering**: all conversations are sorted by `lastSeen` descending (most recent first) **before** any filter — both in `list` and in `absorb`. The `[N]` index shown is always the position in that full list, so `absorb <N>` uses the same number printed by `list` or `search`.
4. **Output**: `absorb` emits a structured text block (with `===` markers) designed to be copied and pasted as context into another tool/LLM.

> **Important note**: `history.jsonl` contains only **user messages** (the prompts). Assistant responses live in the full transcripts at `~/.claude/projects/<project>/<sessionId>.jsonl` — that directory is **not** read by this plugin (see [Limitations](#limitations)).

## Project structure

```
claude-chat-index/
├── package.json               # npm manifest (type: module, bin: claude-chat)
├── plugin.yaml                # Hermes plugin manifest (install/update/enable)
├── __init__.py                # Python entrypoint: registers CLI `hermes claude-chat` + tool `claude_chat`
├── README.md                  # This documentation
├── EXAMPLE.md                 # End-to-end usage example (list → search → absorb)
├── src/
│   └── cli.js                 # Main CLI (the plugin itself — single file)
├── bin/
│   └── claude-chat            # Bash wrapper for the PATH (override: CLAUDE_CHAT_PLUGIN_DIR)
├── scripts/
│   └── verify-plugin.mjs      # 12 hermetic checks (fixture in a temporary $HOME)
└── docs/
    └── usage-guide.md         # Reference guide: use cases, integration patterns
```

### Anatomy of `src/cli.js`

| Function | Responsibility |
|----------|----------------|
| `loadHistory()` | Reads `~/.claude/history.jsonl`, parses line by line (tolerates corrupt lines) |
| `groupBySession(history)` | Groups by `sessionId`, builds metadata (title, period, messages) |
| `formatDate(ts)` | Relative date ("2 h ago") for < 7 days, `en-US` date after |
| `listSessions(query?)` | The `list` command (and the basis of `search`) — with an optional term filter |
| `searchSessions(query)` | The `search` command — a thin wrapper over `listSessions(query)` |
| `absorbSession(index)` | The `absorb` command — emits the structured context block |
| `main()` | Argument parser and command routing |

## Installation

### Via Hermes (recommended)

A single command installs **and enables** the plugin:

```bash
hermes plugins install erickstryck/claude-chat-index --enable
```

With `--enable`, the plugin registers two surfaces in Hermes:

- **Native CLI command** — `hermes claude-chat {list, search <term>, absorb <n>}`
- **Agent tool** — `claude_chat` (Hermes itself lists/searches/absorbs Claude Code conversations via a tool call, no terminal needed)

```bash
hermes claude-chat list
hermes claude-chat search rebase
hermes claude-chat absorb 1
```

The repo is **public**, so the `owner/repo` shorthand works directly,
with no SSH key or token (anonymous clone over HTTPS):

> Alternative: install by full URL —
> `hermes plugins install https://github.com/erickstryck/claude-chat-index.git --enable`.

To update in the future:

```bash
hermes plugins update claude-chat-index
```

### Globally via npm

```bash
git clone https://github.com/erickstryck/claude-chat-index.git
cd claude-chat-index
npm install -g .        # registers the `claude-chat` binary on the PATH
claude-chat --help
```

### Manual (no npm)

```bash
node /path/to/claude-chat-index/src/cli.js list
```

### Standalone wrapper (without the plugin enabled)

If you install **without** `--enable`, the `bin/claude-chat` (bash wrapper) still
exposes the `claude-chat` command on the PATH — just copy it to a directory on
your PATH (e.g. `~/.hermes/claude-chat`). The location override is the
`CLAUDE_CHAT_PLUGIN_DIR` environment variable.

### Hermes skill

With the plugin enabled, the corresponding skill (`claude-chat-index`) already
knows how to invoke `hermes claude-chat ...` — so natural commands work directly:
*"List Claude Code conversations"*, *"Search conversations about rebase"*,
*"Absorb conversation 2"*. The native command makes the `claude-chat` wrapper
on the PATH optional.

## Commands

### `claude-chat list`

Lists all conversations, most recent first.

```
================================================================================
CLAUDE CONVERSATIONS (5 found)
================================================================================

[1] a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
    Title: create a script that exports the monthly report as CSV...
    Project: my-project
    Messages: 5
    Last activity: 13 h ago
    Last access: 08/17/2026, 8:17:50 PM
...
```

> Synthetic example (fictional data).

### `claude-chat search <term>`

Searches by term (case-insensitive) across three fields: **title**, **project path**, and **message content**.

The `[N]` number shown is the **position in the full list** (recency-sorted), **not** in the filtered list — so the same number that appears in a `search` works directly with `absorb <N>`.

```bash
claude-chat search rebase
claude-chat search config
```

### `claude-chat absorb <number>`

Emits the full context of conversation number `<number>` (same numbering as `list`) in a format ready to use as input context in another task/agent:

```
=== CLAUDE CONVERSATION CONTEXT FOR HERMES ===
Session ID: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
Project: /home/dev/projects/my-project
Title: create a script that exports the monthly report as CSV...
Period: 07/17/2026, 9:35:01 AM to 07/17/2026, 1:22:51 PM
Total messages: 55
=== CONVERSATION CONTENT ===

<message 1>

---

<message 2>
...
=== END OF CONTEXT ===

Tip: this block is formatted for use as input context in another Hermes task.
```

> Synthetic example (fictional data).

### Typical flow

```bash
claude-chat search "entity migration"   # 1. find the right conversation
claude-chat absorb 2                     # 2. generate the context
# 3. use the block as input context in another tool/LLM:
#    "I need to resume a Claude conversation. Here is the context: ...
#     Continue from where we left off: [what is needed]"
```

## Data schema

Source: `~/.claude/history.jsonl` — one JSON per line, **one line per user prompt**:

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `string` (UUID) | Conversation identifier. The plugin groups by this. |
| `project` | `string` | Absolute path of the project directory. |
| `timestamp` | `number` | Epoch in **milliseconds** (UTC). |
| `display` | `string` | Text of the user prompt. |
| `pastedContents` | `object?` | Pasted/expanded content (e.g. `@file`), optional — not used by the plugin. |

Example (synthetic values):

```json
{"sessionId":"a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d","project":"/home/dev/projects/my-project","display":"create a script that exports the monthly report...","timestamp":1786102110312,"pastedContents":{}}
```

Lines that fail `JSON.parse` are **ignored** (the history is append-only and can contain residue).

## Verification / tests

The `scripts/verify-plugin.mjs` script runs 10 ad-hoc checks (file existence, running the 3 commands, the `absorb` output structure, error on an invalid index). It locates the CLI automatically relative to its own position in the repo, or use the `PLUGIN_PATH` variable to point at another installation:

```bash
node scripts/verify-plugin.mjs
# or:
PLUGIN_PATH=/path/to/other/src/cli.js node scripts/verify-plugin.mjs
```

Prerequisites: Claude Code has been used at least once (`~/.claude/history.jsonl` exists with at least 1 conversation) and `node` is on the PATH.

## Limitations

- **User messages only**: `history.jsonl` does not contain Claude's responses. For the full transcript (user + assistant), read `~/.claude/projects/<slugified-project>/<sessionId>.jsonl` — a natural future extension of this plugin.
- **One prompt = one "message"**: there is no granularity for tool turns / inside the session.
- **Heuristic title**: the first short message (or one that starts with `/`, like slash-commands) does not become a title; the conversation shows up as "(untitled)".
- **No cache**: everything is re-read from disk on every run (fast for hundreds of conversations; check performance before using with histories of tens of thousands of lines).
- The `~/.claude/sessions/` directory is cited in the manifest but not read by the current code.

## Privacy

All processing is local. The plugin **does not** send anything over the network, does not write files, and keeps no cache.

## Development

```bash
git clone https://github.com/erickstryck/claude-chat-index.git && cd claude-chat-index
npm link            # development: claude-chat binary points at the checkout
node scripts/verify-plugin.mjs   # validate after changes
```

To publish: `npm publish --access public` (the package is ready — `bin: claude-chat`).

## License

[MIT](LICENSE)