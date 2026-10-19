/** Bounds of the diagram records, and `markupExcerpt`: how many characters of a page's content a refusal quotes from the place it names ({@link unreadMarkupOf}) or from the attribute value it names ({@link attributeScriptingClauseOf}). */
const LIMITS = { diagrams: 24, nodes: 24, edges: 64, grid: 8, nodeLabel: 80, edgeLabel: 80, condition: 120, references: 8, markupExcerpt: 40 };
const LAYOUT = { nodeWidth: 168, columnGap: 296, rowGap: 100, margin: 48, fontSize: 13, lineHeight: 17, labelGap: 8, nodePadding: 14, laneGap: 34, loopWidth: 100, labelWidth: 22 };
const EDGE_KINDS = new Set(['call', 'return', 'data', 'containment', 'branch', 'pending']);
const IDENTIFIER = /^[A-Za-z][\w-]{0,63}$/;

/** Escapes metadata shared by the page and diagram renderers. @example escapeHtml('<name>') // '&lt;name&gt;' */
export const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/** Rejects misspelled graph fields before rendering can silently ignore them. @example record({ id: 'a' }, ['id'], 'node') */
function record(value, keys, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Invalid ${context} fields.`);
}

/** Bounds readable labels rather than truncating source meaning. @example text('Call service', 80, 'edge label') */
function text(value, maximum, context) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error(`Invalid ${context}; use 1–${maximum} characters.`);
}

/** Requires explicit cited evidence for each authored graph element. @example references(node.sources, 'node a') */
function references(values, context) {
  if (!Array.isArray(values) || !values.length || values.length > LIMITS.references) throw new Error(`${context} needs 1–${LIMITS.references} source references.`);
  for (const reference of values) {
    record(reference, ['path', 'line', 'endLine', 'quote'], `${context} source`);
    if (!Number.isSafeInteger(reference.line) || !Number.isSafeInteger(reference.endLine) || reference.line < 1 || reference.endLine < reference.line) throw new Error(`${context} needs an explicit source line range.`);
    text(reference.quote, 8000, `${context} source quote`);
  }
}

/** Validates explicit edge identity; node order never creates a relationship. @example validateDiagram({ id, title, caption, kind, nodes, edges }) */
function validateDiagram(diagram) {
  record(diagram, ['id', 'title', 'caption', 'kind', 'nodes', 'edges'], 'diagram');
  if (!IDENTIFIER.test(diagram.id) || typeof diagram.id !== 'string') throw new Error('A diagram needs a safe unique id.');
  text(diagram.title, 140, 'diagram title'); text(diagram.caption, 1000, 'diagram caption');
  if (!['flow', 'sequence'].includes(diagram.kind)) throw new Error('Diagram kind must be flow or sequence.');
  if (!Array.isArray(diagram.nodes) || !diagram.nodes.length || diagram.nodes.length > LIMITS.nodes || !Array.isArray(diagram.edges) || diagram.edges.length > LIMITS.edges) throw new Error('Split diagrams into at most 24 nodes and 64 edges.');
  const nodes = new Map(), cells = new Set(), edgeIds = new Set();
  for (const node of diagram.nodes) {
    record(node, diagram.kind === 'flow' ? ['id', 'label', 'row', 'column', 'sources'] : ['id', 'label', 'sources'], 'diagram node');
    if (typeof node.id !== 'string' || !IDENTIFIER.test(node.id) || nodes.has(node.id)) throw new Error('Diagram node IDs must be safe and distinct.');
    text(node.label, LIMITS.nodeLabel, 'node label'); references(node.sources, `Node ${node.id}`);
    if (diagram.kind === 'flow') {
      if (![node.row, node.column].every(value => Number.isInteger(value) && value >= 0 && value < LIMITS.grid)) throw new Error('Flow nodes need integer row/column positions in an 8x8 grid.');
      const cell = `${node.row}:${node.column}`;
      if (cells.has(cell)) throw new Error('Flow nodes cannot occupy the same grid cell.');
      cells.add(cell);
    }
    nodes.set(node.id, node);
  }
  for (const edge of diagram.edges) {
    record(edge, ['id', 'from', 'to', 'label', 'kind', 'condition', 'sources'], 'diagram edge');
    if (typeof edge.id !== 'string' || !IDENTIFIER.test(edge.id) || edgeIds.has(edge.id)) throw new Error('Diagram edge IDs must be safe and distinct.');
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error(`Edge ${edge.id} references an unknown node.`);
    if (!EDGE_KINDS.has(edge.kind)) throw new Error(`Edge ${edge.id} needs a supported relationship kind.`);
    text(edge.label, LIMITS.edgeLabel, 'edge label'); references(edge.sources, `Edge ${edge.id}`);
    if (edge.condition !== undefined || ['branch', 'pending'].includes(edge.kind)) text(edge.condition, LIMITS.condition, 'edge condition');
    edgeIds.add(edge.id);
  }
  return nodes;
}

/** Keeps ordinary words intact when graph text wraps; long tokens still fit without dropping characters. @example wrap('Read source', 20) // ['Read source'] */
function wrap(value, maximum) {
  const lines = []; let line = '', width = 0;
  for (const word of value.replace(/\s+/g, ' ').trim().split(' ')) {
    const wordWidth = [...word].reduce((sum, character) => sum + (character.codePointAt(0) > 255 ? 2 : 1), 0);
    if (line && width + 1 + wordWidth <= maximum) { line += ` ${word}`; width += 1 + wordWidth; continue; }
    // Preserve a boundary space on the prior SVG line; concatenated text must still read correctly.
    if (line) { lines.push(`${line} `); line = ''; width = 0; }
    // Prefer a PascalCase boundary for long symbol names before falling back to characters.
    for (const segment of word.split(/(?<=[a-z\d])(?=[A-Z])/u)) {
      const segmentWidth = [...segment].reduce((sum, character) => sum + (character.codePointAt(0) > 255 ? 2 : 1), 0);
      if (line && width + segmentWidth > maximum) { lines.push(line); line = ''; width = 0; }
      for (const character of segment) {
        const nextWidth = character.codePointAt(0) > 255 ? 2 : 1;
        // A single oversized segment or wide-script token still remains complete.
        if (width + nextWidth > maximum) { lines.push(line); line = ''; width = 0; }
        line += character; width += nextWidth;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Keeps an operation and its condition in one edge-owned text block. @example edgeLines({ label: 'render', condition: 'pending' }) */
function edgeLines(edge) { return [...wrap(edge.label, LAYOUT.labelWidth), ...(edge.condition ? wrap(`When ${edge.condition}`, LAYOUT.labelWidth) : [])]; }

/** Emits escaped, visible SVG text for the same record as its path. @example svgText(['Call'], 50, 20) */
function svgText(lines, x, y, anchor = 'middle') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="var(--text)" font-size="${LAYOUT.fontSize}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? LAYOUT.lineHeight : 0}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
}

/** Draws a named participant without deriving calls from its position. @example nodeSvg(node, { x: 48, y: 48, height: 62 }) */
function nodeSvg(node, position) {
  return `<g data-node-id="${node.id}"><rect x="${position.x}" y="${position.y}" width="${LAYOUT.nodeWidth}" height="${position.height}" rx="5" fill="var(--panel)" stroke="var(--border)"/>${svgText(wrap(node.label, 20), position.x + LAYOUT.nodeWidth / 2, position.y + LAYOUT.nodePadding + LAYOUT.fontSize)}</g>`;
}

/** Binds path, operation and condition to one edge ID, including reverse and pending paths. @example edgeSvg(edge, prefix, path, 100, 80) */
function edgeSvg(edge, prefix, path, labelX, labelY) {
  const dashed = ['return', 'pending'].includes(edge.kind) ? ' stroke-dasharray="5 4"' : '';
  const accessibleLabel = `${edge.label}${edge.condition ? `; when ${edge.condition}` : ''}`;
  const lines = edgeLines(edge);
  const longest = Math.max(...lines.map(line => [...line].reduce((width, character) => width + (character.codePointAt(0) > 255 ? 2 : 1), 0)));
  const backingWidth = longest * LAYOUT.fontSize * .72 + 12;
  const backing = `<rect x="${labelX - backingWidth / 2}" y="${labelY - LAYOUT.fontSize - 2}" width="${backingWidth}" height="${lines.length * LAYOUT.lineHeight + 1}" rx="3" fill="var(--bg)"/>`;
  // The opaque label backing keeps the edge operation legible where its own connector crosses it.
  return `<g data-edge-id="${edge.id}" data-from="${edge.from}" data-to="${edge.to}" data-kind="${edge.kind}" role="group" aria-label="${escapeHtml(accessibleLabel)}"><path d="${path}" fill="none" stroke="var(--link)" stroke-width="1.5"${dashed} marker-end="url(#${prefix}-arrow)"/>${backing}${svgText(lines, labelX, labelY)}</g>`;
}

/** Renders grid positions and explicit connectors without inferring temporal order. @example flowSvg(diagram, 'diagram-auth') */
function flowSvg(diagram, prefix) {
  const nodeHeight = Math.max(...diagram.nodes.map(node => wrap(node.label, 20).length)) * LAYOUT.lineHeight + LAYOUT.nodePadding * 2;
  const horizontalGroups = new Map();
  const definitions = new Map(diagram.nodes.map(node => [node.id, node]));
  for (const edge of diagram.edges) {
    const from = definitions.get(edge.from), to = definitions.get(edge.to);
    if (from.id === to.id || from.row !== to.row) continue;
    const key = [from.id, to.id].sort().join(':');
    const group = horizontalGroups.get(key) ?? [];
    group.push(edge); horizontalGroups.set(key, group);
  }
  const groupedHeight = [...horizontalGroups.values()].map(group => group.reduce((height, edge) => height + edgeLines(edge).length * LAYOUT.lineHeight, (group.length - 1) * LAYOUT.labelGap));
  const labelHeight = Math.max(LAYOUT.lineHeight, ...diagram.edges.map(edge => edgeLines(edge).length * LAYOUT.lineHeight), ...groupedHeight);
  const rowStride = nodeHeight + labelHeight + LAYOUT.rowGap, columnStride = LAYOUT.nodeWidth + LAYOUT.columnGap;
  const positions = new Map(diagram.nodes.map(node => [node.id, { x: LAYOUT.margin + node.column * columnStride, y: LAYOUT.margin + labelHeight + node.row * rowStride, height: nodeHeight }]));
  const selfCount = Math.max(0, ...diagram.nodes.map(node => diagram.edges.filter(edge => edge.from === node.id && edge.to === node.id).length));
  const loopSpace = selfCount ? selfCount * (LAYOUT.loopWidth + LAYOUT.nodeWidth) : 0;
  const width = Math.max(...[...positions.values()].map(position => position.x)) + LAYOUT.nodeWidth + LAYOUT.margin + loopSpace;
  const height = Math.max(...[...positions.values()].map(position => position.y)) + nodeHeight + LAYOUT.margin;
  const connectors = diagram.edges.map(edge => {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    if (edge.from === edge.to) {
      const right = from.x + LAYOUT.nodeWidth, top = from.y + nodeHeight / 4, bottom = from.y + nodeHeight * 3 / 4;
      const siblings = diagram.edges.filter(candidate => candidate.from === edge.from && candidate.to === edge.to);
      const offset = LAYOUT.loopWidth + siblings.indexOf(edge) * (LAYOUT.loopWidth + LAYOUT.nodeWidth);
      return edgeSvg(edge, prefix, `M${right} ${top} C${right + offset} ${top} ${right + offset} ${bottom} ${right} ${bottom}`, right + offset, from.y - labelHeight + LAYOUT.fontSize);
    }
    const horizontal = from.y === to.y;
    const forward = horizontal ? to.x > from.x : to.y > from.y;
    const startX = from.x + (horizontal ? forward ? LAYOUT.nodeWidth : 0 : LAYOUT.nodeWidth / 2);
    const endX = to.x + (horizontal ? forward ? 0 : LAYOUT.nodeWidth : LAYOUT.nodeWidth / 2);
    const startY = from.y + (horizontal ? nodeHeight / 2 : forward ? nodeHeight : 0);
    const endY = to.y + (horizontal ? nodeHeight / 2 : forward ? 0 : nodeHeight);
    const siblings = diagram.edges.filter(candidate => candidate.from === edge.from && candidate.to === edge.to || candidate.from === edge.to && candidate.to === edge.from);
    const lane = (siblings.indexOf(edge) - (siblings.length - 1) / 2) * LAYOUT.laneGap;
    const midpointX = (startX + endX) / 2, midpointY = (startY + endY) / 2;
    const offsetX = horizontal ? 0 : lane, offsetY = horizontal ? lane : 0;
    const path = `M${startX} ${startY} C${midpointX + offsetX} ${startY + offsetY} ${midpointX + offsetX} ${endY + offsetY} ${endX} ${endY}`;
    // Horizontal labels use the row's reserved band, clear of both nodes and their connector.
    const group = horizontalGroups.get([edge.from, edge.to].sort().join(':')) ?? [edge];
    const priorHeight = group.slice(0, group.indexOf(edge)).reduce((height, previous) => height + edgeLines(previous).length * LAYOUT.lineHeight + LAYOUT.labelGap, 0);
    const labelY = horizontal ? from.y - labelHeight + LAYOUT.fontSize + priorHeight : midpointY + offsetY - labelHeight / 2;
    return edgeSvg(edge, prefix, path, midpointX + offsetX, labelY);
  }).join('');
  return { width, height, content: connectors + diagram.nodes.map(node => nodeSvg(node, positions.get(node.id))).join('') };
}

/** Draws ordered messages between explicit participants, including returns and self calls. @example sequenceSvg(diagram, 'diagram-submit') */
function sequenceSvg(diagram, prefix) {
  const nodeHeight = Math.max(...diagram.nodes.map(node => wrap(node.label, 20).length)) * LAYOUT.lineHeight + LAYOUT.nodePadding * 2;
  const positions = new Map(diagram.nodes.map((node, index) => [node.id, { x: LAYOUT.margin + index * (LAYOUT.nodeWidth + LAYOUT.columnGap), y: LAYOUT.margin, height: nodeHeight }]));
  let y = LAYOUT.margin + nodeHeight + LAYOUT.margin;
  const messages = diagram.edges.map(edge => {
    const from = positions.get(edge.from).x + LAYOUT.nodeWidth / 2, to = positions.get(edge.to).x + LAYOUT.nodeWidth / 2;
    const labelY = y;
    y += edgeLines(edge).length * LAYOUT.lineHeight + LAYOUT.nodePadding;
    const path = edge.from === edge.to ? `M${from} ${y} h${LAYOUT.loopWidth} v${LAYOUT.laneGap} h-${LAYOUT.loopWidth}` : `M${from} ${y} H${to}`;
    const content = edgeSvg(edge, prefix, path, edge.from === edge.to ? from + LAYOUT.loopWidth / 2 : (from + to) / 2, labelY);
    y += LAYOUT.margin + (edge.from === edge.to ? LAYOUT.laneGap : 0);
    return content;
  }).join('');
  const width = LAYOUT.margin * 2 + diagram.nodes.length * (LAYOUT.nodeWidth + LAYOUT.columnGap) - LAYOUT.columnGap + LAYOUT.loopWidth;
  const participants = diagram.nodes.map(node => { const position = positions.get(node.id), center = position.x + LAYOUT.nodeWidth / 2; return nodeSvg(node, position) + `<path d="M${center} ${position.y + nodeHeight} V${y}" stroke="var(--border)" stroke-dasharray="4 4"/>`; }).join('');
  return { width, height: y + LAYOUT.margin, content: participants + messages };
}

/** A comment of authored HTML as a browser reads it: it ends at `-->` or at `--!>`, at once when it is `<!-->` or `<!--->`, and otherwise never: a browser then reads everything after its start as comment, up to the end of the document. */
const COMMENT = /<!--(?:-?>|[\s\S]*?(?:--!?>|$))/;
/** A start tag of authored HTML, read up to the `>` that ends it as a browser reads it: a quoted attribute value may hold a `>`, and a `<` inside the tag is a character of it (a bare attribute value `<!--` starts no comment). Text and an escaped code example hold no `<` before a letter, so they are never read as a tag. */
const START_TAG = /<[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/;
/** A comment or a start tag of authored HTML, the two things {@link withAttributeValues} and {@link scriptingClauseOf} tell apart from text. A comment is passed over whole, so an element inside it is no element of the page. */
const COMMENT_OR_START_TAG = new RegExp(`${COMMENT.source}|${START_TAG.source}`, 'g');
/** White space inside a tag is what a browser separates at there: tab, line feed, form feed, carriage return and space. Another space character (a no-break space) is a character of a name or of a bare value, so the patterns below name these five and never JavaScript's wider class. */
/** One attribute of a start tag, read in the order a browser reads them: what stands before its name (spaces, a slash, or nothing after a closing quote), its name, and, when it has a value, its equals sign and the value in double quotes, in single quotes or bare. */
const ATTRIBUTE = /([\t\n\f\r /]*)([^\t\n\f\r "'<>/=]+)(?:([\t\n\f\r ]*=[\t\n\f\r ]*)(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r "'=<>`]+)))?/g;
/** A character reference in an attribute value: decimal, hexadecimal, or one of the five named ones an author writes into an address or an id. */
const CHARACTER_REFERENCE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g;
const NAMED_CHARACTERS = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** The character a numeric reference names; the replacement character for a number that names none. Called by {@link attributeText}. @example referencedCharacter('45', 10) // => '-' */
const referencedCharacter = (digits, radix) => { const codePoint = Number.parseInt(digits, radix); return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '�'; };
/** Reads an attribute value as a browser does: every character reference becomes its character, so an id or an address written with an entity compares as the text it means. Called by {@link withAttributeValues} and {@link attributeScriptingClauseOf}. @example attributeText('a&amp;b.html#qa&#45;form') // => 'a&b.html#qa-form' */
const attributeText = value => value.replace(CHARACTER_REFERENCE, (_reference, decimal, hexadecimal, name) => NAMED_CHARACTERS[name] ?? referencedCharacter(decimal ?? hexadecimal, decimal === undefined ? 16 : 10));
/** An attribute's value as written, in whichever of the three forms {@link ATTRIBUTE} matched it. Called by {@link withAttributeValues} and {@link attributesOf}. @example writtenValue(undefined, 'a', undefined) // => 'a' */
const writtenValue = (double, single, bare) => double ?? single ?? bare;
/** What the publisher reads exactly as a browser does at a `<` of authored HTML, tried at that `<` alone: a comment that ends; an end tag; a start tag (the first group; the slash that closes it at once, if it has one, is the second) whose attributes are separated by spaces or follow a closing quote and whose values are quoted, or bare without a character a browser takes for an error there (a quotation mark, `<`, `=` or a backtick); or a `<` before a character that starts no tag, which is text. Anything else at a `<` (`<?`, `<!` without `--`, a CDATA section, a quote that is no attribute's value, a tag or a quoted value that never ends, an end tag with an attribute) a browser reads by rules this publisher does not follow. */
const READ_EXACTLY = /<!--(?:-?>|[\s\S]*?--!?>)|<\/[A-Za-z][A-Za-z0-9:._-]*[\t\n\f\r ]*>|(<[A-Za-z][A-Za-z0-9:._-]*(?:(?:[\t\n\f\r ]+|(?<=["']))[^\t\n\f\r "'<>/=]+(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"[^"]*"|'[^']*'|[^\t\n\f\r "'<>=`]+))?)*[\t\n\f\r ]*(\/?)>)|<(?![A-Za-z!/?])/y;
/** The attributes of a start tag as {@link ATTRIBUTE} reads them: for each its name in lower case and its value as written (an empty text without one). Called by {@link isTagReadExactly} and {@link tagScriptingClauseOf}. @example attributesOf('<h2 id="a" hidden>') // => [['id', 'a'], ['hidden', '']] */
const attributesOf = tag => [...tag.slice(tag.search(/[\t\n\f\r />]/)).matchAll(ATTRIBUTE)].map(([, , name, , double, single, bare]) => [name.toLowerCase(), writtenValue(double, single, bare) ?? '']);
/** Whether an id is written so that the publisher reads the text a browser reads: plain, or with the character references {@link attributeText} reads. Another reference (`&lowbar;`, or `&#45` without its semicolon) a browser turns into a character the publisher would not see. An ampersand that can begin no reference is text for both: before a digit of `&#` or `&#x` a browser reads a number, and a name of its table of references has two characters at least and begins with a letter, so `&` before one letter or digit and then something else (`q&a`, `R&D`), before a digit, or before any other character begins none. Whether two or more letters and digits after `&` begin a name only the table can tell, which this publisher does not carry: such an id is refused, and the refusal says to write `&` as `&amp;`. Called by {@link isTagReadExactly}. @example isIdReadExactly('qa&#45;form') // => true; isIdReadExactly('q&a') // => true; isIdReadExactly('qa&#45form') // => false; isIdReadExactly('a&lowbar;b') // => false */
const isIdReadExactly = id => !/&(?:#[0-9]|#[xX][0-9a-fA-F]|[A-Za-z][A-Za-z0-9])/.test(id.replace(CHARACTER_REFERENCE, ''));
/** Whether a start tag that {@link READ_EXACTLY} matched carries what the publisher reads as a browser does: each attribute once (a browser keeps the first of two and drops the other) and an id read exactly. Called by {@link unreadMarkupOf}. @example isTagReadExactly('<h2 id="a" id="qa-form">') // => false */
const isTagReadExactly = tag => {
  const attributes = attributesOf(tag), names = attributes.map(([name]) => name);
  return new Set(names).size === names.length && attributes.every(([name, value]) => name !== 'id' || isIdReadExactly(value));
};
/** How many characters the publisher reads exactly as a browser does at one `<` of authored HTML; 0 when it cannot. Called by {@link unreadMarkupOf}. @example readLengthAt('a <b> c', 2) // => 3; readLengthAt('a <? c', 2) // => 0 */
const readLengthAt = (html, index) => {
  READ_EXACTLY.lastIndex = index;
  const read = READ_EXACTLY.exec(html);
  // The first group is a start tag; a comment, an end tag and a `<` of the text need no second look.
  return read && (read[1] === undefined || isTagReadExactly(read[1])) ? read[0].length : 0;
};
/** Finds the first place of authored HTML that the publisher cannot read exactly as a browser does, so the page renderer can refuse the page instead of reading tags and ids there that a browser reads differently. Every `<` is looked at once; what a tag or a comment holds is passed over with it. @returns The first {@link LIMITS}.markupExcerpt characters of that place with its white space as single spaces; undefined when every `<` is read exactly. @example unreadMarkupOf('<p>1 < 2</p><? <h2 id="a">') // => '<? <h2 id="a">' */
export const unreadMarkupOf = html => {
  for (let index = html.indexOf('<'); index !== -1;) {
    const length = readLengthAt(html, index);
    if (length === 0) return html.slice(index, index + LIMITS.markupExcerpt).replace(/[\t\n\f\r ]+/g, ' ');
    index = html.indexOf('<', index + length);
  }
  return undefined;
};
/** A set of element names, written as one text. @example namesOf('td th').has('th') // => true */
const namesOf = text => new Set(text.split(' '));
/** Elements that open nothing; `image` is among them because a browser reads it as `img`. */
const VOID_ELEMENTS = namesOf('area base basefont bgsound br col embed hr image img input keygen link meta param source track wbr');
/** Elements whose end tag an author may leave out: a browser closes them by itself, at the next one or at the end of what holds them. No other element is ever closed for the author. */
const CLOSED_BY_THEMSELVES = namesOf('dd dt li optgroup option p rb rp rt rtc');
/** Those of them that every end tag closes; the others (a paragraph, a list item, a term, a detail) only the end tag of a block or of a table part does. */
const CLOSED_BY_EVERY_END_TAG = namesOf('optgroup option rb rp rt rtc');
const NO_NAMES = new Set();
/** Start tags at which a browser closes an open paragraph. */
const ENDS_A_PARAGRAPH = namesOf('address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer header hgroup main menu nav ol p search section summary ul h1 h2 h3 h4 h5 h6 pre listing form li dd dt table hr');
const PARAGRAPH = namesOf('p');
/** Start tags at which a browser closes an option on top of the open elements. */
const CLOSES_AN_OPTION = namesOf('option optgroup');
const OPTION = namesOf('option');
/** How an element of mathematics is written among the open elements: with this before its name, which no tag name holds. An element a page names `mi` outside mathematics is an HTML element and not one of these. */
const MATHML = 'math ';
/** The elements of mathematics whose content a browser reads as HTML again. */
const MATH_TEXT = new Set(['mi', 'mo', 'mn', 'ms', 'mtext'].map(name => MATHML + name));
/** The HTML start tags at which a browser closes the mathematics they are written in, outside its text elements. */
const ENDS_MATH = namesOf('b big blockquote body br center code dd div dl dt em embed font h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var');
/** Elements beyond which a browser looks for no open element of a name, and the same with `button` for an open paragraph. */
const SCOPE_BOUNDARY = new Set([...namesOf('applet caption marquee table td th'), ...MATH_TEXT]);
const PARAGRAPH_BOUNDARY = new Set([...SCOPE_BOUNDARY, 'button']);
/** Elements at which a browser stops looking for the open list item, term or detail that a new one closes: the standard's special elements other than `address`, `div` and `p`. */
const ITEM_BOUNDARY = new Set([...namesOf('applet aside blockquote button caption center colgroup dd details dir dl dt fieldset figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup li listing marquee menu nav ol pre search section summary table tbody td tfoot th thead tr ul'), ...MATH_TEXT]);
/** Elements a browser does not open inside an open one of their own kind, each with the elements beyond which it does not look for the open one. */
const NOT_INSIDE_ITSELF = new Map([['button', SCOPE_BOUNDARY], ['nobr', SCOPE_BOUNDARY], ['a', namesOf('applet caption marquee td th')]]);
const HEADINGS = namesOf('h1 h2 h3 h4 h5 h6');
/** Which open item a new list item, term or detail closes. A `Map`, like the tables below: a page may name an element `constructor`. */
const ITEM_KINDS = new Map([['li', namesOf('li')], ['dd', namesOf('dd dt')], ['dt', namesOf('dd dt')]]);
/** The part of a ruby that stays open when a new part closes the elements on top of it: an `rt` and an `rp` stay inside an open `rtc`. */
const RUBY_PART_STAYS_IN = new Map([['rb', undefined], ['rtc', undefined], ['rp', 'rtc'], ['rt', 'rtc']]);
const TABLE_PARTS = namesOf('caption colgroup tbody thead tfoot tr td th');
const TABLE_STRUCTURE = namesOf('table caption colgroup tbody thead tfoot tr td th');
/** The parts of a table between which a `table` start tag closes the open table by force. */
const BETWEEN_TABLE_PARTS = namesOf('table colgroup tbody thead tfoot tr');
/** The parts a table part's start tag closes by itself when they stand on top of the open elements, beside the elements that close by themselves. */
const PARTS_CLOSED_BY_START = new Map(
  Object.entries({ col: 'td th tr tbody thead tfoot caption', td: 'td th caption colgroup', th: 'td th caption colgroup', tr: 'td th tr caption colgroup', tbody: [...TABLE_PARTS].join(' '), thead: [...TABLE_PARTS].join(' '), tfoot: [...TABLE_PARTS].join(' '), caption: [...TABLE_PARTS].join(' '), colgroup: [...TABLE_PARTS].join(' ') }).map(([name, parts]) => [name, new Set([...CLOSED_BY_THEMSELVES, ...namesOf(parts)])]),
);
/** What the end tag of a block or of a table part closes by itself before its own element: the elements that close by themselves, and for a table, a row and a table's head, body and foot the parts inside them. */
const CLOSED_BY_END_TAG = new Map([
  ...'address applet aside blockquote button center details dialog dir div dl fieldset figcaption figure footer header hgroup listing marquee menu nav ol pre search section summary ul li dd dt p h1 h2 h3 h4 h5 h6 td th caption'.split(' ').map(name => [name, CLOSED_BY_THEMSELVES]),
  ...Object.entries({ table: [...TABLE_PARTS].join(' '), tr: 'td th', tbody: 'td th tr', thead: 'td th tr', tfoot: 'td th tr' }).map(([name, parts]) => [name, new Set([...CLOSED_BY_THEMSELVES, ...namesOf(parts)])]),
]);
/** The name of an open element as a refusal shows it. @example shown('math mrow') // => 'mrow' */
const shown = entry => entry.replace(MATHML, '');
/** What a page's content does that is not balanced, as the clause the refusal ends with: an element still open at the end of the content, at a start tag where a browser closes it by force, or at the end tag of an element opened before it; an end tag of an element the content did not open; and a tag a browser does not keep where it is written. */
const WHAT_TO_DO = "close every element inside the page's content, the last opened first.";
const neverCloses = entry => `opens <${shown(entry)}> and never closes it; ${WHAT_TO_DO}`;
const leftOpenAtStartTag = (entry, startName) => `opens <${shown(entry)}> and does not close it before <${startName}>, where a browser closes it; ${WHAT_TO_DO}`;
const leftOpenAtEndTag = (entry, endName) => `opens <${shown(entry)}> and does not close it before </${endName}>; ${WHAT_TO_DO}`;
const closesUnopened = name => `has </${name}> without a <${name}> it opens; ${WHAT_TO_DO}`;
const outsideATable = name => `has <${name}> outside a table; write a table's parts inside a <table>.`;
const insideMathMarkup = name => `has <${name}> inside <math> outside its text; inside mathematics write HTML elements only in <mi>, <mo>, <mn>, <ms> or <mtext>.`;
/** Takes the elements of `names` off the top of the open elements, down to one named `except`. Called for a start tag, an end tag and the end of the content. @example closeOnTop(open = ['ul', 'li', 'p'], CLOSED_BY_THEMSELVES) // leaves ['ul'] */
const closeOnTop = (open, names, except) => {
  while (open.length && open.at(-1) !== except && names.has(open.at(-1))) open.pop();
};
/** Closes the nearest open element of `kinds` as a browser does at a start tag: it looks down the open elements, stops at a boundary, and closes that element with everything above it. Only elements that close by themselves may stand above. @returns The name of another one, which a browser would close by force, or undefined. @example closeNearest(['ul', 'li', 'div'], new Set(['li']), ITEM_BOUNDARY) // => 'div' */
const closeNearest = (open, kinds, boundary) => {
  const nearest = open.findLastIndex(name => kinds.has(name) || boundary.has(name));
  if (!kinds.has(open[nearest])) return undefined;
  const inTheWay = open.slice(nearest + 1).find(name => !CLOSED_BY_THEMSELVES.has(name));
  if (inTheWay === undefined) open.length = nearest;
  return inTheWay;
};
/** Whether an element of a name is open with no boundary above it. @example isOpenWithin(['button', 'td'], 'button', SCOPE_BOUNDARY) // => false */
const isOpenWithin = (open, name, boundary) => open[open.findLastIndex(candidate => candidate === name || boundary.has(candidate))] === name;
/** What the start tag of an option or of a part of a ruby closes by itself, where nothing can be in the way: an option on top of the open elements, and inside a ruby the elements that close by themselves on top of them. */
const closeOptionOrRubyParts = (open, name) => {
  if (CLOSES_AN_OPTION.has(name)) closeOnTop(open, OPTION);
  if (RUBY_PART_STAYS_IN.has(name) && isOpenWithin(open, 'ruby', SCOPE_BOUNDARY)) closeOnTop(open, CLOSED_BY_THEMSELVES, RUBY_PART_STAYS_IN.get(name));
};
const itemKindsClosedBy = name => ITEM_KINDS.get(name) ?? NO_NAMES;
/** What a start tag closes by itself among list items and paragraphs. @returns The clause for an element in the way, or undefined. */
const closedItemOrParagraph = (open, name) => {
  const itemInTheWay = closeNearest(open, itemKindsClosedBy(name), ITEM_BOUNDARY);
  const inTheWay = itemInTheWay ?? closeNearest(open, ENDS_A_PARAGRAPH.has(name) ? PARAGRAPH : NO_NAMES, PARAGRAPH_BOUNDARY);
  return inTheWay === undefined ? undefined : leftOpenAtStartTag(inTheWay, name);
};
/** What a table part's start tag does: outside a table a browser drops it, so it is refused; inside one it closes the parts before it, and whatever else stands open above the nearest part a browser would close by force. @returns The clause, or undefined. */
const closedTableParts = (open, name) => {
  const closes = PARTS_CLOSED_BY_START.get(name);
  if (closes === undefined) return undefined;
  const context = open.findLastIndex(candidate => TABLE_STRUCTURE.has(candidate));
  if (context === -1) return outsideATable(name);
  const inTheWay = open.slice(context + 1).find(candidate => !CLOSED_BY_THEMSELVES.has(candidate));
  if (inTheWay !== undefined) return leftOpenAtStartTag(inTheWay, name);
  open.length = context + 1;
  return void closeOnTop(open, closes);
};
/** The start tags at which a browser closes by force an element that an author must close: a `table` between the parts of an open table; a button, a link or a `nobr` inside an open one of its own kind; and a heading directly inside a heading. @returns The clause, or undefined. */
const tableClosedByForce = (open, name) => (name === 'table' && BETWEEN_TABLE_PARTS.has(open.findLast(candidate => TABLE_STRUCTURE.has(candidate))) ? leftOpenAtStartTag('table', 'table') : undefined);
const ownKindClosedByForce = (open, name) => (NOT_INSIDE_ITSELF.has(name) && isOpenWithin(open, name, NOT_INSIDE_ITSELF.get(name)) ? leftOpenAtStartTag(name, name) : undefined);
const headingClosedByForce = (open, name) => (HEADINGS.has(name) && HEADINGS.has(open.at(-1)) ? leftOpenAtStartTag(open.at(-1), name) : undefined);
const closedByForce = (open, name) => tableClosedByForce(open, name) ?? ownKindClosedByForce(open, name) ?? headingClosedByForce(open, name);
/** Everything an HTML start tag closes before its own element opens. @returns The clause when the content is not balanced there, or undefined. */
const closedByStartTag = (open, name) => {
  closeOptionOrRubyParts(open, name);
  return closedItemOrParagraph(open, name) ?? closedTableParts(open, name) ?? closedByForce(open, name);
};
/** Whether an open element is one of mathematics. */
const isMathML = entry => entry?.startsWith(MATHML) === true;
/** Whether a browser reads the next start tag as markup of mathematics and not as HTML: the innermost open element is one of mathematics other than its text elements. */
const readsMathMarkup = open => isMathML(open.at(-1)) && !MATH_TEXT.has(open.at(-1));
/** Opens the element of a start tag in the markup of mathematics, where nothing closes by itself and a tag closed at once with a slash opens nothing. An HTML tag at which a browser would close the mathematics is refused. @returns The clause, or undefined. */
const openInMath = (open, name, isClosedAtOnce) => {
  if (ENDS_MATH.has(name)) return insideMathMarkup(name);
  if (!isClosedAtOnce) open.push(MATHML + name);
  return undefined;
};
/** Whether an HTML start tag opens nothing: a void element (the slash means nothing in HTML), and mathematics closed at once with a slash. */
const opensNothing = (name, isClosedAtOnce) => VOID_ELEMENTS.has(name) || (name === 'math' && isClosedAtOnce);
/** Opens the element of an HTML start tag, after what the tag closes by itself. @returns The clause when the content is not balanced there, or undefined. */
const openInHtml = (open, name, isClosedAtOnce) => {
  const clause = closedByStartTag(open, name);
  if (clause === undefined && !opensNothing(name, isClosedAtOnce)) open.push(name === 'math' ? MATHML + name : name);
  return clause;
};
/** The elements an end tag closes by itself before its own: none where the innermost open element is one of mathematics or the end tag's own HTML element is not open. */
const closedByEndTag = (open, name) => (isMathML(open.at(-1)) || !open.includes(name) ? NO_NAMES : CLOSED_BY_END_TAG.get(name) ?? CLOSED_BY_EVERY_END_TAG);
/** Whether the content opened an element of a name and has not closed it, in HTML or in mathematics. */
const isOpen = (open, name) => open.includes(name) || open.includes(MATHML + name);
/** Closes the element of an end tag, after the elements the end tag closes by itself. @returns The clause when the content is not balanced there (another element is still open above it, or the content never opened it), or undefined. */
const closeElement = (open, name) => {
  // An end tag closes an element of mathematics where one is the innermost open element.
  const entry = isMathML(open.at(-1)) ? MATHML + name : name;
  closeOnTop(open, closedByEndTag(open, name), entry);
  if (open.at(-1) === entry) return void open.pop();
  return isOpen(open, name) ? leftOpenAtEndTag(open.at(-1), name) : closesUnopened(name);
};
/** The name of a tag {@link READ_EXACTLY} matched, as a browser reads it. @example nameOf('</TD >') // => 'td' */
const nameOf = tag => /^<\/?([A-Za-z0-9:._-]+)/.exec(tag)[1].toLowerCase();
/** What one match of {@link READ_EXACTLY} does to the open elements: a start tag opens, an end tag closes, a comment and a `<` of the text do nothing. @returns The clause when the content is not balanced there, or undefined. */
const clauseAt = (open, [whole, startTag, slash]) => {
  if (startTag !== undefined) return (readsMathMarkup(open) ? openInMath : openInHtml)(open, nameOf(startTag), slash === '/');
  return whole.startsWith('</') ? closeElement(open, nameOf(whole)) : undefined;
};
/** What {@link READ_EXACTLY} reads at a `<` of content that {@link unreadMarkupOf} let through. In other content a `<` it does not read counts as a `<` of the text. */
const readAt = (html, index) => {
  READ_EXACTLY.lastIndex = index;
  return READ_EXACTLY.exec(html) ?? ['<'];
};
/** Says where a page's content is not balanced. Content is balanced when every element it opens is closed in it, the last opened first, with the end tags an author may leave out (a paragraph, a list item, a term or a detail of a description list, an option, a part of a ruby, and a table's caption, column group, head, body, foot, row and cell), and no end tag closes what the content did not open. What is not balanced reaches beyond the article in a browser: a table left open takes the field and the button out of the reader's question form and the rail into the article, an end tag too many closes the reader's own layout, and an inline element left open is opened again around everything that follows. It is a stack of open elements over the tags {@link READ_EXACTLY} reads, not a tree builder: only the elements whose end tag may be left out are closed for the author, where a browser closes them, and what a browser would close by force is refused. Called by the page renderer after {@link unreadMarkupOf} let the content through. @returns The clause the refusal ends with, or undefined for balanced content. @example unbalancedClauseOf('<table><tr><td>cell</td></tr>') // => 'opens <table> and never closes it; close every element inside the page\'s content, the last opened first.' */
export const unbalancedClauseOf = html => {
  const open = [];
  for (let index = html.indexOf('<'); index !== -1;) {
    const read = readAt(html, index);
    const clause = clauseAt(open, read);
    if (clause !== undefined) return clause;
    index = html.indexOf('<', index + read[0].length);
  }
  closeOnTop(open, CLOSED_BY_THEMSELVES);
  return open.length ? neverCloses(open.at(-1)) : undefined;
};
/** The schemes an address in a page's content may name for any place: the web's and mail's. Any other (`javascript:`, `data:`, `file:` …) is refused by {@link scriptingClauseOf}, except Codebook's own editor addresses ({@link CODEBOOK_ADDRESS_STARTS}). */
const ADDRESS_SCHEMES = new Set(['http', 'https', 'mailto']);
/** How Codebook's own addresses start in both editors, which the reader binds to the editor that serves the page: an address of the editors' schemes is accepted only under Codebook's authority, never another extension's URI handler or the editor's file handler (`vscode://file/…`). */
const CODEBOOK_ADDRESS_STARTS = ['vscode://laststance.codebook/', 'cursor://laststance.codebook/'];
/** Whether an address, as {@link isAcceptedAddress} reads it, is one of Codebook's own ({@link CODEBOOK_ADDRESS_STARTS}); the scheme and the authority compare without case, as a browser compares them. Called by {@link isAcceptedAddress}. @example isCodebookAddress('cursor://laststance.codebook/source?path=a.ts') // => true; isCodebookAddress('vscode://file/etc/hosts') // => false */
const isCodebookAddress = read => CODEBOOK_ADDRESS_STARTS.some(start => read.toLowerCase().startsWith(start));
/** The attributes whose value a browser follows, loads or submits to as an address, SVG's `xlink:href` among them; `srcset` holds a list of them, and `cite` names the source of a quote. */
const ADDRESS_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'srcset', 'cite']);
/** The attributes a page's content may give its elements: those an article needs, as the 46 pages real chats wrote on the development host show (they use id, href and data-codebook-diagram alone), with the ones of tables, lists, quotes, times, open details and accessibility (`aria-*`); `src` is allowed on an image alone ({@link isAllowedAttribute}). Every other attribute (`style`, `poster`, `background`, `ping`, `srcset`, `target` …) may carry an address or a script of its own and is refused. */
const CONTENT_ATTRIBUTES = new Set(['id', 'class', 'href', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'scope', 'headers', 'lang', 'dir', 'role', 'open', 'start', 'reversed', 'datetime', 'cite', 'data-codebook-diagram']);
/** The attributes {@link CONTENT_ATTRIBUTES} allows, as the refusal of another one names them. */
const CONTENT_ATTRIBUTE_LIST = 'id, class, href, alt, title, width, height, colspan, rowspan, scope, headers, lang, dir, role, aria-*, open, start, reversed, datetime, cite and data-codebook-diagram, and src on an image';
/** Whether a page's content may give an element an attribute: one of {@link CONTENT_ATTRIBUTES}, an `aria-` attribute, or `src` on an image (`<img>`, or `<image>`, which a browser reads as `<img>`). Called by {@link allowlistClauseOf}. @example isAllowedAttribute('img', 'src') // => true; isAllowedAttribute('p', 'style') // => false */
const isAllowedAttribute = (tag, name) => CONTENT_ATTRIBUTES.has(name) || name.startsWith('aria-') || (name === 'src' && ['img', 'image'].includes(tag));
/** The clause a refusal of an attribute an article does not need ends with ({@link isAllowedAttribute}); called by {@link tagScriptingClauseOf}. @returns The clause, or undefined for an attribute a page may carry. @example allowlistClauseOf('p', ['style', 'color:red']) // => 'must give its elements only the attributes an article needs (…): its <p> holds style.' */
const allowlistClauseOf = (tag, [name]) => isAllowedAttribute(tag, name) ? undefined : `must give its elements only the attributes an article needs (${CONTENT_ATTRIBUTE_LIST}): its <${tag}> holds ${name}.`;
/** The first clause `clauseOf` gives an attribute of a tag, in the order the tag writes them; called by {@link tagScriptingClauseOf}. @example firstClauseOf([['style', '']], ([name]) => name) // => 'style' */
const firstClauseOf = (attributes, clauseOf) => {
  for (const attribute of attributes) {
    const clause = clauseOf(attribute);
    if (clause !== undefined) return clause;
  }
  return undefined;
};
/** What no address may hold, whatever it names: a number reference after the publisher read the ones it reads (`&#58` without its semicolon, which a browser reads as a colon wherever it stands), or two slashes or backslashes in any mix at its start (`//host/x`, `\\\\host\\share\\x`, `/\\host/x`), which a page opened from disk on Windows reads as a network path (`file://host/…`): an image there fetches it over SMB without a click and may send the learner's NTLM credentials. Called by {@link isAcceptedAddress}. */
const REFUSED_IN_ANY_ADDRESS = /&#|^[/\\]{2}/;
/** Whether {@link attributeScriptingClauseOf} accepts one address, its character references read by {@link attributeText}, as a browser reads it: without the spaces and control characters at its ends and without any tab or line break in it. Without a colon before its first slash, question mark or number sign it is a relative path or a fragment, unless a reference this publisher does not read stands there, which a browser may read as a colon or a tab: a named one with its semicolon (`&colon;`, `&Tab;`). A number without its semicolon (`&#58`) a browser reads too, wherever it stands, and its `#` would end the part the colon is looked for in, so an address that holds `&#` after its references were read is refused. A name without a semicolon a browser reads only from its short table of old names, none of which is a colon, a letter or a space, so `a&b.html` is a path. @example isAcceptedAddress('pages/flow.html#start') // => true; isAcceptedAddress('a&b.html') // => true; isAcceptedAddress('java\tscript:run()') // => false; isAcceptedAddress('javascript&colon;run()') // => false; isAcceptedAddress('javascript&#58run()') // => false; isAcceptedAddress('\\\\host\\share\\x.png') // => false */
const isAcceptedAddress = address => {
  const read = withoutAddressEdgeControls(address).replace(/[\t\n\r]/g, '');
  const [head] = read.split(/[/?#]/), schemeEnd = head.indexOf(':');
  if (REFUSED_IN_ANY_ADDRESS.test(read)) return false;
  return schemeEnd === -1 ? !/&[A-Za-z][A-Za-z0-9]*;/.test(head) : ADDRESS_SCHEMES.has(head.slice(0, schemeEnd).toLowerCase()) || isCodebookAddress(read);
};
/** Trims only the C0 controls and ASCII space at an address's ends for {@link isAcceptedAddress}, without rescanning an internal run. @example withoutAddressEdgeControls(' x  y ') // => 'x  y' */
const withoutAddressEdgeControls = address => {
  let start = 0, end = address.length;
  // The URL parser removes these characters only at the edges.
  while (start < end && /[\x00-\x20]/.test(address[start])) start++;
  while (end > start && /[\x00-\x20]/.test(address[end - 1])) end--;
  return address.slice(start, end);
};
/** The addresses one attribute value holds: for `srcset` the address of each candidate, split at every comma, so a comma inside an address can only add a refusal; the whole value otherwise. Called by {@link attributeScriptingClauseOf}. @example addressesOf('srcset', 'small.png 1x, large.png 2x') // => ['small.png', 'large.png'] */
const addressesOf = (name, text) => name === 'srcset' ? text.split(',').map(candidate => candidate.trim().split(/[\t\n\f\r ]/)[0]) : [text];
/** The named references a browser reads in an attribute value whose character is ASCII, with their semicolon; every other name it knows stands for a character outside ASCII, which can be no letter, digit, colon, slash or white space of an address, so such a reference is left as written, which judges alike. The reader decodes a value with `decodeHTMLAttribute` of the `entities` package (`browserAttributeText.ts`), by the HTML standard's whole table; this skill keeps to Node's built-ins, so it holds the part of that table an address can need. The two read every reference whose character is ASCII alike, and ASCII is all an address, a scheme or a keyword can hold: the standard's 2,125 names hold 46 that stand for ASCII characters, these, and a number below 128 names the same character in both. They part only outside ASCII: a number of the C1 range is its Windows-1252 character for the reader and the replacement character here. */
const ASCII_NAMED_REFERENCES = { 'Tab;': '\t', 'NewLine;': '\n', 'excl;': '!', 'quot;': '"', 'QUOT;': '"', 'num;': '#', 'dollar;': '$', 'percnt;': '%', 'amp;': '&', 'AMP;': '&', 'apos;': "'", 'lpar;': '(', 'rpar;': ')', 'ast;': '*', 'midast;': '*', 'plus;': '+', 'comma;': ',', 'period;': '.', 'sol;': '/', 'colon;': ':', 'semi;': ';', 'lt;': '<', 'LT;': '<', 'equals;': '=', 'gt;': '>', 'GT;': '>', 'quest;': '?', 'commat;': '@', 'lsqb;': '[', 'lbrack;': '[', 'bsol;': '\\', 'rsqb;': ']', 'rbrack;': ']', 'Hat;': '^', 'lowbar;': '_', 'UnderBar;': '_', 'grave;': '`', 'DiacriticalGrave;': '`', 'lcub;': '{', 'lbrace;': '{', 'verbar;': '|', 'vert;': '|', 'VerticalLine;': '|', 'rcub;': '}', 'rbrace;': '}', 'fjlig;': 'fj' };
/** The names with an ASCII character that a browser reads without their semicolon too, longest first, and their characters. */
const LEGACY_ASCII_NAMES = [['QUOT', '"'], ['quot', '"'], ['AMP', '&'], ['amp', '&'], ['LT', '<'], ['lt', '<'], ['GT', '>'], ['gt', '>']];
/** A character reference in an attribute value as a browser's tokenizer finds it: a number with or without its semicolon, or a run of letters and digits after `&` with its semicolon if one follows. */
const BROWSER_REFERENCE = /&(?:#([xX][0-9a-fA-F]+|[0-9]+);?|([A-Za-z][A-Za-z0-9]*;?))/g;
/** Whether a code point lies in a range a browser does not name by a number: the surrogates, and the C1 range, which it maps to characters outside ASCII. Called by {@link isNamedCodePoint}. @example isSurrogateOrC1(0x85) // => true */
const isSurrogateOrC1 = codePoint => (codePoint >= 0xd800 && codePoint <= 0xdfff) || (codePoint >= 0x80 && codePoint <= 0x9f);
/** Whether a browser names a character by this number: one above 0, up to the last code point, and no surrogate or C1 character. Called by {@link browserNumber}. @example isNamedCodePoint(0x2f) // => true */
const isNamedCodePoint = codePoint => codePoint > 0 && codePoint <= 0x10ffff && !isSurrogateOrC1(codePoint);
/** The number a numeric reference writes, decimal or after `x` hexadecimal; one of more than eight significant digits lies past the last code point in either base. Called by {@link browserNumber}. @example codePointOf('x2f') // => 47 */
const codePointOf = digits => {
  const isHexadecimal = /^[xX]/.test(digits), significant = digits.replace(/^[xX]?0*/, '');
  return significant.length > 8 ? Infinity : Number.parseInt(significant || '0', isHexadecimal ? 16 : 10);
};
/** The character a number names as a browser reads it; the replacement character for a number it names no character by ({@link isNamedCodePoint}). Called by {@link browserText}. @example browserNumber('x2f') // => '/' */
const browserNumber = digits => {
  const codePoint = codePointOf(digits);
  return isNamedCodePoint(codePoint) ? String.fromCodePoint(codePoint) : '\uFFFD';
};
/** The character after a name at the start of a run of letters and digits: the run's next one, or the character after the run. Called by {@link legacyCharacters}. @example nextAfterName('ampx', 'amp', ';') // => 'x' */
const nextAfterName = (run, name, next) => run.length > name.length ? run[name.length] : next;
/** The characters of a name of {@link LEGACY_ASCII_NAMES} that starts a run without its semicolon, as a browser reads it in an attribute value: not before `=`, a letter or a digit. Called by {@link browserName}. @example legacyCharacters('amp', '/') // => '&'; legacyCharacters('ampx', ';') // => undefined */
const legacyCharacters = (run, next) => {
  const legacy = LEGACY_ASCII_NAMES.find(([name]) => run.startsWith(name));
  if (legacy === undefined) return undefined;
  return /[=A-Za-z0-9]/.test(nextAfterName(run, legacy[0], next) ?? '') ? undefined : legacy[1] + run.slice(legacy[0].length);
};
/** The characters of a named reference as a browser reads it in an attribute value: one of {@link ASCII_NAMED_REFERENCES}, or a name a browser reads without its semicolon ({@link legacyCharacters}); `undefined` to leave it as written. Called by {@link browserText}. @example browserName('sol;', 'h') // => '/' */
const browserName = (run, next) => Object.hasOwn(ASCII_NAMED_REFERENCES, run) ? ASCII_NAMED_REFERENCES[run] : legacyCharacters(run, next);
/** Reads an attribute value as a browser's tokenizer reads it ({@link browserNumber}, {@link browserName}), where {@link attributeText} reads only the references the publisher writes: `/&sol;host/x` is `//host/x` for a browser. Called by {@link addressClauseOf}. @example browserText('/&sol;host/x') // => '//host/x' */
const browserText = written => written.replace(BROWSER_REFERENCE, (reference, digits, run, offset) => digits === undefined ? browserName(run, written[offset + reference.length]) ?? reference : browserNumber(digits));

/** The clause a refusal of an address attribute ends with when one of its addresses names another scheme than {@link ADDRESS_SCHEMES}, is no Codebook address ({@link CODEBOOK_ADDRESS_STARTS}) or is a network path, read as the publisher reads it ({@link attributeText}) or as a browser does ({@link browserText}); called by {@link attributeScriptingClauseOf}. @returns The clause, or undefined for an attribute that is no address or leads nowhere else. @example addressClauseOf('a', 'href', 'javascript:run()') // => 'must link only to … its <a> holds href="javascript:run()".' */
const addressClauseOf = (tag, name, written) => ADDRESS_ATTRIBUTES.has(name) && [attributeText(written), browserText(written)].some(text => !addressesOf(name, text).every(isAcceptedAddress))
  ? `must link only to a relative path, a #fragment, an http, https or mailto address, or Codebook’s own vscode://laststance.codebook/ or cursor://laststance.codebook/ address: its <${tag}> holds ${name}="${written.slice(0, LIMITS.markupExcerpt).replace(/[\t\n\f\r ]+/g, ' ')}".`
  : undefined;
/** The clause a refusal of one attribute of a start tag ends with: an event attribute, or an address of another scheme ({@link addressClauseOf}); called by {@link tagScriptingClauseOf}. @returns The clause, or undefined for an attribute that runs no script and leads nowhere else. @example attributeScriptingClauseOf('a', 'href', 'javascript:run()') // => 'must link only to … its <a> holds href="javascript:run()".' */
const attributeScriptingClauseOf = (tag, name, written) => {
  if (name.startsWith('on')) return `must contain article sections, not a document, form or script: its <${tag}> holds the event attribute ${name}.`;
  return addressClauseOf(tag, name, written);
};
/** The clause a refusal of one start tag ends with, for its first attribute that {@link attributeScriptingClauseOf} refuses; called by {@link scriptingClauseOf}. @example tagScriptingClauseOf('<img src="flow.png" onerror="run()">') // => 'must contain article sections, not a document, form or script: its <img> holds the event attribute onerror.' */
const tagScriptingClauseOf = markup => {
  const tag = markup.slice(1, markup.search(/[\t\n\f\r />]/)).toLowerCase(), attributes = attributesOf(markup);
  // A script or a foreign address of any attribute is named first; an attribute an article does not need after.
  return firstClauseOf(attributes, ([name, written]) => attributeScriptingClauseOf(tag, name, written)) ?? firstClauseOf(attributes, attribute => allowlistClauseOf(tag, attribute));
};
/** Says where a page's content would run script of its own or lead elsewhere than a page, the web, mail or Codebook in the editor: an attribute whose name starts with `on` (an event attribute, with or without a value), and an address in {@link ADDRESS_ATTRIBUTES} that names another scheme than {@link ADDRESS_SCHEMES} and is no Codebook address ({@link CODEBOOK_ADDRESS_STARTS}). Without this, markup an agent writes when a repository's text steers it would run script on the reader's origin, which may ask the editor's model. Start tags alone are read, with their character references, as {@link withAttributeValues} reads them; a comment and the text, an escaped code example included, are passed over. Called by the page renderer after {@link unbalancedClauseOf} let the content through. @returns The clause the refusal ends with, naming the element and its attribute, or undefined for content that runs no script. @example scriptingClauseOf('<img src="flow.png" onerror="run()">') // => 'must contain article sections, not a document, form or script: its <img> holds the event attribute onerror.' */
export const scriptingClauseOf = html => {
  for (const [markup] of html.matchAll(COMMENT_OR_START_TAG)) {
    // A comment opens no element.
    const clause = markup.startsWith('<!--') ? undefined : tagScriptingClauseOf(markup);
    if (clause !== undefined) return clause;
  }
  return undefined;
};
/** The quote a changed attribute value is printed in: the author's single quotes, and double quotes otherwise, also where the author wrote the value bare, because the changed text may hold a space, which would end a bare value. Called by {@link withAttributeValues}. @example quoteOf('a') // => "'"; quoteOf(undefined) // => '"' */
const quoteOf = single => single === undefined ? '"' : "'";
/** Rewrites attribute values in the start tags of authored HTML and leaves its text and its comments alone, so an id a code example only mentions or a commented-out element carries is not touched; called by {@link contentIdsOf} and {@link slotAttributeCountOf} here and by the page renderer when it renames a content id. `rewrite` gets the attribute's name in lower case and its value as text (its character references read) and returns the text to print; a changed value is printed escaped and in quotes: the author's, or double quotes where the author used none. @example withAttributeValues('<h2 id="a">id="a"</h2>', (name, value) => name === 'id' ? 'b' : value) // => '<h2 id="b">id="a"</h2>' */
export const withAttributeValues = (html, rewrite) => html.replace(COMMENT_OR_START_TAG, markup => {
  if (markup.startsWith('<!--')) return markup;
  // The tag's name ends at the first space, slash or closing bracket; what follows are its attributes.
  const nameEnd = markup.search(/[\t\n\f\r />]/);
  return markup.slice(0, nameEnd) + markup.slice(nameEnd).replace(ATTRIBUTE, (attribute, lead, name, equals, double, single, bare) => {
    // An attribute without a value refers to nothing.
    if (equals === undefined) return attribute;
    const text = attributeText(writtenValue(double, single, bare)), rewritten = rewrite(name.toLowerCase(), text);
    // An unchanged attribute keeps its exact text.
    return rewritten === text ? attribute : `${lead}${name}${equals}${quoteOf(single)}${escapeHtml(rewritten)}${quoteOf(single)}`;
  });
});
/** Lists the ids the elements of authored HTML carry, as a browser reads them: from start tags alone, with character references read. Called by {@link renderWikiDiagrams} for the ids a diagram generates, and by the page renderer for a page's outline and for the ids the reader uses itself. @example contentIdsOf('<h2 id="flow">Flow</h2><p id=note>…</p><!-- <p id="old"> --><code>&lt;p id="shown"&gt;</code>') // => Set { 'flow', 'note' } */
export const contentIdsOf = html => {
  const ids = new Set();
  withAttributeValues(html, (name, value) => { if (name === 'id') ids.add(value); return value; });
  return ids;
};
/** An empty figure slot of a diagram as the agent writes it into a page's content; the second group is the diagram's id. */
const SLOT = /<figure[\t\n\f\r ]+data-codebook-diagram=(["'])([A-Za-z][\w-]{0,63})\1[\t\n\f\r ]*>[\t\n\f\r ]*<\/figure>/;
/** A comment, a slot or any other start tag, tried in that order at each `<` of authored HTML: the text of a slot inside a comment or inside another tag's quoted attribute value belongs to that comment or tag and is no slot. */
const COMMENT_SLOT_OR_START_TAG = new RegExp(`${COMMENT.source}|${SLOT.source}|${START_TAG.source}`, 'g');
/** Whether a piece of markup is a comment that holds the start of a slot. Called by {@link diagramSlotsOf}. @example isCommentedSlot('<!-- <figure data-codebook-diagram="old"></figure> -->') // => true */
const isCommentedSlot = markup => markup.startsWith('<!--') && /<figure[\t\n\f\r ]+data-codebook-diagram[\t\n\f\r ]*=/.test(markup);
/** Reads the diagram slots of a page's content: the ids of the empty figure slots that are elements of the page, and whether a comment holds the start of one. Called by {@link renderWikiDiagrams}. @example diagramSlotsOf('<figure data-codebook-diagram="flow"></figure><!-- <figure data-codebook-diagram="old"></figure> -->') // => { slots: ['flow'], hasCommentedSlot: true } */
const diagramSlotsOf = contentHtml => {
  const markup = [...contentHtml.matchAll(COMMENT_SLOT_OR_START_TAG)];
  // A match that is a slot carries the slot's id as its second group.
  return { slots: markup.map(([, , id]) => id).filter(id => id !== undefined), hasCommentedSlot: markup.some(([text]) => isCommentedSlot(text)) };
};
/** Counts the elements of a page's content that carry the slot attribute with a value, whatever element and whatever value: more of them than slots means a slot that is not an empty figure. A comment that shows such an element and an attribute value that mentions it are not counted. Called by {@link renderWikiDiagrams}. @example slotAttributeCountOf('<figure data-codebook-diagram="flow">Old graph</figure>') // => 1 */
const slotAttributeCountOf = contentHtml => {
  let count = 0;
  withAttributeValues(contentHtml, (name, value) => { if (name === 'data-codebook-diagram') count += 1; return value; });
  return count;
};
/** Replaces exact article slots after verifying each graph's cited source through the page resolver. The slots, the elements that carry the slot attribute and the ids of the content are read from the content's start tags, never from its text or its comments. @example await renderWikiDiagrams(page, resolveReference) */
export async function renderWikiDiagrams(page, resolveReference) {
  const diagrams = page.diagrams ?? [];
  if (!Array.isArray(diagrams) || diagrams.length > LIMITS.diagrams) throw new Error('A Wiki page supports at most 24 diagrams.');
  const { slots, hasCommentedSlot } = diagramSlotsOf(page.contentHtml);
  // A commented slot would hide its generated figure from the learner, also in a comment that never ends.
  if (hasCommentedSlot) throw new Error('Diagram figure slots must not be inside HTML comments.');
  if (slotAttributeCountOf(page.contentHtml) !== slots.length || slots.length !== diagrams.length) throw new Error('Every diagram needs exactly one empty figure slot.');
  // The ids the elements of the content really carry: an id a code example or a comment only shows collides with nothing.
  const ids = new Set(), rendered = new Map(), contentIds = [...contentIdsOf(page.contentHtml)];
  for (const diagram of diagrams) {
    const nodes = validateDiagram(diagram);
    if (ids.has(diagram.id) || slots.filter(slot => slot === diagram.id).length !== 1) throw new Error('Diagram IDs and slots must match exactly once.');
    ids.add(diagram.id);
    const prefix = `codebook-diagram-${diagram.id.length}-${diagram.id}`;
    if (contentIds.some(id => id === prefix || id.startsWith(`${prefix}-`))) throw new Error('Article IDs must not collide with generated diagram IDs.');
    const evidence = [];
    for (const element of [...diagram.nodes, ...diagram.edges]) {
      const links = [];
      for (const reference of element.sources) links.push(`${await resolveReference(reference, true)}<pre><code>${escapeHtml(reference.quote)}</code></pre>`);
      const meaning = 'from' in element ? `${nodes.get(element.from).label} → ${nodes.get(element.to).label}: ${element.label}${element.condition ? ` (when ${element.condition})` : ''}` : element.label;
      evidence.push(`<li><strong>${escapeHtml(meaning)}</strong><div>${links.join('')}</div></li>`);
    }
    const graph = diagram.kind === 'flow' ? flowSvg(diagram, prefix) : sequenceSvg(diagram, prefix);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${graph.width}" height="${graph.height}" viewBox="0 0 ${graph.width} ${graph.height}" role="img" aria-labelledby="${prefix}-title"><title id="${prefix}-title">${escapeHtml(diagram.title)}</title><defs><marker id="${prefix}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--link)"/></marker></defs>${graph.content}</svg>`;
    rendered.set(diagram.id, `<figure class="codebook-diagram" id="${prefix}"><div class="diagram-canvas" tabindex="0" role="region" aria-label="${escapeHtml(diagram.title)}">${svg}</div><figcaption>${escapeHtml(diagram.caption)}</figcaption><details><summary>Diagram relationships and sources</summary><ul>${evidence.join('')}</ul></details></figure>`);
  }
  return page.contentHtml.replace(COMMENT_SLOT_OR_START_TAG, (markup, _quote, id) => id === undefined ? markup : rendered.get(id));
}
