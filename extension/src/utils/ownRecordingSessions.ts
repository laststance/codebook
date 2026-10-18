/** The writer sessions of this process's recording stores ({@link RecordingStore}), each a random id that no other process has; kept for as long as this process runs. */
const sessionsOfThisProcess = new Set<string>()

/**
 * Remembers a recording store's writer session as one of this process, so that the judgement of a recording's writer tells this window's own recordings by what this window knows; called by {@link RecordingStore} when it is made, before it writes any header with that session.
 * @param sessionId - The store's session id, which every header it writes names as `owner.sessionId`.
 * @example rememberOwnRecordingSession(randomUUID())
 */
export function rememberOwnRecordingSession(sessionId: string): void {
  sessionsOfThisProcess.add(sessionId)
}

/**
 * Says whether a recording's header names this very process as its writer: this process's id and a writer session of one of its recording stores ({@link rememberOwnRecordingSession}); called by the judgement of a recording's writer ({@link recordingWriterState}) before it compares host names, which can change while this window records (macOS takes it from the network).
 * Why: a process id and a time prove nothing about whose recording it is. Another computer's editor can have this window's process id, and its recording can be created after this window began; only the session this window gave its own headers, which no other process has, proves it.
 * @param owner - The writer the header names: its process id and its session.
 * @returns `true` for this process's id with a session of one of its recording stores; `false` for any other, also another computer's editor with this process id and an earlier process of this id.
 * @example isOwnRecording(header.owner) // => true for a recording this window started
 */
export function isOwnRecording(owner: {
  pid: number
  sessionId: string
}): boolean {
  return owner.pid === process.pid && sessionsOfThisProcess.has(owner.sessionId)
}
