import type * as Parse5 from 'parse5' with { 'resolution-mode': 'import' }

import {
  HTML_PARSER_ABSENT_END_STATE_NAMES,
  HTML_PARSER_HIDDEN_INPUT_TABLE_MODES,
  HTML_PARSER_IN_BODY_MODE,
  HTML_PARSER_IN_ROW_MODE,
  HTML_PARSER_IN_SELECT_MODE,
  HTML_PARSER_IN_SELECT_IN_TABLE_MODE,
  HTML_PARSER_TABLE_SECTION_NAMES,
} from '../constants'

// Node24 can load this ESM package synchronously; the VSIX build bundles it as CJS.
const { Parser, html: htmlTree }: typeof Parse5 = require('parse5')

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

/** White space between the parts of a tag: the five characters a browser separates them at. */
const WHITESPACE = /[\t\n\f\r ]*/y
/** The rest of a tag's name after its first letter: up to white space, a slash or `>`. */
const TAG_NAME = /[^\t\n\f\r />]*/y
/** The rest of an attribute's name after its first character, which may be `=`: up to white space, a slash, `>` or `=`. */
const ATTRIBUTE_NAME_REST = /[^\t\n\f\r />=]*/y
/** An unquoted attribute value: up to white space or `>`. */
const UNQUOTED_VALUE = /[^\t\n\f\r >]*/y

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
 * Reads a start tag or an end tag from its `<`, as a browser's tokenizer does: the name up to white space, a slash or `>`, then each attribute up to the `>` that ends the tag; a slash before `>` closes the tag itself, and a slash elsewhere separates. Called by {@link HtmlPageReader.onStartTag} to retain every original attribute, including duplicates.
 * @param html - The page.
 * @param nameAt - Where the tag's name starts (after `<`, or `</` for an end tag).
 * @returns The tag, or `undefined` when the page ends inside it, as a browser then drops it.
 * @example
 * readTagAt('<a href="x">', 1) // => { name: 'a', attributes: [{ name: 'href', … }] }
 */
