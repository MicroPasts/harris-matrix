import {
  buildMatrixGraph,
  buildHarrisMatrixSvg,
  parseMatrixData,
  emitContextSelect,
  copyTextToClipboard,
} from './core.js';

let globalTemplate = null;

export class HarrisMatrix extends HTMLElement {
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