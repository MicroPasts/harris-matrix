/**
 * @micropasts/harris-matrix v0.1.0
 * Zero-dependency stratigraphic Harris Matrix Web Components
 * License: MIT
 */
(function () {
'use strict';
const DEFAULT_PHASE_COLORS = [
  '#0284c7',
  '#7c3aed',
  '#0d9488',
  '#d97706',
  '#be123c',
  '#4f46e5',
];

function truncateLabel(str, maxChars = 18) {
  const s = String(str ?? '');
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars - 1)}…`;
}

/**
 * Convert structured rows into { contexts, edges, warnings }.
 * Each row can have: id (or context), label, type, phase, description, uri,
 * above (string or array of IDs that are stratigraphically LATER than this context),
 * below (string or array of IDs that are stratigraphically EARLIER than this context).
 */
function rowsToMatrix(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const contexts = [];
  const contextIds = new Set();
  const edgeSet = new Set();
  const edges = [];
  const warnings = [];

  const splitRefs = (val) => {
    if (Array.isArray(val)) {
      return val.map((v) => String(v).trim()).filter(Boolean);
    }
    if (typeof val !== 'string' || !val.trim()) return [];
    return val
      .split(/[|;]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  };

  for (const row of list) {
    const rawId = row.id ?? row.context ?? '';
    const id = String(rawId).trim();
    if (!id) continue;

    if (contextIds.has(id)) {
      warnings.push(`Duplicate context ID "${id}" — merged/kept first definition.`);
      continue;
    }

    contextIds.add(id);
    contexts.push({
      id,
      label: String(row.label ?? `Context ${id}`).trim() || `Context ${id}`,
      type: String(row.type ?? 'deposit').trim() || 'deposit',
      phase: String(row.phase ?? 'Unphased').trim() || 'Unphased',
      description: String(row.description ?? '').trim(),
      uri: String(row.uri ?? '').trim(),
    });
  }

  const addEdge = (above, below) => {
    const a = String(above).trim();
    const b = String(below).trim();
    if (!a || !b) return;
    if (a === b) {
      warnings.push(`Self-loop ignored on context "${a}".`);
      return;
    }
    const key = `${a}=>${b}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ above: a, below: b });
  };

  for (const row of list) {
    const id = String(row.id ?? row.context ?? '').trim();
    if (!id) continue;

    // `above` column lists contexts LATER than this row -> this row is BELOW those
    for (const laterId of splitRefs(row.above)) {
      addEdge(laterId, id);
    }

    // `below` column lists contexts EARLIER than this row -> this row is ABOVE those
    for (const earlierId of splitRefs(row.below)) {
      addEdge(id, earlierId);
    }
  }

  // Check for missing context definitions and direct/mutual cycles
  const adj = new Map();
  for (const e of edges) {
    if (!contextIds.has(e.above)) {
      warnings.push(`Edge references undefined "above" context "${e.above}".`);
    }
    if (!contextIds.has(e.below)) {
      warnings.push(`Edge references undefined "below" context "${e.below}".`);
    }
    if (edgeSet.has(`${e.below}=>${e.above}`) && e.above < e.below) {
      warnings.push(`Direct cycle between "${e.above}" and "${e.below}".`);
    }
    if (!adj.has(e.above)) adj.set(e.above, []);
    adj.get(e.above).push(e.below);
  }

  // Detect any multi-hop cycle via DFS
  const visiting = new Set();
  const visited = new Set();
  let cycleReported = false;

  const dfs = (node) => {
    if (cycleReported) return;
    visiting.add(node);
    for (const nxt of adj.get(node) || []) {
      if (visiting.has(nxt)) {
        warnings.push(`Stratigraphic cycle detected involving "${node}" and "${nxt}".`);
        cycleReported = true;
        return;
      }
      if (!visited.has(nxt)) dfs(nxt);
    }
    visiting.delete(node);
    visited.add(node);
  };

  for (const id of contextIds) {
    if (!visited.has(id)) dfs(id);
  }

  return { contexts, edges, warnings };
}

/**
 * Parse CSV/TSV text with headers:
 * id,label,type,phase,above,below,description,uri
 * Supports quoted fields and pipe/semicolon lists inside above/below.
 */
