export interface PauseIdentity {
  sessionId: string
  threadId: number
  generation: number
}

/** Reserves pauses synchronously for HTTP callers; DAP events invalidate in-flight inspection. @example gate.reserve(gate.stop('page', 3)) // true */
export class PauseGate {
  generation = 0
  current?: PauseIdentity
  phase: 'running' | 'paused' | 'resume-requested' = 'running'
  conflict = false

  /** Assigns a fresh identity when the owned target emits a real stop. @example gate.stop('page', 3).generation // 1 */
  stop(sessionId: string, threadId: number): PauseIdentity {
    this.current = { sessionId, threadId, generation: ++this.generation }
    this.phase = 'paused'
    return this.current
  }

  /** Checks identity around every async inspection to reject mixed stops. @example gate.matches(oldPause) // false after resume */
  matches(identity: PauseIdentity): boolean {
    return (
      this.phase === 'paused' &&
      this.current?.generation === identity.generation &&
      this.current.sessionId === identity.sessionId &&
      this.current.threadId === identity.threadId
    )
  }

  /** Claims the stop before any await in a continue handler. @example gate.reserve(identity) // false for a duplicate */
  reserve(identity: PauseIdentity): boolean {
    if (!this.matches(identity)) return false
    this.phase = 'resume-requested'
    return true
  }

  /** Invalidates live references on actual or manual resume; captured snapshots stay historical. @example gate.invalidate(true) // marks a control conflict */
  invalidate(conflict = false): void {
    this.conflict ||= conflict
    this.current = undefined
    this.phase = 'running'
  }
}
