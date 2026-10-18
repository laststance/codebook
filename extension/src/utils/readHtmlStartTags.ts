import type * as Parse5 from 'parse5' with { 'resolution-mode': 'import' }

import {
  HTML_PARSER_ABSENT_END_BODY_NAMES,
  HTML_PARSER_ABSENT_END_MODE_TABLE_NAMES,
  HTML_PARSER_SVG_CASE_NAMES_PARSE5_LACKS,
  HTML_PARSER_HEADING_NAMES,
  HTML_PARSER_HIDDEN_INPUT_TABLE_MODES,
  HTML_PARSER_IN_ROW_MODE,
  HTML_PARSER_IN_SELECT_MODE,
  HTML_PARSER_IN_SELECT_IN_TABLE_MODE,
  HTML_PARSER_TABLE_SECTION_NAMES,
} from '../constants'

// Node24 can load this ESM package synchronously; the VSIX build bundles it as CJS.
const {
  Parser,
  html: htmlTree,
  foreignContent,
}: typeof Parse5 = require('parse5')

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
/** The HTML elements that end the ordinary scope of the pinned parser (parse5 8.0.1's `SCOPING_ELEMENTS_HTML`), which the reader's scope walks repeat while an HTML select is open. */
const SCOPE_END_TAG_IDS = new Set([
  htmlTree.TAG_ID.APPLET,
  htmlTree.TAG_ID.CAPTION,
  htmlTree.TAG_ID.HTML,
  htmlTree.TAG_ID.MARQUEE,
  htmlTree.TAG_ID.OBJECT,
  htmlTree.TAG_ID.TABLE,
  htmlTree.TAG_ID.TD,
  htmlTree.TAG_ID.TEMPLATE,
  htmlTree.TAG_ID.TH,
])
/** The HTML elements that end the list item scope: the ordinary ones, ol and ul. */
const LIST_ITEM_SCOPE_END_TAG_IDS = new Set([
  ...SCOPE_END_TAG_IDS,
  htmlTree.TAG_ID.OL,
  htmlTree.TAG_ID.UL,
])
/** The HTML elements that end the button scope: the ordinary ones and button. */
const BUTTON_SCOPE_END_TAG_IDS = new Set([
  ...SCOPE_END_TAG_IDS,
  htmlTree.TAG_ID.BUTTON,
])
/** The svg and MathML elements that end every scope but the table scope: the integration points, which the HTML standard also counts as special. */
const FOREIGN_SCOPE_END_TAG_IDS = {
  [htmlTree.NS.SVG]: new Set([
    htmlTree.TAG_ID.DESC,
    htmlTree.TAG_ID.FOREIGN_OBJECT,
    htmlTree.TAG_ID.TITLE,
  ]),
  [htmlTree.NS.MATHML]: new Set([
    htmlTree.TAG_ID.ANNOTATION_XML,
    htmlTree.TAG_ID.MI,
    htmlTree.TAG_ID.MN,
    htmlTree.TAG_ID.MO,
    htmlTree.TAG_ID.MS,
    htmlTree.TAG_ID.MTEXT,
  ]),
}
/** The tag ids the pinned parser's insertion-mode reset sets a mode at, whatever an element's namespace: the elements the HTML standard's reset names, all of them HTML elements. */
const RESET_MODE_TAG_IDS = new Set([
  htmlTree.TAG_ID.TR,
  htmlTree.TAG_ID.TBODY,
  htmlTree.TAG_ID.THEAD,
  htmlTree.TAG_ID.TFOOT,
  htmlTree.TAG_ID.CAPTION,
  htmlTree.TAG_ID.COLGROUP,
  htmlTree.TAG_ID.TABLE,
  htmlTree.TAG_ID.BODY,
  htmlTree.TAG_ID.FRAMESET,
  htmlTree.TAG_ID.SELECT,
  htmlTree.TAG_ID.TEMPLATE,
  htmlTree.TAG_ID.HTML,
  htmlTree.TAG_ID.TD,
  htmlTree.TAG_ID.TH,
  htmlTree.TAG_ID.HEAD,
])

