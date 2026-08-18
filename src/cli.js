#!/usr/bin/env node

/**
 * Claude Chat Index Plugin
 * 
 * Plugin para catalogar, indexar e recuperar conversas do Claude Code.
 * Permite listar conversas por idade (mais recentes primeiro) e absorver
 * o contexto de uma conversa específica no Hermes Agent.
 * 
 * Uso:
 *   claude-chat list              - Lista todas as conversas do Claude
 *   claude-chat absorb <session>  - Absorve uma conversa específica no contexto
 *   claude-chat search <query>    - Busca conversas por termo
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLAUDE_HOME = process.env.HOME + '/.claude';
const HISTORY_FILE = join(CLAUDE_HOME, 'history.jsonl');

/**
 * Lê o arquivo history.jsonl do Claude e retorna todas as conversas
 */
function loadHistory() {
  if (!existsSync(HISTORY_FILE)) {
    console.error('Erro: Arquivo de histórico não encontrado em', HISTORY_FILE);
    process.exit(1);
  }

  const content = readFileSync(HISTORY_FILE, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  return lines.map(line => {
    try {
      return JSON.parse(line);
    } catch (e) {
      return null;
    }
  }).filter(item => item !== null);
}

/**
 * Agrupa conversas por sessionId e retorna com metadados
 */
function groupBySession(history) {
  const sessions = new Map();
  
  for (const item of history) {
    if (!item.sessionId || !item.display) continue;
    
    if (!sessions.has(item.sessionId)) {
      sessions.set(item.sessionId, {
        sessionId: item.sessionId,
        project: item.project,
        messages: [],
        // timestamp pode faltar em entradas antigas/corrompidas;
        // 0 mantém o sort e as datas coerentes (em vez de NaN/'Invalid Date')
        firstSeen: item.timestamp || 0,
        lastSeen: item.timestamp || 0,
        title: null
      });
    }
    
    const session = sessions.get(item.sessionId);
    session.messages.push({
      role: 'user',
      content: item.display,
      timestamp: item.timestamp || 0
    });
    
    // Atualiza timestamps
    if (item.timestamp < session.firstSeen) session.firstSeen = item.timestamp;
    if (item.timestamp > session.lastSeen) session.lastSeen = item.timestamp;
    
    // Tenta extrair título da primeira mensagem do usuário
    if (!session.title && item.display.length > 50 && !item.display.startsWith('/')) {
      session.title = item.display.substring(0, 80) + '...';
    }
  }
  
  return Array.from(sessions.values());
}

/**
 * Formata timestamp para data legível
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  // Timestamp no futuro (clock skew): evita "-3 min atrás"
  if (diffMs < 0) {
    return date.toLocaleDateString('pt-BR', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 60) return `${diffMins} min atrás`;
  if (diffHours < 24) return `${diffHours} h atrás`;
  if (diffDays < 7) return `${diffDays} dias atrás`;
  
  return date.toLocaleDateString('pt-BR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Lista conversas ordenadas por idade (mais recentes primeiro).
 *
 * Se `query` for fornecido, filtra por termo — MAS o número exibido [N]
 * continua sendo a posição na lista COMPLETA (recency-sorted), igual ao
 * espaço de índices do `absorb`. Assim "absorb <N>" funciona com o número
 * impresso por `list` OU por `search`.
 */
function listSessions(query = null) {
  const history = loadHistory();
  let sessions = groupBySession(history);

  // Ordena ANTES de filtrar, por mais recente primeiro (lastSeen decrescente).
  // O sort do V8 é estável, então o índice global é determinístico.
  sessions.sort((a, b) => b.lastSeen - a.lastSeen);

  // Marca cada sessão com a posição na lista completa (1-based).
  sessions = sessions.map((s, i) => ({ ...s, globalIndex: i + 1 }));

  // Filtra por query se fornecida (o índice global é preservado)
  if (query) {
    const lowerQuery = query.toLowerCase();
    sessions = sessions.filter(s =>
      s.title?.toLowerCase().includes(lowerQuery) ||
      s.project?.toLowerCase().includes(lowerQuery) ||
      s.messages.some(m => m.content.toLowerCase().includes(lowerQuery))
    );
  }
  
  if (sessions.length === 0) {
    console.log('Nenhuma conversa encontrada.');
    return;
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`CONVERSAS DO CLAUDE (${sessions.length} encontradas)`);
  console.log(`${'='.repeat(80)}\n`);
  
  sessions.forEach((session, index) => {
    const age = formatDate(session.lastSeen);
    const msgCount = session.messages.length;
    // `project` pode estar ausente em entradas antigas/corrompidas do histórico
    const project = session.project?.split('/').pop() || '(desconhecido)';
    
    console.log(`[${session.globalIndex}] ${session.sessionId}`);
    console.log(`    Título: ${session.title || '(sem título)'}`);
    console.log(`    Projeto: ${project}`);
    console.log(`    Mensagens: ${msgCount}`);
    console.log(`    Última atividade: ${age}`);
    console.log(`    Último acesso: ${new Date(session.lastSeen).toLocaleString('pt-BR')}`);
    console.log('');
  });
  
  console.log(`${'='.repeat(80)}`);
  console.log('Use: claude-chat absorb <numero>  para absorver uma conversa no contexto');
  console.log('Ex: claude-chat absorb 1');
}

/**
 * Absorve uma conversa específica no contexto do Hermes
 */
function absorbSession(sessionIndex) {
  const history = loadHistory();
  let sessions = groupBySession(history);
  
  // Ordena por mais recente primeiro (igual ao list)
  sessions.sort((a, b) => b.lastSeen - a.lastSeen);
  
  const index = parseInt(sessionIndex) - 1;
  if (isNaN(index) || index < 0 || index >= sessions.length) {
    console.error(`Erro: Índice inválido. Use um número entre 1 e ${sessions.length}`);
    process.exit(1);
  }
  
  const session = sessions[index];
  
  // Gera um resumo estruturado da conversa
  const summary = {
    sessionId: session.sessionId,
    project: session.project,
    title: session.title,
    dateRange: {
      first: new Date(session.firstSeen).toLocaleString('pt-BR'),
      last: new Date(session.lastSeen).toLocaleString('pt-BR')
    },
    messageCount: session.messages.length,
    context: session.messages.map(m => m.content).join('\n\n---\n\n')
  };
  
  // Output formatado para ser absorvido pelo Hermes
  console.log('=== CONTEXTO DA CONVERSA CLAUDE PARA HERMES ===');
  console.log(`Session ID: ${summary.sessionId}`);
  console.log(`Projeto: ${summary.project || '(desconhecido)'}`);
  console.log(`Título: ${summary.title || '(sem título)'}`);
  console.log(`Período: ${summary.dateRange.first} até ${summary.dateRange.last}`);
  console.log(`Total de mensagens: ${summary.messageCount}`);
  console.log('=== CONTEÚDO DA CONVERSA ===\n');
  console.log(summary.context);
  console.log('\n=== FIM DO CONTEXTO ===');
  console.log('\nDica: Copie este output e use como contexto em uma nova tarefa no Hermes.');
}

/**
 * Busca conversas por termo
 */
function searchSessions(query) {
  if (!query) {
    console.error('Erro: termo de busca é obrigatório');
    process.exit(1);
  }
  
  listSessions(query);
}

/**
 * Main CLI handler
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'list':
      listSessions();
      break;
      
    case 'search':
      searchSessions(args[1]);
      break;
      
    case 'absorb':
      absorbSession(args[1]);
      break;
      
    case '--help':
    case '-h':
      console.log(`
Claude Chat Index Plugin

Uso:
  claude-chat list              Lista todas as conversas (mais recentes primeiro)
  claude-chat search <termo>    Busca conversas por termo
  claude-chat absorb <numero>   Absorve conversa no contexto (ex: absorb 1)
  claude-chat --help            Mostra esta ajuda

Exemplos:
  claude-chat list
  claude-chat search rebase
  claude-chat absorb 3
      `);
      break;
      
    default:
      console.error(`Comando desconhecido: ${command}`);
      console.log('Use --help para ver a ajuda.');
      process.exit(1);
  }
}

main();
