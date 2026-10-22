import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Claude Code injects hook context of up to 10,000 characters whole; longer text arrives only as a 2,000-character preview.
const MAX_CONTEXT_CHARS = 10_000
// The sections every restored context carries verbatim; the rest of AGENTS.md is read from disk.
const RESTORED_SECTIONS = ['## Mandatory entry', '## Owner directions in force']

/**
 * Returns one `## ` section of AGENTS.md, from its heading to the next `## ` heading.
 *
 * Why: the restored context carries only the sections that order the re-entry and keep the owner's scope, so it stays within the hosts' context limits.
 * Caller: {@link restoreProductContext}.
 *
 * @param instructions - The current AGENTS.md text.
 * @param heading - The exact `## ` heading line.
 * @returns The section text without trailing blank lines.
 * @throws When the heading is missing, so that a renamed section never restores silently without it.
 * @example
 * sectionOf('# A\n\n## Mandatory entry\n\nRead.\n\n## Next\n', '## Mandatory entry') // => '## Mandatory entry\n\nRead.'
 */
function sectionOf(instructions, heading) {
  const lines = instructions.split('\n')
  const start = lines.indexOf(heading)
  if (start === -1)
    throw new Error(`AGENTS.md is missing its ${heading.slice(3)} section.`)
  const next = lines.findIndex(
    (line, index) => index > start && line.startsWith('## '),
  )
  return lines
    .slice(start, next === -1 ? lines.length : next)
    .join('\n')
    .trimEnd()
}

/** Supplies the owner's re-entry rule and current repository instructions after compaction. Called by the SessionStart command hook. @example echo '{"hook_event_name":"SessionStart","source":"compact"}' | node .codex/restore-product-context.mjs */
async function restoreProductContext() {
  let input = ''
  // Hook events are small; reject oversized input before retaining an unbounded payload.
  for await (const chunk of process.stdin) {
    input += chunk
    if (Buffer.byteLength(input) > 65_536)
      throw new Error('Hook input exceeds 64 KiB.')
  }
  const event = JSON.parse(input)
  if (event?.hook_event_name !== 'SessionStart' || event.source !== 'compact')
    return

  const root = fileURLToPath(new URL('../', import.meta.url))
  const instructions = await readFile(
    new URL('../AGENTS.md', import.meta.url),
    'utf8',
  )
  const rule = [
    'CODEBOOK: RESTORE PRODUCT CONTEXT AFTER COMPACTION',
    `Repository root: ${root}`,
    "The owner's most important rule: before any other work after this compaction, whatever the task, read PRODUCT_GOAL.md in full, every line, and open the approved PNG (docs/designs/assets/codebook-product-spec-v9.png) with an image-viewing tool and check its identity against PRODUCT_GOAL.md's Design target; then read the active cycle Issue (the open Issue with the label `cycle`) with its comments and AGENTS.md in full from disk. A compacted summary or this reminder is not evidence of those reads or of the image inspection.",
    'Reconcile the current source and affected acceptance gaps, then resume the latest owner-authorized task. Preserve pending owner instructions and any explicit pause; this reminder grants no additional work scope.',
  ]
  const sections = RESTORED_SECTIONS.map((heading) =>
    sectionOf(instructions, heading),
  )
  const full = [
    ...rule,
    'These AGENTS.md sections follow verbatim; read the whole file on disk and resolve its relative links from the repository root:',
    ...sections,
  ].join('\n\n')
  // A grown AGENTS.md must never push the rule out of the inline context: keep the rule and point to the file.
  const context =
    full.length <= MAX_CONTEXT_CHARS
      ? full
      : [
          ...rule,
          `AGENTS.md's ${RESTORED_SECTIONS.map((heading) => heading.slice(3)).join(' and ')} sections exceed this reminder's ${MAX_CONTEXT_CHARS}-character limit; read them in AGENTS.md on disk now.`,
        ].join('\n\n')
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    }) + '\n',
  )
}

restoreProductContext().catch((error) => {
  process.stderr.write(
    `Codebook context restoration failed: ${error.message}\n`,
  )
  process.exitCode = 1
})