function readTagAt(html: string, nameAt: number): HtmlStartTag | undefined {
  TAG_NAME.lastIndex = nameAt
  TAG_NAME.exec(html)
  const tag: HtmlStartTag = {
    name: asciiLowerCase(html.slice(nameAt, TAG_NAME.lastIndex)),
    attributes: [],
  }
  let next = TAG_NAME.lastIndex
  // Each part of the tag in turn, up to its `>`; the page's end inside it drops the tag.
  for (;;) {
    next = afterWhitespace(html, next)
    const character = html[next]
    if (character === undefined) return undefined
    if (character === '>') return tag
    if (character === '/') {
      if (html[next + 1] === '>') return tag
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
 * Keeps original start-tag spans while parse5 owns the complete HTML tree; created by {@link readHtmlStartTags} for each page.
 * Its adapters use current select rules (a select changes no insertion mode, so table tokens close it by the table rules, and an input closes it by the body rule) and require a matching table section before closing a row. Other tree construction stays with the pinned parser.
 * @example new HtmlPageReader('<p>text</p>').tokenizer.write('<p>text</p>', true)
 */
class HtmlPageReader extends Parser<Parse5.DefaultTreeAdapterMap> {
  readonly startTags: HtmlStartTag[] = []
  private readonly openNames = new Map<string, number>()

  /**
   * Retains the original page for attribute offsets; called only by {@link readHtmlStartTags}.
   * @param page - The unmodified HTML source.
   * @example new HtmlPageReader('<p title="a">text</p>')
   */
  constructor(private readonly page: string) {
    super({ sourceCodeLocationInfo: true, scriptingEnabled: true })
  }

  /**
   * Keeps the raw start tag before tree processing can normalize its attributes.
   * @param token - The tokenizer's original start token and source position.
   * @returns Nothing; original attributes and normal tree feedback are retained.
   * @example reader.onStartTag(token) // keeps both attributes in '<a href=x href=y>'
   */
  override onStartTag(token: Parse5.Token.TagToken): void {
    const start = token.location?.startOffset
    const tag =
      start === undefined ? undefined : readTagAt(this.page, start + 1)
    if (tag) this.startTags.push(tag)
    super.onStartTag(token)
  }

  /**
   * Applies current select entry rules only after the parser chooses HTML dispatch.
   * @param token - An HTML start token, including one reprocessed by the tree builder.
   * @returns Nothing; foreign select elements never enter this hook.
   * @example reader._startTagOutsideForeignContent(selectToken) // closes an earlier select in scope
   */
  override _startTagOutsideForeignContent(token: Parse5.Token.TagToken): void {
    if (token.tagID === htmlTree.TAG_ID.SELECT && this.hasOpenSelect()) {
      this.closeSelect()
      return
    }
    // The body rule for input closes an open select first; a hidden input that a table rule takes leaves it open.
    if (
      token.tagID === htmlTree.TAG_ID.INPUT &&
      this.hasOpenSelect() &&
      !this.isHiddenInputOfTableRule(token)
    )
      this.closeSelect()
    super._startTagOutsideForeignContent(token)
    this.useCurrentSelectMode()
  }

  /**
   * Keeps table-section scope and current select rules after foreign dispatch chooses HTML end processing.
   * @param token - The end token handled by HTML rules.
   * @returns Nothing; other ends keep the parser's full tree rules.
   * @example reader._endTagOutsideForeignContent(selectEnd) // closes select with a div child
   */
  override _endTagOutsideForeignContent(token: Parse5.Token.TagToken): void {
    // parse5 8.0.1 accepts either scope; HTML requires both before closing a row.
    if (this.shouldIgnoreTableSectionEnd(token)) return
    if (token.tagID === htmlTree.TAG_ID.SELECT && this.hasOpenSelect()) {
      this.closeSelect()
      return
    }
    super._endTagOutsideForeignContent(token)
  }

  /**
   * Continues the insertion-mode reset below an open select, as current HTML has no select modes; the pinned reset calls this when it meets a select.
   * @param selectIndex - Where the reset met the select on the stack of open elements.
   * @returns Nothing; the mode is the one the elements below every open select give.
   * @example reader._resetInsertionModeForSelect(3) // IN_CELL for a select in a table cell
   */
  override _resetInsertionModeForSelect(selectIndex: number): void {
    const { tagIDs } = this.openElements
    const hiddenSelects: number[] = []
    // The pinned reset skips an unknown element, so each select below the one it met is read as one for this pass.
    for (let index = selectIndex; index >= 0; index -= 1) {
      if (tagIDs[index] !== htmlTree.TAG_ID.SELECT) continue
      hiddenSelects.push(index)
      tagIDs[index] = htmlTree.TAG_ID.UNKNOWN
    }
    try {
      super._resetInsertionMode()
    } finally {
      for (const index of hiddenSelects) tagIDs[index] = htmlTree.TAG_ID.SELECT
    }
  }

  /**
   * Tells whether an input is hidden and comes in a mode where the table rule takes it without the body rule, so an open select stays open; called by {@link HtmlPageReader._startTagOutsideForeignContent}.
   * @param token - An input start token.
   * @returns Whether the input's `type` is `hidden` (ASCII case-insensitive) in a table, table-body or row mode.
   * @example reader.isHiddenInputOfTableRule(hiddenInputToken) // true in a table, false in a cell
   */
  private isHiddenInputOfTableRule(token: Parse5.Token.TagToken): boolean {
    return (
      HTML_PARSER_HIDDEN_INPUT_TABLE_MODES.has(this.insertionMode) &&
      token.attrs.some(
        (attribute) =>
          attribute.name === 'type' &&
          asciiLowerCase(attribute.value) === 'hidden',
      )
    )
  }

  /**
   * Refuses a table-section end without both required scopes; called by {@link HtmlPageReader._endTagOutsideForeignContent} before the pinned row handler.
   * @param token - The end token routed to HTML rules.
   * @returns Whether the end must leave the current row and its children open.
   * @example reader.shouldIgnoreTableSectionEnd(theadEnd) // true in a row of tbody
   */
  private shouldIgnoreTableSectionEnd(token: Parse5.Token.TagToken): boolean {
    if (
      this.insertionMode !== HTML_PARSER_IN_ROW_MODE ||
      !HTML_PARSER_TABLE_SECTION_NAMES.has(token.tagName)
    )
      return false
    return (
      !this.openElements.hasInTableScope(token.tagID) ||
      !this.openElements.hasInTableScope(htmlTree.TAG_ID.TR)
    )
  }

  /**
   * Checks that select actually exists before the library's scope search, which assumes an initialized stack.
   * @returns Whether an HTML select remains in ordinary scope.
   * @example reader.hasOpenSelect() // false before the first source token
   */
  private hasOpenSelect(): boolean {
    const { stackTop, tagIDs } = this.openElements
    return (
      stackTop >= 0 &&
      tagIDs.lastIndexOf(htmlTree.TAG_ID.SELECT, stackTop) >= 0 &&
      this.openElements.hasInScope(htmlTree.TAG_ID.SELECT)
    )
  }

  /**
   * Ends the current HTML select and restores its parent's parsing mode.
   * @returns Nothing; the select and its children leave the stack.
   * @example reader.closeSelect() // called only after hasOpenSelect returned true
   */
  private closeSelect(): void {
    this.openElements.popUntilTagNamePopped(htmlTree.TAG_ID.SELECT)
    this._resetInsertionMode()
  }

  /**
   * Replaces the old select mode the pinned parser enters at a select start with the mode the elements below the select give; raw text and other modes keep their meaning.
   * @returns Nothing; a select in a table cell leaves the cell mode, in body the body mode.
   * @example reader.useCurrentSelectMode() // leaves TEXT unchanged
   */
  private useCurrentSelectMode(): void {
    if (
      this.insertionMode === HTML_PARSER_IN_SELECT_MODE ||
      this.insertionMode === HTML_PARSER_IN_SELECT_IN_TABLE_MODE
    )
      this._resetInsertionMode()
  }

  /**
   * Tracks actual stack pushes so an unmatched foreign end needs no repeated stack scan.
   * @param node - The callback node; a non-top insertion may report a different current node.
   * @param tagId - The parser's tag identifier.
   * @param isTop - Whether this is an ordinary top insertion.
   * @returns Nothing; the real stack replaces the index after a non-top insertion.
   * @example reader.onItemPush(node, tagId, false) // rebuilds after formatting adoption
   */
  override onItemPush(
    node: Parse5.DefaultTreeAdapterMap['parentNode'],
    tagId: number,
    isTop: boolean,
  ): void {
    if (isTop) this.addOpenName(node)
    else this.rebuildOpenNames()
    super.onItemPush(node, tagId, isTop)
  }

  /**
   * Removes the actual popped name, including a form removed from the middle of the stack.
   * @param node - The element that left the stack.
   * @param isTop - Whether the parser removed its current node.
   * @returns Nothing; the name index and the parser's own state stay in step.
   * @example reader.onItemPop(node, false) // counts a non-top form removal
   */
  override onItemPop(
    node: Parse5.DefaultTreeAdapterMap['parentNode'],
    isTop: boolean,
  ): void {
    if (this.treeAdapter.isElementNode(node)) {
      const name = asciiLowerCase(this.treeAdapter.getTagName(node))
      const count = this.openNames.get(name) ?? 0
      if (count > 1) this.openNames.set(name, count - 1)
      else this.openNames.delete(name)
    }
    super.onItemPop(node, isTop)
  }

  /**
   * Adds one real element name to the end-tag index; used by pushes and index rebuilds.
   * @param node - An element or the document root.
   * @returns Nothing; a document has no element name to record.
   * @example reader.addOpenName(svgForeignObject) // records lowercase foreignobject
   */
  private addOpenName(node: Parse5.DefaultTreeAdapterMap['parentNode']): void {
    if (!this.treeAdapter.isElementNode(node)) return
    const name = asciiLowerCase(this.treeAdapter.getTagName(node))
    this.openNames.set(name, (this.openNames.get(name) ?? 0) + 1)
  }

  /**
   * Rebuilds from live stack entries after a non-top insertion, whose callback can name the current node instead.
   * @returns Nothing; stale entries past stackTop are excluded.
   * @example reader.rebuildOpenNames() // uses only items[0..stackTop]
   */
  private rebuildOpenNames(): void {
    this.openNames.clear()
    for (let index = 0; index <= this.openElements.stackTop; index += 1) {
      const node = this.openElements.items[index]
      if (node) this.addOpenName(node)
    }
    // The pinned parser's event-free replace clones the same name/namespace.
    // Recheck that invariant when upgrading parse5; this adapter never changes token names.
  }

  /**
   * Skips a foreign end only when its absent name proves no tree or mode effect under IN_BODY rules.
   * @param token - The source end token.
   * @returns Nothing; effectful names and every other insertion mode keep the parser's rules.
   * @example reader.onEndTag(spanEnd) // no stack scan for an absent span in IN_BODY
   */
  override onEndTag(token: Parse5.Token.TagToken): void {
    if (
      this.currentNotInHTML &&
      this.insertionMode === HTML_PARSER_IN_BODY_MODE &&
      !this.openNames.has(token.tagName) &&
      !HTML_PARSER_ABSENT_END_STATE_NAMES.has(token.tagName)
    ) {
      // Preserve onEndTag's bookkeeping even when tree construction is a no-op.
      this.skipNextNewLine = false
      this.currentToken = token
      return
    }
    super.onEndTag(token)
  }
}

/**
 * Reads original start tags using full HTML tree feedback, for the Wiki address filter and local-editor link binder.
 * Raw attribute slices keep duplicates and untouched text; the tree parser decides where markup is active.
 * @param html - The unchanged page source.
 * @returns Start tags in source order, with every original attribute's exact positions and values.
 * @example readHtmlStartTags('<!-- <a href=x> --><a HREF=y>').map(tag => tag.name) // => ['a']
 */
export function readHtmlStartTags(html: string): HtmlStartTag[] {
  const reader = new HtmlPageReader(html)
  reader.tokenizer.write(html, true)
  return reader.startTags
}
