# Atril

A minimalist, lightweight desktop PDF reader for books, with a library at its heart.

- **Library first:** continue reading, favorites and collections ("rooms").
- **Remembers where you left off** in every book, down to the scroll position.
- **Highlights save themselves** the moment you make them. Your PDF files are never modified.
- Night and sepia page modes, outline, search, and notes exportable to Markdown.
- A reader for your books, not a generic PDF viewer: add folders or open a PDF from inside the app.

Built with Tauri 2, React, TypeScript, Rust and MuPDF. Linux first; Windows later.

> Status: early development (phase 0). See `docs/ROADMAP.md`.

## Development

```bash
npm install
npm run tauri dev
```

System dependencies (Ubuntu/Mint): `libwebkit2gtk-4.1-dev build-essential libssl-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev`.

## License

Copyright (C) 2026 GabJS10.

Atril is licensed under the GNU Affero General Public License v3.0 (see `LICENSE`). It uses MuPDF, which is AGPL-3.0 too.
