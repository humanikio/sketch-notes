# Changelog

Each plugin has its own version, set in its `.claude-plugin/plugin.json`. Claude Code updates an installed plugin when that version changes.

## sketch-notes 2.0.1 · 2026-11-18

- The skill suggests the board in the board's own terms (pick an app, a screenshot or an image, click what should change, attach), and when `/sketch` isn't installed it says once how to get it.
- The quick install removes `sketch-notes-skill` if it finds it, since `sketch-notes` has the same skill in it.

## sketch-notes-skill 1.0.0 · 2026-11-18

The skill on its own, Markdown only, for the Claude plugin directory. It is the same `read-sketches` skill as in `sketch-notes`.

## sketch-notes 2.0.0 · 2026-11-17

The board and the skill are one plugin now, `sketch-notes`. `sketch-notes-pane` is gone.

- If you had `sketch-notes-pane`, uninstall it (`claude plugin uninstall sketch-notes-pane@sketch-notes`) and install or update `sketch-notes`, or run the quick install again, which does both.
- Settings move to the `sketch-notes` row: set `opens` and `folder` again there if you had changed them. Your sketches and board stay where they were.

## sketch-notes-pane 1.0.0 · 2026-11-17

First release of the `/sketch` board.

- A full-screen board that opens on a picker: a running local server, a window screenshot, or an image.
- A click anywhere asks "What should be changed here?". On a live page the note pins to the component under the mouse.
- Live pages of local dev servers: scrolling and ⌘-click work like in Chrome, with Comment and Interact modes and a snapshot when a site refuses to be framed.
- React, Vue and Svelte components with the file and line they were written at, including React 19 and Next.js server components.
- Pen, highlighter, arrow, box and eraser; select, move, resize, copy, paste and delete like a design tool.
- Attach to prompt: a png of the board or the selection, a readable crop of each page, and a written list of every note.
- The board is kept in `~/.claude/sketches` and comes back with `/sketch`.
- `/sketch pane` keeps the canvas in the terminal.

## sketch-notes 1.0.0 · 2026-11-17

First release of the skill: how Claude reads a sketch, and when to suggest drawing one.
