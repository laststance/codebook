import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RecordedEvent {
  sequence: number;
  elapsedMs: number;
  wallTime: string;
  type: string;
  detail: unknown;
}

/** Preserves receipt ordering and serializes disk writes without blocking debugger control. @example evidence.record('stopped', { generation: 1 }) */
export class Evidence {
  readonly events: RecordedEvent[] = [];
  readonly started = process.hrtime.bigint();
  failure?: string;
  private pending: Promise<void>;

  constructor(readonly directory: string) {
    // Even an immediate DELETE/focus event must append only after the directory exists.
    this.pending = mkdir(directory, { recursive: true }).then(() => undefined).catch(error => { this.failure = String(error); });
  }

  /** Records a local receipt time immediately when any runtime lane reports evidence. @example evidence.record('input.accepted', { operationId: 'op' }) */
  record(type: string, detail: unknown = {}): RecordedEvent {
    const event = { sequence: this.events.length + 1, elapsedMs: Number(process.hrtime.bigint() - this.started) / 1e6, wallTime: new Date().toISOString(), type, detail };
    this.events.push(event);
    this.pending = this.pending.then(() => appendFile(join(this.directory, 'events.jsonl'), JSON.stringify(event) + '\n')).catch(error => { this.failure = String(error); });
    return event;
  }

  /** Confirms queued directory initialization before setup proceeds, called by the run. @example await evidence.initialize() */
  async initialize(): Promise<void> {
    await this.flush();
  }

  /** Saves fixed-name evidence supplied by the implementation, never by an HTTP file parameter. @example await evidence.save('snapshot.json', snapshot) */
  async save(name: string, contents: unknown): Promise<void> {
    const bytes = typeof contents === 'string' || Buffer.isBuffer(contents) ? contents : JSON.stringify(contents, null, 2) + '\n';
    // Share the event queue so an older manifest cannot finish after a newer one.
    const saving = this.pending.then(async () => {
      const temporaryPath = join(this.directory, `${name}.tmp`);
      await writeFile(temporaryPath, bytes);
      await rename(temporaryPath, join(this.directory, name));
    });
    this.pending = saving.catch(error => { this.failure = String(error); });
    await saving;
  }

  /** Flushes the append queue before teardown or manifest finalization. @example await evidence.flush() */
  async flush(): Promise<void> {
    await this.pending;
    if (this.failure) throw new Error(`Evidence write failed: ${this.failure}`);
  }
}
