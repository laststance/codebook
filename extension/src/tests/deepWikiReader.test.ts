import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDeepWikiManifest, startDeepWikiReader } from '../deepWikiReader';

test('generated Wiki reader serves published pages and answers an explicit same-origin question', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-'));
  const projectRoot = await realpath(projectDirectory);
  const output = join(projectRoot, '.codebook', 'wiki');
  await mkdir(join(output, 'pages'), { recursive: true });
  await writeFile(join(output, 'index.html'), '<!doctype html><body><a href="pages/qa.html">Ask</a></body>');
  await writeFile(join(output, 'pages/qa.html'), '<!doctype html><body><form id="qa-form"><textarea></textarea><div class="qa-answer"></div></form></body>');
  await writeFile(join(output, 'secret.txt'), 'private');
  await writeFile(join(output, 'codebook-wiki.json'), JSON.stringify({ schemaVersion: 1, repositoryRoot: projectRoot, pages: [{ path: 'pages/qa.html' }], assets: [], includedSources: [{ path: 'src/a.ts', sha256: 'a'.repeat(64) }] }));
  const received: string[] = [];
  const reader = await startDeepWikiReader(output, projectRoot, async (question, sources) => {
    received.push(question);
    assert.equal(sources[0]?.path, 'src/a.ts');
    return { answer: 'The source confirms it.', citations: [{ path: 'src/a.ts', line: 1, uri: 'vscode://laststance.codebook/source' }], sourceChanged: false };
  });
  try {
    // Act
    const page = await fetch(new URL('pages/qa.html', reader.url));
    const pageHtml = await page.text();
    const client = await fetch(new URL('codebook-qa.js', reader.url));
    const clientScript = await client.text();
    const freshness = await fetch(new URL('api/freshness', reader.url));
    const origin = new URL(reader.url).origin;
    const api = new URL('api/ask', reader.url);
    const answer = await fetch(api, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Where is it?' }) });
    const crossOrigin = await fetch(api, { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Where is it?' }) });
    const privateFile = await fetch(new URL('secret.txt', reader.url));
    await writeFile(join(output, 'pages/new.html'), '<!doctype html><body>New chapter</body>');
    await writeFile(join(output, 'codebook-wiki.json'), JSON.stringify({ schemaVersion: 1, repositoryRoot: projectRoot, pages: [{ path: 'pages/qa.html' }, { path: 'pages/new.html' }], assets: [], includedSources: [{ path: 'src/a.ts', sha256: 'a'.repeat(64) }] }));
    const publishedLater = await fetch(new URL('pages/new.html', reader.url));
    const publishedLaterHtml = await publishedLater.text();
    // Assert
    assert.equal(page.status, 200);
    assert.match(pageHtml, /codebook-qa\.js/);
    assert.equal(client.status, 200);
    assert.match(clientScript, /Connected to Codebook reader/);
    assert.equal(freshness.status, 200);
    assert.equal((await freshness.json()).status, 'changed');
    assert.equal(answer.status, 200);
    assert.deepEqual((await answer.json()).answer, 'The source confirms it.');
    assert.deepEqual(received, ['Where is it?']);
    assert.equal(crossOrigin.status, 403);
    assert.equal(privateFile.status, 404);
    assert.equal(publishedLater.status, 200);
    assert.match(publishedLaterHtml, /New chapter/);
    assert.match(publishedLaterHtml, /codebook-qa\.js/);
    assert.match(clientScript, /data-shortcut-help/);
    assert.match(clientScript, /Keyboard shortcuts/);
    assert.match(clientScript, /outside text inputs/);
  } finally { await reader.close(); await rm(projectDirectory, { recursive: true, force: true }); }
});

test('generated Wiki reader refuses a published symlink escaping its output directory', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-link-'));
  const projectRoot = await realpath(projectDirectory);
  const output = join(projectRoot, '.codebook', 'wiki');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'index.html'), '<!doctype html><body></body>');
  await writeFile(join(projectRoot, 'outside.txt'), 'private');
  await symlink(join(projectRoot, 'outside.txt'), join(output, 'outside.txt'));
  await writeFile(join(output, 'codebook-wiki.json'), JSON.stringify({ schemaVersion: 1, repositoryRoot: projectRoot, pages: [{ path: 'index.html' }], assets: ['outside.txt'], includedSources: [] }));
  const reader = await startDeepWikiReader(output, projectRoot, async () => { throw new Error('No model request expected.'); });
  try {
    // Act
    const response = await fetch(new URL('outside.txt', reader.url));
    // Assert
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /private/);
  } finally { await reader.close(); await rm(projectDirectory, { recursive: true, force: true }); }
});

