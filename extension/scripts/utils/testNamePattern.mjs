/**
 * Builds the one regular-expression literal that `node --test-name-pattern` or `--test-skip-pattern` needs to select exactly these test names; called by {@link planTestShards} for every part of a split test file.
 * @param names - Complete top-level test names of one file.
 * @returns A `/^(?:…)$/` literal that matches a name only when it equals one of the given names.
 * @example
 * testNamePattern(['a (b)', 'c/d']) // => '/^(?:a \\(b\\)|c\\/d)$/'
 */
export function testNamePattern(names) {
  const alternatives = names.map((name) =>
    name.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&'),
  )
  return `/^(?:${alternatives.join('|')})$/`
}
