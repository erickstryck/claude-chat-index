# Claude Chat Index — Reference Guide

This file contains reference information for using the Claude Chat Index plugin effectively.

All examples use the installed `claude-chat` command (or `hermes claude-chat` when the
plugin is enabled). The plugin only reads `~/.claude/history.jsonl`.

## Use Cases

### 1. Resume Interrupted Work

When you need to continue a conversation from Claude Code that was interrupted:

```bash
# Step 1: Find the conversation
claude-chat search <topic>

# Step 2: Emit the full context
claude-chat absorb <number>

# Step 3: Feed that block as input context to the next Hermes task
```

### 2. Cross-Reference Previous Solutions

When encountering a similar problem:

```bash
claude-chat search "migration"
claude-chat search "rebase"
claude-chat search "config"
```

### 3. Audit Conversation History

When you need to understand what work was done:

```bash
claude-chat list
claude-chat search <project-or-topic>
```

## Integration Patterns

### With Hermes Agent

1. **Load the skill**: `skill_view(name='claude-chat-index')`
2. **Use natural commands**:
   - "List Claude Code conversations"
   - "Search conversations about [term]"
   - "Absorb conversation [number]"

### With Other Tools

The `absorb` block is plain text — pipe it into any tool that accepts an input context
(other agent session, LLM prompt, note file you write yourself, etc.).

## Output Format

The `absorb` command outputs structured context:

```
=== CLAUDE CONVERSATION CONTEXT FOR HERMES ===
Session ID: <uuid>
Project: <path>
Title: <conversation summary>
Period: <start> to <end>
Total messages: <count>
=== CONVERSATION CONTENT ===

<message 1>

---

<message 2>
...
=== END OF CONTEXT ===
```

## Common Search Terms

Examples of the kinds of terms that match well (case-insensitive, matched against
title, project path, and message text):

| Term | Typical Use |
|------|-------------|
| `rebase` | Git conflict resolution |
| `migration` | Data/entity migration workflows |
| `config` | Configuration changes |
| `test` | Test runs and fixes |
| `deploy` | Deployment steps |

## Troubleshooting

### "No conversation found"

**Cause**: No conversations in history, or the search term doesn't match.

**Solution**:
1. Use `list` to see all available conversations
2. Try broader search terms
3. Verify Claude Code was used (`~/.claude/history.jsonl` exists)

### "History file not found"

**Cause**: Claude Code hasn't been used yet or the history file was deleted.

**Solution**: Use Claude Code at least once to create the history file.

### Wrong conversation absorbed

**Cause**: Index mismatch between `list` and `absorb`.

**Solution**: Both commands sort by most recent first and print the **global** index,
so the number from `search`/`list` works directly with `absorb`. Verify with `list` first.

## Performance Notes

- **List**: Fast (<1s for 50+ conversations)
- **Search**: Fast, in-memory filter
- **Absorb**: Fast, emits full conversation text (tool output is capped at 12k chars)

## Data Privacy

- All processing is local
- No data is sent externally (no network calls of any kind)
- Reads only `~/.claude/history.jsonl`
- No cache or persistence beyond the current run

See `SECURITY.md` for the full security posture and scanner notes.

## Version History

### v1.0.0
- Initial release
- `list`, `search`, `absorb` commands
- Structured output format
- Python entrypoint: `hermes claude-chat` CLI + `claude_chat` agent tool