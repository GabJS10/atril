# Changelog

All notable changes to Atril are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-10-29

### Added
- Highlight groups: each book can have its own groups ("Chapter 3 notes"). Create, rename and delete them from the highlights panel, where each group is a folding section with its count and "Ungrouped" goes last. Move a highlight to a group, or to a new one, from its editor. Deleting a group keeps its highlights; they become ungrouped.
- The Markdown export has a section per group when the book has groups; books without groups export exactly as before.

### Changed
- The highlights panel shows the newest highlights first. A "By page" chip switches back to reading order.

## [1.1.0] - 2026-10-16

Atril now runs on **Windows 10 and 11** too.

### Added
- Windows installer (`Atril_1.1.0_x64-setup.exe`): installs for the current user without administrator rights, in English or Spanish, and downloads WebView2 if it is missing.
- On Windows, small books (up to 16 MiB) can be moved, renamed or deleted in File Explorer while they are open; larger ones are locked until Atril releases them.
- Browser shortcuts and the browser context menu are disabled inside the app (print, reload, page zoom, find bar, caret browsing).
- Atril keeps a log in its data folder (`atril.log`), with a summary of every library scan.
- A notice explains why a folder could not be added to the library.

### Changed
- Highlights take whole words: a selection that starts or ends in the middle of a word keeps the whole word. Copying still copies exactly what is selected.
- Books are dragged onto rooms with the pointer instead of HTML drag and drop, the same on Linux and Windows.
- Adding a folder again brings back the books you had removed from the library that are inside it, recognized by their content even if they moved, with their progress, highlights and rooms.

### Fixed
- Saving a note closes the note editor.
- Words split by a hyphen at the end of a line are joined in new highlights ("for- taleza" becomes "fortaleza"); existing highlights are shown and exported joined too.

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
