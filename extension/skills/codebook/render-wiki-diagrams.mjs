const LIMITS = { diagrams: 24, nodes: 24, edges: 64, grid: 8, nodeLabel: 80, edgeLabel: 80, condition: 120, references: 8 };
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
/** A comment that has an end, the whole of what {@link COMMENT} matched. */
const CLOSED_COMMENT = /^<!--(?:-?>|[\s\S]*?--!?>)$/;
/** A start tag of authored HTML, read up to the `>` that ends it as a browser reads it: a quoted attribute value may hold a `>`, and a `<` inside the tag is a character of it (a bare attribute value `<!--` starts no comment). Text and an escaped code example hold no `<` before a letter, so they are never read as a tag. */
const START_TAG = /<[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/;
/** A comment or a start tag of authored HTML, the two things {@link withAttributeValues} tells apart from text. A comment is passed over whole, so an element inside it is no element of the page. */
const COMMENT_OR_START_TAG = new RegExp(`${COMMENT.source}|${START_TAG.source}`, 'g');
/** One attribute of a start tag, read in the order a browser reads them: what stands before its name (spaces, a slash, or nothing after a closing quote), its name, and, when it has a value, its equals sign and the value in double quotes, in single quotes or bare. */
const ATTRIBUTE = /([\s/]*)([^\s"'<>/=]+)(?:(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
/** A character reference in an attribute value: decimal, hexadecimal, or one of the five named ones an author writes into an address or an id. */
const CHARACTER_REFERENCE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g;
const NAMED_CHARACTERS = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** Says whether authored HTML holds a comment that never ends. In a published page such a comment takes everything after it, the reader's question form, rail and script included, so the page renderer refuses the page. A `<!--` inside a quoted attribute value or in a bare one is a character of its tag and starts no comment. @example hasEndlessComment('<p>Explained.</p><!-- to do') // => true; hasEndlessComment('<!-- done --!><p title="<!--">Explained.</p>') // => false */
export const hasEndlessComment = html => [...html.matchAll(COMMENT_OR_START_TAG)].some(([markup]) => markup.startsWith('<!--') && !CLOSED_COMMENT.test(markup));
/** The character a numeric reference names; the replacement character for a number that names none. Called by {@link attributeText}. @example referencedCharacter('45', 10) // => '-' */
const referencedCharacter = (digits, radix) => { const codePoint = Number.parseInt(digits, radix); return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '�'; };
/** Reads an attribute value as a browser does: every character reference becomes its character, so an id or an address written with an entity compares as the text it means. Called by {@link withAttributeValues}. @example attributeText('a&amp;b.html#qa&#45;form') // => 'a&b.html#qa-form' */
const attributeText = value => value.replace(CHARACTER_REFERENCE, (_reference, decimal, hexadecimal, name) => NAMED_CHARACTERS[name] ?? referencedCharacter(decimal ?? hexadecimal, decimal === undefined ? 16 : 10));
/** An attribute's value as written, in whichever of the three forms {@link ATTRIBUTE} matched it. Called by {@link withAttributeValues}. @example writtenValue(undefined, 'a', undefined) // => 'a' */
const writtenValue = (double, single, bare) => double ?? single ?? bare;
/** The quote an attribute's value stands in, by which of the two quoted forms {@link ATTRIBUTE} matched; none for a bare value. Called by {@link withAttributeValues}. @example quoteOf(undefined, 'a') // => "'" */
const quoteOf = (double, single) => double !== undefined ? '"' : single !== undefined ? "'" : '';
/** Rewrites attribute values in the start tags of authored HTML and leaves its text and its comments alone, so an id a code example only mentions or a commented-out element carries is not touched; called by {@link contentIdsOf} and {@link slotAttributeCountOf} here and by the page renderer when it renames a content id. `rewrite` gets the attribute's name in lower case and its value as text (its character references read) and returns the text to print; a changed value is printed escaped, in the quotes the author used. @example withAttributeValues('<h2 id="a">id="a"</h2>', (name, value) => name === 'id' ? 'b' : value) // => '<h2 id="b">id="a"</h2>' */
export const withAttributeValues = (html, rewrite) => html.replace(COMMENT_OR_START_TAG, markup => {
  if (markup.startsWith('<!--')) return markup;
  // The tag's name ends at the first space, slash or closing bracket; what follows are its attributes.
  const nameEnd = markup.search(/[\s/>]/);
  return markup.slice(0, nameEnd) + markup.slice(nameEnd).replace(ATTRIBUTE, (attribute, lead, name, equals, double, single, bare) => {
    // An attribute without a value refers to nothing.
    if (equals === undefined) return attribute;
    const text = attributeText(writtenValue(double, single, bare)), rewritten = rewrite(name.toLowerCase(), text);
    // An unchanged attribute keeps its exact text.
    return rewritten === text ? attribute : `${lead}${name}${equals}${quoteOf(double, single)}${escapeHtml(rewritten)}${quoteOf(double, single)}`;
  });
});
/** Lists the ids the elements of authored HTML carry, as a browser reads them: from start tags alone, with character references read. Called by {@link renderWikiDiagrams} for the ids a diagram generates, and by the page renderer for a page's outline and for the ids the reader uses itself. @example contentIdsOf('<h2 id="flow">Flow</h2><p id=note>…</p><!-- <p id="old"> --><code>&lt;p id="shown"&gt;</code>') // => Set { 'flow', 'note' } */
export const contentIdsOf = html => {
  const ids = new Set();
  withAttributeValues(html, (name, value) => { if (name === 'id') ids.add(value); return value; });
  return ids;
};
/** An empty figure slot of a diagram as the agent writes it into a page's content; the second group is the diagram's id. */
const SLOT = /<figure\s+data-codebook-diagram=(["'])([A-Za-z][\w-]{0,63})\1\s*>\s*<\/figure>/;
/** A comment, a slot or any other start tag, tried in that order at each `<` of authored HTML: the text of a slot inside a comment or inside another tag's quoted attribute value belongs to that comment or tag and is no slot. */
const COMMENT_SLOT_OR_START_TAG = new RegExp(`${COMMENT.source}|${SLOT.source}|${START_TAG.source}`, 'g');
/** Whether a piece of markup is a comment that holds the start of a slot. Called by {@link diagramSlotsOf}. @example isCommentedSlot('<!-- <figure data-codebook-diagram="old"></figure> -->') // => true */
const isCommentedSlot = markup => markup.startsWith('<!--') && /<figure\s+data-codebook-diagram\s*=/.test(markup);
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
