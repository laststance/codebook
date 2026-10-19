/** Says whether a character ends an unquoted program name, or separates two arguments after it outside quotes: a space or a tab, and no other white space. @example isArgumentSeparator('\t') // => true */
function isArgumentSeparator(character: string | undefined): boolean {
  return character === ' ' || character === '\t'
}

/** Gives the position of the first character after a run of separators. @example afterSeparators('a  b', 1) // => 3 */
function afterSeparators(commandLine: string, start: number): number {
  let index = start
  while (isArgumentSeparator(commandLine[index])) index += 1
  return index
}

/**
 * Reads the program name, the first argument of a Windows command line, by `CommandLineToArgvW`'s own rule for it; called by {@link windowsCommandLineArguments}.
 * A name that begins with a quote ends at the next quote, whatever follows it (`"C:\P F\chrome.exe"--flag` is the program and `--flag`); any other name ends at the first space or tab ({@link isArgumentSeparator}), and other white space, a line break among it, is a character of it. A backslash or a quote inside an unquoted name is a character of it, and a leading space gives an empty name.
 * @param commandLine - The whole command line.
 * @returns The program name and the position after it.
 * @example
 * programNameAt('"C:\\Program Files\\chrome.exe" --headless') // => { argument: 'C:\\Program Files\\chrome.exe', end: 29 }
 */
function programNameAt(commandLine: string): {
  argument: string
  end: number
} {
  if (commandLine.startsWith('"')) {
    const closing = commandLine.indexOf('"', 1)
    // A name whose quote is never closed takes the rest of the line.
    return closing === -1
      ? { argument: commandLine.slice(1), end: commandLine.length }
      : { argument: commandLine.slice(1, closing), end: closing + 1 }
  }
  // Wine's CommandLineToArgvW ends an unquoted name at a space or a tab only.
  const separator = commandLine.search(/[ \t]/)
  const end = separator === -1 ? commandLine.length : separator
  return { argument: commandLine.slice(0, end), end }
}

/**
 * Reads a run of quotes inside an argument by `CommandLineToArgvW`'s rule, with the backslashes right before it; called by {@link argumentAt} at each quote.
 * The backslashes were taken into the argument as they came. Before an even number of them, half of them stay and the quote opens or closes a quoted part; before an odd number, half of them stay and the quote is a character. Every further quote right after it counts too: each third quote in a row is a character, and a count of two closes the quoted part.
 * @param commandLine - The whole command line.
 * @param at - The position of the quote.
 * @param read - The argument so far, its quote count (`quotes`, 0 outside a quoted part) and the backslashes right before the quote.
 * @returns The argument with the run read, the quote count after it and the position after the run.
 * @example
 * quoteRunAt('"a""b"', 2, { argument: 'a', quotes: 1, backslashes: 0 }) // => { argument: 'a"', quotes: 0, end: 4 }
 */
function quoteRunAt(
  commandLine: string,
  at: number,
  read: { argument: string; quotes: number; backslashes: number },
): { argument: string; quotes: number; end: number } {
  const { backslashes } = read
  let quotes = read.quotes
  // An even run of backslashes is halved and the quote counts; an odd one is halved and escapes the quote.
  let argument =
    backslashes % 2 === 0
      ? read.argument.slice(0, read.argument.length - backslashes / 2)
      : `${read.argument.slice(0, read.argument.length - (backslashes - 1) / 2 - 1)}"`
  if (backslashes % 2 === 0) quotes += 1
  let end = at + 1
  for (; commandLine[end] === '"'; end += 1) {
    quotes += 1
    // Every third quote in a row is one quote of the argument.
    if (quotes === 3) {
      argument += '"'
      quotes = 0
    }
  }
  return { argument, quotes: quotes === 2 ? 0 : quotes, end }
}

/**
 * Reads one argument after the program name by `CommandLineToArgvW`'s rules, from where it begins; called by {@link windowsCommandLineArguments}.
 * Spaces and tabs end the argument outside quoted parts; quotes and the backslashes before them are read by {@link quoteRunAt}; every other character, a backslash elsewhere among it, is a character of the argument.
 * @param commandLine - The whole command line.
 * @param start - Where the argument begins (no separator there).
 * @returns The argument and the position after it.
 * @example
 * argumentAt('"--user-data-dir=C:\\a b\\x" --headless', 0) // => { argument: '--user-data-dir=C:\\a b\\x', end: 26 }
 */
function argumentAt(
  commandLine: string,
  start: number,
): { argument: string; end: number } {
  let argument = '',
    quotes = 0,
    backslashes = 0,
    index = start
  while (
    index < commandLine.length &&
    (quotes !== 0 || !isArgumentSeparator(commandLine[index]))
  ) {
    const character = commandLine[index]!
    if (character === '"') {
      const run = quoteRunAt(commandLine, index, {
        argument,
        quotes,
        backslashes,
      })
      ;({ argument, quotes } = run)
      index = run.end
      backslashes = 0
      continue
    }
    argument += character
    // Backslashes are counted until a quote decides what they are; any other character ends the run.
    backslashes = character === '\\' ? backslashes + 1 : 0
    index += 1
  }
  return { argument, end: index }
}

/**
 * Splits a Windows command line into its arguments as `CommandLineToArgvW` does, by which Chrome (`base::CommandLine`) reads its own, so that an argument is compared as Chrome sees it; called by {@link profileProcesses} for the command lines PowerShell lists on Windows.
 * Why: Windows keeps a process's command line as one text, and an argument that holds a space is written in quotes, whole (`"--user-data-dir=C:\Users\a b\…"`) or only around its value (`--user-data-dir="C:\Users\a b\…"`). Read as text, the profile path then ends at a quote, not at a space or at the end. The program name has a rule of its own ({@link programNameAt}); the arguments after it follow {@link argumentAt}. The rules are the ones of Wine's port of `CommandLineToArgvW`, which mirrors Windows'.
 * @param commandLine - The process's command line as Windows keeps it (`Win32_Process.CommandLine`).
 * @returns Every argument in order, the program name first (empty for a line that begins with a space); quotes and the backslashes that only escape them are removed.
 * @example
 * windowsCommandLineArguments('"C:\\Program Files\\chrome.exe" "--user-data-dir=C:\\Users\\a b\\x" --headless')
 * // => ['C:\\Program Files\\chrome.exe', '--user-data-dir=C:\\Users\\a b\\x', '--headless']
 * windowsCommandLineArguments('"C:\\P F\\chrome.exe"--user-data-dir=C:\\x')
 * // => ['C:\\P F\\chrome.exe', '--user-data-dir=C:\\x']
 */
export function windowsCommandLineArguments(commandLine: string): string[] {
  const program = programNameAt(commandLine)
  const commandArguments = [program.argument]
  // Separators after the program name and between arguments belong to no argument; trailing ones start none.
  for (
    let index = afterSeparators(commandLine, program.end);
    index < commandLine.length;
  ) {
    const next = argumentAt(commandLine, index)
    commandArguments.push(next.argument)
    index = afterSeparators(commandLine, next.end)
  }
  return commandArguments
}
