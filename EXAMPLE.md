# Exemplo de Uso: Claude Chat Index

Este arquivo demonstra como usar o plugin `claude-chat-index` para recuperar conversas do Claude Code no Hermes Agent.

> **Nota:** todas as saídas abaixo são **sintéticas** (dados fictícios de exemplo).

## Cenário: Retomar uma conversa sobre um rebase

### Passo 1: Listar conversas recentes

```bash
claude-chat list
```

**Saída esperada:**
```
================================================================================
CONVERSAS DO CLAUDE (12 encontradas)
================================================================================

[1] a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
    Título: resolva os conflitos que apareceram quando eu dei o rebase com a main...
    Projeto: meu-projeto
    Mensagens: 41
    Última atividade: 1 min atrás
    Último acesso: 17/07/2026, 15:35:29

[2] f0e1d2c3-b4a5-4968-8776-655443322110
    Título: crie para mim um md com tudo que é necessário para se criar o fluxo de migração...
    Projeto: meu-projeto
    Mensagens: 5
    Última atividade: 2 h atrás
    Último acesso: 17/07/2026, 13:21:15
...
```

### Passo 2: Buscar conversas por termo (opcional)

```bash
claude-chat search config
```

**Saída esperada:**
```
================================================================================
CONVERSAS DO CLAUDE (3 encontradas)
================================================================================

[1] a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
    Título: resolva os conflitos que apareceram quando eu dei o rebase com a main...
    Projeto: meu-projeto
...
```

### Passo 3: Absorver a conversa no contexto do Hermes

```bash
claude-chat absorb 1
```

**Saída esperada:**
```
=== CONTEXTO DA CONVERSA CLAUDE PARA HERMES ===
Session ID: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
Projeto: /home/dev/projects/meu-projeto
Título: resolva os conflitos que apareceram quando eu dei o rebase com a main...
Período: 16/07/2026, 11:01:37 até 17/07/2026, 15:35:29
Total de mensagens: 41
=== CONTEÚDO DA CONVERSA ===

resolva os conflitos que apareceram quando eu dei o rebase com a main

---

o sdk deve ser mantido sempre na última versão

---

crie as sessões para as entidades em @/home/dev/projects/meu-projeto/src/ui/index.tsx...
...
=== FIM DO CONTEXTO ===
```

### Passo 4: Usar o contexto no Hermes

Use o bloco do Passo 3 como contexto de entrada no Hermes:

```
Preciso retomar uma conversa do Claude sobre rebase e migração.

Aqui está o contexto da conversa anterior:

[COLE O OUTPUT DO PASSO 3 AQUI]

Continuação: preciso seguir com o próximo passo do fluxo.
```

## Comandos Disponíveis

| Comando | Descrição |
|---------|-----------|
| `list` | Lista todas as conversas (mais recentes primeiro) |
| `search <termo>` | Busca conversas por termo |
| `absorb <numero>` | Absorve conversa no contexto |
| `--help` | Mostra ajuda |

## Exemplos de Uso

### Listar todas as conversas
```bash
claude-chat list
```

### Buscar por "migration"
```bash
claude-chat search migration
```

### Absorver conversa 3
```bash
claude-chat absorb 3
```

## Integração com o Hermes

Com o plugin habilitado, também há o comando nativo e a tool:

```bash
hermes claude-chat list
hermes claude-chat search config
hermes claude-chat absorb 1
```

Ou via tool `claude_chat` (invocada pelo próprio agente).

## Notas

- As conversas são listadas por data de última atividade (mais recentes primeiro)
- O índice exibido é **global** (posição na lista completa), então o número de `search` é o mesmo aceito por `absorb`
- O output do `absorb` está formatado para ser facilmente copiado e usado no Hermes