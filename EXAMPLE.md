# Usage Example: Claude Chat Index

This file demonstrates how to use the `claude-chat-index` plugin to retrieve Claude Code conversations in the Hermes Agent.

> **Note:** all outputs below are **synthetic** (fictional example data).

## Scenario: Resuming a conversation about a rebase

### Step 1: List recent conversations

```bash
claude-chat list
```

**Expected output:**
```
================================================================================
CLAUDE CONVERSATIONS (12 found)
================================================================================

[1] a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
    Title: resolve the conflicts that showed up when I rebased with main...
    Project: my-project
    Messages: 41
    Last activity: 1 min ago
    Last access: 07/17/2026, 3:35:29 PM

[2] f0e1d2c3-b4a5-4968-8776-655443322110
    Title: create an md for me with everything needed to build the migration flow...
    Project: my-project
    Messages: 5
    Last activity: 2 h ago
    Last access: 07/17/2026, 1:21:15 PM
...
```

### Step 2: Search conversations by term (optional)

```bash
claude-chat search config
```

**Expected output:**
```
================================================================================
CLAUDE CONVERSATIONS (3 found)
================================================================================

[1] a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
    Title: resolve the conflicts that showed up when I rebased with main...
    Project: my-project
...
```

### Step 3: Absorb the conversation into Hermes context

```bash
claude-chat absorb 1
```

**Expected output:**
```
=== CLAUDE CONVERSATION CONTEXT FOR HERMES ===
Session ID: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
Project: /home/dev/projects/my-project
Title: resolve the conflicts that showed up when I rebased with main...
Period: 07/16/2026, 11:01:37 AM to 07/17/2026, 3:35:29 PM
Total messages: 41
=== CONVERSATION CONTENT ===

resolve the conflicts that showed up when I rebased with main

---

the sdk must always be kept on the latest version

---

create the sessions for the entities in @/home/dev/projects/my-project/src/ui/index.tsx...
...
=== END OF CONTEXT ===
```

### Step 4: Use the context in Hermes

Use the block from Step 3 as input context in Hermes:

```
I need to resume a Claude conversation about a rebase and a migration.

Here is the context of the previous conversation:

[PASTE THE STEP 3 OUTPUT HERE]

Continuing: I need to proceed with the next step of the flow.
```

## Available Commands

| Command | Description |
|---------|-------------|
| `list` | Lists all conversations (most recent first) |
| `search <term>` | Searches conversations by term |
| `absorb <number>` | Absorbs a conversation into the context |
| `--help` | Shows help |

## Usage Examples

### List all conversations
```bash
claude-chat list
```

### Search for "migration"
```bash
claude-chat search migration
```

### Absorb conversation 3
```bash
claude-chat absorb 3
```

## Integration with Hermes

With the plugin enabled, there is also the native command and the tool:

```bash
hermes claude-chat list
hermes claude-chat search config
hermes claude-chat absorb 1
```

Or via the `claude_chat` tool (invoked by the agent itself).

## Notes

- Conversations are listed by last-activity date (most recent first)
- The index shown is **global** (position in the full list), so the number from `search` is the same one accepted by `absorb`
- The `absorb` output is formatted to be easily copied and used in Hermes