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

/** Replaces exact article slots after verifying each graph's cited source through the page resolver. @example await renderWikiDiagrams(page, resolveReference) */
export async function renderWikiDiagrams(page, resolveReference) {
  const diagrams = page.diagrams ?? [];
  if (!Array.isArray(diagrams) || diagrams.length > LIMITS.diagrams) throw new Error('A Wiki page supports at most 24 diagrams.');
  // A commented slot would pass string matching but hide its generated figure from the learner.
  if ([...page.contentHtml.matchAll(/<!--[\s\S]*?-->/g)].some(comment => /<figure\s+data-codebook-diagram\s*=/.test(comment[0]))) throw new Error('Diagram figure slots must not be inside HTML comments.');
  const slots = [...page.contentHtml.matchAll(/<figure\s+data-codebook-diagram=(["'])([A-Za-z][\w-]{0,63})\1\s*>\s*<\/figure>/g)];
  if ((page.contentHtml.match(/<[A-Za-z][^>]*\sdata-codebook-diagram\s*=/g) ?? []).length !== slots.length || slots.length !== diagrams.length) throw new Error('Every diagram needs exactly one empty figure slot.');
  const ids = new Set(), rendered = new Map();
  for (const diagram of diagrams) {
    const nodes = validateDiagram(diagram);
    if (ids.has(diagram.id) || slots.filter(slot => slot[2] === diagram.id).length !== 1) throw new Error('Diagram IDs and slots must match exactly once.');
    ids.add(diagram.id);
    const prefix = `codebook-diagram-${diagram.id.length}-${diagram.id}`;
    if (new RegExp(`\\sid\\s*=\\s*["']${prefix}(?:["'-])`).test(page.contentHtml)) throw new Error('Article IDs must not collide with generated diagram IDs.');
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
  return page.contentHtml.replace(/<figure\s+data-codebook-diagram=(["'])([A-Za-z][\w-]{0,63})\1\s*>\s*<\/figure>/g, (_slot, _quote, id) => rendered.get(id));
}
