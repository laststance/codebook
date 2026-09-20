import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { repositoryConfigSchema, inspectionPathSchema, type RepositoryConfiguration } from '../repositoryConfigSchemas';

/** Supplies an ordinary cited action for configuration boundary tests before any runtime is acquired. @example configuration().action.title // 'Change display theme' */
function configuration(): RepositoryConfiguration {
  return {
    version: 1, adapter: 'next-dev-webpack',
    book: { bookId: 'interface', revision: 1, nodeId: 'display-theme', anchorIndex: 0 },
    source: { path: 'src/controls/theme.tsx', hash: 'a'.repeat(64), line: 19, column: 5 },
    action: { title: 'Change display theme', selector: 'button[data-theme]',
      before: [{ kind: 'attribute', selector: 'html', attribute: 'data-theme', equals: 'light' }],
      after: [{ kind: 'text', selector: '#theme-label', equals: 'Dark' }] },
    inspections: [{ path: 'nextTheme', mode: 'value', required: true }, { path: 'setTheme', mode: 'type', required: false }],
    initialStorage: [{ key: 'theme', value: 'light' }],
  };
}

test('a configured action declares bounded facts and conditions without requiring fixture names or expected runtime values', () => {
  // Arrange
  const input = configuration();
  // Act
  const parsed = repositoryConfigSchema.parse(input);
  // Assert
  assert.equal(parsed.book.bookId, 'interface');
  assert.equal(parsed.source.path, 'src/controls/theme.tsx');
  assert.deepEqual(parsed.inspections, [{ path: 'nextTheme', mode: 'value', required: true }, { path: 'setTheme', mode: 'type', required: false }]);
  assert.deepEqual(parsed.action.before, [{ kind: 'attribute', selector: 'html', attribute: 'data-theme', equals: 'light' }]);
  assert.deepEqual(parsed.action.after, [{ kind: 'text', selector: '#theme-label', equals: 'Dark' }]);
});

test('reordered object fields produce the same canonical configured intent', () => {
  // Arrange
  const input = configuration();
  const reordered = { initialStorage: input.initialStorage, inspections: input.inspections, action: { after: input.action.after, before: input.action.before, selector: input.action.selector, title: input.action.title },
    source: { column: 5, line: 19, hash: 'a'.repeat(64), path: 'src/controls/theme.tsx' }, book: { anchorIndex: 0, nodeId: 'display-theme', revision: 1, bookId: 'interface' }, adapter: 'next-dev-webpack', version: 1 };
  // Act
  const first = JSON.stringify(repositoryConfigSchema.parse(input)), second = JSON.stringify(repositoryConfigSchema.parse(reordered));
  // Assert
  assert.equal(second, first);
  assert.notEqual(JSON.stringify(input), JSON.stringify(reordered));
});

test('configuration rejects supplied roots, shell commands, predicates and expected runtime facts', () => {
  // Arrange
  const input = configuration();
  const invalid = [
    { ...input, root: '/another/project' }, { ...input, command: 'npm run dev' }, { ...input, route: '/other' },
    { ...input, action: { ...input.action, javascript: 'button.click()' } },
    { ...input, action: { ...input.action, before: [{ kind: 'visible', selector: 'button', predicate: 'true' }] } },
    { ...input, inspections: [{ path: 'nextTheme', mode: 'value', required: true, expected: 'dark' }] },
  ];
  // Act / Assert
  for (const candidate of invalid) assert.equal(repositoryConfigSchema.safeParse(candidate).success, false);
});

test('inspection paths allow four literal identifier segments and reject expressions or prototype access', () => {
  // Arrange
  const allowed = ['nextTheme', '$store._state.name', 'state.cart.product.price', 'item.default'];
  const forbidden = ['state.cart.product.price.value', 'read()', 'state["name"]', 'state?.name', 'x = 1', 'x + 1', 'x;run()', 'x\n', 'x/*comment*/', 'value.constructor', 'value.prototype.name', '__proto__.x', 'this.name', 'true', 'null', 'undefined', 'NaN', 'Infinity', 'await.value', '1value', '\\u0061'];
  // Act / Assert
  for (const path of allowed) assert.equal(inspectionPathSchema.safeParse(path).success, true, path);
  for (const path of forbidden) assert.equal(inspectionPathSchema.safeParse(path).success, false, path);
});

test('a configured stop requires a real value and distinguishes value and type inspections of the same path', () => {
  // Arrange
  const input = configuration();
  // Act / Assert
  assert.equal(repositoryConfigSchema.safeParse({ ...input, inspections: [] }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, inspections: [{ path: 'nextTheme', mode: 'type', required: true }] }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, inspections: [{ path: 'nextTheme', mode: 'value', required: false }] }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, inspections: [input.inspections[0], input.inspections[0]] }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, inspections: [{ path: 'nextTheme', mode: 'value', required: true }, { path: 'nextTheme', mode: 'type', required: false }] }).success, true);
});

