# Claude Chat Index

Plugin CLI para **catalogar, indexar e recuperar conversas do Claude Code** — feito para integrar com o [Hermes Agent](https://hermes-agent.nousresearch.com/docs).

Permite listar as conversas do Claude Code ordenadas por data, buscar por termo e **absorver** o contexto de uma conversa específica para continuar o trabalho em outro agente (ex.: retomar no Hermes de onde o Claude parou).

- **Zero dependências** — apenas Node.js (>= 18, usa ESM nativo)
- **100% local** — nenhum dado sai da máquina
- **Lingua**: saída em pt-BR

---

## Como funciona (arquitetura)

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  ~/.claude/history.jsonl │         │      claude-chat CLI         │
│  (gravado pelo Claude    │  lê     │                              │
│   Code a cada prompt do  │ ──────▶ │  loadHistory()  → parse JSONL│
│   usuário)               │         │  groupBySession() → agrupa   │
└─────────────────────────┘         │  por sessionId               │
                                    │  sort por lastSeen desc      │
┌─────────────────────────┐         │                              │
│  ~/.claude/projects/**/  │  n.l.   │  list / search / absorb      │
│  <sessionId>.jsonl       │ ◀────── │                              │
│  (transcrições completas,│         └──────────────────────────────┘
│  incl. respostas do      │
│  assistente)             │
└─────────────────────────┘
```

1. **Fonte de dados**: o Claude Code grava cada prompt do usuário em `~/.claude/history.jsonl` (um JSON por linha). O plugin lê **apenas** esse arquivo — ver [Schema dos dados](#schema-dos-dados).
2. **Agrupamento**: `groupBySession()` agrupa as linhas por `sessionId`, calculando `firstSeen`/`lastSeen`, contagem de mensagens e um título heurístico (primeira mensagem longa que não comece com `/`, truncada a 80 chars).
3. **Ordenação**: todas as conversas são ordenadas por `lastSeen` decrescente (mais recentes primeiro) **antes** de qualquer filtro — tanto no `list` quanto no `absorb`. O índice `[N]` exibido é sempre a posição nessa lista completa, então o `absorb <N>` usa o mesmo número impresso por `list` ou `search`.
4. **Saída**: `absorb` emite um bloco de texto estruturado (com marcadores `===`) pensado para ser copiado e colado como contexto em outra ferramenta/LLM.

> **Nota importante**: o `history.jsonl` contém apenas as **mensagens do usuário** (os prompts). As respostas do assistente ficam nas transcrições completas em `~/.claude/projects/<projeto>/<sessionId>.jsonl` — esse diretório **não** é lido por este plugin (ver [Limitações](#limitações)).

## Estrutura do projeto

```
claude-chat-index/
├── package.json               # Manifesto npm (type: module, bin: claude-chat)
├── plugin.yaml                # Manifesto do plugin Hermes (install/update/enable)
├── __init__.py                # Entrypoint Python: registra CLI `hermes claude-chat` + tool `claude_chat`
├── README.md                  # Esta documentação
├── EXAMPLE.md                 # Exemplo de uso ponta a ponta (list → search → absorb)
├── src/
│   └── cli.js                 # CLI principal (o plugin em si — arquivo único)
├── bin/
│   └── claude-chat            # Wrapper bash para o PATH (override: CLAUDE_CHAT_PLUGIN_DIR)
├── scripts/
│   └── verify-plugin.mjs      # 12 verificações hermetic (fixture em $HOME temporário)
└── docs/
    └── usage-guide.md         # Guia de referência: casos de uso, padrões de integração
```

### Anatomia de `src/cli.js`

| Função | Responsabilidade |
|--------|------------------|
| `loadHistory()` | Lê `~/.claude/history.jsonl`, faz parse linha a linha (tolera linhas corrompidas) |
| `groupBySession(history)` | Agrupa por `sessionId`, monta metadados (título, período, mensagens) |
| `formatDate(ts)` | Data relativa ("2 h atrás") para < 7 dias, data `pt-BR` após |
| `listSessions(query?)` | Comando `list` (e base do `search`) — com filtro opcional por termo |
| `searchSessions(query)` | Comando `search` — thin wrapper sobre `listSessions(query)` |
| `absorbSession(index)` | Comando `absorb` — emite o bloco de contexto estruturado |
| `main()` | Parser de argumentos e roteamento dos comandos |

## Instalação

### Via Hermes (recomendado)

Um único comando instala **e habilita** o plugin:

```bash
hermes plugins install erickstryck/claude-chat-index --enable
```

Com `--enable`, o plugin registra duas superfícies no Hermes:

- **Comando CLI nativo** — `hermes claude-chat {list, search <termo>, absorb <n>}`
- **Tool do agente** — `claude_chat` (o próprio Hermes lista/busca/absorve conversas do Claude Code via tool call, sem terminal)

```bash
hermes claude-chat list
hermes claude-chat search rebase
hermes claude-chat absorb 1
```

O repo é **público**, então o shorthand `owner/repo` funciona direto,
sem chave SSH ou token (clone anônimo por HTTPS):

> Alternativa: instalar pela URL completa —
> `hermes plugins install https://github.com/erickstryck/claude-chat-index.git --enable`.

Para atualizar no futuro:

```bash
hermes plugins update claude-chat-index
```

### Global via npm

```bash
git clone https://github.com/erickstryck/claude-chat-index.git
cd claude-chat-index
npm install -g .        # registra o binário `claude-chat` no PATH
claude-chat --help
```

### Manual (sem npm)

```bash
node /caminho/para/claude-chat-index/src/cli.js list
```

### Wrapper standalone (sem o plugin habilitado)

Se você instalar **sem** `--enable`, o `bin/claude-chat` (wrapper bash) ainda
expõe o comando `claude-chat` no PATH — basta copiar para um diretório no
PATH (ex.: `~/.hermes/claude-chat`). O override de localização é a variável
`CLAUDE_CHAT_PLUGIN_DIR`.

### Skill do Hermes

Com o plugin habilitado, a skill correspondente (`claude-chat-index`) já sabe
invocar `hermes claude-chat ...` — então comandos naturais funcionam direto:
*"Listar conversas do Claude Code"*, *"Buscar conversas sobre rebase"*,
*"Absorver conversa 2"*. O comando nativo torna o wrapper `claude-chat` no
PATH opcional.

## Comandos

### `claude-chat list`

Lista todas as conversas, mais recentes primeiro.

```
================================================================================
CONVERSAS DO CLAUDE (5 encontradas)
================================================================================

[1] a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
    Título: crie um script que exporta o relatório mensal em CSV...
    Projeto: meu-projeto
    Mensagens: 5
    Última atividade: 13 h atrás
    Último acesso: 17/08/2026, 20:17:50
...
```

> Exemplo sintético (dados fictícios).

### `claude-chat search <termo>`

Busca por termo (case-insensitive) em três campos: **título**, **caminho do projeto** e **conteúdo das mensagens**.

O número `[N]` exibido é a **posição na lista completa** (recency-sorted), **não** na lista filtrada — portanto o mesmo número que aparece em um `search` funciona diretamente no `absorb <N>`.

```bash
claude-chat search rebase
claude-chat search config
```

### `claude-chat absorb <numero>`

Emite o contexto completo da conversa nº `<numero>` (mesma numeração do `list`) em formato pronto para uso como contexto de entrada em outra tarefa/agente:

```
=== CONTEXTO DA CONVERSA CLAUDE PARA HERMES ===
Session ID: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
Projeto: /home/dev/projects/meu-projeto
Título: crie um script que exporta o relatório mensal em CSV...
Período: 17/07/2026, 09:35:01 até 17/07/2026, 13:22:51
Total de mensagens: 55
=== CONTEÚDO DA CONVERSA ===

<mensagem 1>

---

<mensagem 2>
...
=== FIM DO CONTEXTO ===

Dica: este bloco está formatado para uso como contexto de entrada em outra tarefa do Hermes.
```

> Exemplo sintético (dados fictícios).

### Fluxo típico

```bash
claude-chat search "migração de entidades"   # 1. acha a conversa certa
claude-chat absorb 2                          # 2. gera o contexto
# 3. use o bloco como contexto de entrada em outra ferramenta/LLM:
#    "Preciso retomar uma conversa do Claude. Aqui está o contexto: ...
#     Continue de onde paramos: [o que precisa]"
```

## Schema dos dados

Fonte: `~/.claude/history.jsonl` — um JSON por linha, **uma linha por prompt do usuário**:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `sessionId` | `string` (UUID) | Identificador da conversa. O plugin agrupa por ele. |
| `project` | `string` | Caminho absoluto do diretório do projeto. |
| `timestamp` | `number` | Epoch em **milissegundos** (UTC). |
| `display` | `string` | Texto do prompt do usuário. |
| `pastedContents` | `object?` | Conteúdo colado/expandido (ex.: `@arquivo`), opcional — não usado pelo plugin. |

Exemplo (valores sintéticos):

```json
{"sessionId":"a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d","project":"/home/dev/projects/meu-projeto","display":"crie um script que exporta o relatório mensal...","timestamp":1786102110312,"pastedContents":{}}
```

Linhas que falhem no `JSON.parse` são **ignoradas** (o histórico é append-only e pode conter resíduos).

## Verificação / testes

O script `scripts/verify-plugin.mjs` roda 10 verificações ad-hoc (existência dos arquivos, execução dos 3 comandos, estrutura do output do `absorb`, erro com índice inválido). Ele localiza o CLI automaticamente em relação à própria posição no repo, ou use a variável `PLUGIN_PATH` para apontar para outra instalação:

```bash
node scripts/verify-plugin.mjs
# ou:
PLUGIN_PATH=/caminho/para/outra/src/cli.js node scripts/verify-plugin.mjs
```

Pré-requisitos: o Claude Code já ter sido usado (existe `~/.claude/history.jsonl` com ao menos 1 conversa) e `node` no PATH.

## Limitações

- **Somente mensagens do usuário**: o `history.jsonl` não contém as respostas do Claude. Para a transcrição completa (usuário + assistente), leia `~/.claude/projects/<projeto-slugificado>/<sessionId>.jsonl` — extensão futura natural deste plugin.
- **Um prompt = uma "mensagem"**: não há granularidade por turnos de ferramenta/dentro da sessão.
- **Título heurístico**: a primeira mensagem curta (ou que comece com `/`, como slash-commands) não vira título; a conversa aparece como "(sem título)".
- **Sem cache**: tudo é relido do disco a cada execução (rápido para centenas de conversas; verifique o desempenho antes de usar com históricos de dezenas de milhares de linhas).
- O diretório `~/.claude/sessions/` é citado no manifesto, mas não é lido pelo código atual.

## Privacidade

Todo o processamento é local. O plugin **não** envia nada para a rede, não escreve arquivos e não mantém cache.

## Desenvolvimento

```bash
git clone https://github.com/erickstryck/claude-chat-index.git && cd claude-chat-index
npm link            # desenvolvimento: binário claude-chat aponta para o checkout
node scripts/verify-plugin.mjs   # valide após mudanças
```

Para publicar: `npm publish --access public` (o pacote está pronto — `bin: claude-chat`).

## License

[MIT](LICENSE)