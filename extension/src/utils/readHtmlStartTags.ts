/** One attribute of a start tag as a browser's tokenizer reads it: its name in ASCII lower case, where the name stands, the value as written (without its quotes; `undefined` without a value), and where the value stands with its quotes (at the name's end without a value). */
export type HtmlAttribute = {
  name: string
  nameStart: number
  nameEnd: number
  written: string | undefined
  valueStart: number
  valueEnd: number
}

/** A start tag a browser reads: its name in ASCII lower case and its attributes in the order written. */
export type HtmlStartTag = { name: string; attributes: HtmlAttribute[] }

/** A tag as {@link readTagAt} reads it, with where it ends and whether it closes itself (`<svg/>`). */
type ReadTag = HtmlStartTag & { end: number; isSelfClosing: boolean }

/** An element of svg or MathML that is open, as far as the tag reading follows the browser's tree: its name, its namespace, and whether it is a point where the browser reads HTML again inside it (`html`: svg's foreignObject, desc and title, and MathML's annotation-xml for HTML; `text`: MathML's mi, mo, mn, ms and mtext). */
type ForeignElement = {
  name: string
  namespace: 'svg' | 'math'
  integration: 'html' | 'text' | undefined
}

/** The state of one reading of a page: where it stands, the start tags read so far, the open svg and MathML elements, and how many open elements have each name. */
type Reading = {
  html: string
  at: number
  tags: HtmlStartTag[]
  foreign: ForeignElement[]
  openForeignTagCounts: Map<string, number>
}

/** White space between the parts of a tag: the five characters a browser separates them at. */
const WHITESPACE = /[\t\n\f\r ]*/y
/** The rest of a tag's name after its first letter: up to white space, a slash or `>`. */
const TAG_NAME = /[^\t\n\f\r />]*/y
/** The rest of an attribute's name after its first character, which may be `=`: up to white space, a slash, `>` or `=`. */
const ATTRIBUTE_NAME_REST = /[^\t\n\f\r />=]*/y
/** An unquoted attribute value: up to white space or `>`. */
const UNQUOTED_VALUE = /[^\t\n\f\r >]*/y
/** The end of a comment after its `<!--`: `-->` or `--!>`. */
const COMMENT_END = /--!?>/g
/** The ASCII letters that start a tag's name. */
const ASCII_LETTER = /[A-Za-z]/
/** The ends a browser looks for in a script element's text, in each of its three states: its end tag, and the `<!--`, `<script` and `-->` that switch between the states. */
const SCRIPT_DATA_ENDS = {
  data: /<\/script[\t\n\f\r />]|<!--/gi,
  escaped: /<\/script[\t\n\f\r />]|<script[\t\n\f\r />]|-->/gi,
  doubleEscaped: /<\/script[\t\n\f\r />]|-->/gi,
}
/** How a browser reads the content of an HTML element whose content is no markup: text with references (`title`, `textarea`), text alone (`style` …, and `noscript`, as scripting is on), a script's text, or the whole rest of the page (`plaintext`). */
const TEXT_CONTENT: Readonly<Record<string, 'text' | 'script' | 'plaintext'>> =
  {
    title: 'text',
    textarea: 'text',
    style: 'text',
    xmp: 'text',
    iframe: 'text',
    noembed: 'text',
    noframes: 'text',
    noscript: 'text',
    script: 'script',
    plaintext: 'plaintext',
  }
/** The end tag that ends the content of each element of {@link TEXT_CONTENT} that ends at its end tag: its name in any case, then white space, a slash or `>`. */
const TEXT_END_TAGS: Readonly<Record<string, RegExp>> = Object.fromEntries(
  Object.entries(TEXT_CONTENT)
    .filter(([, content]) => content === 'text')
    .map(([name]) => [name, new RegExp(`</${name}[\\t\\n\\f\\r />]`, 'gi')]),
)
/** The HTML start tags after which a browser leaves svg or MathML content (and `font` with color, face or size). */
const BREAKOUT_TAGS = new Set(
  'b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var'.split(
    ' ',
  ),
)
/** The svg elements inside which a browser reads HTML again. */
const SVG_HTML_POINTS = new Set(['foreignobject', 'desc', 'title'])
/** The MathML elements inside which a browser reads text and HTML start tags again. */
const MATHML_TEXT_POINTS = new Set(['mi', 'mo', 'mn', 'ms', 'mtext'])

