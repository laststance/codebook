import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyVitestTestResult } from '../utils/verifyVitestTestResult';

const citedFile = '/repo/app/lib/data.test.ts';
const citedTitles = ['invoice data queries', 'converts stored invoice cents to dollars for the edit form'];

/**
 * Writes a Vitest JSON report in the shape `--reporter=json` produces and returns its path.
 *
 * @param report - The report body, or raw text for malformed reports.
 * @example
 * ```ts
 * const file = await writeReport({ testResults: [] }); // => '/tmp/codebook-vitest-report-x/vitest-report.json'
 * ```
 */
async function writeReport(report: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-vitest-report-test-'));
  const file = join(directory, 'vitest-report.json');
  await writeFile(file, typeof report === 'string' ? report : JSON.stringify(report));
  return { directory, file };
}

test('a report where exactly the cited test ran confirms the run and gives its status', async () => {
  // Arrange
  const report = await writeReport({ testResults: [{ name: citedFile, assertionResults: [
    { ancestorTitles: ['invoice data queries'], title: 'applies the requested filter and page before returning invoice rows', status: 'skipped' },
    { ancestorTitles: ['invoice data queries'], title: 'converts stored invoice cents to dollars for the edit form', status: 'passed' },
  ] }] });
  try {
    // Act
    const status = await verifyVitestTestResult(report.file, citedFile, citedTitles);
    // Assert
    assert.equal(status, 'passed');
  } finally { await rm(report.directory, { recursive: true, force: true }); }
});

test('a cited test that failed its assertions still counts as the cited test running', async () => {
  // Arrange
  const report = await writeReport({ testResults: [{ name: citedFile, assertionResults: [
    { ancestorTitles: ['invoice data queries'], title: 'converts stored invoice cents to dollars for the edit form', status: 'failed' },
  ] }] });
  try {
    // Act
    const status = await verifyVitestTestResult(report.file, citedFile, citedTitles);
    // Assert
    assert.equal(status, 'failed');
  } finally { await rm(report.directory, { recursive: true, force: true }); }
});

test('a run where the cited test was skipped, another test ran or two tests matched cannot pass as the cited test', async () => {
  // Arrange
  const skipped = await writeReport({ testResults: [{ name: citedFile, assertionResults: [
    { ancestorTitles: ['invoice data queries'], title: 'converts stored invoice cents to dollars for the edit form', status: 'skipped' },
  ] }] });
  const different = await writeReport({ testResults: [{ name: citedFile, assertionResults: [
    { ancestorTitles: ['invoice data queries'], title: 'returns undefined when an invoice does not exist', status: 'passed' },
  ] }] });
  // Vitest 5 selects both a top-level "a > b" and describe("a") > test("b") with one anchored pattern.
  const ambiguous = await writeReport({ testResults: [{ name: citedFile, assertionResults: [
    { ancestorTitles: [], title: 'invoice data queries > converts stored invoice cents to dollars for the edit form', status: 'passed' },
    { ancestorTitles: ['invoice data queries'], title: 'converts stored invoice cents to dollars for the edit form', status: 'passed' },
  ] }] });
  const otherFile = await writeReport({ testResults: [
    { name: citedFile, assertionResults: [{ ancestorTitles: ['invoice data queries'], title: 'converts stored invoice cents to dollars for the edit form', status: 'passed' }] },
    { name: '/repo/copy/app/lib/data.test.ts', assertionResults: [{ ancestorTitles: [], title: 'copied', status: 'skipped' }] },
  ] });
  try {
    // Act / Assert
    await assert.rejects(verifyVitestTestResult(skipped.file, citedFile, citedTitles), /Vitest ran no test.*cited test did not run/);
    await assert.rejects(verifyVitestTestResult(different.file, citedFile, citedTitles), /instead of the cited test.*returns undefined when an invoice does not exist/);
    await assert.rejects(verifyVitestTestResult(ambiguous.file, citedFile, citedTitles),
      /Vitest ran 2 tests \(\["invoice data queries > converts stored invoice cents to dollars for the edit form"\], \["invoice data queries","converts stored invoice cents to dollars for the edit form"\]\)/);
    await assert.rejects(verifyVitestTestResult(otherFile.file, citedFile, citedTitles), /another test file.*copy\/app\/lib\/data\.test\.ts/);
  } finally {
    for (const report of [skipped, different, ambiguous, otherFile]) await rm(report.directory, { recursive: true, force: true });
  }
});

test('a missing, malformed or oversized Vitest report fails the run instead of assuming the cited test ran', async () => {
  // Arrange
  const malformed = await writeReport('{"testResults": [');
  const wrongShape = await writeReport({ testResults: [{ name: citedFile }] });
  const oversized = await writeReport(' '.repeat(1_024));
  try {
    // Act / Assert
    await assert.rejects(verifyVitestTestResult(join(malformed.directory, 'absent.json'), citedFile, citedTitles), /Vitest wrote no test report/);
    await assert.rejects(verifyVitestTestResult(malformed.file, citedFile, citedTitles), /unreadable test report/);
    await assert.rejects(verifyVitestTestResult(wrongShape.file, citedFile, citedTitles), /unreadable test report/);
    await assert.rejects(verifyVitestTestResult(oversized.file, citedFile, citedTitles, 512), /larger than 512 bytes/);
  } finally {
    for (const report of [malformed, wrongShape, oversized]) await rm(report.directory, { recursive: true, force: true });
  }
});

test('a report naming a contained symlink confirms only the exact cited test file behind that alias', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-vitest-report-alias-'));
  const source = join(directory, 'source.test.ts');
  const other = join(directory, 'other.test.ts');
  const alias = join(directory, 'alias.test.ts');
  await writeFile(source, 'test source');
  await writeFile(other, 'another test source');
  await symlink(source, alias);
  const report = await writeReport({ testResults: [{ name: alias, assertionResults: [
    { ancestorTitles: ['invoice data queries'], title: 'converts stored invoice cents to dollars for the edit form', status: 'passed' },
  ] }] });
  const duplicate = await writeReport({ testResults: [
    { name: alias, assertionResults: [{ ancestorTitles: ['invoice data queries'], title: 'converts stored invoice cents to dollars for the edit form', status: 'passed' }] },
    { name: await realpath(source), assertionResults: [{ ancestorTitles: ['invoice data queries'], title: 'converts stored invoice cents to dollars for the edit form', status: 'passed' }] },
  ] });
  try {
    // Act
    const status = await verifyVitestTestResult(report.file, await realpath(source), citedTitles);

    // Assert
    assert.equal(status, 'passed');
    await assert.rejects(verifyVitestTestResult(duplicate.file, await realpath(source), citedTitles), /Vitest ran 2 tests/);
    await rm(alias);
    await symlink(other, alias);
    await assert.rejects(verifyVitestTestResult(report.file, await realpath(source), citedTitles), /another test file/);
    await rm(alias);
    await assert.rejects(verifyVitestTestResult(report.file, await realpath(source), citedTitles), /another test file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(report.directory, { recursive: true, force: true });
    await rm(duplicate.directory, { recursive: true, force: true });
  }
});
