import {
  buildMatrixGraph,
  buildHarrisMatrixSvg,
  parseMatrixData,
  emitContextSelect,
  copyTextToClipboard,
} from './core.js';

export class HarrisMatrixTailwind extends HTMLElement {
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