/**
 * Lowers the ASCII capitals of a name, as a browser lowers a tag's and an attribute's name; called by {@link readTagAt} and {@link readAttributeAt}. Other letters keep their case, so no other letter turns into an ASCII one.
 * @param name - The name as written.
 * @returns The name with A to Z lowered.
 * @example
 * asciiLowerCase('HREF') // => 'href'
 */
function asciiLowerCase(name: string): string {
  return name.replace(/[A-Z]+/g, (capitals) => capitals.toLowerCase())
}

/**
 * Passes over the white space at a place of a tag; called by {@link readTagAt} and {@link readAttributeAt}.
 * @param html - The page.
 * @param at - Where the white space may start.
 * @returns Where the next character stands.
 * @example
 * afterWhitespace('a  b', 1) // => 3
 */
function afterWhitespace(html: string, at: number): number {
  WHITESPACE.lastIndex = at
  WHITESPACE.exec(html)
  return WHITESPACE.lastIndex
}

/**
 * Reads an attribute value from where it starts, after its `=` and white space, as a browser does: quoted to its closing quote, or bare up to white space or `>`; called by {@link readAttributeAt}.
 * @param html - The page.
 * @param at - The value's first character.
 * @returns The value as written, where it stands with its quotes, and where the tag goes on; `undefined` when the page ends inside it.
 * @example
 * readValueAt('a="x" b', 2) // => { written: 'x', valueStart: 2, valueEnd: 5 }
 */
function readValueAt(
  html: string,
  at: number,
): { written: string; valueStart: number; valueEnd: number } | undefined {
  const quote = html[at]
  if (quote === '"' || quote === "'") {
    const close = html.indexOf(quote, at + 1)
    return close === -1
      ? undefined
      : {
          written: html.slice(at + 1, close),
          valueStart: at,
          valueEnd: close + 1,
        }
  }
  UNQUOTED_VALUE.lastIndex = at
  UNQUOTED_VALUE.exec(html)
  const end = UNQUOTED_VALUE.lastIndex
  // A bare value that runs to the end of the page leaves its tag unended, and a browser drops such a tag.
  return end === html.length
    ? undefined
    : { written: html.slice(at, end), valueStart: at, valueEnd: end }
}

/**
 * Reads one attribute of a tag from its name's first character, as a browser does: a name (whose first character may be `=`), then, after white space, an optional `=` and its value; called by {@link readTagAt}.
 * @param html - The page.
 * @param at - The name's first character: no white space, slash or `>`.
 * @returns The attribute, or `undefined` when the page ends inside it.
 * @example
 * readAttributeAt('<a HREF = "x">', 3) // => { name: 'href', nameStart: 3, nameEnd: 7, written: 'x', valueStart: 10, valueEnd: 13 }
 */
function readAttributeAt(html: string, at: number): HtmlAttribute | undefined {
  ATTRIBUTE_NAME_REST.lastIndex = at + 1
  ATTRIBUTE_NAME_REST.exec(html)
  const nameEnd = ATTRIBUTE_NAME_REST.lastIndex
  const name = asciiLowerCase(html.slice(at, nameEnd))
  const afterName = afterWhitespace(html, nameEnd)
  // Without `=` the attribute has no value, and what follows is the tag's next part.
  if (html[afterName] !== '=')
    return {
      name,
      nameStart: at,
      nameEnd,
      written: undefined,
      valueStart: nameEnd,
      valueEnd: nameEnd,
    }
  const valueAt = afterWhitespace(html, afterName + 1)
  // `=` before `>` gives an empty value; the page's end inside the tag drops the tag.
  if (html[valueAt] === '>')
    return {
      name,
      nameStart: at,
      nameEnd,
      written: '',
      valueStart: valueAt,
      valueEnd: valueAt,
    }
  const value = valueAt < html.length ? readValueAt(html, valueAt) : undefined
  return value && { name, nameStart: at, nameEnd, ...value }
}

/**
 * Reads a start tag or an end tag from its `<`, as a browser's tokenizer does: the name up to white space, a slash or `>`, then each attribute up to the `>` that ends the tag; a slash before `>` closes the tag itself, and a slash elsewhere separates. Called by {@link readStartTagAt} and {@link readEndTagAt}.
 * @param html - The page.
 * @param nameAt - Where the tag's name starts (after `<`, or `</` for an end tag).
 * @returns The tag, or `undefined` when the page ends inside it, as a browser then drops it.
 * @example
 * readTagAt('<a href="x">', 1) // => { name: 'a', attributes: [{ name: 'href', … }], end: 12, isSelfClosing: false }
 */
