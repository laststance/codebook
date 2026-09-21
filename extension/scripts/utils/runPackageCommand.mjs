import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { PACKAGE_COMMAND_OUTPUT_BYTES, PACKAGE_COMMAND_TIMEOUT_MS, PACKAGE_COMMAND_EXIT_TIMEOUT_MS, PACKAGE_COMMAND_EXIT_POLL_MS } from './packageConstants.mjs';

/** Runs literal package tools and retires their owned POSIX process group before the pipeline resumes. @example await runPackageCommand('pnpm', ['build'], extensionRoot) */
export async function runPackageCommand(executable, arguments_, cwd) {
  if (process.platform === 'win32') throw new Error('Package builds require POSIX process-group cleanup; Windows builds are unsupported.');
  let interruption;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];
  let rejectInterrupted;
  const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
  const handlers = signals.map(signal => [signal, () => {
    interruption ??= Object.assign(new Error(`Package command interrupted by ${signal}.`), { code: 'ABORT_ERR', signal });
    rejectInterrupted(interruption);
  }]);
  // Subscribe before spawn; repeated signals remain handled until the owned group has been retired.
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    // execFile does not forward detached; spawn establishes the group whose lifetime this helper owns.
    const child = spawn(executable, arguments_, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = { stdout: [], stderr: [] };
    // Drain both pipes concurrently, retaining at most the existing limit for each diagnostic channel.
    const readers = ['stdout', 'stderr'].map(async channel => {
      let bytes = 0;
      for await (const chunk of child[channel]) {
        chunks[channel].push(chunk.subarray(0, Math.max(0, PACKAGE_COMMAND_OUTPUT_BYTES - bytes)));
        bytes += chunk.length;
        if (bytes > PACKAGE_COMMAND_OUTPUT_BYTES) throw Object.assign(new Error(`${channel} maxBuffer length exceeded`), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
      }
    });
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      // Detect leader failure before inherited descendant pipes can postpone the close event.
      child.once('exit', (code, signal) => {
        if (code !== 0 || signal !== null) reject(Object.assign(new Error(`Package command failed: ${executable} (${signal ?? code})`), { code, signal }));
      });
      child.once('close', resolve);
    });
    let timer, failure, cleanupFailure;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Package command exceeded its time limit.'), { code: 'ETIMEDOUT' })), PACKAGE_COMMAND_TIMEOUT_MS);
    });
    try { await Promise.race([Promise.all([closed, ...readers]), deadline, interrupted]); }
    catch (error) { failure = error; }
    finally { clearTimeout(timer); }
    try {
      if (child.pid) {
        // A failed pnpm leader can leave compilers writing; stop its separate group before returning either outcome.
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        const cleanupDeadline = Date.now() + PACKAGE_COMMAND_EXIT_TIMEOUT_MS;
        for (;;) {
          try { process.kill(-child.pid, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; }
          if (Date.now() >= cleanupDeadline) throw new Error('Package process group did not exit before cleanup deadline.');
          await delay(PACKAGE_COMMAND_EXIT_POLL_MS);
        }
      }
    } catch (cleanupError) {
      cleanupFailure = cleanupError;
    }
    // Close owned pipes even when an escaped or unkillable process retains an inherited descriptor.
    child.stdout.destroy(); child.stderr.destroy(); await Promise.allSettled(readers);
    const result = { stdout: Buffer.concat(chunks.stdout).toString('utf8'), stderr: Buffer.concat(chunks.stderr).toString('utf8') };
    failure ??= interruption;
    // Settle diagnostics after cleanup and pipe draining so a late owned-phase signal keeps its identity.
    if (cleanupFailure) failure = failure ? Object.assign(new AggregateError([failure, cleanupFailure], 'Package command failed and owned process cleanup could not be confirmed.'), { code: failure.code, signal: failure.signal }) : cleanupFailure;
    if (failure) throw Object.assign(failure, result);
    return result;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    // Let caller finally blocks remove package scratch; terminating this process here would bypass them.
  }
}
