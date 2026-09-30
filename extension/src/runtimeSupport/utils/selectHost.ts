/** Rejects unknown runner hosts before launching any editor; called by the harness entry point. @example selectHost('cursor') // 'cursor' */
export function selectHost(value: string | undefined): 'vscode' | 'cursor' {
  if (value === undefined || value === 'vscode') return 'vscode'
  if (value === 'cursor') return 'cursor'
  throw new Error(`Unsupported editor host: ${value}`)
}