function readTagAt(html: string, nameAt: number): ReadTag | undefined {
  TAG_NAME.lastIndex = nameAt
  TAG_NAME.exec(html)
  const tag: ReadTag = {
    name: asciiLowerCase(html.slice(nameAt, TAG_NAME.lastIndex)),
    attributes: [],
    end: html.length,
    isSelfClosing: false,
  }
  let next = TAG_NAME.lastIndex
  // Each part of the tag in turn, up to its `>`; the page's end inside it drops the tag.
  for (;;) {
    next = afterWhitespace(html, next)
    const character = html[next]
    if (character === undefined) return undefined
    if (character === '>') return { ...tag, end: next + 1 }
    if (character === '/') {
      if (html[next + 1] === '>')
        return { ...tag, end: next + 2, isSelfClosing: true }
      next += 1
      continue
    }
    const attribute = readAttributeAt(html, next)
    if (!attribute) return undefined
    tag.attributes.push(attribute)
    next = attribute.valueEnd
  }
}

/**
 * Finds where a comment ends, as a browser does: at once for `<!-->` and `<!--->`, otherwise after the first `-->` or `--!>` that follows the `<!--`, or at the page's end; called by {@link readDeclarationAt}.
 * @param html - The page.
 * @param at - The comment's `<`.
 * @returns Where the page goes on after the comment.
 * @example
 * endOfComment('<!-- a --!><b>', 0) // => 11
 */
function endOfComment(html: string, at: number): number {
  if (html.startsWith('>', at + 4)) return at + 5
  if (html.startsWith('->', at + 4)) return at + 6
  COMMENT_END.lastIndex = at + 4
  return COMMENT_END.exec(html) ? COMMENT_END.lastIndex : html.length
}

/**
 * Finds where a page goes on after a run that ends at its first `>` or at the page's end: a doctype, or what a browser reads as a bogus comment (`<?…>`, `<!x…>`, `</ …>`); called by {@link readMarkupAt} and {@link readDeclarationAt}.
 * @param html - The page.
 * @param from - Where the search for `>` starts.
 * @param terminator - What ends the run: `>`, or `]]>` for a CDATA section.
 * @returns Where the page goes on.
 * @example
 * endAfter('<?x>a', 2, '>') // => 4
 */
function endAfter(html: string, from: number, terminator: string): number {
  const end = html.indexOf(terminator, from)
  return end === -1 ? html.length : end + terminator.length
}

/**
 * Reads what follows `<!`, as a browser does: a comment, a doctype, a CDATA section in svg or MathML, or a bogus comment; called by {@link readMarkupAt}.
 * @param reading - The reading.
 * @param at - The `<`.
 * @returns Where the page goes on.
 * @example
 * readDeclarationAt(reading, 0) // => 11 for '<!-- a --><b>'
 */
function readDeclarationAt(reading: Reading, at: number): number {
  const { html } = reading
  if (html.startsWith('<!--', at)) return endOfComment(html, at)
  // A CDATA section is one only in svg or MathML; elsewhere it is a bogus comment.
  if (html.startsWith('<![CDATA[', at) && reading.foreign.length > 0)
    return endAfter(html, at + 9, ']]>')
  return endAfter(html, at + 2, '>')
}

/**
 * Says whether a start tag is read by the rules of svg or MathML content where it stands: inside such an element that is no point where HTML is read again (`<annotation-xml>` lets `<svg>` in as svg); called by {@link placeStartTag}.
 * @param foreign - The open svg and MathML elements.
 * @param tag - The start tag.
 * @returns Whether the tag is an element of svg or MathML.
 * @example
 * isForeignContext([{ name: 'svg', namespace: 'svg', integration: undefined }], tag) // => true
 */
function isForeignContext(foreign: ForeignElement[], tag: ReadTag): boolean {
  const current = foreign.at(-1)
  if (current === undefined || current.integration === 'html') return false
  if (current.integration === 'text')
    return tag.name === 'mglyph' || tag.name === 'malignmark'
  return !(current.name === 'annotation-xml' && tag.name === 'svg')
}

