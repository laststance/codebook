/** Says whether a character separates two arguments of a Windows command line outside quotes: a space or a tab. @example isArgumentSeparator('\t') // => true */
function isArgumentSeparator(character: string | undefined): boolean {
  return character === ' ' || character === '\t'
}

/**
 * Reads the program name, the first argument of a Windows command line, from where it begins; called by {@link windowsCommandLineArguments}.
 * The program name has rules of its own: a quote opens or closes a quoted part, and a backslash is always a character of the name (it is a path).
 * @param commandLine - The whole command line.
 * @param start - Where the program name begins (no separator there).
 * @returns The program name and the position after it.
 * @example
 * programNameAt('"C:\\Program Files\\chrome.exe" --headless', 0) // => { argument: 'C:\\Program Files\\chrome.exe', end: 29 }
 */
function programNameAt(
  commandLine: string,
  start: number,
): { argument: string; end: number } {
  let argument = '',
    inQuotes = false,
    index = start
  for (; index < commandLine.length; index += 1) {
    const character = commandLine[index]!
    if (character === '"') inQuotes = !inQuotes
    else if (!inQuotes && isArgumentSeparator(character)) break
    else argument += character
  }
  return { argument, end: index }
}

/**
 * Reads a run of backslashes inside an argument and the quote that may follow it, by the rules of the Microsoft C runtime; called by {@link argumentAt} at each backslash.
 * Backslashes are characters of the argument unless they stand right before a quote: then each pair of them gives one backslash, and an odd one left over makes that quote a character instead of a delimiter.
 * @param commandLine - The whole command line.
 * @param start - Where the run of backslashes begins.
 * @returns The text the run gives the argument and the position after what it consumed: after the escaped quote when one was escaped; before the quote when it stays a delimiter.
 * @example
 * backslashRunAt('a\\b', 1)    // => { text: '\\', end: 2 }: a backslash in a path
 * backslashRunAt('d\\"e', 1)  // => { text: '"', end: 3 }: an escaped quote
 * backslashRunAt('f\\\\"', 1) // => { text: '\\', end: 3 }: one backslash, then the quote is a delimiter
 */
function backslashRunAt(
  commandLine: string,
  start: number,
): { text: string; end: number } {
  let end = start
  while (commandLine[end] === '\\') end += 1
  const backslashes = end - start
  // Backslashes count only right before a quote; elsewhere each is a character of a path.
  if (commandLine[end] !== '"') return { text: '\\'.repeat(backslashes), end }
  const halved = '\\'.repeat(Math.floor(backslashes / 2))
  // An odd backslash escapes the quote, which is then a character; after an even number the quote is read as a delimiter by the caller.
  return backslashes % 2 === 1
    ? { text: `${halved}"`, end: end + 1 }
    : { text: halved, end }
}

/**
 * Reads one argument after the program name by the rules of the Microsoft C runtime, from where it begins; called by {@link windowsCommandLineArguments}.
 * A quote opens or closes a quoted part, in which spaces and tabs belong to the argument, and a doubled quote inside a quoted part is one quote. Backslashes are read by {@link backslashRunAt}.
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
    inQuotes = false,
    index = start
  while (index < commandLine.length) {
    const character = commandLine[index]!
    if (!inQuotes && isArgumentSeparator(character)) break
    if (character === '\\') {
      const run = backslashRunAt(commandLine, index)
      argument += run.text
      index = run.end
    } else if (
      inQuotes &&
      character === '"' &&
      commandLine[index + 1] === '"'
    ) {
      // A doubled quote inside a quoted part is one quote, and the part goes on.
      argument += '"'
      index += 2
    } else if (character === '"') {
      inQuotes = !inQuotes
      index += 1
    } else {
      argument += character
      index += 1
    }
  }
  return { argument, end: index }
}

/**
 * Splits a Windows command line into its arguments as a program built with the Microsoft C runtime receives them (Chrome among them), so that an argument is compared as a whole; called by {@link profileProcesses} for the command lines PowerShell lists on Windows.
 * Why: Windows keeps a process's command line as one text, and an argument that holds a space is written in quotes, whole (`"--user-data-dir=C:\Users\a b\…"`) or only around its value (`--user-data-dir="C:\Users\a b\…"`). Read as text, the profile path then ends at a quote, not at a space or at the end.
 * @param commandLine - The process's command line as Windows keeps it (`Win32_Process.CommandLine`).
 * @returns Every argument in order, the program name first; quotes and the backslashes that only escape them are removed. Empty for a command line of separators only.
 * @example
 * windowsCommandLineArguments('"C:\\Program Files\\chrome.exe" "--user-data-dir=C:\\Users\\a b\\x" --headless')
 * // => ['C:\\Program Files\\chrome.exe', '--user-data-dir=C:\\Users\\a b\\x', '--headless']
 * windowsCommandLineArguments('chrome.exe --user-data-dir="C:\\Users\\a b\\x"')
 * // => ['chrome.exe', '--user-data-dir=C:\\Users\\a b\\x']
 */
export function windowsCommandLineArguments(commandLine: string): string[] {
  const commandArguments: string[] = []
  let index = 0
  // Separators between arguments, and before the first, are no part of any argument.
  const skipSeparators = (): void => {
    while (isArgumentSeparator(commandLine[index])) index += 1
  }
  skipSeparators()
  if (index >= commandLine.length) return commandArguments
  const program = programNameAt(commandLine, index)
  commandArguments.push(program.argument)
  index = program.end
  skipSeparators()
  while (index < commandLine.length) {
    const next = argumentAt(commandLine, index)
    commandArguments.push(next.argument)
    index = next.end
    skipSeparators()
  }
  return commandArguments
}
