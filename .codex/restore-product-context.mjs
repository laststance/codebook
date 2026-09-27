import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Supplies current repository instructions to Codex after compaction. Called by the SessionStart command hook. @example echo '{"hook_event_name":"SessionStart","source":"compact"}' | node .codex/restore-product-context.mjs */
async function restoreProductContext() {
  let input = '';
  // Hook events are small; reject oversized input before retaining an unbounded payload.
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 65_536) throw new Error('Hook input exceeds 64 KiB.');
  }
  const event = JSON.parse(input);
  if (event?.hook_event_name !== 'SessionStart' || event.source !== 'compact') return;

  const root = fileURLToPath(new URL('../', import.meta.url));
  const instructions = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  if (!/^## (Mandatory entry|Read before acting)$/m.test(instructions)) throw new Error('AGENTS.md is missing its entry instructions.');
  const context = [
    'CODEBOOK: RESTORE PRODUCT CONTEXT AFTER COMPACTION',
    `Repository root: ${root}`,
    'Before continuing implementation or runtime trials, perform the repository entry procedure below again using the current files on disk. Read every required document in full, follow PROJECT_STATE.md to the active cycle, and open the approved PNG with an image-viewing tool. A compacted summary or this reminder is not evidence of those reads or image inspection.',
    'Reconcile the current source and affected acceptance gaps, then resume the latest owner-authorized task. Preserve pending owner instructions and any explicit pause; this reminder grants no additional work scope.',
    'Current AGENTS.md follows; resolve its relative links from the repository root:',
    instructions,
  ].join('\n\n');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }) + '\n');
}

restoreProductContext().catch(error => {
  process.stderr.write(`Codebook context restoration failed: ${error.message}\n`);
  process.exitCode = 1;
});
