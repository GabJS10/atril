# Atril

A minimalist, lightweight desktop PDF reader for books, with a library at its heart.

- **Library first:** continue reading, favorites and collections ("rooms").
- **Remembers where you left off** in every book, down to the scroll position.
- **Highlights save themselves** the moment you make them. Your PDF files are never modified.
- Night and sepia page modes, outline, search, notes exportable to Markdown, and open PDFs straight from your file manager.

Built with Tauri 2, React, TypeScript, Rust and pdf.js. Linux first; Windows later.

> Status: early development (phase 0). See `docs/ROADMAP.md`.

## Development

```bash
npm install
npm run tauri dev
```

System dependencies (Ubuntu/Mint): `libwebkit2gtk-4.1-dev build-essential libssl-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev`.
