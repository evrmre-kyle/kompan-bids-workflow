# RFP & Proposal Workflow Chart

An interactive, left-to-right process diagram of an operational RFP / proposal
workflow — from intake through strategy, scoping, design, and compliance review.
Built as a single static page with no build step.

![Workflow](docs/preview.png)

## Features

- **Horizontal flow** with decision diamonds (GO / NO-GO, Turnkey vs. Supply &
  Install) and a branch that forks and re-converges.
- **Owner colour-coding** — Sales, Bid & Proposal, Design, Compliance. Click an
  owner in the legend to spotlight just their steps.
- **Expandable steps** — click any card (or *Expand all*) to reveal its
  sub-steps; connectors re-route automatically.
- **Pan / zoom / fit** controls for navigating the canvas.
- **Tweaks panel** — live theming controls:
  - Mode: Bright / Dark
  - Colour palette: Pastel · Corporate · Sunset · Ocean
  - Typeface: Soft · Rounded · Modern
  - Card style: Tinted · White · Outline
  - Corner radius
  - Background: Dots / Plain

## Viewing it

Because the Tweaks panel is loaded as a `.jsx` module (compiled in-browser by
Babel), the page must be served over HTTP — opening `index.html` directly from
the filesystem (`file://`) will block that fetch.

**Option A — GitHub Pages (recommended)**
1. Push this repo to GitHub.
2. Settings → Pages → Source: `main` branch, `/ (root)`.
3. Open the published URL. `index.html` is served automatically.

**Option B — local server**
```bash
# from this folder
python3 -m http.server 8000
# then open http://localhost:8000
```

## Project structure

```
.
├── index.html            # the chart (markup + styles + flow logic)
├── tweaks-panel.jsx      # reusable Tweaks panel shell + form controls
├── workflow-tweaks.jsx   # the chart's specific tweak controls + bindings
└── README.md
```

## Tech notes

- No bundler, no `npm install`. React 18, ReactDOM, and Babel are loaded from a
  CDN with pinned versions + integrity hashes.
- The chart itself is plain HTML/CSS/JS. The Tweaks panel is the only React
  part; it writes theme values to CSS custom properties and `data-*` attributes
  on `<body>`, which the stylesheet reacts to.
- Connectors are drawn as SVG paths computed from live element positions, so the
  diagram re-routes whenever cards expand, fonts change, or the layout reflows.
- Fonts (Poppins, Mulish, Nunito, Space Grotesk) load from Google Fonts.

## Editing the flow

The nodes live as static markup inside `index.html` (search for `class="node`).
Each step is a `<div class="node card" data-owner="…">` with a title, owner
chips, and an optional `<ul class="substeps">`. Connections are declared in the
`links` array in the inline `<script>` near the bottom of the file.
