#!/usr/bin/env node

/**
 * Verificação Ad-hoc: Claude Chat Index Plugin
 *
 * Testes HERMÉTICOS: criam um $HOME temporário com um history.jsonl de
 * fixture (incluindo casos de borda) e apontam a HOME do processo filho do
 * CLI para lá. NÃO dependem de histórico real do Claude Code — rodam em
 * qualquer máquina, a qualquer hora.
 *
 * Casos de borda cobertos pelo fixture:
 *  - linha corrompida (não-JSON) → deve ser ignorada
 *  - entrada SEM campo `project` → não pode crashar o `list`
 *  - entrada SEM `timestamp` → não pode gerar 'Invalid Date'/NaN
 *  - sessão com apenas slash-command → título '(sem título)'
 *
 * Regressões cobertas:
 *  - R1: `list` crashava (TypeError) em sessão sem `project` (cli.js)
 *  - R2: `search` imprimia índices da lista FILTRADA, mas `absorb` indexava
 *        a lista COMPLETA → o usuário absorvia a conversa errada
 *  - R3: entrada sem `timestamp` gerava 'Invalid Date' e NaN no sort
 *
 * Roda como verificação pontual das funcionalidades críticas.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

// Localiza o CLI de forma robusta:
//  1. Variável PLUGIN_PATH (explicada acima)
//  2. Repositorio padrao (src/cli.js relativa a este script em ../src)
//  3. Instalacao global do Hermes (~/.hermes/plugins/claude-chat-index/src/cli.js)
//  4. Layout legado do projeto (.github/plugins/claude-chat-index/src/cli.js)
const __dirname = dirname(fileURLToPath(import.meta.url));

const CANDIDATE_PATHS = [
  process.env.PLUGIN_PATH,
  resolve(__dirname, '..', 'src', 'cli.js'),
  join(process.env.HOME || '', '.hermes', 'plugins', 'claude-chat-index', 'src', 'cli.js'),
  join(process.cwd(), '.github', 'plugins', 'claude-chat-index', 'src', 'cli.js'),
].filter(Boolean);

const PLUGIN_PATH = CANDIDATE_PATHS.find(p => existsSync(p)) || CANDIDATE_PATHS[1];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ---------------------------------------------------------------------------
// Fixture: $HOME temporário com histórico sintético e determinístico.
//
// Ordem esperada por lastSeen (descrescente):
//   [1] s3-ccc  (T3, mais recente; só slash-command → sem título)
//   [2] s2-bbb  (T2; SEM campo `project` → teste R1; contém "alpha" e "projeto")
//   [3] s1-aaa  (T1+60s; 2 mensagens; título na 1ª msg; contém "projeto")
//   [4] s4-ddd  (SEM `timestamp` → fallback 0 → teste R3; mais antiga)
//
// Total: 4 sessões válidas (a linha corrompida é ignorada).
// ---------------------------------------------------------------------------
const FIXTURE_HOME = join(tmpdir(), `claude-chat-index-test-${process.pid}`);
const FIXTURE_HISTORY = join(FIXTURE_HOME, '.claude', 'history.jsonl');

const T_S1 = 1700000000000; // mais antiga (s1)
const T_S2 = 1700003600000; // intermediária (s2)
const T_S3 = 1700007200000; // mais recente (s3)

const FIXTURE_LINES = [
  // s1: 2 mensagens, com project, 1ª msg > 50 chars (virar título)
  { sessionId: 's1-aaa', project: '/home/x/proj-a', display: 'mensagem inicial longa o suficiente para virar titulo da sessao um sobre projeto', timestamp: T_S1 },
  { sessionId: 's1-aaa', project: '/home/x/proj-a', display: 'segunda mensagem do proj-a', timestamp: T_S1 + 60000 },
  // s2: SEM campo `project` (regressão R1), contém "alpha" e "projeto"
  { sessionId: 's2-bbb', display: 'trabalhando na busca alpha do projeto', timestamp: T_S2 },
  // s3: apenas slash-command (sem título), mais recente
  { sessionId: 's3-ccc', project: '/home/x/proj-c', display: '/clear', timestamp: T_S3 },
  // linha corrompida — deve ser ignorada sem derrubar o parse
  'THIS IS NOT JSON {{{',
  // s4: SEM `timestamp` (regressão R3)
  { sessionId: 's4-ddd', project: '/home/x/proj-d', display: 'sessao sem timestamp para testar o fallback' },
];

try {
  mkdirSync(join(FIXTURE_HOME, '.claude'), { recursive: true });
  writeFileSync(
    FIXTURE_HISTORY,
    FIXTURE_LINES.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n',
    'utf-8'
  );

  // Aponta a HOME do processo filho para o fixture (o CLI lê $HOME/.claude)
  const run = (args) =>
    execSync(`node ${PLUGIN_PATH} ${args}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: FIXTURE_HOME },
    });

  console.log('='.repeat(70));
  console.log('VERIFICAÇÃO AD-HOC: Claude Chat Index Plugin (fixture hermetic)');
  console.log('='.repeat(70));
  console.log('');

  // Teste 1: Verificar se o arquivo do plugin existe
  test('Plugin file exists', () => {
    assert(existsSync(PLUGIN_PATH), `Plugin not found at ${PLUGIN_PATH}`);
  });

  // Teste 2: Verificar se o fixture de histórico foi criado
  test('Fixture history file created', () => {
    assert(existsSync(FIXTURE_HISTORY), `Fixture not created at ${FIXTURE_HISTORY}`);
  });

  // Teste 3: Testar comando list
  test('List command executes successfully', () => {
    const output = run('list');
    assert(output.includes('CONVERSAS DO CLAUDE'), 'Output missing header');
    assert(output.includes('4 encontradas'), 'Expected 4 sessions (corrupt line must be ignored)');
  });

  // Teste 4: Verificar que list retorna conversas ordenadas por recência
  test('List returns conversations in recency order', () => {
    const output = run('list');
    const pos = (id) => output.indexOf(id);
    assert(pos('s3-ccc') !== -1 && pos('s2-bbb') !== -1 && pos('s1-aaa') !== -1 && pos('s4-ddd') !== -1, 'Missing expected sessions in output');
    assert(pos('s3-ccc') < pos('s2-bbb'), 's3 (most recent) must come before s2');
    assert(pos('s2-bbb') < pos('s1-aaa'), 's2 must come before s1');
    assert(pos('s1-aaa') < pos('s4-ddd'), 's1 must come before s4 (missing timestamp → oldest)');
  });

  // Teste 5: Testar comando search (resultado filtrado)
  test('Search command filters correctly', () => {
    const output = run('search alpha');
    assert(output.includes('1 encontradas'), 'Expected exactly 1 match for "alpha"');
    assert(output.includes('s2-bbb'), 'Expected s2 in results');
  });

  // Teste 6 (REGRESSÃO R2): índices do search devem ser da lista COMPLETA,
  // i.e. compatíveis com o `absorb`. "projeto" casa com s2 e s1 →
  // devem aparecer como [2] e [3] (posições globais), NÃO [1] e [2].
  test('Search indices match absorb index space (regression R2)', () => {
    const output = run('search projeto');
    assert(output.includes('2 encontradas'), 'Expected 2 matches for "projeto"');
    assert(output.includes('[2] s2-bbb'), 's2 must show global index [2] in search output');
    assert(output.includes('[3] s1-aaa'), 's1 must show global index [3] in search output');
    assert(!output.includes('[1] s'), 'filtered results must not renumber from [1]');
  });

  // Teste 7: Testar comando absorb (primeira conversa)
  test('Absorb command executes successfully', () => {
    const output = run('absorb 1');
    assert(output.includes('=== CONTEXTO DA CONVERSA CLAUDE PARA HERMES ==='), 'Absorb missing header');
    assert(output.includes('Session ID: s3-ccc'), 'Absorb 1 must resolve to s3 (most recent)');
    assert(output.includes('=== FIM DO CONTEXTO ==='), 'Absorb missing footer');
  });

  // Teste 8 (REGRESSÃO R1): absorb/list com sessão SEM `project` não pode
  // crashar e deve exibir '(desconhecido)'.
  test('Session without project does not crash (regression R1)', () => {
    const outList = run('list');
    assert(outList.includes('(desconhecido)'), 'list must render "(desconhecido)" for missing project');
    const outAbsorb = run('absorb 2');
    assert(outAbsorb.includes('Session ID: s2-bbb'), 'absorb 2 must resolve to s2');
    assert(outAbsorb.includes('Projeto: (desconhecido)'), 'absorb must render "(desconhecido)" for missing project');
  });

  // Teste 9: Testar que absorb com índice inválido retorna erro
  test('Absorb with invalid index returns error', () => {
    try {
      execSync(`node ${PLUGIN_PATH} absorb 99999`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: { ...process.env, HOME: FIXTURE_HOME },
      });
      throw new Error('Should have failed with invalid index');
    } catch (error) {
      assert(error.stderr && error.stderr.includes('Índice inválido'), 'Error message incorrect');
    }
  });

  // Teste 10: Verificar estrutura de saída do absorb
  test('Absorb output format is correct', () => {
    const output = run('absorb 3');
    const hasHeader = output.includes('=== CONTEXTO DA CONVERSA CLAUDE PARA HERMES ===');
    const hasSessionId = output.includes('Session ID: s1-aaa');
    const hasProject = output.includes('Projeto: /home/x/proj-a');
    const hasTitle = output.includes('Título:');
    const hasPeriod = output.includes('Período:');
    const hasMessageCount = output.match(/Total de mensagens: \d+/);
    const hasContent = output.includes('=== CONTEÚDO DA CONVERSA ===');
    const hasFooter = output.includes('=== FIM DO CONTEXTO ===');
    const hasTip = output.includes('Dica:');
    const hasBothMessages =
      output.includes('mensagem inicial longa') && output.includes('segunda mensagem do proj-a');

    assert(hasHeader && hasSessionId && hasProject && hasTitle &&
           hasPeriod && hasMessageCount && hasContent && hasFooter && hasTip,
           'Output structure incomplete');
    assert(hasBothMessages, 'absorb must include all messages of the session');
  });

  // Teste 11 (REGRESSÃO R3): entrada sem `timestamp` não pode gerar
  // 'Invalid Date' nem NaN no output.
  test('Missing timestamp produces sane output (regression R3)', () => {
    const output = run('list');
    assert(!output.includes('Invalid Date'), "Output must not contain 'Invalid Date'");
    assert(!output.includes('NaN'), 'Output must not contain NaN');
  });

  // Teste 12: Testar comando help
  test('Help command executes successfully', () => {
    const output = run('--help');
    assert(output.includes('Claude Chat Index Plugin'), 'Help missing title');
    assert(output.includes('list'), 'Help missing list command');
    assert(output.includes('absorb'), 'Help missing absorb command');
    assert(output.includes('search'), 'Help missing search command');
  });

} finally {
  // Limpa o fixture
  rmSync(FIXTURE_HOME, { recursive: true, force: true });
}

console.log('');
console.log('='.repeat(70));
console.log(`RESULTADO: ${passed} passed, ${failed} failed`);
console.log('='.repeat(70));

if (failed > 0) {
  console.log('');
  console.log('⚠️  Verificação falhou. Revise os erros acima.');
  process.exit(1);
} else {
  console.log('');
  console.log('✅ Todos os testes passaram!');
  console.log('');
  console.log('Nota: Esta é uma verificação ad-hoc com fixture hermetic, não um');
  console.log('suite de testes completo. Funcionalidades validadas:');
  console.log('  - list: Lista conversas ordenadas por data (com linha corrompida tolerada)');
  console.log('  - search: Busca por termo com índices globais (compatível com absorb)');
  console.log('  - absorb: Absorve contexto de conversa (incl. sessão sem project/timestamp)');
  process.exit(0);
}