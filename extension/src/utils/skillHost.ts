import { AsyncLocalStorage } from 'node:async_hooks'

/** The editors whose user skill folder Codebook deploys the bundled skill into ({@link runForSkillHost}). */
export type SkillHost = 'cursor' | 'devin'

/** What differs between the hosts for the skill deployment: where the skill lives, what is created above it, where its receipts live, and how the sentences name the host. */
type SkillHostDefinition = {
  /** Folders below the home folder that are created when missing, the upper one first; the last is the folder that holds the skill folder. */
  foldersAbove: readonly (readonly string[])[]
  /** The skill folder below the home folder. */
  skillFolder: readonly string[]
  /** The folder in Codebook's private storage that holds the receipt and the records. */
  receiptFolderName: string
  /** The host as every sentence names it. */
  label: string
  /** The removal command's title, which refusals name as the one to run again. */
  removalCommand: string
}

/** The one table of host differences; Cursor's values are the ones the skill deployment always had. */
const SKILL_HOSTS: Record<SkillHost, SkillHostDefinition> = {
  cursor: {
    foldersAbove: [['.cursor'], ['.cursor', 'skills']],
    skillFolder: ['.cursor', 'skills', 'codebook'],
    receiptFolderName: 'cursor-skill',
    label: 'Cursor',
    removalCommand: 'Codebook: Remove Managed Cursor Skill',
  },
  devin: {
    foldersAbove: [
      ['.config'],
      ['.config', 'devin'],
      ['.config', 'devin', 'skills'],
    ],
    skillFolder: ['.config', 'devin', 'skills', 'codebook'],
    receiptFolderName: 'devin-skill',
    label: 'Devin Desktop',
    removalCommand: 'Codebook: Remove Devin Desktop Setup',
  },
}

const hostOfRun = new AsyncLocalStorage<SkillHost>()

/**
 * Runs one skill command for a host, so every path, receipt folder and sentence below it reads that host's row of the table; called by the entries of the skill deployment ({@link deployCursorSkill}, {@link deployDevinSkill} and their siblings).
 * @param host - The editor the command is for.
 * @param run - The command's work.
 * @returns What `run` returned.
 * @example await runForSkillHost('devin', () => deploySkill('/ext', '/private', '/home', 'setup'))
 */
export function runForSkillHost<Result>(
  host: SkillHost,
  run: () => Promise<Result>,
): Promise<Result> {
  return hostOfRun.run(host, run)
}

/**
 * Reads the table row of the host the running command is for; Cursor outside {@link runForSkillHost}, so Cursor's callers need no change.
 * @returns The row.
 * @example currentSkillHost().label // => 'Cursor'
 */
export function currentSkillHost(): SkillHostDefinition {
  return SKILL_HOSTS[hostOfRun.getStore() ?? 'cursor']
}
