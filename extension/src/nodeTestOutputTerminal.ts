import type * as vscode from 'vscode'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import type { NodeTestOutputEvent } from './utils/launchNodeTest'

const TERMINAL_READY_TIMEOUT_MS = 8_000

/** Presents the owned Node test's actual output in a native, read-only editor terminal before process input begins. Called by {@link OwnedNodeTestRun}; closing it invalidates further live capture. @param runId - Exact owning run. @param editor - Native editor API. @example const output = new NodeTestOutputTerminal(runId); await output.ready(signal); output.write(event) */
export class NodeTestOutputTerminal {
  readonly terminal: vscode.Terminal
  private readonly emitter: vscode.EventEmitter<string>
  private readonly opened: Promise<void>
  private resolveOpen?: () => void
  private rejectOpen?: (error: Error) => void
  private isOpen = false
  private closed = false
  private disposed = false
  private sequence = 0
  private elapsedMs = 0

  constructor(
    runId: string,
    editor: Pick<typeof vscode, 'EventEmitter'> & {
      window: Pick<typeof vscode.window, 'createTerminal'>
    },
    private readonly onUnexpectedClose?: () => void,
  ) {
    this.emitter = new editor.EventEmitter<string>()
    this.opened = new Promise<void>((resolve, reject) => {
      this.resolveOpen = resolve
      this.rejectOpen = reject
    })
    const pty: vscode.Pseudoterminal = {
      onDidWrite: this.emitter.event,
      open: () => {
        if (this.closed) return
        this.isOpen = true
        this.resolveOpen?.()
      },
      close: () => {
        this.closed = true
        this.isOpen = false
        this.rejectOpen?.(
          new Error(
            'Owned Node test output terminal closed before capture was ready.',
          ),
        )
        if (!this.disposed) this.onUnexpectedClose?.()
      },
    }
    this.terminal = editor.window.createTerminal({
      name: `Codebook · Test output ${runId.slice(0, 8)}`,
      pty,
    })
    this.terminal.show(true)
  }

  /** Waits for the actual native terminal renderer before letting the test process produce output. @example await output.ready(signal) */
  async ready(signal: AbortSignal): Promise<void> {
    await awaitResponse(
      this.opened,
      'owned Node test output terminal',
      signal,
      TERMINAL_READY_TIMEOUT_MS,
    )
    if (!this.isOpen || this.closed)
      throw new Error('Owned Node test output terminal is unavailable.')
  }

  /** Restores this run's actual output tab after the native debugger opens its console. @example output.reveal() */
  reveal(): void {
    if (!this.isOpen || this.closed)
      throw new Error('Owned Node test output terminal was closed.')
    this.terminal.show(true)
  }

  /** Writes only the next observed output receipt without echoing input or synthesizing a test result. @example output.write({sequence:1,elapsedMs:12,channel:'stdout',text:'RUN\n'}) */
  write(event: NodeTestOutputEvent): void {
    if (!this.isOpen || this.closed)
      throw new Error('Owned Node test output terminal was closed.')
    if (
      event.sequence !== this.sequence + 1 ||
      !Number.isFinite(event.elapsedMs) ||
      event.elapsedMs < this.elapsedMs ||
      event.text.length > 4_096
    )
      throw new Error(
        'Node test output receipt is missing, repeated or out of order.',
      )
    this.sequence = event.sequence
    this.elapsedMs = event.elapsedMs
    this.emitter.fire(event.text.replace(/\r?\n/g, '\r\n'))
  }

  /** Releases only this run's terminal and event source after owned execution ends. @example output.dispose() */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.closed = true
    this.isOpen = false
    this.rejectOpen?.(
      new Error(
        'Owned Node test output terminal closed before capture was ready.',
      ),
    )
    this.terminal.dispose()
    this.emitter.dispose()
  }
}
