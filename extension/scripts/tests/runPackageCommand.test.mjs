import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const utilitySource = new URL('../utils/', import.meta.url);

/** Isolates real lifecycle descendants with a shorter test-only deadline while preserving the runner and output limit. @example const fixture = await commandFixture(context, 'overflow') */
async function commandFixture(context, scenario, cleanupTimeoutMs = 5000) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-command-'));
  context.after(async () => {
    // A red-before run can leave the recorded fixture writer alive; never clean up by process name.
    for (const name of ['lifecycle.json', 'writer.json']) {
      const record = await readFile(join(directory, name), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (!record) continue;
      const { pid } = JSON.parse(record);
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(join(directory, 'utils'));
  await writeFile(join(directory, 'utils/runPackageCommand.mjs'), await readFile(new URL('runPackageCommand.mjs', utilitySource)));
  await writeFile(join(directory, 'utils/withPackageOutput.mjs'), await readFile(new URL('withPackageOutput.mjs', utilitySource)));
  const constants = (await readFile(new URL('packageConstants.mjs', utilitySource), 'utf8'))
    .replace(/(export const PACKAGE_COMMAND_TIMEOUT_MS = )[\d_]+;/, '$15000;')
    .replace(/(export const PACKAGE_COMMAND_EXIT_TIMEOUT_MS = )[\d_]+;/, (_, declaration) => `${declaration}${cleanupTimeoutMs};`);
  assert.match(constants, /PACKAGE_COMMAND_TIMEOUT_MS = 5000;/);
  await writeFile(join(directory, 'utils/packageConstants.mjs'), constants);
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'codebook-command-fixture', private: true, scripts: { build: 'node parent.mjs' } }));
  await writeFile(join(directory, 'writer.mjs'), `import {writeFileSync} from 'node:fs';
writeFileSync('writer.json',JSON.stringify({pid:process.pid}));
process.on('SIGTERM',()=>{});
const hold=setInterval(()=>{},100);
process.on('message',message=>{if(message==='finish'){writeFileSync('completed.txt','child completed');clearInterval(hold);process.disconnect();}});
process.send('ready');
`);
  const action = scenario === 'overflow' ? "process.stdout.write(Buffer.alloc(9*1024*1024,'x'));"
    : scenario === 'exit' ? 'process.exit(2);' : scenario === 'success' ? "child.send('finish');process.stdout.write('fixture finished\\n');" : 'setInterval(()=>{},100);';
  await writeFile(join(directory, 'parent.mjs'), `import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';
writeFileSync('lifecycle.json',JSON.stringify({pid:process.pid}));
const child=spawn(process.execPath,['writer.mjs'],{stdio:['ignore','inherit','inherit','ipc']});
child.once('message',()=>{${action}});
`);
  const { runPackageCommand } = await import(pathToFileURL(join(directory, 'utils/runPackageCommand.mjs')).href);
  return { directory, runPackageCommand };
}

