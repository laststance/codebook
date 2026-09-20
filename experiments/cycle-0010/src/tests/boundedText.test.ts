import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readBoundedText } from '../utils/readBoundedText';
import { isSourcePosition } from '../utils/isSourcePosition';

test('bounded source reads accept the byte ceiling and reject growth or cancellation before returning text', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-bounded-source-')), path = join(directory, 'source');
  await writeFile(path, 'あ');
  try {
    // Act / Assert
    assert.equal(await readBoundedText(path, 3), 'あ');
    await assert.rejects(readBoundedText(path, 2), /exceeds byte limit/);
    await assert.rejects(readBoundedText(path, 3, AbortSignal.abort()), /aborted/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('source coordinates preserve UTF-16 boundaries and reject impossible debugger locations', () => {
  // Arrange
  const source = '😀\nx';
  // Act / Assert
  assert.equal(isSourcePosition(source, 0, 2), true);
  assert.equal(isSourcePosition(source, 0, 3), false);
  assert.equal(isSourcePosition(source, 1, 1), true);
  assert.equal(isSourcePosition(source, 2, 0), false);
  assert.equal(isSourcePosition(source, -1, 0), false);
  assert.equal(isSourcePosition(source, 0, 0.5), false);
});
