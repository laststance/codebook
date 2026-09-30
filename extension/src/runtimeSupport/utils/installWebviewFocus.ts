export type WebviewFocusReceipt = {
  type: 'codebook-focus-receipt'
  phase: 'prepared' | 'focused'
  requestId: string
  epoch: string
  focused: boolean
}

/** Confirms native focus in owned Application/Context documents without issuing delayed focus effects; HTML generators pass their API. @example installWebviewFocus(api) */
export function installWebviewFocus(api: {
  postMessage(message: WebviewFocusReceipt): unknown
}): void {
  const epoch = crypto.randomUUID()
  let prepared: { requestId: string; expiresAt: number } | undefined
  let committed: typeof prepared
  let reportedFocus = false
  const receipt = (phase: WebviewFocusReceipt['phase'], requestId: string) =>
    api.postMessage({
      type: 'codebook-focus-receipt',
      phase,
      requestId,
      epoch,
      focused: document.visibilityState === 'visible' && document.hasFocus(),
    })
  const observe = () => {
    if (!committed || Date.now() >= committed.expiresAt) {
      committed = undefined
      return
    }
    if (document.visibilityState !== 'visible') {
      if (reportedFocus) receipt('focused', committed.requestId)
      committed = undefined
      return
    }
    // Native activation may reach the inner document later; report its observation without issuing another focus effect.
    const focused = document.hasFocus()
    if (focused !== reportedFocus) {
      reportedFocus = focused
      receipt('focused', committed.requestId)
    }
  }
  window.addEventListener('focus', observe)
  // Learner departure revokes queued focus authority locally before a delayed host cancel can arrive.
  window.addEventListener('blur', () => {
    prepared = undefined
    observe()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      observe()
      prepared = undefined
    }
  })
  window.addEventListener('message', (event) => {
    const message: unknown = event.data
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== 'codebook-focus' ||
      !('requestId' in message) ||
      typeof message.requestId !== 'string' ||
      !('phase' in message)
    )
      return
    if (
      message.phase === 'cancel' &&
      'epoch' in message &&
      message.epoch === epoch
    ) {
      if (prepared?.requestId === message.requestId) prepared = undefined
      if (committed?.requestId === message.requestId) committed = undefined
      return
    }
    if (message.phase === 'prepare') {
      if (
        !('expiresAt' in message) ||
        typeof message.expiresAt !== 'number' ||
        !Number.isFinite(message.expiresAt) ||
        message.expiresAt <= Date.now() ||
        document.visibilityState !== 'visible'
      )
        return
      // Preparing is read-only and supersedes any earlier document-local authority.
      prepared = { requestId: message.requestId, expiresAt: message.expiresAt }
      committed = undefined
      receipt('prepared', message.requestId)
      return
    }
    if (
      message.phase !== 'commit' ||
      !('epoch' in message) ||
      message.epoch !== epoch ||
      prepared?.requestId !== message.requestId
    )
      return
    const authority = prepared
    prepared = undefined
    if (
      Date.now() >= authority.expiresAt ||
      document.visibilityState !== 'visible'
    )
      return
    // Only native reveal owns focus; an unfocused renderer cannot know whether a queued request outlived learner departure.
    committed = authority
    reportedFocus = false
    observe()
  })
}
