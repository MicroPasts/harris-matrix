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
export function rowsToMatrix(rows = []) {
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
export function csvToMatrix(csvText = '') {
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
export function buildMatrixGraph(input = {}) {
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
export function buildHarrisMatrixSvg(graph, selectedId = null, options = {}) {
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

export function parseMatrixData(el) {
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

export function emitContextSelect(target, node) {
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

export async function copyTextToClipboard(text) {
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