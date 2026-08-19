#!/usr/bin/env node

/**
 * Ad-hoc Verification: Claude Chat Index Plugin
 *
 * HERMETIC TESTS: they create a temporary $HOME with a fixture
 * history.jsonl (including edge cases) and point the CLI child process's
 * HOME there. They do NOT depend on a real Claude Code history — they run on
 * any machine, at any time.
 *
 * Edge cases covered by the fixture:
 *  - corrupt line (non-JSON) → must be ignored
 *  - entry WITHOUT a `project` field → must not crash `list`
 *  - entry WITHOUT a `timestamp` → must not produce 'Invalid Date'/NaN
 *  - session with only a slash-command → title '(untitled)'
 *
 * Regressions covered:
 *  - R1: `list` crashed (TypeError) on a session without `project` (cli.js)
 *  - R2: `search` printed indices from the FILTERED list, but `absorb`
 *        indexed the FULL list → the user absorbed the wrong conversation
 *  - R3: an entry without `timestamp` produced 'Invalid Date' and NaN in the sort
 *
 * Runs as a spot check of the critical functionalities.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

// Locates the CLI robustly:
//  1. PLUGIN_PATH variable (documented above)
//  2. Default repository (src/cli.js relative to this script, in ../src)
//  3. Global Hermes installation (~/.hermes/plugins/claude-chat-index/src/cli.js)
//  4. Legacy project layout (.github/plugins/claude-chat-index/src/cli.js)
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
// Fixture: a temporary $HOME with a synthetic, deterministic history.
//
// Expected order by lastSeen (descending):
//   [1] s3-ccc  (T3, most recent; only a slash-command → no title)
//   [2] s2-bbb  (T2; WITHOUT a `project` field → test R1; contains "alpha" and "project")
//   [3] s1-aaa  (T1+60s; 2 messages; title on the 1st message; contains "project")
//   [4] s4-ddd  (WITHOUT a `timestamp` → fallback 0 → test R3; oldest)
//
// Total: 4 valid sessions (the corrupt line is ignored).
// ---------------------------------------------------------------------------
const FIXTURE_HOME = join(tmpdir(), `claude-chat-index-test-${process.pid}`);
const FIXTURE_HISTORY = join(FIXTURE_HOME, '.claude', 'history.jsonl');

const T_S1 = 1700000000000; // oldest (s1)
const T_S2 = 1700003600000; // middle (s2)
const T_S3 = 1700007200000; // most recent (s3)

const FIXTURE_LINES = [
  // s1: 2 messages, with project, 1st message > 50 chars (becomes the title)
  { sessionId: 's1-aaa', project: '/home/x/proj-a', display: 'initial long message long enough to become the title of session one about the project', timestamp: T_S1 },
  { sessionId: 's1-aaa', project: '/home/x/proj-a', display: 'second message of proj-a', timestamp: T_S1 + 60000 },
  // s2: WITHOUT a `project` field (regression R1), contains "alpha" and "project"
  { sessionId: 's2-bbb', display: 'working on the alpha search of the project', timestamp: T_S2 },
  // s3: only a slash-command (no title), most recent
  { sessionId: 's3-ccc', project: '/home/x/proj-c', display: '/clear', timestamp: T_S3 },
  // corrupt line — must be ignored without breaking the parse
  'THIS IS NOT JSON {{{',
  // s4: WITHOUT a `timestamp` (regression R3)
  { sessionId: 's4-ddd', project: '/home/x/proj-d', display: 'session without a timestamp to test the fallback' },
];

try {
  mkdirSync(join(FIXTURE_HOME, '.claude'), { recursive: true });
  writeFileSync(
    FIXTURE_HISTORY,
    FIXTURE_LINES.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n',
    'utf-8'
  );

  // Points the child process HOME at the fixture (the CLI reads $HOME/.claude)
  const run = (args) =>
    execSync(`node ${PLUGIN_PATH} ${args}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: FIXTURE_HOME },
    });

  console.log('='.repeat(70));
  console.log('AD-HOC VERIFICATION: Claude Chat Index Plugin (hermetic fixture)');
  console.log('='.repeat(70));
  console.log('');

  // Test 1: Verify the plugin file exists
  test('Plugin file exists', () => {
    assert(existsSync(PLUGIN_PATH), `Plugin not found at ${PLUGIN_PATH}`);
  });

  // Test 2: Verify the fixture history file was created
  test('Fixture history file created', () => {
    assert(existsSync(FIXTURE_HISTORY), `Fixture not created at ${FIXTURE_HISTORY}`);
  });

  // Test 3: Test the list command
  test('List command executes successfully', () => {
    const output = run('list');
    assert(output.includes('CLAUDE CONVERSATIONS'), 'Output missing header');
    assert(output.includes('4 found'), 'Expected 4 sessions (corrupt line must be ignored)');
  });

  // Test 4: Verify list returns conversations in recency order
  test('List returns conversations in recency order', () => {
    const output = run('list');
    const pos = (id) => output.indexOf(id);
    assert(pos('s3-ccc') !== -1 && pos('s2-bbb') !== -1 && pos('s1-aaa') !== -1 && pos('s4-ddd') !== -1, 'Missing expected sessions in output');
    assert(pos('s3-ccc') < pos('s2-bbb'), 's3 (most recent) must come before s2');
    assert(pos('s2-bbb') < pos('s1-aaa'), 's2 must come before s1');
    assert(pos('s1-aaa') < pos('s4-ddd'), 's1 must come before s4 (missing timestamp → oldest)');
  });

  // Test 5: Test the search command (filtered result)
  test('Search command filters correctly', () => {
    const output = run('search alpha');
    assert(output.includes('1 found'), 'Expected exactly 1 match for "alpha"');
    assert(output.includes('s2-bbb'), 'Expected s2 in results');
  });

  // Test 6 (REGRESSION R2): search indices must come from the FULL list,
  // i.e. be compatible with `absorb`. "project" matches s2 and s1 →
  // they must appear as [2] and [3] (global positions), NOT [1] and [2].
  test('Search indices match absorb index space (regression R2)', () => {
    const output = run('search project');
    assert(output.includes('2 found'), 'Expected 2 matches for "project"');
    assert(output.includes('[2] s2-bbb'), 's2 must show global index [2] in search output');
    assert(output.includes('[3] s1-aaa'), 's1 must show global index [3] in search output');
    assert(!output.includes('[1] s'), 'filtered results must not renumber from [1]');
  });

  // Test 7: Test the absorb command (first conversation)
  test('Absorb command executes successfully', () => {
    const output = run('absorb 1');
    assert(output.includes('=== CLAUDE CONVERSATION CONTEXT FOR HERMES ==='), 'Absorb missing header');
    assert(output.includes('Session ID: s3-ccc'), 'Absorb 1 must resolve to s3 (most recent)');
    assert(output.includes('=== END OF CONTEXT ==='), 'Absorb missing footer');
  });

  // Test 8 (REGRESSION R1): absorb/list with a session WITHOUT `project`
  // must not crash and must display '(unknown)'.
  test('Session without project does not crash (regression R1)', () => {
    const outList = run('list');
    assert(outList.includes('(unknown)'), 'list must render "(unknown)" for missing project');
    const outAbsorb = run('absorb 2');
    assert(outAbsorb.includes('Session ID: s2-bbb'), 'absorb 2 must resolve to s2');
    assert(outAbsorb.includes('Project: (unknown)'), 'absorb must render "(unknown)" for missing project');
  });

  // Test 9: Test that absorb with an invalid index returns an error
  test('Absorb with invalid index returns error', () => {
    try {
      execSync(`node ${PLUGIN_PATH} absorb 99999`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: { ...process.env, HOME: FIXTURE_HOME },
      });
      throw new Error('Should have failed with invalid index');
    } catch (error) {
      assert(error.stderr && error.stderr.includes('Invalid index'), 'Error message incorrect');
    }
  });

  // Test 10: Verify the absorb output structure
  test('Absorb output format is correct', () => {
    const output = run('absorb 3');
    const hasHeader = output.includes('=== CLAUDE CONVERSATION CONTEXT FOR HERMES ===');
    const hasSessionId = output.includes('Session ID: s1-aaa');
    const hasProject = output.includes('Project: /home/x/proj-a');
    const hasTitle = output.includes('Title:');
    const hasPeriod = output.includes('Period:');
    const hasMessageCount = output.match(/Total messages: \d+/);
    const hasContent = output.includes('=== CONVERSATION CONTENT ===');
    const hasFooter = output.includes('=== END OF CONTEXT ===');
    const hasTip = output.includes('Tip:');
    const hasBothMessages =
      output.includes('initial long message') && output.includes('second message of proj-a');

    assert(hasHeader && hasSessionId && hasProject && hasTitle &&
           hasPeriod && hasMessageCount && hasContent && hasFooter && hasTip,
           'Output structure incomplete');
    assert(hasBothMessages, 'absorb must include all messages of the session');
  });

  // Test 11 (REGRESSION R3): an entry without a `timestamp` must not produce
  // 'Invalid Date' or NaN in the output.
  test('Missing timestamp produces sane output (regression R3)', () => {
    const output = run('list');
    assert(!output.includes('Invalid Date'), "Output must not contain 'Invalid Date'");
    assert(!output.includes('NaN'), 'Output must not contain NaN');
  });

  // Test 12: Test the help command
  test('Help command executes successfully', () => {
    const output = run('--help');
    assert(output.includes('Claude Chat Index Plugin'), 'Help missing title');
    assert(output.includes('list'), 'Help missing list command');
    assert(output.includes('absorb'), 'Help missing absorb command');
    assert(output.includes('search'), 'Help missing search command');
  });

} finally {
  // Cleans up the fixture
  rmSync(FIXTURE_HOME, { recursive: true, force: true });
}

console.log('');
console.log('='.repeat(70));
console.log(`RESULT: ${passed} passed, ${failed} failed`);
console.log('='.repeat(70));

if (failed > 0) {
  console.log('');
  console.log('⚠️  Verification failed. Review the errors above.');
  process.exit(1);
} else {
  console.log('');
  console.log('✅ All tests passed!');
  console.log('');
  console.log('Note: This is an ad-hoc verification with a hermetic fixture, not a');
  console.log('full test suite. Validated functionalities:');
  console.log('  - list: Lists conversations ordered by date (with a corrupt line tolerated)');
  console.log('  - search: Search by term with global indices (compatible with absorb)');
  console.log('  - absorb: Absorbs a conversation context (incl. session without project/timestamp)');
  process.exit(0);
}