# Changelog

All notable changes to Atril are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-10-14

### Fixed
- The .deb package now has a description, homepage and maintainer (the installer showed "(none)"). The launcher entry gets a tooltip comment too.

## [1.0.0] - 2026-10-13

First public version, for Linux (.deb and AppImage).

### Library
- A library as the home screen: continue reading, favorites, collections ("rooms") and recently added books.
- Watched folders and loose files. Books stay where they are and are recognized by their content, so moving or renaming a file keeps its progress, highlights and rooms.
- Covers and metadata extracted in the background. Covers are shown in color, and the "continue reading" card takes its tint from the cover.
- Search by title or author (Ctrl K), filters by reading status and several sort orders.

### Reader
- Native PDF engine (MuPDF) with a virtualized viewer: fast first page, smooth scrolling and crisp two-step zoom, scanned books included.
- Remembers the exact position in every book.
- Text selection and copy, search with highlighted matches, outline and links.
- Highlights in four pigments, with notes, saved the moment they are made and exportable to Markdown. The PDF is never modified.
- Normal, sepia and night paper; focus mode and full screen.

### App
- "Gallery at night" design, in dark and light ("white cube") themes.
- Spanish and English interface, following the system language by default.
- Atril is a reader for your books, not a generic PDF viewer: it does not register itself as the system PDF reader; books are opened from inside the app.

### License
- GNU AGPL-3.0, because Atril links MuPDF, which is AGPL-3.0.
