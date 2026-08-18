# Claude Chat Index - Reference Guide

This file contains reference information for using the Claude Chat Index plugin effectively.

## Use Cases

### 1. Resume Interrupted Work

When you need to continue a conversation from Claude Code that was interrupted:

```bash
# Step 1: Find the conversation
node .github/plugins/claude-chat-index/src/cli.js search <topic>

# Step 2: Absorb the context
node .github/plugins/claude-chat-index/src/cli.js absorb <number>

# Step 3: Use in Hermes with continuation prompt
```

### 2. Cross-Reference Previous Solutions

When encountering a similar problem:

```bash
# Search for related solutions
node .github/plugins/claude-chat-index/src/cli.js search "migration entities"
node .github/plugins/claude-chat-index/src/cli.js search "rebase conflicts"
node .github/plugins/claude-chat-index/src/cli.js search "kvstore"
```

### 3. Audit Conversation History

When you need to understand what work was done:

```bash
# List all recent conversations
node .github/plugins/claude-chat-index/src/cli.js list

# Filter by project
node .github/plugins/claude-chat-index/src/cli.js search airthings
node .github/plugins/claude-chat-index/src/cli.js search famis360
```

## Integration Patterns

### With Hermes Agent

1. **Load the skill**: `skill_view(name='claude-chat-index')`
2. **Use natural commands**:
   - "Listar conversas do Claude Code"
   - "Buscar conversas sobre [termo]"
   - "Absorver conversa [numero]"

### With Other Skills

- **tickets**: Create ClickUp tasks based on absorbed conversation findings
- **plan**: Generate action plans from absorbed context
- **hermes-agent**: Configure Hermes based on lessons learned

## Output Format

The `absorb` command outputs structured context:

```
=== CONTEXTO DA CONVERSA CLAUDE PARA HERMES ===
Session ID: <uuid>
Projeto: <path>
Título: <conversation summary>
Período: <start> até <end>
Total de mensagens: <count>
=== CONTEÚDO DA CONVERSA ===

<message 1>

---

<message 2>
...
=== FIM DO CONTEXTO ===
```

## Common Search Terms

Based on project history:

| Term | Typical Use |
|------|-------------|
| `rebase` | Git conflict resolution |
| `migration` | Entity migration workflows |
| `airthings` | Airthings connector work |
| `entities` | Entity definition and mapping |
| `kvstore` | Key-value store implementation |
| `provision` | Provisioning workflows |
| `webhook` | Webhook handling |
| `place-mapping` | Legacy place mapping |

## Troubleshooting

### "Nenhuma conversa encontrada"

**Cause**: No conversations in history or search term doesn't match.

**Solution**: 
1. Use `list` to see all available conversations
2. Try broader search terms
3. Verify Claude Code was used (`~/.claude/history.jsonl` exists)

### "Arquivo de histórico não encontrado"

**Cause**: Claude Code hasn't been used yet or history file was deleted.

**Solution**: Use Claude Code at least once to create the history file.

### Wrong conversation absorbed

**Cause**: Index mismatch between list and absorb.

**Solution**: Both commands now sort by most recent first, so indices should match. Always verify with `list` first.

## Performance Notes

- **List**: Fast (<1s for 50+ conversations)
- **Search**: Fast, filters in-memory
- **Absorb**: Fast, outputs full conversation text

## Data Privacy

- All processing is local
- No data sent externally
- Reads only `~/.claude/history.jsonl`
- No cache or persistence beyond session

## Version History

### v1.0.0
- Initial release
- List, search, absorb commands
- Structured output format
- Portuguese language support