/**
 * Says whether a start tag takes a browser out of svg or MathML content: one of {@link BREAKOUT_TAGS}, or `font` with a color, face or size; called by {@link placeStartTag}.
 * @param tag - The start tag.
 * @returns Whether the tag is read as HTML after the svg and MathML elements are closed.
 * @example
 * isBreakout({ name: 'p', attributes: [], … }) // => true
 */
function isBreakout(tag: ReadTag): boolean {
  return (
    BREAKOUT_TAGS.has(tag.name) ||
    (tag.name === 'font' &&
      tag.attributes.some(({ name }) =>
        ['color', 'face', 'size'].includes(name),
      ))
  )
}

/**
 * Says where HTML is read again inside a new svg or MathML element; called by {@link openForeignElement}.
 * @param name - The element's name in lower case.
 * @param namespace - Its namespace.
 * @param tag - Its start tag, for the encoding of `annotation-xml`.
 * @returns `html`, `text` or `undefined`, as {@link ForeignElement} names them.
 * @example
 * integrationOf('foreignobject', 'svg', tag) // => 'html'
 */
function integrationOf(
  name: string,
  namespace: 'svg' | 'math',
  tag: ReadTag,
): ForeignElement['integration'] {
  if (namespace === 'svg') return SVG_HTML_POINTS.has(name) ? 'html' : undefined
  if (MATHML_TEXT_POINTS.has(name)) return 'text'
  const encoding = tag.attributes
    .find((attribute) => attribute.name === 'encoding')
    ?.written?.toLowerCase()
  return name === 'annotation-xml' &&
    (encoding === 'text/html' || encoding === 'application/xhtml+xml')
    ? 'html'
    : undefined
}

/**
 * Opens an svg or MathML element for the reading, unless its tag closes itself; called by {@link placeStartTag}.
 * @param reading - The open foreign elements and their name counts.
 * @param tag - The start tag.
 * @param namespace - The new element's namespace.
 * @returns Nothing; the element and its name count are added.
 * @example
 * openForeignElement(reading, svgTag, 'svg')
 */
function openForeignElement(
  reading: Reading,
  tag: ReadTag,
  namespace: 'svg' | 'math',
): void {
  // A self-closing tag leaves no open element or name.
  if (tag.isSelfClosing) return
  reading.foreign.push({
    name: tag.name,
    namespace,
    integration: integrationOf(tag.name, namespace, tag),
  })
  reading.openForeignTagCounts.set(
    tag.name,
    (reading.openForeignTagCounts.get(tag.name) ?? 0) + 1,
  )
}

/**
 * Removes the last foreign element and updates its name count, so a later unmatched end tag cannot search a name that already closed; called by {@link closeToIntegrationPoint} and {@link placeEndTag}.
 * @param reading - The open elements and the counts of their names.
 * @returns Nothing; the last element and one count of its name are removed.
 * @example
 * popForeignElement(reading) // removes the innermost SVG or MathML element
 */
function popForeignElement(reading: Reading): void {
  const closed = reading.foreign.pop()
  if (closed === undefined) return
  const count = reading.openForeignTagCounts.get(closed.name) ?? 0
  // A name remains searchable only while another element of that name is open.
  if (count > 1) reading.openForeignTagCounts.set(closed.name, count - 1)
  else reading.openForeignTagCounts.delete(closed.name)
}

/**
 * Closes the open svg and MathML elements down to the nearest point where HTML is read again, as a browser does at a breakout tag; called by {@link placeStartTag} and {@link placeEndTag}.
 * @param reading - The open foreign elements and their name counts.
 * @returns Nothing; the closed elements and their name counts are removed.
 * @example
 * closeToIntegrationPoint(reading)
 */
function closeToIntegrationPoint(reading: Reading): void {
  const { foreign } = reading
  // Every discarded element also loses its count, including names at a breakout.
  while (foreign.length > 0 && foreign.at(-1)?.integration === undefined)
    popForeignElement(reading)
}

/**
 * Places a start tag in the browser's tree as far as the reading follows it, and says whether the tag is read by HTML rules; called by {@link readStartTagAt}.
 * @param reading - The open foreign elements and their name counts.
 * @param tag - The start tag.
 * @returns `true` for an HTML element, whose content may be no markup ({@link TEXT_CONTENT}); `false` for an svg or MathML element.
 * @example
 * placeStartTag(reading, styleTag) // => true outside foreign content
 */
