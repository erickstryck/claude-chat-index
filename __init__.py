"""claude-chat-index plugin — integra o CLI claude-chat ao Hermes Agent.

Registra duas superfícies quando o plugin está habilitado
(``hermes plugins install erickstryck/claude-chat-index --enable``):

* **Comando CLI** — ``hermes claude-chat {list, search <termo>, absorb <n>}``
  Encaminha para o CLI Node (``src/cli.js``), que lê
  ``~/.claude/history.jsonl`` (histórico local do Claude Code).

* **Tool do agente** — ``claude_chat`` (action: list | search | absorb)
  Permite ao próprio Hermes listar/buscar/absorver conversas do Claude Code
  diretamente via tool call, sem precisar de terminal.

O plugin é um wrapper fino: toda a lógica de parse/agrupamento fica no
``src/cli.js`` (zero dependências, 100% local). Nada sai da máquina.
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
# Localizando o CLI Node (src/cli.js)
# ---------------------------------------------------------------------------

def _plugin_dir() -> Path:
    """Diretório do plugin (o repo é o plugin: root == plugin dir).

    Sobrepõe via CLAUDE_CHAT_PLUGIN_DIR para layouts não-padrão
    (mesma convenção do wrapper bin/claude-chat).
    """
    override = os.environ.get("CLAUDE_CHAT_PLUGIN_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent


def _cli_js() -> Path:
    return _plugin_dir() / "src" / "cli.js"


def _check_requirements() -> bool:
    """Gate da tool: só aparece se `node` e o CLI existirem."""
    return shutil.which("node") is not None and _cli_js().exists()


# ---------------------------------------------------------------------------
# Execução do CLI
# ---------------------------------------------------------------------------

def _run_cli(*cli_args: str, timeout: int = 60) -> tuple[bool, str, str]:
    """Roda o CLI Node e devolve (ok, stdout, stderr)."""
    try:
        proc = subprocess.run(
            ["node", str(_cli_js()), *cli_args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode == 0, proc.stdout or "", proc.stderr or ""
    except subprocess.TimeoutExpired:
        return False, "", f"claude-chat {' '.join(cli_args)}: timeout após {timeout}s"
    except Exception as e:  # pragma: no cover — défensive
        return False, "", f"erro ao executar o CLI: {e}"


# ---------------------------------------------------------------------------
# Tool do agente
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

# Absorb pode devolver conversas longas; corta para caber no contexto sem
# estourar o budget de tool result.
_MAX_TOOL_OUTPUT = 12000


def handle_claude_chat(args: Dict[str, Any], **_kw) -> str:
    """Handler da tool claude_chat — encaminha para o CLI Node."""
    if not _check_requirements():
        return _err(
            "claude-chat-index indisponível: 'node' não está no PATH ou "
            f"src/cli.js não encontrado em {_cli_js()}"
        )

    action = str(args.get("action", ""))
    cli_args = [action]

    if action == "search":
        query = args.get("query")
        if not query or not str(query).strip():
            return _err("query é obrigatório quando action=search")
        cli_args.append(str(query).strip())
    elif action == "absorb":
        index = args.get("index")
        if index is None:
            return _err("index é obrigatório quando action=absorb")
        try:
            cli_args.append(str(int(index)))
        except (TypeError, ValueError):
            return _err("index deve ser um inteiro", got=repr(index))
    elif action != "list":
        return _err(f"action inválida: {action!r} (use list, search ou absorb)")

    ok, out, err = _run_cli(*cli_args)
    if not ok:
        return _err((err or out).strip() or "falha desconhecida no CLI",
                    command=f"claude-chat {' '.join(cli_args)}")

    output = out.strip()
    truncated = len(output) > _MAX_TOOL_OUTPUT
    if truncated:
        output = output[:_MAX_TOOL_OUTPUT] + f"\n... [truncado; {len(output)} chars de um total maior — use 'list'/'search' para refinar]"
    return _json({"success": True, "truncated": truncated, "output": output})


# ---------------------------------------------------------------------------
# Comando CLI nativo: hermes claude-chat ...
# ---------------------------------------------------------------------------

def _register_cli(subparser) -> None:
    """Monta a árvore argparse de `hermes claude-chat`."""
    subs = subparser.add_subparsers(dest="claude_chat_cmd")

    subs.add_parser("list", help="Lista conversas do Claude Code (mais recentes primeiro)")

    search_p = subs.add_parser("search", help="Busca conversas por termo")
    search_p.add_argument("query", nargs="+", help="termo de busca (case-insensitive)")

    absorb_p = subs.add_parser("absorb", help="Absorve o contexto de uma conversa")
    absorb_p.add_argument("index", type=int, help="número da conversa (conforme list/search)")


def _claude_chat_command(args) -> int:
    """Handler do comando `hermes claude-chat` — devolve exit code."""
    cmd = getattr(args, "claude_chat_cmd", None)
    if not cmd:
        print("usage: hermes claude-chat {list, search <termo>, absorb <n>}")
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
# Registro
# ---------------------------------------------------------------------------

def register(ctx) -> None:
    """Registro do plugin — chamado uma vez pelo loader quando habilitado."""
    if not _check_requirements():
        logger.warning(
            "claude-chat-index: 'node' ou src/cli.js ausente — "
            "nada registrado. CLI em %s", _cli_js()
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
            "Cataloga e recupera conversas do Claude Code (~/.claude/history.jsonl). "
            "Ex.: hermes claude-chat list | hermes claude-chat search rebase | "
            "hermes claude-chat absorb 1"
        ),
    )