/**
 * Lowers the ASCII capitals of a name, as a browser lowers a tag's and an attribute's name; called by {@link readTagAt}, {@link readAttributeAt} and the name counts of {@link HtmlPageReader}. Other letters keep their case, so no other letter turns into an ASCII one.
 * @param name - The name as written.
 * @returns The name with A to Z lowered.
 * @example
 * asciiLowerCase('HREF') // => 'href'
 */
function asciiLowerCase(name: string): string {
  return name.replace(/[A-Z]+/g, (capitals) => capitals.toLowerCase())
}

/**
 * Writes a tag token's name in svg case as Chrome does in svg content: by parse5's svg case table and by the names the HTML standard's table has beyond it ({@link HTML_PARSER_SVG_CASE_NAMES_PARSE5_LACKS}); called by {@link HtmlPageReader} for a start or an end tag under an svg element.
 * @param token - A start or end token whose name is in ASCII lower case.
 * @returns Nothing; the token's name and tag id are those of the svg element's own name.
 * @example
 * writeInSvgCase(fedropshadowEnd) // its name is now feDropShadow
 */
function writeInSvgCase(token: Parse5.Token.TagToken): void {
  foreignContent.adjustTokenSVGTagName(token)
  const svgCaseName = HTML_PARSER_SVG_CASE_NAMES_PARSE5_LACKS.get(token.tagName)
  if (svgCaseName === undefined) return
  token.tagName = svgCaseName
  token.tagID = htmlTree.getTagID(svgCaseName)
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
 * Reads a start tag from the character after its `<`, as a browser's tokenizer does: the name up to white space, a slash or `>`, then each attribute up to the `>` that ends the tag; a slash before `>` closes the tag itself, and a slash elsewhere separates. Called only by {@link HtmlPageReader.onStartTag}, at the start token's offset, to retain every original attribute, including duplicates.
 * @param html - The page.
 * @param nameAt - Where the tag's name starts, right after its `<`.
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
 * Its adapters use current select rules (a select changes no insertion mode, so table tokens close it by the table rules, and an input closes it by the body rule) and require a matching table section before closing a row; an open select ends every scope but the table scope; it resets the insertion mode by HTML elements alone, skips each end tag that provably changes nothing, writes an end's name in svg case under an svg element and compares a foreign element's name with it as Chrome does, and ignores a body-rule end at an svg or MathML integration point. Other tree construction stays with the pinned parser.
 * It depends on parse5 8.0.1 internals, which an upgrade must recheck one by one: the protected hooks it overrides (`_startTagOutsideForeignContent`, `_endTagOutsideForeignContent`, `_resetInsertionMode`, `_resetInsertionModeForSelect`, `onItemPush`, `onItemPop`, `onStartTag`, `onEndTag`) and the order the pinned parser calls them in; the pinned reset's walk, which reads `openElements.tagIDs` from the current node down and stops at the first tag id of `RESET_MODE_TAG_IDS`, whatever the namespace, so that the reader's reset may hide a foreign element's tag id for one pass; the @internal fields it reads or changes (`openElements` with `items`, `tagIDs`, `stackTop` and `tmplCount`, `insertionMode` with the mode numbers in constants.ts, `formElement`, `currentNotInHTML`, `skipNextNewLine`, `currentToken`); the methods of `activeFormattingElements` it wraps, which must stay the only ones that add or remove entries; the four scope checks of `openElements` it wraps (`hasInScope`, `hasInListItemScope`, `hasInButtonScope`, `hasNumberedHeaderInScope`), whose scope ends `SCOPE_END_TAG_IDS`, `LIST_ITEM_SCOPE_END_TAG_IDS`, `BUTTON_SCOPE_END_TAG_IDS` and `FOREIGN_SCOPE_END_TAG_IDS` repeat from parse5's open-element-stack.js; `_isSpecialElement` and the body rule for an end of an unknown name, which matches by tag id before it asks whether an element is special; and `foreignContent.adjustTokenSVGTagName` with its svg case table, which lacks the names of `HTML_PARSER_SVG_CASE_NAMES_PARSE5_LACKS` (recheck the table against the HTML standard's at an upgrade), the hook `shouldProcessStartTagTokenInForeignContent` it overrides to add them for start tags, and `_getAdjustedCurrentElement`.
 * @example new HtmlPageReader('<p>text</p>').tokenizer.write('<p>text</p>', true)
 */
class HtmlPageReader extends Parser<Parse5.DefaultTreeAdapterMap> {
  readonly startTags: HtmlStartTag[] = []
  /** The open elements' names in ASCII lower case, each with how many elements of that name are open. */
  private readonly openNames = new Map<string, number>()
  /** How many HTML select elements are open, so that a start tag finds no open select without a scan of the stack. */
  private openHtmlSelectCount = 0
  /** The insertion mode each open HTML select was pushed in: current rules give a select no mode of its own, so the mode stays while it is open and comes back when it closes. */
  private readonly selectPushModes = new WeakMap<
    Parse5.DefaultTreeAdapterMap['element'],
    number
  >()
  /** The HTML select that left the stack last, whose push mode {@link HtmlPageReader.closeSelect} restores. */
  private lastPoppedSelect: Parse5.DefaultTreeAdapterMap['element'] | undefined
  /** The element names of the list of active formatting elements, each with how many entries of that name it holds, markers aside. */
  private readonly formattingEntryNames = new Map<string, number>()

  /**
   * Retains the original page for attribute offsets; called only by {@link readHtmlStartTags}.
   * @param page - The unmodified HTML source.
   * @example new HtmlPageReader('<p title="a">text</p>')
   */
  constructor(private readonly page: string) {
    super({ sourceCodeLocationInfo: true, scriptingEnabled: true })
    this.countFormattingEntries()
    this.endScopesAtOpenSelect()
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
   * Answers, as the pinned parser does, whether a start tag takes the rules of foreign content, and then writes a name its svg case table lacks in svg case under an svg element; the pinned parser calls this for each start tag and then writes the names its table has in svg case.
   * @param token - The start token.
   * @returns Whether the token takes the rules of foreign content.
   * @example reader.shouldProcessStartTagTokenInForeignContent(fedropshadowStart) // true in an svg, and the token is named feDropShadow
   */
  protected override shouldProcessStartTagTokenInForeignContent(
    token: Parse5.Token.TagToken,
  ): boolean {
    if (!super.shouldProcessStartTagTokenInForeignContent(token)) return false
    if (
      this.treeAdapter.getNamespaceURI(this._getAdjustedCurrentElement()) ===
      htmlTree.NS.SVG
    )
      writeInSvgCase(token)
    return true
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
      // The cheap check of the input comes first: a hidden input in a table keeps the select open, and the scope check walks the stack.
      !this.isHiddenInputOfTableRule(token) &&
      this.hasOpenSelect()
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
    if (this.isEndAtForeignSpecialElement(token)) return
    if (token.tagID === htmlTree.TAG_ID.SELECT && this.hasOpenSelect()) {
      this.closeSelect()
      return
    }
    super._endTagOutsideForeignContent(token)
  }

  /**
   * Tells whether the body rules' end of an unknown name would close an svg or MathML integration point it names (`</mi>`, `</desc>`, `</foreignObject>` written in svg case), which the pinned parser matches by its tag id whatever the namespace; the HTML standard and Chrome match HTML elements only and stop at that special element, so the end is ignored. Called by {@link HtmlPageReader._endTagOutsideForeignContent} before the pinned rules.
   * Only in the modes whose rules hand such an end to the body rules ({@link HTML_PARSER_ABSENT_END_MODE_TABLE_NAMES}); the walk takes the pinned rule's own steps, from the current node down to the first element that matches or is special.
   * @param token - The end token handled by HTML rules.
   * @returns Whether the pinned rule would close a foreign element, so the end must be ignored instead.
   * @example reader.isEndAtForeignSpecialElement(miEnd) // => true for '<math><mi><span></mi>'
   */
  private isEndAtForeignSpecialElement(token: Parse5.Token.TagToken): boolean {
    if (
      !HTML_PARSER_ABSENT_END_MODE_TABLE_NAMES.has(this.insertionMode) ||
      !(
        FOREIGN_SCOPE_END_TAG_IDS[htmlTree.NS.SVG].has(token.tagID) ||
        FOREIGN_SCOPE_END_TAG_IDS[htmlTree.NS.MATHML].has(token.tagID)
      )
    )
      return false
    const { items, tagIDs, stackTop } = this.openElements
    for (let index = stackTop; index > 0; index -= 1) {
      const element = items[index]
      const tagID = tagIDs[index]
      if (
        element === undefined ||
        tagID === undefined ||
        !this.treeAdapter.isElementNode(element)
      )
        continue
      // The pinned rule matches by tag id before it asks whether the element is special.
      if (tagID === token.tagID)
        return this.treeAdapter.getNamespaceURI(element) !== htmlTree.NS.HTML
      if (this._isSpecialElement(element, tagID)) return false
    }
    return false
  }

  /**
   * Resets the insertion mode by the elements of the HTML namespace alone, as the HTML standard and browsers do: the pinned reset reads a tag id whatever the namespace, so an svg or MathML td sets the cell mode, and a later table end in that mode pops the whole stack and throws.
   * Called by the pinned parser wherever it resets the mode (after a table, a template or a caption closes) and by the select adapters of this reader. An element of another namespace with a tag id the reset reads is read as unknown for this one pass, down to where the reset stops, so the walk takes no longer than the pinned reset's own.
   * @returns Nothing; the mode is the one the HTML elements of the stack give.
   * @example reader._resetInsertionMode() // IN_TABLE, not IN_CELL, for '<table><svg><td><foreignObject>'
   */
  override _resetInsertionMode(): void {
    const { items, tagIDs, stackTop } = this.openElements
    const hiddenTagIDs: { index: number; tagID: Parse5.html.TAG_ID }[] = []
    // From the current node down to the first HTML element the reset sets a mode at, where the pinned reset stops.
    for (let index = stackTop; index >= 0; index -= 1) {
      const element = items[index]
      const tagID = tagIDs[index]
      if (
        element === undefined ||
        tagID === undefined ||
        !RESET_MODE_TAG_IDS.has(tagID) ||
        !this.treeAdapter.isElementNode(element)
      )
        continue
      if (this.treeAdapter.getNamespaceURI(element) === htmlTree.NS.HTML) break
      hiddenTagIDs.push({ index, tagID })
      tagIDs[index] = htmlTree.TAG_ID.UNKNOWN
    }
    try {
      super._resetInsertionMode()
    } finally {
      for (const { index, tagID } of hiddenTagIDs) tagIDs[index] = tagID
    }
  }

  /**
   * Continues the insertion-mode reset below an open select, as current HTML has no select modes; the pinned reset calls this when it meets a select.
   * @param selectIndex - Where the reset met the select on the stack of open elements.
   * @returns Nothing; the mode is the one the elements below every open select give.
   * @example reader._resetInsertionModeForSelect(3) // IN_CELL for a select in a table cell
   */
  override _resetInsertionModeForSelect(selectIndex: number): void {
    // An HTML select keeps the mode it was pushed in; the pinned reset would read the elements below it, an svg colgroup or td as a table's.
    const select = this.openElements.items[selectIndex]
    const pushMode =
      select && this.treeAdapter.isElementNode(select)
        ? this.selectPushModes.get(select)
        : undefined
    if (pushMode !== undefined) {
      this.insertionMode = pushMode
      return
    }
    // parse5 8.0.1 internals: the pinned _resetInsertionMode calls this protected hook, and this pass and the reader's own reset rewrite the @internal openElements.tagIDs for one reset; parse5 is pinned, so recheck both, with the hooks _startTagOutsideForeignContent and _endTagOutsideForeignContent, before an upgrade.
    const { tagIDs } = this.openElements
    const hiddenSelects: number[] = []
    // The reset met the topmost select, so the open selects all stand here or below; one it meets again, if the count missed it, comes back to this hook.
    let selectsLeft = Math.max(this.openNames.get('select') ?? 0, 1)
    // The pinned reset skips an unknown element, so each select below the one it met is read as one for this pass; the walk ends at the last open select.
    for (let index = selectIndex; index >= 0 && selectsLeft > 0; index -= 1) {
      if (tagIDs[index] !== htmlTree.TAG_ID.SELECT) continue
      hiddenSelects.push(index)
      tagIDs[index] = htmlTree.TAG_ID.UNKNOWN
      selectsLeft -= 1
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
   * Checks that an HTML select is open before the library's scope search, which assumes an initialized stack and walks it; called for each select and input start and each select end.
   * @returns Whether an HTML select remains in ordinary scope.
   * @example reader.hasOpenSelect() // false, without a scan, while no HTML select is open
   */
  private hasOpenSelect(): boolean {
    return (
      this.openHtmlSelectCount > 0 &&
      this.openElements.hasInScope(htmlTree.TAG_ID.SELECT)
    )
  }

  /**
   * Ends the current HTML select and restores the mode it was pushed in, which current rules kept while it was open.
   * @returns Nothing; the select and its children leave the stack.
   * @example reader.closeSelect() // called only after hasOpenSelect returned true
   */
  private closeSelect(): void {
    this.openElements.popUntilTagNamePopped(htmlTree.TAG_ID.SELECT)
    const pushMode =
      this.lastPoppedSelect && this.selectPushModes.get(this.lastPoppedSelect)
    // A select without a recorded push takes the mode the elements below it give.
    if (pushMode === undefined) this._resetInsertionMode()
    else this.insertionMode = pushMode
  }

  /**
   * Replaces the old select mode the pinned parser enters at a select start with the mode the select was pushed in, which current rules keep, or else with the mode the elements below the select give; raw text and other modes keep their meaning.
   * The pushed mode needs no walk of the stack, which deep nesting would make as long as the page for every select.
   * @returns Nothing; a select in a table cell leaves the cell mode, in body the body mode.
   * @example reader.useCurrentSelectMode() // leaves TEXT unchanged
   */
  private useCurrentSelectMode(): void {
    if (
      this.insertionMode !== HTML_PARSER_IN_SELECT_MODE &&
      this.insertionMode !== HTML_PARSER_IN_SELECT_IN_TABLE_MODE
    )
      return
    // The select the parser just pushed is the current node; its push recorded the mode it came in.
    const { current } = this.openElements
    const pushMode =
      current && this.treeAdapter.isElementNode(current)
        ? this.selectPushModes.get(current)
        : undefined
    if (pushMode === undefined) this._resetInsertionMode()
    else this.insertionMode = pushMode
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
    if (isTop) {
      this.addOpenName(node)
      this.recordSelectPush(node)
    } else this.rebuildOpenNames()
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
      if (this.isHtmlSelect(node)) {
        this.openHtmlSelectCount -= 1
        this.lastPoppedSelect = node
      }
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
    if (this.isHtmlSelect(node)) this.openHtmlSelectCount += 1
  }

  /**
   * Records the insertion mode an HTML select is pushed in, before the pinned parser leaves it for its old select mode; called by {@link HtmlPageReader.onItemPush} for a push on top.
   * @param node - The element pushed.
   * @returns Nothing; another element changes no record.
   * @example reader.recordSelectPush(select) // in a table cell, records IN_CELL
   */
  private recordSelectPush(
    node: Parse5.DefaultTreeAdapterMap['parentNode'],
  ): void {
    if (this.treeAdapter.isElementNode(node) && this.isHtmlSelect(node))
      this.selectPushModes.set(node, this.insertionMode)
  }

  /**
   * Tells whether an element is an HTML select, which {@link HtmlPageReader.openHtmlSelectCount} counts; an svg or MathML element named select is not; called by {@link HtmlPageReader.addOpenName} and {@link HtmlPageReader.onItemPop}.
   * @param element - An element that enters or leaves the stack.
   * @returns Whether the element is a select in the HTML namespace.
   * @example reader.isHtmlSelect(svgSelect) // => false
   */
  private isHtmlSelect(
    element: Parse5.DefaultTreeAdapterMap['element'],
  ): boolean {
    return (
      this.treeAdapter.getTagName(element) === 'select' &&
      this.treeAdapter.getNamespaceURI(element) === htmlTree.NS.HTML
    )
  }

  /**
   * Rebuilds from live stack entries after a non-top insertion, whose callback can name the current node instead.
   * @returns Nothing; stale entries past stackTop are excluded.
   * @example reader.rebuildOpenNames() // uses only items[0..stackTop]
   */
  private rebuildOpenNames(): void {
    this.openNames.clear()
    this.openHtmlSelectCount = 0
    for (let index = 0; index <= this.openElements.stackTop; index += 1) {
      const node = this.openElements.items[index]
      if (node) this.addOpenName(node)
    }
    // The pinned parser's event-free replace clones the same name/namespace.
    // Recheck that invariant when upgrading parse5; this adapter never changes token names.
  }

  /**
   * Makes an open HTML select end the ordinary, list item and button scopes and the heading scope, as Chrome 151 reads a page: inside a select an element opened before it is out of scope, so an end tag of it (`</b>`, `</div>`, `</h1>`) is ignored, a `</p>` inserts an empty paragraph, and a block start inside the select closes no paragraph outside it; the table scope keeps its rules, so a cell or a table still closes the select. Called once by the constructor.
   * The pinned parser's four scope checks are wrapped on this parser's stack: while no HTML select is open, and for the select itself, they answer as before.
   * @returns Nothing; the stack's scope checks follow open selects from here on.
   * @example reader.endScopesAtOpenSelect() // then '<b><select></b>' leaves the b and the select open
   */
  private endScopesAtOpenSelect(): void {
    const stack = this.openElements
    const hasInScope = stack.hasInScope.bind(stack)
    const hasInListItemScope = stack.hasInListItemScope.bind(stack)
    const hasInButtonScope = stack.hasInButtonScope.bind(stack)
    const hasNumberedHeaderInScope = stack.hasNumberedHeaderInScope.bind(stack)
    stack.hasInScope = (tagID): boolean =>
      this.openHtmlSelectCount === 0 || tagID === htmlTree.TAG_ID.SELECT
        ? hasInScope(tagID)
        : this.isInScopeEndingAtSelect(
            (openTagID) => openTagID === tagID,
            SCOPE_END_TAG_IDS,
          )
    stack.hasInListItemScope = (tagID): boolean =>
      this.openHtmlSelectCount === 0
        ? hasInListItemScope(tagID)
        : this.isInScopeEndingAtSelect(
            (openTagID) => openTagID === tagID,
            LIST_ITEM_SCOPE_END_TAG_IDS,
          )
    stack.hasInButtonScope = (tagID): boolean =>
      this.openHtmlSelectCount === 0
        ? hasInButtonScope(tagID)
        : this.isInScopeEndingAtSelect(
            (openTagID) => openTagID === tagID,
            BUTTON_SCOPE_END_TAG_IDS,
          )
    stack.hasNumberedHeaderInScope = (): boolean =>
      this.openHtmlSelectCount === 0
        ? hasNumberedHeaderInScope()
        : this.isInScopeEndingAtSelect(
            (openTagID) => htmlTree.NUMBERED_HEADERS.has(openTagID),
            SCOPE_END_TAG_IDS,
          )
  }

  /**
   * Walks the stack from the current node down as the pinned parser's scope checks do, and ends the walk at an HTML select as well; called by the scope checks {@link HtmlPageReader.endScopesAtOpenSelect} wraps, while an HTML select is open.
   * @param isTarget - Whether an HTML element of this tag id is the one looked for.
   * @param htmlScopeEnds - The HTML elements that end this scope.
   * @returns Whether an HTML element looked for comes before any element that ends the scope (true on a stack that holds neither, as the pinned walk answers).
   * @example reader.isInScopeEndingAtSelect((tagID) => tagID === TAG_ID.B, SCOPE_END_TAG_IDS) // => false for '<b><select>'
   */
  private isInScopeEndingAtSelect(
    isTarget: (tagID: Parse5.html.TAG_ID) => boolean,
    htmlScopeEnds: ReadonlySet<Parse5.html.TAG_ID>,
  ): boolean {
    const { items, tagIDs, stackTop } = this.openElements
    for (let index = stackTop; index >= 0; index -= 1) {
      const element = items[index]
      const tagID = tagIDs[index]
      if (
        element === undefined ||
        tagID === undefined ||
        !this.treeAdapter.isElementNode(element)
      )
        continue
      const namespace = this.treeAdapter.getNamespaceURI(element)
      if (namespace === htmlTree.NS.HTML) {
        if (isTarget(tagID)) return true
        if (htmlScopeEnds.has(tagID) || tagID === htmlTree.TAG_ID.SELECT)
          return false
      } else if (
        (namespace === htmlTree.NS.SVG || namespace === htmlTree.NS.MATHML) &&
        FOREIGN_SCOPE_END_TAG_IDS[namespace].has(tagID)
      )
        return false
    }
    return true
  }

  /**
   * Counts the entries of the list of active formatting elements by name as the pinned parser adds and removes them, so that an absent formatting end needs no scan of the list; called once by the constructor.
   * The list's methods that add or remove entries are wrapped on this parser's own list; marking and bookmarking change no name.
   * @returns Nothing; {@link HtmlPageReader.formattingEntryNames} follows the list from here on.
   * @example reader.countFormattingEntries() // then '<b>' counts one b entry
   */
  private countFormattingEntries(): void {
    const list = this.activeFormattingElements
    const pushElement = list.pushElement.bind(list)
    const insertElementAfterBookmark =
      list.insertElementAfterBookmark.bind(list)
    const removeEntry = list.removeEntry.bind(list)
    const clearToLastMarker = list.clearToLastMarker.bind(list)
    list.pushElement = (element, token): void => {
      const lengthBefore = list.entries.length
      pushElement(element, token)
      const removedCount = lengthBefore + 1 - list.entries.length
      // The Noah's Ark rule removes at most one older entry of the pushed name while no more than three alike are listed; more removals may have taken another name, so the names are counted anew.
      if (removedCount === 0)
        this.countFormattingName(this.treeAdapter.getTagName(element), 1)
      else if (removedCount > 1) this.recountFormattingNames()
    }
    list.insertElementAfterBookmark = (element, token): void => {
      insertElementAfterBookmark(element, token)
      this.countFormattingName(this.treeAdapter.getTagName(element), 1)
    }
    list.removeEntry = (entry): void => {
      const lengthBefore = list.entries.length
      removeEntry(entry)
      if ('element' in entry && list.entries.length < lengthBefore)
        this.countFormattingName(this.treeAdapter.getTagName(entry.element), -1)
    }
    list.clearToLastMarker = (): void => {
      // The entries before the newest marker leave, or all of them without a marker.
      for (const entry of list.entries) {
        if (!('element' in entry)) break
        this.countFormattingName(this.treeAdapter.getTagName(entry.element), -1)
      }
      clearToLastMarker()
    }
  }

  /**
   * Changes the count of one name in {@link HtmlPageReader.formattingEntryNames}; called by the list wrappers of {@link HtmlPageReader.countFormattingEntries}.
   * @param name - The element name of the entry, as the list compares it.
   * @param change - `1` for an added entry, `-1` for a removed one.
   * @returns Nothing; a name whose count falls to zero leaves the index.
   * @example reader.countFormattingName('b', -1) // the last b entry left
   */
  private countFormattingName(name: string, change: 1 | -1): void {
    const count = (this.formattingEntryNames.get(name) ?? 0) + change
    if (count > 0) this.formattingEntryNames.set(name, count)
    else this.formattingEntryNames.delete(name)
  }

  /**
   * Counts every entry name of the list of active formatting elements again; called by {@link HtmlPageReader.countFormattingEntries} after a push removed more than one entry.
   * @returns Nothing; the index holds the list's names as they are now.
   * @example reader.recountFormattingNames() // after a fourth identical b broke the rule's limit
   */
  private recountFormattingNames(): void {
    this.formattingEntryNames.clear()
    for (const entry of this.activeFormattingElements.entries)
      if ('element' in entry)
        this.countFormattingName(this.treeAdapter.getTagName(entry.element), 1)
  }

  /**
   * Skips an end tag that provably changes nothing, so that a page of many such ends after deep nesting takes no scan of the stack per end; the pinned parser's foreign rule and its body rule for an unknown name each walk the stack.
   * @param token - The source end token.
   * @returns Nothing; every other end keeps the parser's rules.
   * @example reader.onEndTag(spanEnd) // no stack scan for an absent span in a table cell
   */
  override onEndTag(token: Parse5.Token.TagToken): void {
    if (this.isAbsentEndWithoutEffect(token.tagName)) {
      // Preserve onEndTag's bookkeeping even when tree construction is a no-op.
      this.skipNextNewLine = false
      this.currentToken = token
      return
    }
    // In foreign content every end but </p> and </br> takes the foreign rule, which here compares names as a browser does.
    if (
      this.currentNotInHTML &&
      !HTML_PARSER_ABSENT_END_BODY_NAMES.has(token.tagName)
    ) {
      this.skipNextNewLine = false
      this.currentToken = token
      // Under an svg element Chrome first writes the end's name in svg case (clippath as clipPath), and the HTML rules then match it with no HTML element.
      const { current } = this.openElements
      if (
        current &&
        this.treeAdapter.isElementNode(current) &&
        this.treeAdapter.getNamespaceURI(current) === htmlTree.NS.SVG
      )
        writeInSvgCase(token)
      this.endTagInForeignContent(token)
      return
    }
    super.onEndTag(token)
  }

  /**
   * Applies the foreign end-tag rule as Chrome does: from the current node down, an element whose own name is the end's name closes with every element above it, and the first HTML element hands the end to the current insertion mode; called by {@link HtmlPageReader.onEndTag} for each end in foreign content but `</p>` and `</br>`, after it wrote the end's name in svg case under an svg element.
   * The names are compared as written: an element's name is in ASCII lower case as its start tag was read, or in svg case for an svg element, which only an end in svg content takes. The pinned parser's rule lowers every letter of the element's name instead, so `</gÀ>` misses an open svg `gÀ`, which a browser closes, `</gk>` closes a `gK` written with a Kelvin sign, and `</clippath>` in MathML content closes an svg `clipPath`, which Chrome both leave open.
   * @param token - The end token, its name in ASCII lower case, or in svg case under an svg element.
   * @returns Nothing; the stack or the current mode's rules act as a browser's do.
   * @example reader.endTagInForeignContent(endOfGWithGrave) // closes '<svg><gÀ>' down to the svg
   */
  private endTagInForeignContent(token: Parse5.Token.TagToken): void {
    const { items, stackTop } = this.openElements
    // The root element ends the walk, as the pinned rule's does.
    for (let index = stackTop; index > 0; index -= 1) {
      const element = items[index]
      if (!element || !this.treeAdapter.isElementNode(element)) continue
      if (this.treeAdapter.getNamespaceURI(element) === htmlTree.NS.HTML) {
        this._endTagOutsideForeignContent(token)
        return
      }
      const tagName = this.treeAdapter.getTagName(element)
      if (tagName === token.tagName) {
        // The token takes the element's own name, as the pinned rule gives it for the end location.
        token.tagName = tagName
        this.openElements.shortenToLength(index)
        return
      }
    }
  }

  /**
   * Tells whether an end tag names no open element and the current insertion mode's rules then leave the tree, the modes and the parser's pointers as they are; called by {@link HtmlPageReader.onEndTag}.
   * In foreign content such an end, `</p>` and `</br>` aside, finds no element of its name and takes the same rules, so the answer holds there too. An absent name is in no scope, so each scope check of these rules fails; what remains are the ends that act without an open element of their name.
   * @param name - The end tag's name in ASCII lower case.
   * @returns
   * - `true` when skipping the end changes nothing
   * - `false` for an open name, a mode outside {@link HTML_PARSER_ABSENT_END_MODE_TABLE_NAMES}, `</table>` where a caption, section or row closes at it, `</p>` and `</br>`, a name with an entry in the list of active formatting elements, a heading while one is open, and a form end that forgets the form pointer
   * @example
   * reader.isAbsentEndWithoutEffect('span') // => true in a table cell with no span open
   * reader.isAbsentEndWithoutEffect('h2') // => false while an h1 is open
   */
  private isAbsentEndWithoutEffect(name: string): boolean {
    const actingTableNames = HTML_PARSER_ABSENT_END_MODE_TABLE_NAMES.get(
      this.insertionMode,
    )
    if (
      actingTableNames === undefined ||
      actingTableNames.has(name) ||
      this.openNames.has(name) ||
      HTML_PARSER_ABSENT_END_BODY_NAMES.has(name)
    )
      return false
    // A formatting end removes a listed entry of its name whose element closed earlier.
    if (this.formattingEntryNames.has(name)) return false
    // A heading end closes an open heading of another level.
    if (HTML_PARSER_HEADING_NAMES.has(name))
      return ![...HTML_PARSER_HEADING_NAMES].some((heading) =>
        this.openNames.has(heading),
      )
    // Outside a template, a form end forgets the form pointer, which a form left in a table keeps set.
    if (name === 'form')
      return this.formElement === null || this.openElements.tmplCount > 0
    return true
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
