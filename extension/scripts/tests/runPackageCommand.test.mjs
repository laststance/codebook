import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const utilitySource = new URL('../utils/', import.meta.url);

/** Isolates real lifecycle descendants with a shorter test-only deadline while preserving the runner and output limit. @example const fixture = await commandFixture(context, 'overflow') */
async function commandFixture(context, scenario) {
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
  const constants = (await readFile(new URL('packageConstants.mjs', utilitySource), 'utf8')).replace(/(export const PACKAGE_COMMAND_TIMEOUT_MS = )[\d_]+;/, '$15000;');
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
    assert.ok(failure); assert.equal(failure.code, expectedCode);
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