function csvToMatrix(csvText = '') {
  const lines = String(csvText)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { contexts: [], edges: [], warnings: ['No CSV rows provided.'] };
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const parseLine = (line) => {
    const cells = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const firstCells = parseLine(lines[0]).map((h) => h.toLowerCase());
  const hasHeader =
    firstCells.includes('id') ||
    firstCells.includes('context') ||
    firstCells.includes('above') ||
    firstCells.includes('below');

  const headers = hasHeader
    ? firstCells
    : ['id', 'label', 'type', 'phase', 'above', 'below', 'description', 'uri'];

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows = dataLines.map((line) => {
    const cells = parseLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    return row;
  });

  return rowsToMatrix(rows);
}

/**
 * Normalize contexts and edges into a stratigraphic graph with depth tiers.
 * Convention: edge { above, below } means `above` is later (higher in matrix) than `below`.
 */
function buildMatrixGraph(input = {}) {
  const rawContexts = Array.isArray(input.contexts) ? input.contexts : [];
  const rawEdges = Array.isArray(input.edges) ? input.edges : [];

  const nodeMap = new Map();
  rawContexts.forEach((ctx, idx) => {
    const id = String(ctx.id);
    nodeMap.set(id, {
      id,
      label: ctx.label || id,
      type: ctx.type || 'deposit',
      phase: ctx.phase || 'Unphased',
      description: ctx.description || '',
      uri: ctx.uri || '',
      order: idx,
      aboveIds: new Set(),
      belowIds: new Set(),
      tier: 0,
      col: 0,
    });
  });

  const ensureNode = (id) => {
    const key = String(id);
    if (!nodeMap.has(key)) {
      nodeMap.set(key, {
        id: key,
        label: key,
        type: 'context',
        phase: 'Unphased',
        description: '',
        uri: '',
        order: nodeMap.size,
        aboveIds: new Set(),
        belowIds: new Set(),
        tier: 0,
        col: 0,
      });
    }
    return nodeMap.get(key);
  };

  const edges = [];
  rawEdges.forEach((edge) => {
    const aboveId = String(edge.above ?? edge.from ?? '');
    const belowId = String(edge.below ?? edge.to ?? '');
    if (!aboveId || !belowId || aboveId === belowId) return;

    const aboveNode = ensureNode(aboveId);
    const belowNode = ensureNode(belowId);

    belowNode.aboveIds.add(aboveId);
    aboveNode.belowIds.add(belowId);
    edges.push({ above: aboveId, below: belowId });
  });

  const nodes = Array.from(nodeMap.values());

  const maxIters = Math.max(1, nodes.length + 2);
  for (let iter = 0; iter < maxIters; iter++) {
    let changed = false;
    for (const node of nodes) {
      for (const laterId of node.aboveIds) {
        const laterNode = nodeMap.get(laterId);
        if (laterNode && node.tier <= laterNode.tier) {
          node.tier = laterNode.tier + 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const tiersMap = new Map();
  for (const node of nodes) {
    if (!tiersMap.has(node.tier)) tiersMap.set(node.tier, []);
    tiersMap.get(node.tier).push(node);
  }

  const sortedTierKeys = Array.from(tiersMap.keys()).sort((a, b) => a - b);
  let maxCols = 1;

  sortedTierKeys.forEach((tierKey) => {
    const group = tiersMap.get(tierKey);
    group.sort((a, b) => a.order - b.order);
    maxCols = Math.max(maxCols, group.length);
    group.forEach((node, colIdx) => {
      node.col = colIdx;
    });
  });

  const phases = Array.from(new Set(nodes.map((n) => n.phase)));
  const phaseColors = new Map();
  phases.forEach((phase, i) => {
    phaseColors.set(phase, DEFAULT_PHASE_COLORS[i % DEFAULT_PHASE_COLORS.length]);
  });

  const relatedIds = new Set();
  const collectRelated = (startId) => {
    if (!startId || !nodeMap.has(String(startId))) return;
    const target = String(startId);
    relatedIds.add(target);

    const queueDown = [target];
    while (queueDown.length) {
      const curr = queueDown.shift();
      const n = nodeMap.get(curr);
      if (!n) continue;
      for (const b of n.belowIds) {
        if (!relatedIds.has(b)) {
          relatedIds.add(b);
          queueDown.push(b);
        }
      }
    }

    const queueUp = [target];
    while (queueUp.length) {
      const curr = queueUp.shift();
      const n = nodeMap.get(curr);
      if (!n) continue;
      for (const a of n.aboveIds) {
        if (!relatedIds.has(a)) {
          relatedIds.add(a);
          queueUp.push(a);
        }
      }
    }
  };

  return {
    nodes,
    edges,
    nodeMap,
    tiersMap,
    sortedTierKeys,
    maxCols,
    phases,
    phaseColors,
    collectRelated,
    relatedIds,
  };
}

/**
 * Render an interactive SVG Harris Matrix diagram.
 */
function buildHarrisMatrixSvg(graph, selectedId = null, options = {}) {
  const boxW = options.boxWidth || 148;
  const boxH = options.boxHeight || 50;
  const gapX = options.gapX || 28;
  const gapY = options.gapY || 56;
  const padX = 24;
  const padY = 24;

  const tierCount = Math.max(1, graph.sortedTierKeys.length);
  const colCount = Math.max(1, graph.maxCols);

  const width = padX * 2 + colCount * boxW + (colCount - 1) * gapX;
  const height = padY * 2 + tierCount * boxH + (tierCount - 1) * gapY;

  const hasSelection = Boolean(selectedId && graph.nodeMap.has(String(selectedId)));
  if (hasSelection) {
    graph.collectRelated(String(selectedId));
  }

  const positions = new Map();
  graph.sortedTierKeys.forEach((tierKey, tierIndex) => {
    const group = graph.tiersMap.get(tierKey) || [];
    const rowWidth = group.length * boxW + (group.length - 1) * gapX;
    const startX = (width - rowWidth) / 2;
    const y = padY + tierIndex * (boxH + gapY);

    group.forEach((node, idx) => {
      const x = startX + idx * (boxW + gapX);
      positions.set(node.id, { x, y, cx: x + boxW / 2, cy: y + boxH / 2 });
    });
  });

  const edgeSvg = graph.edges
    .map((e) => {
      const pAbove = positions.get(e.above);
      const pBelow = positions.get(e.below);
      if (!pAbove || !pBelow) return '';

      const x1 = pAbove.cx;
      const y1 = pAbove.y + boxH;
      const x2 = pBelow.cx;
      const y2 = pBelow.y;
      const midY = (y1 + y2) / 2;

      const isHighlighted =
        hasSelection &&
        graph.relatedIds.has(e.above) &&
        graph.relatedIds.has(e.below);
      const opacity = hasSelection ? (isHighlighted ? '0.95' : '0.18') : '0.55';
      const strokeWidth = isHighlighted ? '2.2' : '1.4';
      const stroke = isHighlighted ? '#0284c7' : 'var(--hm-fg, currentColor)';

      const d = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
      return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`;
    })
    .join('\n');

  const nodeSvg = graph.nodes
    .map((node) => {
      const pos = positions.get(node.id);
      if (!pos) return '';

      const color = graph.phaseColors.get(node.phase) || '#0284c7';
      const isSelected = String(selectedId) === node.id;
      const isRelated = hasSelection && graph.relatedIds.has(node.id);
      const opacity = hasSelection ? (isRelated ? '1' : '0.32') : '1';
      const stroke = isSelected ? '#f59e0b' : color;
      const strokeWidth = isSelected ? '2.75' : '1.6';

      return `
        <g data-hm-node="${escAttr(node.id)}" opacity="${opacity}" style="cursor:pointer">
          <rect x="${pos.x}" y="${pos.y}" width="${boxW}" height="${boxH}" rx="6"
            fill="var(--hm-node-bg, #ffffff)" stroke="${stroke}" stroke-width="${strokeWidth}" />
          <rect x="${pos.x}" y="${pos.y}" width="6" height="${boxH}" rx="3" fill="${color}" />
          <text x="${pos.x + 14}" y="${pos.y + 20}" font-size="12" font-weight="700" fill="var(--hm-fg, currentColor)">${escText(truncateLabel(node.label, 18))}</text>
          <text x="${pos.x + 14}" y="${pos.y + 36}" font-size="10" fill="var(--hm-muted, currentColor)">${escText(truncateLabel(`${node.type} · ${node.phase}`, 23))}</text>
        </g>
      `;
    })
    .join('\n');

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px;height:auto;display:block" role="img" aria-label="Harris Matrix stratigraphic diagram">
      <g class="hm-edges">${edgeSvg}</g>
      <g class="hm-nodes">${nodeSvg}</g>
    </svg>
  `.trim();
}

function parseMatrixData(el) {
  const attrJson = el.getAttribute('data');
  if (attrJson) {
    try {
      return JSON.parse(attrJson);
    } catch {
      return null;
    }
  }
  const scriptEl = el.querySelector('script[type="application/json"]');
  if (scriptEl) {
    try {
      return JSON.parse(scriptEl.textContent);
    } catch {
      return null;
    }
  }
  return null;
}

function emitContextSelect(target, node) {
  if (!node) return;
  target.dispatchEvent(
    new CustomEvent('heritage:select', {
      bubbles: true,
      composed: true,
      detail: {
        uri: node.uri || `#context-${encodeURIComponent(node.id)}`,
        contextId: node.id,
        label: node.label,
        phase: node.phase,
        type: node.type,
      },
    })
  );
}

async function copyTextToClipboard(text) {
  const value = String(text ?? '').trim();
  if (!value) return false;

  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function' &&
    typeof window !== 'undefined' &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fallback below
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch {
    return false;
  }
}

function escText(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(str) {
  return escText(str).replace(/"/g, '&quot;');
}

let globalTemplate = null;

class HarrisMatrix extends HTMLElement {
  static get observedAttributes() {
    return ['selected', 'listen'];
  }

  static setTemplate(fn) {
    globalTemplate = fn;
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._selectedId = this.getAttribute('selected') || null;
    this._phaseFilter = 'ALL';
    this._rawData = null;
    this.template = null;
    this._onExternalSelect = this._onExternalSelect.bind(this);
  }

  connectedCallback() {
    this._rawData = parseMatrixData(this) || { contexts: [], edges: [] };
    this.render();
    this._bindEvents();

    const listenEvent = this.getAttribute('listen');
    if (listenEvent) {
      window.addEventListener(listenEvent, this._onExternalSelect);
    }
  }

  disconnectedCallback() {
    const listenEvent = this.getAttribute('listen');
    if (listenEvent) {
      window.removeEventListener(listenEvent, this._onExternalSelect);
    }
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal || !this.isConnected) return;
    if (name === 'selected') {
      this._selectedId = newVal || null;
      this.render();
      this._bindEvents();
    }
  }

  setData(data) {
    this._rawData = data || { contexts: [], edges: [] };
    this._selectedId = null;
    this.render();
    this._bindEvents();
  }

  _onExternalSelect(e) {
    const ctxId = e.detail?.contextId;
    if (ctxId && this._rawData?.contexts?.some((c) => String(c.id) === String(ctxId))) {
      this._selectedId = String(ctxId);
      this.render();
      this._bindEvents();
    }
  }

  _filteredData() {
    if (this._phaseFilter === 'ALL') return this._rawData;
    const allowed = new Set(
      (this._rawData.contexts || [])
        .filter((c) => (c.phase || 'Unphased') === this._phaseFilter)
        .map((c) => String(c.id))
    );
    return {
      contexts: (this._rawData.contexts || []).filter((c) => allowed.has(String(c.id))),
      edges: (this._rawData.edges || []).filter(
        (e) => allowed.has(String(e.above ?? e.from)) && allowed.has(String(e.below ?? e.to))
      ),
    };
  }

  _bindEvents() {
    const phaseSelect = this.shadowRoot.querySelector('.phase-select');
    phaseSelect?.addEventListener('change', (e) => {
      this._phaseFilter = e.target.value;
      this.render();
      this._bindEvents();
    });

    const resetBtn = this.shadowRoot.querySelector('.reset-btn');
    resetBtn?.addEventListener('click', () => {
      this._selectedId = null;
      this.render();
      this._bindEvents();
    });

    this.shadowRoot.querySelectorAll('[data-hm-node]').forEach((nodeEl) => {
      nodeEl.addEventListener('click', () => {
        const id = nodeEl.getAttribute('data-hm-node');
        this._selectedId = id;
        const graph = buildMatrixGraph(this._filteredData());
        const nodeObj = graph.nodeMap.get(id);
        this.render();
        this._bindEvents();
        if (nodeObj) emitContextSelect(this, nodeObj);
      });
    });

    const copyBtn = this.shadowRoot.querySelector('.copy-btn');
    copyBtn?.addEventListener('click', async (e) => {
      const text = e.currentTarget.getAttribute('data-copy') || '';
      const copied = await copyTextToClipboard(text);
      if (copied) {
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.textContent = 'Copy Context';
        }, 1200);
      }
    });
  }

  _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  render() {
    const allGraph = buildMatrixGraph(this._rawData || { contexts: [], edges: [] });
    const graph = buildMatrixGraph(this._filteredData());
    const svg = buildHarrisMatrixSvg(graph, this._selectedId);
    const selectedNode = this._selectedId ? allGraph.nodeMap.get(this._selectedId) : null;

    const customFn = this.template || globalTemplate;
    const inspectorHtml =
      typeof customFn === 'function'
        ? customFn(selectedNode, allGraph, this._esc.bind(this))
        : selectedNode
          ? `
            <div class="insp-title">${this._esc(selectedNode.label)} <span class="insp-tag">${this._esc(selectedNode.type)}</span></div>
            <div class="insp-phase">Phase: ${this._esc(selectedNode.phase)} · Tier ${selectedNode.tier + 1} (top = latest)</div>
            ${selectedNode.description ? `<p class="insp-desc">${this._esc(selectedNode.description)}</p>` : ''}
            <div class="insp-rels">
              <div><strong>Later / Above:</strong> ${Array.from(selectedNode.aboveIds).join(', ') || 'None (top)'}</div>
              <div><strong>Earlier / Below:</strong> ${Array.from(selectedNode.belowIds).join(', ') || 'None (earliest)'}</div>
            </div>
            <div class="insp-actions">
              <button type="button" class="copy-btn" data-copy="${this._esc(`${selectedNode.label} (${selectedNode.type}, ${selectedNode.phase})`)}">Copy Context</button>
            </div>
          `
          : `<div class="insp-empty">Click any stratigraphic context box to highlight its sequence and inspect relationships.</div>`;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --hm-bg: #ffffff;
          --hm-fg: #18181b;
          --hm-node-bg: #ffffff;
          --hm-muted: #52525b;
          --hm-border: #e4e4e7;
          --hm-surface: rgba(127, 127, 127, 0.08);
          --hm-radius: 0.5rem;
          --hm-font: system-ui, -apple-system, sans-serif;

          display: block;
          font-family: var(--hm-font);
          color: var(--hm-fg);
        }

        @media (prefers-color-scheme: dark) {
          :host(:not([theme="light"])) {
            --hm-bg: #18181b;
            --hm-fg: #f4f4f5;
            --hm-node-bg: #27272a;
            --hm-muted: #a1a1aa;
            --hm-border: #3f3f46;
          }
        }

        :host([theme="dark"]) {
          --hm-bg: #18181b;
          --hm-fg: #f4f4f5;
          --hm-node-bg: #27272a;
          --hm-muted: #a1a1aa;
          --hm-border: #3f3f46;
        }

        .wrap {
          background: var(--hm-bg);
          color: var(--hm-fg);
          border: 1px solid var(--hm-border);
          border-radius: var(--hm-radius);
          padding: 14px;
        }

        .toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 12px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--hm-border);
          font-size: 12px;
          color: var(--hm-fg);
        }

        .controls { display: flex; align-items: center; gap: 8px; }
        select, .reset-btn, .copy-btn {
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid var(--hm-border);
          background: var(--hm-node-bg);
          color: var(--hm-fg);
          cursor: pointer;
        }

        .matrix-box {
          overflow-x: auto;
          padding: 8px;
          background: var(--hm-surface);
          color: var(--hm-fg);
          border-radius: 6px;
        }

        .inspector {
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid var(--hm-border);
          font-size: 12.5px;
          color: var(--hm-fg);
        }

        .insp-title { font-weight: 700; font-size: 14px; color: var(--hm-fg); }
        .insp-tag { font-size: 11px; font-weight: 500; color: var(--hm-muted); margin-left: 6px; }
        .insp-phase { font-size: 11px; color: var(--hm-muted); margin-top: 2px; }
        .insp-desc { margin: 6px 0; line-height: 1.45; color: var(--hm-fg); }
        .insp-rels { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; font-size: 11.5px; margin-top: 6px; color: var(--hm-fg); }
        .insp-actions { margin-top: 8px; }
        .insp-empty { font-size: 12px; color: var(--hm-muted); }
      </style>
      <div part="container" class="wrap">
        <div part="toolbar" class="toolbar">
          <span><strong>Harris Matrix</strong> · ${graph.nodes.length} contexts · ${graph.edges.length} links (top = latest)</span>
          <div class="controls">
            <select part="phase-filter" class="phase-select" aria-label="Filter by phase">
              <option value="ALL" ${this._phaseFilter === 'ALL' ? 'selected' : ''}>All phases</option>
              ${allGraph.phases
                .map(
                  (p) =>
                    `<option value="${this._esc(p)}" ${this._phaseFilter === p ? 'selected' : ''}>${this._esc(p)}</option>`
                )
                .join('')}
            </select>
            <button type="button" class="reset-btn">Clear Selection</button>
          </div>
        </div>
        <div part="matrix" class="matrix-box">${svg}</div>
        <div part="inspector" class="inspector">${inspectorHtml}</div>
      </div>
    `;
  }
}

if (!customElements.get('harris-matrix')) {
  customElements.define('harris-matrix', HarrisMatrix);
}

class HarrisMatrixTailwind extends HTMLElement {
  static classes = {
    wrapper:
      'rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-zinc-900 dark:text-zinc-100',
    toolbar:
      'flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-3 text-xs text-zinc-800 dark:text-zinc-200',
    canvasBox:
      'overflow-x-auto rounded-lg bg-zinc-50 dark:bg-zinc-950 p-2 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800',
    inspector:
      'mt-3 border-t border-zinc-200 dark:border-zinc-800 pt-3 text-xs text-zinc-900 dark:text-zinc-100',
    btn:
      'rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 px-2.5 py-1 text-[11px] font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors',
  };

  constructor() {
    super();
    this._selectedId = this.getAttribute('selected') || null;
    this._phaseFilter = 'ALL';
    this._rawData = null;
    this._initialized = false;
    this._onExternalSelect = this._onExternalSelect.bind(this);
  }

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this._rawData = parseMatrixData(this) || { contexts: [], edges: [] };
    this.render();

    const listenEvent = this.getAttribute('listen');
    if (listenEvent) {
      window.addEventListener(listenEvent, this._onExternalSelect);
    }
  }

  disconnectedCallback() {
    const listenEvent = this.getAttribute('listen');
    if (listenEvent) {
      window.removeEventListener(listenEvent, this._onExternalSelect);
    }
  }

  _onExternalSelect(e) {
    const ctxId = e.detail?.contextId;
    if (ctxId && this._rawData?.contexts?.some((c) => String(c.id) === String(ctxId))) {
      this._selectedId = String(ctxId);
      this.render();
    }
  }

  _filteredData() {
    if (this._phaseFilter === 'ALL') return this._rawData;
    const allowed = new Set(
      (this._rawData.contexts || [])
        .filter((c) => (c.phase || 'Unphased') === this._phaseFilter)
        .map((c) => String(c.id))
    );
    return {
      contexts: (this._rawData.contexts || []).filter((c) => allowed.has(String(c.id))),
      edges: (this._rawData.edges || []).filter(
        (e) => allowed.has(String(e.above ?? e.from)) && allowed.has(String(e.below ?? e.to))
      ),
    };
  }

  _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  render() {
    const c = HarrisMatrixTailwind.classes;
    const allGraph = buildMatrixGraph(this._rawData || { contexts: [], edges: [] });
    const graph = buildMatrixGraph(this._filteredData());
    const svg = buildHarrisMatrixSvg(graph, this._selectedId);
    const selectedNode = this._selectedId ? allGraph.nodeMap.get(this._selectedId) : null;

    const wrapClass = `${c.wrapper} ${this.getAttribute('card-class') || ''}`.trim();

    const inspectorHtml = selectedNode
      ? `
        <div class="flex items-center justify-between gap-2">
          <div>
            <span class="text-sm font-bold text-zinc-900 dark:text-zinc-100">${this._esc(selectedNode.label)}</span>
            <span class="ml-2 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 px-1.5 py-0.5 text-[10px] font-medium">${this._esc(selectedNode.type)}</span>
          </div>
          <span class="text-[11px] text-zinc-600 dark:text-zinc-400">Phase: ${this._esc(selectedNode.phase)}</span>
        </div>
        ${selectedNode.description ? `<p class="mt-1.5 text-zinc-700 dark:text-zinc-300 leading-relaxed">${this._esc(selectedNode.description)}</p>` : ''}
        <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
          <div><strong class="text-zinc-900 dark:text-zinc-100">Later / Above:</strong> ${Array.from(selectedNode.aboveIds).join(', ') || 'None'}</div>
          <div><strong class="text-zinc-900 dark:text-zinc-100">Earlier / Below:</strong> ${Array.from(selectedNode.belowIds).join(', ') || 'None'}</div>
        </div>
        <div class="mt-2.5">
          <button type="button" data-hm-copy data-copy="${this._esc(`${selectedNode.label} (${selectedNode.type}, ${selectedNode.phase})`)}" class="${c.btn}">Copy Context</button>
        </div>
      `
      : `<p class="text-zinc-600 dark:text-zinc-400">Select a stratigraphic context box to highlight direct and indirect relationships.</p>`;

    this.innerHTML = `
      <div class="${wrapClass}">
        <div class="${c.toolbar}">
          <div class="font-medium text-zinc-800 dark:text-zinc-200">
            ${graph.nodes.length} contexts · ${graph.edges.length} stratigraphic links <span class="text-zinc-500 dark:text-zinc-400">(top = latest)</span>
          </div>
          <div class="flex items-center gap-2">
            <select data-hm-phase class="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 px-2 py-1 text-[11px]">
              <option value="ALL" ${this._phaseFilter === 'ALL' ? 'selected' : ''}>All phases</option>
              ${allGraph.phases
                .map(
                  (p) =>
                    `<option value="${this._esc(p)}" ${this._phaseFilter === p ? 'selected' : ''}>${this._esc(p)}</option>`
                )
                .join('')}
            </select>
            <button type="button" data-hm-reset class="${c.btn}">Clear Selection</button>
          </div>
        </div>
        <div class="${c.canvasBox}">${svg}</div>
        <div class="${c.inspector}">${inspectorHtml}</div>
      </div>
    `;

    this.querySelector('[data-hm-phase]')?.addEventListener('change', (e) => {
      this._phaseFilter = e.target.value;
      this.render();
    });

    this.querySelector('[data-hm-reset]')?.addEventListener('click', () => {
      this._selectedId = null;
      this.render();
    });

    this.querySelectorAll('[data-hm-node]').forEach((nodeEl) => {
      nodeEl.addEventListener('click', () => {
        const id = nodeEl.getAttribute('data-hm-node');
        this._selectedId = id;
        const nodeObj = allGraph.nodeMap.get(id);
        this.render();
        if (nodeObj) emitContextSelect(this, nodeObj);
      });
    });

    this.querySelector('[data-hm-copy]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const text = btn.getAttribute('data-copy') || '';
      const copied = await copyTextToClipboard(text);
      if (copied) {
        btn.textContent = 'Copied';
        setTimeout(() => {
          btn.textContent = 'Copy Context';
        }, 1200);
      }
    });
  }
}

if (!customElements.get('harris-matrix-tw')) {
  customElements.define('harris-matrix-tw', HarrisMatrixTailwind);
}

window.HarrisMatrixLib = {
    buildMatrixGraph,
    buildHarrisMatrixSvg,
    parseMatrixData,
    emitContextSelect,
    copyTextToClipboard,
    HarrisMatrix,
    HarrisMatrixTailwind
  };
})();