function placeStartTag(reading: Reading, tag: ReadTag): boolean {
  const { foreign } = reading
  if (isForeignContext(foreign, tag)) {
    if (!isBreakout(tag)) {
      openForeignElement(reading, tag, foreign.at(-1)?.namespace ?? 'svg')
      return false
    }
    closeToIntegrationPoint(reading)
  }
  if (tag.name === 'svg' || tag.name === 'math')
    openForeignElement(reading, tag, tag.name)
  return true
}

/**
 * Places an end tag in the browser's tree as far as the reading follows it: `</br>` and `</p>` leave svg and MathML content, and another end tag closes the nearest open svg or MathML element of its name with those above it; called by {@link readEndTagAt}.
 * @param reading - The open foreign elements and their name counts.
 * @param name - The end tag's name in lower case.
 * @returns Nothing; the elements this tag closes and their name counts are removed.
 * @example
 * placeEndTag(reading, 'svg')
 */
function placeEndTag(reading: Reading, name: string): void {
  const { foreign } = reading
  if (foreign.length === 0) return
  if (name === 'br' || name === 'p') {
    closeToIntegrationPoint(reading)
    return
  }
  // An unmatched close takes no stack scan, even when this name was open earlier.
  if (!reading.openForeignTagCounts.has(name)) return
  // A successful search removes every element it visits, so total work stays linear.
  const index = foreign.findLastIndex((element) => element.name === name)
  if (index !== -1) while (foreign.length > index) popForeignElement(reading)
}

/** A state a browser reads a script element's text in: plain, after `<!--`, or after `<!--` and `<script`. */
type ScriptState = keyof typeof SCRIPT_DATA_ENDS

/**
 * Says what a mark found in a script's text does, as a browser reads it; called by {@link endOfScriptText}.
 * @param mark - The mark, in lower case: `</script…`, `<script…`, `<!--` or `-->`.
 * @param state - The state the mark was found in.
 * @returns `end` for the end tag that ends the script, or the state the text is read in after the mark.
 * @example
 * nextScriptState('<!--', 'data') // => 'escaped'
 * nextScriptState('</script>', 'doubleEscaped') // => 'escaped'
 */
function nextScriptState(
  mark: string,
  state: ScriptState,
): ScriptState | 'end' {
  if (mark === '<!--') return 'escaped'
  if (mark === '-->') return 'data'
  if (!mark.startsWith('</')) return 'doubleEscaped'
  return state === 'doubleEscaped' ? 'escaped' : 'end'
}

/**
 * Finds where a script element's text ends, as a browser reads it through its three states: at its end tag, except inside `<!--` … `<script>` … `-->`, where an end tag only leaves the inner script; called by {@link endOfTextContent}.
 * @param html - The page.
 * @param from - Where the script's text starts.
 * @returns Where its end tag's `<` stands, or the page's end.
 * @example
 * endOfScriptText('a()</script>', 0) // => 3
 */
function endOfScriptText(html: string, from: number): number {
  let state: ScriptState = 'data'
  let at = from
  // Each switch of state in turn, until the end tag that ends the script.
  for (;;) {
    const ends: RegExp = SCRIPT_DATA_ENDS[state]
    ends.lastIndex = at
    const found: RegExpExecArray | null = ends.exec(html)
    if (found === null) return html.length
    const next = nextScriptState(found[0].toLowerCase(), state)
    if (next === 'end') return found.index
    // `<!--` may end at once (`<!-->`), so the search for `-->` starts at its dashes.
    at = found[0] === '<!--' ? found.index + 2 : ends.lastIndex
    state = next
  }
}

/**
 * Finds where the content of an HTML element that holds no markup ends ({@link TEXT_CONTENT}): at its end tag, at the end of a script's text, or at the page's end for `plaintext`; called by {@link readStartTagAt}.
 * @param html - The page.
 * @param tag - The element's start tag, read by HTML rules.
 * @returns Where markup is read again: the `<` of the end tag, the tag's end for any other element, or the page's end.
 * @example
 * endOfTextContent('<style>a{}</style>', styleTag) // => 10
 */
function endOfTextContent(html: string, tag: ReadTag): number {
  const content = TEXT_CONTENT[tag.name]
  if (content === undefined) return tag.end
  if (content === 'plaintext') return html.length
  if (content === 'script') return endOfScriptText(html, tag.end)
  const endTag = TEXT_END_TAGS[tag.name]
  if (endTag === undefined) return html.length
  endTag.lastIndex = tag.end
  return endTag.exec(html)?.index ?? html.length
}

