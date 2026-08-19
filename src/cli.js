#!/usr/bin/env node

/**
 * Claude Chat Index Plugin
 * 
 * Plugin to catalog, index, and retrieve Claude Code conversations.
 * Lets you list conversations by age (most recent first) and absorb
 * the context of a specific conversation into the Hermes Agent.
 * 
 * Usage:
 *   claude-chat list              - Lists all Claude conversations
 *   claude-chat absorb <session>  - Absorbs a specific conversation into the context
 *   claude-chat search <query>    - Searches conversations by term
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
 * Reads the Claude history.jsonl file and returns all conversations
 */
function loadHistory() {
  if (!existsSync(HISTORY_FILE)) {
    console.error('Error: History file not found at', HISTORY_FILE);
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
 * Groups conversations by sessionId and returns them with metadata
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
        // timestamp may be missing in old/corrupt entries;
        // 0 keeps the sort and dates coherent (instead of NaN/'Invalid Date')
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
    
    // Update timestamps
    if (item.timestamp < session.firstSeen) session.firstSeen = item.timestamp;
    if (item.timestamp > session.lastSeen) session.lastSeen = item.timestamp;
    
    // Tries to extract the title from the first user message
    if (!session.title && item.display.length > 50 && !item.display.startsWith('/')) {
      session.title = item.display.substring(0, 80) + '...';
    }
  }
  
  return Array.from(sessions.values());
}

/**
 * Formats a timestamp into a readable date
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  // Timestamp in the future (clock skew): avoids "-3 min ago"
  if (diffMs < 0) {
    return date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} h ago`;
  if (diffDays < 7) return `${diffDays} days ago`;
  
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Lists conversations ordered by age (most recent first).
 *
 * If `query` is given, it filters by term — BUT the number shown [N]
 * remains the position in the FULL (recency-sorted) list, the same
 * index space as `absorb`. So "absorb <N>" works with the number
 * printed by `list` OR by `search`.
 */
function listSessions(query = null) {
  const history = loadHistory();
  let sessions = groupBySession(history);

  // Sort BEFORE filtering, by most recent first (lastSeen descending).
  // The V8 sort is stable, so the global index is deterministic.
  sessions.sort((a, b) => b.lastSeen - a.lastSeen);

  // Marks each session with its position in the full list (1-based).
  sessions = sessions.map((s, i) => ({ ...s, globalIndex: i + 1 }));

  // Filters by query if given (the global index is preserved)
  if (query) {
    const lowerQuery = query.toLowerCase();
    sessions = sessions.filter(s =>
      s.title?.toLowerCase().includes(lowerQuery) ||
      s.project?.toLowerCase().includes(lowerQuery) ||
      s.messages.some(m => m.content.toLowerCase().includes(lowerQuery))
    );
  }
  
  if (sessions.length === 0) {
    console.log('No conversation found.');
    return;
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`CLAUDE CONVERSATIONS (${sessions.length} found)`);
  console.log(`${'='.repeat(80)}\n`);
  
  sessions.forEach((session, index) => {
    const age = formatDate(session.lastSeen);
    const msgCount = session.messages.length;
    // `project` may be absent in old/corrupt history entries
    const project = session.project?.split('/').pop() || '(unknown)';
    
    console.log(`[${session.globalIndex}] ${session.sessionId}`);
    console.log(`    Title: ${session.title || '(untitled)'}`);
    console.log(`    Project: ${project}`);
    console.log(`    Messages: ${msgCount}`);
    console.log(`    Last activity: ${age}`);
    console.log(`    Last access: ${new Date(session.lastSeen).toLocaleString('en-US')}`);
    console.log('');
  });
  
  console.log(`${'='.repeat(80)}`);
  console.log('Use: claude-chat absorb <number>  to absorb a conversation into the context');
  console.log('Example: claude-chat absorb 1');
}

/**
 * Absorbs a specific conversation into the Hermes context
 */
function absorbSession(sessionIndex) {
  const history = loadHistory();
  let sessions = groupBySession(history);
  
  // Sort by most recent first (same as list)
  sessions.sort((a, b) => b.lastSeen - a.lastSeen);
  
  const index = parseInt(sessionIndex) - 1;
  if (isNaN(index) || index < 0 || index >= sessions.length) {
    console.error(`Error: Invalid index. Use a number between 1 and ${sessions.length}`);
    process.exit(1);
  }
  
  const session = sessions[index];
  
  // Generates a structured summary of the conversation
  const summary = {
    sessionId: session.sessionId,
    project: session.project,
    title: session.title,
    dateRange: {
      first: new Date(session.firstSeen).toLocaleString('en-US'),
      last: new Date(session.lastSeen).toLocaleString('en-US')
    },
    messageCount: session.messages.length,
    context: session.messages.map(m => m.content).join('\n\n---\n\n')
  };
  
  // Formatted output to be absorbed by Hermes
  console.log('=== CLAUDE CONVERSATION CONTEXT FOR HERMES ===');
  console.log(`Session ID: ${summary.sessionId}`);
  console.log(`Project: ${summary.project || '(unknown)'}`);
  console.log(`Title: ${summary.title || '(untitled)'}`);
  console.log(`Period: ${summary.dateRange.first} to ${summary.dateRange.last}`);
  console.log(`Total messages: ${summary.messageCount}`);
  console.log('=== CONVERSATION CONTENT ===\n');
  console.log(summary.context);
  console.log('\n=== END OF CONTEXT ===');
  console.log('\nTip: this block is formatted for use as input context in another Hermes task.');
}

/**
 * Searches conversations by term
 */
function searchSessions(query) {
  if (!query) {
    console.error('Error: a search term is required');
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

Usage:
  claude-chat list              Lists all conversations (most recent first)
  claude-chat search <term>     Searches conversations by term
  claude-chat absorb <number>   Absorbs a conversation into the context (e.g. absorb 1)
  claude-chat --help            Shows this help

Examples:
  claude-chat list
  claude-chat search rebase
  claude-chat absorb 3
      `);
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      console.log('Use --help to see the help.');
      process.exit(1);
  }
}

main();