test('configured source coordinates and book references reject unsafe numbers and traversal', () => {
  // Arrange
  const input = configuration();
  // Act / Assert
  for (const line of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) assert.equal(repositoryConfigSchema.safeParse({ ...input, source: { ...input.source, line } }).success, false);
  for (const column of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(repositoryConfigSchema.safeParse({ ...input, source: { ...input.source, column } }).success, false);
  for (const path of ['/outside.ts', '../outside.ts', 'src/../outside.ts', 'src\\theme.tsx', 'src/\0theme.ts']) assert.equal(repositoryConfigSchema.safeParse({ ...input, source: { ...input.source, path } }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, book: { ...input.book, bookId: 'bad/id' } }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, book: { ...input.book, revision: 0 } }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, book: { ...input.book, anchorIndex: 8 } }).success, false);
});

test('DOM conditions require a supported literal comparison and preserve null attribute absence', () => {
  // Arrange
  const input = configuration();
  // Act / Assert
  assert.equal(repositoryConfigSchema.safeParse({ ...input, action: { ...input.action, before: [] } }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, action: { ...input.action, after: [] } }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, action: { ...input.action, before: [{ kind: 'visible', selector: 'button' }] } }).success, true);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, action: { ...input.action, after: [{ kind: 'attribute', selector: 'button', attribute: 'disabled', equals: null }] } }).success, true);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, action: { ...input.action, after: [{ kind: 'attribute', selector: 'button', attribute: 'bad name', equals: '' }] } }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, action: { ...input.action, selector: 'button\n' } }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, action: { ...input.action, after: [{ kind: 'text', selector: 'button', equals: null }] } }).success, false);
});

test('public field limits accept the boundary and reject the next character or inspection', () => {
  // Arrange
  const input = configuration();
  // Act / Assert
  assert.equal(repositoryConfigSchema.safeParse({ ...input, action: { ...input.action, selector: 'a'.repeat(512), title: 'a'.repeat(160) } }).success, true);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, action: { ...input.action, selector: 'a'.repeat(513) } }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, action: { ...input.action, title: 'a'.repeat(161) } }).success, false);
  assert.equal(inspectionPathSchema.safeParse('a'.repeat(128)).success, true);
  assert.equal(inspectionPathSchema.safeParse('a'.repeat(129)).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, inspections: Array.from({ length: 10 }, (_, index) => ({ path: `value${index}`, mode: 'value', required: true })) }).success, true);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, inspections: Array.from({ length: 11 }, (_, index) => ({ path: `value${index}`, mode: 'value', required: true })) }).success, false);
});

test('initial storage rejects duplicate keys and enforces bytes as well as per-entry character limits', () => {
  // Arrange
  const input = configuration();
  // Act / Assert
  assert.equal(repositoryConfigSchema.safeParse({ ...input, initialStorage: undefined }).success, true);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, initialStorage: [] }).success, true);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, initialStorage: [{ key: 'theme', value: 'light' }, { key: 'theme', value: 'dark' }] }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, initialStorage: [{ key: 'x'.repeat(128), value: 'x'.repeat(2048) }] }).success, true);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, initialStorage: [{ key: 'x'.repeat(129), value: '' }] }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, initialStorage: [{ key: 'x', value: 'x'.repeat(2049) }] }).success, false);
  assert.equal(repositoryConfigSchema.safeParse({ ...input, initialStorage: Array.from({ length: 17 }, (_, index) => ({ key: `k${index}`, value: '' })) }).success, false);
  const oversized = repositoryConfigSchema.safeParse({ ...input, initialStorage: Array.from({ length: 8 }, (_, index) => ({ key: `k${index}`, value: '界'.repeat(1024) })) });
  assert.equal(oversized.success, false);
  assert.equal(oversized.error?.issues.some(issue => issue.message === 'Initial storage exceeds 16384 bytes.'), true);
});

test('aggregate configuration bytes stay bounded even when every multibyte condition fits its character limit', () => {
  // Arrange
  const input = configuration();
  const conditions = Array.from({ length: 8 }, () => ({ kind: 'text', selector: '頁'.repeat(512), equals: '界'.repeat(1024) }));
  // Act
  const result = repositoryConfigSchema.safeParse({ ...input, action: { ...input.action, before: conditions, after: conditions } });
  // Assert
  assert.equal(result.success, false);
  assert.equal(result.error?.issues.some(issue => issue.message === 'Repository configuration exceeds 65536 bytes.'), true);
});

test('MCP discovery can represent strict bounded configuration fields without replacing runtime refinements', () => {
  // Arrange / Act
  const schema = z.toJSONSchema(repositoryConfigSchema);
  // Assert
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['version', 'adapter', 'book', 'source', 'action', 'inspections']);
  assert.equal(repositoryConfigSchema.safeParse({ ...configuration(), inspections: [] }).success, false);
});