for (const [scenario, expectedCode] of [['overflow', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'], ['exit', 2], ['timeout', 'ETIMEDOUT']]) {
  test(`a package build failing through ${scenario} retires inherited-output descendants before rejecting`, async context => {
    // Arrange
    const fixture = await commandFixture(context, scenario);
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},100);'], { stdio: 'ignore' });
    const unrelatedExit = new Promise(resolve => unrelated.once('exit', resolve));
    context.after(async () => { unrelated.kill('SIGKILL'); await unrelatedExit; });
    // Act
    let failure;
    try { await fixture.runPackageCommand('pnpm', ['build'], fixture.directory); } catch (error) { failure = error; }
    // Assert
    assert.ok(failure); assert.equal(failure.code, expectedCode, JSON.stringify({ message: failure.message, stack: failure.stack, errors: failure.errors?.map(error => ({message:error.message,code:error.code,stack:error.stack})) }));
    if (scenario === 'exit') assert.match(failure.stderr, /ELIFECYCLE|exit code 2/);
    if (scenario === 'overflow') assert.equal(Buffer.byteLength(failure.stdout), 8 * 1024 * 1024);
    for (const name of ['lifecycle.json', 'writer.json']) {
      const { pid } = JSON.parse(await readFile(join(fixture.directory, name), 'utf8'));
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    await assert.rejects(readFile(join(fixture.directory, 'completed.txt')), { code: 'ENOENT' });
  });
}

test('a successful package build drains its child output and keeps the child result', async context => {
  // Arrange
  const fixture = await commandFixture(context, 'success');
  // Act
  const result = await fixture.runPackageCommand('pnpm', ['build'], fixture.directory);
  // Assert
  assert.match(result.stdout, /fixture finished\n/);
  assert.equal(await readFile(join(fixture.directory, 'completed.txt'), 'utf8'), 'child completed');
  const { pid } = JSON.parse(await readFile(join(fixture.directory, 'writer.json'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('package subprocess arguments remain literal and both diagnostic streams are retained', async context => {
  // Arrange
  const fixture = await commandFixture(context, 'success');
  // Act
  const result = await fixture.runPackageCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1]);process.stderr.write("diagnostic");', ' literal $() `argument` 雪 '], fixture.directory);
  // Assert
  assert.deepEqual(result, { stdout: ' literal $() `argument` 雪 ', stderr: 'diagnostic' });
});

test('an unavailable package executable preserves its spawn error without claiming process cleanup', async context => {
  // Arrange
  const fixture = await commandFixture(context, 'success');
  // Act / Assert
  await assert.rejects(fixture.runPackageCommand(join(fixture.directory, 'unavailable'), [], fixture.directory), { code: 'ENOENT', stdout: '', stderr: '' });
});

/** Exercises terminal-group interruption through a real package parent after its lifecycle writer is ready. @example await interruptPackageParent(context, fixture, 'SIGINT') */
async function interruptPackageParent(context, fixture, signal, callerHandlesSignal = false) {
  const runner = pathToFileURL(join(fixture.directory, 'utils/runPackageCommand.mjs')).href;
  await writeFile(join(fixture.directory, 'codebook.vsix'), 'previous verified archive');
  const outputHelper = pathToFileURL(join(fixture.directory, 'utils/withPackageOutput.mjs')).href;
  const script = `import {runPackageCommand} from ${JSON.stringify(runner)}; import {withPackageOutput} from ${JSON.stringify(outputHelper)}; import {writeFileSync} from 'node:fs'; import {join} from 'node:path';
let signalsHandled=0;
${callerHandlesSignal ? `process.on(${JSON.stringify(signal)},()=>{signalsHandled++;});` : ''}
try { await withPackageOutput(join(process.cwd(),'codebook.vsix'),async({candidate})=>{writeFileSync(candidate,'unfinished candidate');await runPackageCommand('pnpm',['build'],process.cwd());}); }
catch(error) { writeFileSync('interrupt-result.json',JSON.stringify({code:error.code,signal:error.signal,signalsHandled,remainingListeners:process.listenerCount(${JSON.stringify(signal)})})); ${callerHandlesSignal ? '' : 'throw error;'} }
`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: fixture.directory, detached: true, stdio: 'ignore' });
  const exited = new Promise((resolve, reject) => { parent.once('error', reject); parent.once('exit', (code, signal) => resolve({ code, signal })); });
  context.after(async () => {
    if (parent.exitCode === null && parent.signalCode === null) {
      try { process.kill(-parent.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await exited;
  });
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    ready = await readFile(join(fixture.directory, 'writer.json')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    if (ready) break;
    await delay(10);
  }
  assert.equal(ready, true, 'The real pnpm lifecycle writer must exist before terminal interruption.');
  process.kill(-parent.pid, signal);
  return await exited;
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
  test(`interrupting the package foreground group with ${signal} retires descendants and package scratch while preserving the previous archive`, { timeout: 15_000 }, async context => {
    // Arrange
    const fixture = await commandFixture(context, 'timeout');
    // Act
    const exit = await interruptPackageParent(context, fixture, signal);
    // Assert
    assert.deepEqual(exit, { code: 1, signal: null });
    assert.deepEqual(JSON.parse(await readFile(join(fixture.directory, 'interrupt-result.json'), 'utf8')), { code: 'ABORT_ERR', signal, signalsHandled: 0, remainingListeners: 0 });
    assert.equal(await readFile(join(fixture.directory, 'codebook.vsix'), 'utf8'), 'previous verified archive');
    assert.deepEqual((await readdir(fixture.directory)).filter(name => name.startsWith('.codebook-package-')), []);
    for (const name of ['lifecycle.json', 'writer.json']) {
      const { pid } = JSON.parse(await readFile(join(fixture.directory, name), 'utf8'));
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
  });
}

for (const scenario of ['exit', 'success']) {
  test(`unconfirmed cleanup after command ${scenario} rejects without losing the original failure identity`, async context => {
    // Arrange: stop the real group, but inject an inconclusive existence probe at a zero cleanup deadline.
    const fixture = await commandFixture(context, scenario, 0);
    const sendSignal = process.kill.bind(process);
    const killMock = context.mock.method(process, 'kill', (pid, signal) => pid < 0 && signal === 0 ? true : sendSignal(pid, signal));
    // Act
    let failure;
    try { await fixture.runPackageCommand('pnpm', ['build'], fixture.directory); } catch (error) { failure = error; }
    finally { killMock.mock.restore(); }
    // Assert
    assert.ok(failure);
    if (scenario === 'exit') {
      assert.ok(failure instanceof AggregateError);
      assert.equal(failure.code, 2);
      assert.equal(failure.signal, null);
      assert.equal(failure.errors[0].code, 2);
      assert.match(failure.errors[1].message, /did not exit before cleanup deadline/);
      assert.match(failure.stderr, /ELIFECYCLE|exit code 2/);
    } else {
      assert.match(failure.message, /did not exit before cleanup deadline/);
      assert.match(failure.stdout, /fixture finished\n/);
    }
  });
}

test('a caller-owned interrupt handler runs once and survives package descendant cleanup', { timeout: 15_000 }, async context => {
  // Arrange
  const fixture = await commandFixture(context, 'timeout');
  // Act
  const exit = await interruptPackageParent(context, fixture, 'SIGINT', true);
  // Assert
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.equal(await readFile(join(fixture.directory, 'codebook.vsix'), 'utf8'), 'previous verified archive');
  assert.deepEqual((await readdir(fixture.directory)).filter(name => name.startsWith('.codebook-package-')), []);
  assert.deepEqual(JSON.parse(await readFile(join(fixture.directory, 'interrupt-result.json'), 'utf8')), { code: 'ABORT_ERR', signal: 'SIGINT', signalsHandled: 1, remainingListeners: 1 });
  for (const name of ['lifecycle.json', 'writer.json']) {
    const { pid } = JSON.parse(await readFile(join(fixture.directory, name), 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
});

test('an interruption during cleanup retains its identity when the successful command cannot confirm group exit', async context => {
  // Arrange: a real successful child reaches a failing cleanup probe while its signal ownership is still active.
  const fixture = await commandFixture(context, 'success');
  const sendSignal = process.kill.bind(process);
  const existingListeners = process.listeners('SIGHUP');
  const killMock = context.mock.method(process, 'kill', (pid, signal) => {
    if (pid < 0 && signal === 0) {
      process.emit('SIGHUP');
      throw Object.assign(new Error('Injected cleanup probe denial'), { code: 'EPERM' });
    }
    return sendSignal(pid, signal);
  });
  // Act
  let failure;
  try { await fixture.runPackageCommand('pnpm', ['build'], fixture.directory); } catch (error) { failure = error; }
  finally { killMock.mock.restore(); }
  // Assert
  assert.ok(failure instanceof AggregateError);
  assert.equal(failure.code, 'ABORT_ERR');
  assert.equal(failure.signal, 'SIGHUP');
  assert.equal(failure.errors[0].code, 'ABORT_ERR');
  assert.equal(failure.errors[1].code, 'EPERM');
  assert.match(failure.stdout, /fixture finished\n/);
  assert.deepEqual(process.listeners('SIGHUP'), existingListeners);
});