/**
 * Reads a start tag from its `<`, keeps it, places it in the browser's tree and passes over its content where that is no markup; called by {@link readMarkupAt}.
 * @param reading - The reading.
 * @param at - The `<`.
 * @returns Where the page goes on.
 * @example
 * readStartTagAt(reading, 0) // => 12 for '<a href="x">…'
 */
function readStartTagAt(reading: Reading, at: number): number {
  const tag = readTagAt(reading.html, at + 1)
  if (!tag) return reading.html.length
  reading.tags.push({ name: tag.name, attributes: tag.attributes })
  return placeStartTag(reading, tag)
    ? endOfTextContent(reading.html, tag)
    : tag.end
}

/**
 * Reads what follows `</`, as a browser does: an end tag, nothing for `</>`, or a bogus comment; called by {@link readMarkupAt}.
 * @param reading - The reading.
 * @param at - The `<`.
 * @returns Where the page goes on.
 * @example
 * readEndTagAt(reading, 0) // => 6 for '</svg>'
 */
function readEndTagAt(reading: Reading, at: number): number {
  const { html } = reading
  const first = html[at + 2]
  if (first === undefined) return html.length
  if (first === '>') return at + 3
  if (!ASCII_LETTER.test(first)) return endAfter(html, at + 2, '>')
  const tag = readTagAt(html, at + 2)
  if (!tag) return html.length
  placeEndTag(reading, tag.name)
  return tag.end
}

/**
 * Reads what a browser reads at a `<` of the page's markup: a declaration or a comment, a bogus comment, an end tag, a start tag, or the character `<` of the text; called by {@link readHtmlStartTags}.
 * @param reading - The reading.
 * @param at - The `<`.
 * @returns Where the page goes on.
 * @example
 * readMarkupAt(reading, 0) // => 1 for '< b'
 */
function readMarkupAt(reading: Reading, at: number): number {
  const next = reading.html[at + 1]
  if (next === '!') return readDeclarationAt(reading, at)
  if (next === '?') return endAfter(reading.html, at + 2, '>')
  if (next === '/') return readEndTagAt(reading, at)
  if (next !== undefined && ASCII_LETTER.test(next))
    return readStartTagAt(reading, at)
  return at + 1
}

/**
 * Reads the start tags of a page as a browser's tokenizer reads them, in one pass over the page: comments, doctypes, bogus comments and CDATA sections are passed over whole, the content of an HTML element that holds no markup (`script`, `style`, `title`, `textarea` …) is passed over up to its end tag, and every tag is read once, its attribute values quoted or bare.
 *
 * Why: the Wiki reader judges the addresses of every page it serves and rewrites some, and it must read the tags a browser reads, no more and no less, in a time that grows with the page's size alone (a page that a reading from every `<` took 20 s for is read here in one pass).
 * How: the browser's tree decides whether an element holds markup: inside svg and MathML, `<style>` and `<script>` hold markup. The reading follows the open svg and MathML elements, their breakout tags and the points where HTML is read again; it follows no other part of the tree.
 * Limit: an HTML element left open inside such a point (`<svg><foreignObject><div>`) is not followed, so an end tag the browser ignores there closes the point for the reading. A page built on that can make the browser read a tag inside what the reading takes for text.
 * Called by {@link withServedAddresses} for every page the reader serves, and by {@link rebindDeepWikiEditorLinks} for the rail entry's link and the ids of a page.
 *
 * @param html - The page.
 * @returns Its start tags in page order, a tag the page's end cuts off left out, as a browser leaves it out.
 * @example
 * readHtmlStartTags('<!-- <a href="x"> --><style><b></style><a HREF=y>').map((tag) => tag.name) // => ['style', 'a']
 */
export function readHtmlStartTags(html: string): HtmlStartTag[] {
  const reading: Reading = {
    html,
    at: 0,
    tags: [],
    foreign: [],
    openForeignTagCounts: new Map(),
  }
  // Each `<` of the markup in turn; the text between is passed over.
  while (reading.at < html.length) {
    const lessThan = html.indexOf('<', reading.at)
    reading.at = lessThan === -1 ? html.length : readMarkupAt(reading, lessThan)
  }
  return reading.tags
}
