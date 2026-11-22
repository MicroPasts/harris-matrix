# @micropasts/harris-matrix

Zero-dependency JavaScript Web Components for rendering interactive archaeological **Harris Matrices** from stratigraphic context and relationship data, complete with phase filtering, relationship highlighting, `heritage:select` synchronization, and a CSV/row-to-JSON helper with cycle and reference validation.

Includes two custom elements built from the same core engine:
- **`<harris-matrix>`** — Encapsulated Shadow DOM Web Component with CSS custom properties, `::part()` selectors, and custom template hooks.
- **`<harris-matrix-tw>`** — Light-DOM Web Component styled with Tailwind CSS utility classes and `dark:` variants.

---

## Features

- **Pure ES2022 JavaScript:** Zero runtime dependencies, no TypeScript build step, and works in vanilla HTML, static sites, or modern bundlers.
- **Stratigraphic Tier Layout:** Computes top-to-bottom stratigraphic depth tiers (`top = latest`, `bottom = earliest`) and highlights direct and indirect later/earlier relationships when a context is selected.
- **Phase Filtering & Context Inspector:** Filter contexts by archaeological phase and inspect context metadata, stratigraphic links, and one-click context details copy.
- **CSV & Row-to-JSON Helper (`csvToMatrix` & `rowsToMatrix`):** Convert tabular context sheets or row arrays into `{ contexts, edges }` while checking for missing context IDs, duplicate IDs, self-loops, and stratigraphic cycles.
- **Cross-Component Event Sync:** Emits and listens for `heritage:select` `CustomEvent`s so maps, authority cards, and panels stay coordinated.
- **Dark Mode Support:** Supports system dark mode, explicit `dark` class/theme attributes, CSS variables, and Tailwind `dark:` classes.

---

## Installation & Build

```bash
npm install @micropasts/harris-matrix
```

Or build from source with zero external dependencies:

```bash
npm run build
npm run dev
```

`npm run build` outputs:
- `dist/harris-matrix.esm.js` — ES Module bundle
- `dist/harris-matrix.iife.js` — Global `<script>` bundle (`window.HarrisMatrixLib`)
- `docs/index.html` and `docs/harris-matrix.esm.js` — Self-contained GitHub Pages demo (including the interactive **Matrix JSON Helper** drawer)

---

## Usage

### 1. Declarative JSON inside `<harris-matrix-tw>` or `<harris-matrix>`

```html
<script type="module" src="./dist/harris-matrix.esm.js"></script>

<harris-matrix-tw>
  <script type="application/json">
    {
      "contexts": [
        { "id": "101", "label": "Context 101", "type": "topsoil", "phase": "Modern", "description": "Ploughsoil and modern turf layer." },
        { "id": "102", "label": "Context 102", "type": "wall", "phase": "Medieval", "description": "Mortared stone foundation." },
        { "id": "103", "label": "Context 103", "type": "natural", "phase": "Natural", "description": "Undisturbed subsoil." }
      ],
      "edges": [
        { "above": "101", "below": "102" },
        { "above": "102", "below": "103" }
      ]
    }
  </script>
</harris-matrix-tw>
```

### 2. Using the CSV & Row-to-JSON Helper

Instead of writing `{ "above": "...", "below": "..." }` edge lists by hand, use `csvToMatrix(csvText)` or `rowsToMatrix(rows)`.

#### Column Conventions
- `id` (or `context`): Unique context identifier.
- `label`: Display label (defaults to `Context <id>`).
- `type`: Stratigraphic type such as `layer`, `cut`, `pit fill`, `wall`, `floor`, or `natural`.
- `phase`: Archaeological phase name (defaults to `Unphased`).
- `above`: Context ID(s) **later** than this context (separate multiple IDs with `|` or `;`).
- `below`: Context ID(s) **earlier** than this context (separate multiple IDs with `|` or `;`).
- `description` & `uri`: Optional notes and linked URI.

#### Example: Converting CSV to Matrix Data

```javascript
import { csvToMatrix } from '@micropasts/harris-matrix';

const csv = `id,label,type,phase,above,below,description
301,Context 301,layer,Post-Medieval,,302,Upper garden loam
302,Context 302,wall,Medieval,301,303|304,Ashlar wall footing
303,Context 303,pit fill,Medieval,302,305,Silty fill in cut 305
304,Context 304,floor,Roman,302,306,Pebble yard surface
305,Context 305,cut,Medieval,303,306,Pit cut into yard
306,Context 306,natural,Natural,304|305,,Natural chalk gravel`;

const { contexts, edges, warnings } = csvToMatrix(csv);

if (warnings.length) {
  console.warn('Stratigraphic warnings:', warnings);
}

const matrixEl = document.querySelector('harris-matrix-tw');
matrixEl.setData({ contexts, edges });
```

#### Example: Converting Structured Rows (`rowsToMatrix`)

```javascript
import { rowsToMatrix } from '@micropasts/harris-matrix';

const rows = [
  { id: '10', label: 'Context 10', type: 'topsoil', phase: 'Modern', below: ['20'] },
  { id: '20', label: 'Context 20', type: 'layer', phase: 'Roman', above: ['10'], below: [] },
];

const { contexts, edges, warnings } = rowsToMatrix(rows);
```

### 3. Synchronizing with `heritage:select`

```javascript
window.addEventListener('heritage:select', (event) => {
  console.log('Selected stratigraphic context:', event.detail);
});
```

---

## Customizing Styles

### Shadow DOM CSS Variables & `::part()` (`<harris-matrix>`)

```css
harris-matrix.custom-hm {
  --hm-bg: #ffffff;
  --hm-fg: #18181b;
  --hm-node-bg: #ffffff;
  --hm-border: #d97706;
  --hm-radius: 0.375rem;
}

harris-matrix.custom-hm::part(inspector) {
  font-size: 13px;
}
```

### Tailwind Utility Classes (`<harris-matrix-tw>`)

Pass `card-class` on the element or customize `HarrisMatrixTailwind.classes` in JavaScript.

---

## Deploying to GitHub Pages

1. Push to `main` (`.github/workflows/pages.yml` runs `npm run build` and publishes `./docs`).
2. In GitHub repository **Settings → Pages**, set **Source** to **GitHub Actions** (or **Deploy from a branch** → `main` / `/docs` after running `npm run build`).

---

## License

MIT