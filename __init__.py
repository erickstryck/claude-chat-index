"""claude-chat-index plugin — integrates the claude-chat CLI with the Hermes Agent.

Registers two surfaces when the plugin is enabled
(``hermes plugins install erickstryck/claude-chat-index --enable``):

* **CLI command** — ``hermes claude-chat {list, search <term>, absorb <n>}``
  Forwards to the Node CLI (``src/cli.js``), which reads
  ``~/.claude/history.jsonl`` (Claude Code's local history).

* **Agent tool** — ``claude_chat`` (action: list | search | absorb)
  Lets Hermes itself list/search/absorb Claude Code conversations
  directly via a tool call, without needing a terminal.

The plugin is a thin wrapper: all parse/grouping logic lives in
``src/cli.js`` (zero dependencies, 100% local). Nothing leaves the machine.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Locating the Node CLI (src/cli.js)
# ---------------------------------------------------------------------------

def _plugin_dir() -> Path:
    """The plugin directory (the repo IS the plugin: root == plugin dir).

    Overridden via CLAUDE_CHAT_PLUGIN_DIR for non-standard layouts
    (same convention as the bin/claude-chat wrapper).
    """
    override = os.environ.get("CLAUDE_CHAT_PLUGIN_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent


def _cli_js() -> Path:
    return _plugin_dir() / "src" / "cli.js"


def _check_requirements() -> bool:
    """Tool gate: only appears if `node` and the CLI exist."""
    return shutil.which("node") is not None and _cli_js().exists()


# ---------------------------------------------------------------------------
# CLI execution
# ---------------------------------------------------------------------------

def _run_cli(*cli_args: str, timeout: int = 60) -> tuple[bool, str, str]:
    """Runs the Node CLI and returns (ok, stdout, stderr)."""
    try:
        proc = subprocess.run(
            ["node", str(_cli_js()), *cli_args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode == 0, proc.stdout or "", proc.stderr or ""
    except subprocess.TimeoutExpired:
        return False, "", f"claude-chat {' '.join(cli_args)}: timeout after {timeout}s"
    except Exception as e:  # pragma: no cover — defensive
        return False, "", f"error running the CLI: {e}"


# ---------------------------------------------------------------------------
# Agent tool
# ---------------------------------------------------------------------------

def _json(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _err(message: str, **extra: Any) -> str:
    return _json({"success": False, "error": message, **extra})


CLAUDE_CHAT_SCHEMA: Dict[str, Any] = {
    "name": "claude_chat",
    "description": (
        "Catalog, search, and retrieve Claude Code conversations stored in "
        "~/.claude/history.jsonl. Actions: 'list' (all conversations, most "
        "recent first), 'search' (case-insensitive match over title, project "
        "path, and message text), 'absorb' (full formatted context block for "
        "conversation <index>). The index shown by list/search is global and "
        "works directly with absorb. 100% local — no data leaves the machine."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list", "search", "absorb"],
            },
            "query": {
                "type": "string",
                "description": "Search term (required when action=search).",
            },
            "index": {
                "type": "integer",
                "description": (
                    "1-based conversation index as printed by list/search "
                    "(required when action=absorb)."
                ),
            },
        },
        "required": ["action"],
        "additionalProperties": False,
    },
}

# Absorb may return long conversations; truncate to fit the context without
# blowing the tool-result budget.
_MAX_TOOL_OUTPUT = 12000


def handle_claude_chat(args: Dict[str, Any], **_kw) -> str:
    """Handler for the claude_chat tool — forwards to the Node CLI."""
    if not _check_requirements():
        return _err(
            "claude-chat-index unavailable: 'node' is not on the PATH or "
            f"src/cli.js not found at {_cli_js()}"
        )

    action = str(args.get("action", ""))
    cli_args = [action]

    if action == "search":
        query = args.get("query")
        if not query or not str(query).strip():
            return _err("query is required when action=search")
        cli_args.append(str(query).strip())
    elif action == "absorb":
        index = args.get("index")
        if index is None:
            return _err("index is required when action=absorb")
        try:
            cli_args.append(str(int(index)))
        except (TypeError, ValueError):
            return _err("index must be an integer", got=repr(index))
    elif action != "list":
        return _err(f"invalid action: {action!r} (use list, search or absorb)")

    ok, out, err = _run_cli(*cli_args)
    if not ok:
        return _err((err or out).strip() or "unknown failure in the CLI",
                    command=f"claude-chat {' '.join(cli_args)}")

    output = out.strip()
    truncated = len(output) > _MAX_TOOL_OUTPUT
    if truncated:
        output = output[:_MAX_TOOL_OUTPUT] + f"\n... [truncated; {len(output)} chars of a larger total — use 'list'/'search' to refine]"
    return _json({"success": True, "truncated": truncated, "output": output})


# ---------------------------------------------------------------------------
# Native CLI command: hermes claude-chat ...
# ---------------------------------------------------------------------------

def _register_cli(subparser) -> None:
    """Builds the argparse tree for `hermes claude-chat`."""
    subs = subparser.add_subparsers(dest="claude_chat_cmd")

    subs.add_parser("list", help="List Claude Code conversations (most recent first)")

    search_p = subs.add_parser("search", help="Search conversations by term")
    search_p.add_argument("query", nargs="+", help="search term (case-insensitive)")

    absorb_p = subs.add_parser("absorb", help="Absorb a conversation's context")
    absorb_p.add_argument("index", type=int, help="conversation number (as in list/search)")


def _claude_chat_command(args) -> int:
    """Handler for the `hermes claude-chat` command — returns an exit code."""
    cmd = getattr(args, "claude_chat_cmd", None)
    if not cmd:
        print("usage: hermes claude-chat {list, search <term>, absorb <n>}")
        return 2

    cli_args = [cmd]
    if cmd == "search":
        cli_args.extend(args.query)
    elif cmd == "absorb":
        cli_args.append(str(args.index))

    ok, out, err = _run_cli(*cli_args)
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err and not out:
        print(err, end="" if err.endswith("\n") else "\n")
    return 0 if ok else 1


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register(ctx) -> None:
    """Plugin registration — called once by the loader when enabled."""
    if not _check_requirements():
        logger.warning(
            "claude-chat-index: 'node' or src/cli.js missing — "
            "nothing registered. CLI at %s", _cli_js()
        )
        return

    ctx.register_tool(
        name="claude_chat",
        toolset="claude_chat_index",
        schema=CLAUDE_CHAT_SCHEMA,
        handler=handle_claude_chat,
        check_fn=_check_requirements,
        emoji="📋",
    )

    ctx.register_cli_command(
        name="claude-chat",
        help="Claude Code conversations: list, search, absorb",
        setup_fn=_register_cli,
        handler_fn=_claude_chat_command,
        description=(
            "Catalogs and retrieves Claude Code conversations (~/.claude/history.jsonl). "
            "E.g. hermes claude-chat list | hermes claude-chat search rebase | "
            "hermes claude-chat absorb 1"
        ),
    )