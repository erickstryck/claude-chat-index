# Segurança do claude-chat-index

## O que este plugin faz (e o que não faz)

| Ato | Suportado? | Onde |
|-----|-----------|------|
| Ler `~/.claude/history.jsonl` (histórico local do Claude Code) | **Sim** | `src/cli.js` (`fs.readFileSync` / `fs.existsSync`) |
| Escrever qualquer arquivo | **Não** | — |
| Fazer qualquer requisição de rede (http, https, dns, socket) | **Não** | — |
| Criar subprocessos | **Sim** | `__init__.py` — **um único** `subprocess.run` (ver abaixo) |
| Ler variáveis de ambiente | **Sim** | `HOME` (para achar o histórico), `CLAUDE_CHAT_PLUGIN_DIR` (override de localização) |
| Manter cache ou estado entre execuções | **Não** | — |

## O único subprocesso

`__init__.py` chama o CLI Node para executar os comandos `list` / `search` / `absorb`:

```python
subprocess.run(
    ["node", str(_cli_js()), *cli_args],
    capture_output=True, text=True, timeout=timeout,
)
```

Características de segurança:

- **Sem shell** — a chamada é uma lista de argumentos (não `shell=True`), então não há injeção de shell via `cli_args`.
- **Alvo fixo** — sempre `node` + o `src/cli.js` **desta instalação** (via `Path(__file__).parent`); o `node` é resolvido do PATH com `shutil.which`.
- **Timeout** — 60 s por chamada.
- `src/cli.js` (o que é executado) só importa `fs.readFileSync` / `fs.existsSync` e `path` — **não há** `http`, `net`, `child_process`, `fetch`, `exec` ou `spawn` nesse arquivo.

## O que o plugin lê e para onde vai

- **Lê**: `~/.claude/history.jsonl` (um JSON por linha — prompt do usuário, projeto, timestamp).
- **Emit**: texto no `stdout` (CLI) ou no resultado da tool (Hermes). **Nenhuma saída deixa a máquina** — o resultado vai apenas para o terminal do operador ou para o contexto da própria sessão do agente local.

## Auditoria

- `node scripts/verify-plugin.mjs` — 12 testes herméticos (fixture em `$HOME` temporário).
- O repositório é público; qualquer mudança na `main` passa por PR com 1 aprovação (ruleset `protect-main`).
- Issues de segurança: abra uma **issue** no repositório (não commite nada sensível em PRs públicos).

## Nota sobre scanners de segurança

Instaladores com scan (ex.: o do Hermes Agent) podem marcar:

- `execution` em `__init__.py` (o `subprocess.run` acima) — **esperado e documentado** aqui; é o mecanismo pelo qual o plugin expõe o CLI ao Hermes.
- `supply_chain` em instruções de `git clone` / `npm install` no README — são instruções de instalação, não código executado pelo plugin.
- `exfiltration` / `persistence` em frases de documentação — heurísticas de texto; o código não contém instrução de exfiltração nem altera configurações de persistência.

Nenhum desses achados corresponde a comportamento real do plugin, segundo a tabela acima.