test('generated Wiki reader refuses malformed source identities rather than showing false freshness', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-manifest-'));
  const projectRoot = await realpath(projectDirectory);
  const output = join(projectRoot, '.codebook', 'wiki');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'index.html'), '<!doctype html><body></body>');
  await writeFile(join(output, 'codebook-wiki.json'), JSON.stringify({ schemaVersion: 1, repositoryRoot: projectRoot, pages: [{ path: 'index.html' }], assets: [], includedSources: [{ path: 'src/a.ts', sha256: 'not-a-hash' }] }));
  try {
    // Act / Assert
    await assert.rejects(readDeepWikiManifest(output, projectRoot), /invalid or duplicate included source identities/);
  } finally { await rm(projectDirectory, { recursive: true, force: true }); }
});

test('the same published Wiki opens source and update links in the active editor without rewriting static files', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-links-'));
  const projectRoot = await realpath(projectDirectory);
  const output = join(projectRoot, '.codebook', 'wiki');
  await mkdir(output, { recursive: true });
  const publishedHtml = '<!doctype html><body><a href="vscode://laststance.codebook/source?path=src%2Fa.ts">Source</a><a href="vscode://laststance.codebook/update?root=%2Frepo">Update</a><a href="vscode://laststance.codebook/settings?root=%2Frepo">Change location</a><a href="cursor://laststance.codebook/source?path=src%2Fb.ts">Older Cursor link</a><a href="https://example.com/wiki">Other</a></body>';
  await writeFile(join(output, 'index.html'), publishedHtml);
  await writeFile(join(output, 'codebook-wiki.json'), JSON.stringify({ schemaVersion: 1, repositoryRoot: projectRoot, pages: [{ path: 'index.html' }], assets: [], includedSources: [] }));
  const answer = async () => { throw new Error('No model request expected.'); };
  const cursorReader = await startDeepWikiReader(output, projectRoot, answer, 'cursor');
  const codeReader = await startDeepWikiReader(output, projectRoot, answer, 'vscode');
  try {
    // Act
    const cursorHtml = await (await fetch(cursorReader.url)).text();
    const codeHtml = await (await fetch(codeReader.url)).text();

    // Assert
    assert.match(cursorHtml, /href="cursor:\/\/laststance\.codebook\/source\?path=src%2Fa\.ts"/);
    assert.match(cursorHtml, /href="cursor:\/\/laststance\.codebook\/update\?root=%2Frepo"/);
    assert.match(cursorHtml, /href="cursor:\/\/laststance\.codebook\/settings\?root=%2Frepo"/);
    assert.match(cursorHtml, /href="cursor:\/\/laststance\.codebook\/source\?path=src%2Fb\.ts"/);
    assert.doesNotMatch(cursorHtml, /href="vscode:\/\/laststance\.codebook/);
    assert.match(codeHtml, /href="vscode:\/\/laststance\.codebook\/source\?path=src%2Fa\.ts"/);
    assert.match(codeHtml, /href="vscode:\/\/laststance\.codebook\/settings\?root=%2Frepo"/);
    assert.match(codeHtml, /href="vscode:\/\/laststance\.codebook\/source\?path=src%2Fb\.ts"/);
    assert.doesNotMatch(codeHtml, /href="cursor:\/\/laststance\.codebook/);
    assert.match(cursorHtml, /href="https:\/\/example\.com\/wiki"/);
    assert.equal(await readFile(join(output, 'index.html'), 'utf8'), publishedHtml);
  } finally {
    await Promise.all([cursorReader.close(), codeReader.close()]);
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
