# sketch-notes

**Show Claude what you mean.** `/sketch` opens a full-screen board in Claude Code where you put your running local apps, screenshots and images side by side, click anything to say *what should be changed here*, and attach it all to your prompt. A note on a live page names the component, its source file and line, and a selector, so Claude goes straight to the code.

```
@~/.claude/sketches/sketch-2026-11-17T18-35-16.png make the pricing cards match
pages on the sketch:
  A. http://localhost:3000/pricing (Pricing)
notes pinned on the sketch (numbered on the image):
1. A · <BuyButton> (in PricingCard ‹ PricingPage) · button "Buy Pro" · src/components/BuyButton.tsx:12: make this purple
```

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [What's in this repo](#whats-in-this-repo)
- [Releasing](#releasing)
- [License](#license)

## Features

- **Click means comment.** A click anywhere asks "What should be changed here?". On a live page the note pins to the component under the mouse.
- **Your running apps, live on the board.** Pick any dev server running on your Mac from a list. Pages scroll and ⌘-click like in Chrome, and side by side you can compare them.
- **Components and source lines.** React, Vue and Svelte components are read from the page, with the file and line they were written at (dev builds, including React 19 and Next.js server components).
- **Screenshots and images.** Capture any window on screen, or drop, paste or open an image.
- **Drawing when you want it.** Pen, highlighter, arrow, box and eraser in a palette. Select, move, resize, copy and paste like a design tool.
- **One attach.** A png of the board (or your selection), a readable crop of each page, and a written list of every note, straight into your prompt.
- **Keeps your board.** It comes back the next time you run `/sketch`.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- `ruby` on your PATH (macOS ships one)
- Google Chrome, Brave, Edge or Chromium, for live pages whose components can be read (any browser opens the board otherwise)
- macOS, for window screenshots, with Screen Recording allowed for the app you run Claude Code in

## Installation

### Quick install

```sh
curl -fsSL https://raw.githubusercontent.com/humanikio/sketch-notes/main/install.sh | sh
```

It checks for Claude Code, `ruby` and a Chromium browser, then installs both plugins for your user, or updates them if they are there. All it runs is `claude plugin` commands, plus one settings change with `--auto-update` (see [Updating](#updating)); [read it](install.sh) before you pipe it into `sh`. Options go after `sh -s --`:

```sh
curl -fsSL https://raw.githubusercontent.com/humanikio/sketch-notes/main/install.sh | sh -s -- --board-only
curl -fsSL https://raw.githubusercontent.com/humanikio/sketch-notes/main/install.sh | sh -s -- --scope project
```

### In Claude Code

At the prompt of a Claude Code session:

```
/plugin install sketch-notes-pane --marketplace humanikio/sketch-notes
/plugin install sketch-notes --marketplace humanikio/sketch-notes
```

Answer `y` to add the marketplace, then pick a scope. The second line, the skill, is optional.

### From a shell

```sh
claude plugin install sketch-notes-pane --marketplace humanikio/sketch-notes
claude plugin install sketch-notes --marketplace humanikio/sketch-notes
```

## Usage

1. Run `/sketch` in Claude Code. The board opens full screen with a picker: **Local server**, **Screenshot** or **Image**.
2. Pick one of your running servers (or type a URL), a window, or an image.
3. Click anything to say what should change. ✓ or Enter keeps the note.
4. Press **Attach to prompt** (⌘↵). Type the rest of your prompt and send.

| Key | Does |
|---|---|
| click | a note: "What should be changed here?" (⌥-click: the exact spot, not the component) |
| ⌘-click on a page | clicks the page itself |
| scroll | scrolls the page under the mouse, or pans the board |
| `W` `S` `O` | add a local server, a window screenshot, an image |
| `V` `P` `H` `A` `B` `E` | select, pen, highlighter, arrow, box, eraser |
| drag on the board | select everything the box touches |
| ⌘C ⌘V ⌘D ⌫ ⌘Z | copy, paste, duplicate, delete, undo |
| pinch, ⇧1, ⇧2 | zoom, fit all, zoom to the selection |

`/sketch path/to/image.png` starts with an image; `/sketch pane` draws in the terminal instead. The full guide is in the [board's README](plugins/sketch-notes-pane/README.md).

## Configuration

In `/config`, on the `sketch-notes-pane` row, or with `claude plugin configure sketch-notes-pane@sketch-notes`:

| Setting | Default | What it is |
|---|---|---|
| `opens` | `window` | `window`, the full-screen board, or `pane`, a canvas in the terminal |
| `folder` | `~/.claude/sketches` | where sketches and the board are kept: outside your projects, so they are never committed |

## Updating

Claude Code updates plugins by their version number, and it keeps marketplaces outside Anthropic's own (like this one) up to date only once you turn auto-update on. Pick one:

**Turn on auto-update (recommended).** In Claude Code: `/plugin` › **Marketplaces** › **sketch-notes** › **Enable auto-update**. Or let the installer do it:

```sh
curl -fsSL https://raw.githubusercontent.com/humanikio/sketch-notes/main/install.sh | sh -s -- --auto-update
```

That sets `"autoUpdate": true` on the `sketch-notes` entry under `extraKnownMarketplaces` in `~/.claude/settings.json`, after saving a backup beside it. From then on, a few minutes into a session Claude Code checks this repo, installs a new version in the background and says *Plugin updated · Run /reload-plugins to apply*; otherwise it loads on your next launch.

**Update by hand.** Run the quick install again, or:

```sh
claude plugin marketplace update sketch-notes
claude plugin update sketch-notes-pane@sketch-notes
claude plugin update sketch-notes@sketch-notes
```

then restart Claude Code (or `/reload-plugins`).

**See what you have.** `claude plugin list` shows each installed version; the [changelog](CHANGELOG.md) says what changed in each.

## Uninstalling

```sh
curl -fsSL https://raw.githubusercontent.com/humanikio/sketch-notes/main/install.sh | sh -s -- --uninstall
```

or `claude plugin uninstall sketch-notes-pane@sketch-notes` and `claude plugin uninstall sketch-notes@sketch-notes`. Your sketches stay in `~/.claude/sketches`, and the board's browser profile in `~/.claude/sketch-notes`: delete those folders to remove them too.

## Privacy and security

- Nothing leaves your machine from this plugin: no telemetry and no server of its own. The board runs on `127.0.0.1` behind a one-time token.
- Live pages run in a separate Chrome profile (`~/.claude/sketch-notes/inspect-profile`) with its DevTools port open on `127.0.0.1`, which is how components are read. Web pages can't reach that port; other programs on your Mac could while it's open, so close its windows when you're done.
- To find source lines, it reads the source files of the local dev servers you put on the board. It never writes to your projects.
- A sketch reaches Claude only when you send the prompt that mentions it.

Everything it runs and reads is listed in [What it runs and sends](plugins/sketch-notes-pane/README.md#what-it-runs-and-sends).

## Troubleshooting

| Problem | Fix |
|---|---|
| Components or source lines missing | Use a dev build (`npm run dev`), not a production build, and Chrome, Brave, Edge or Chromium |
| A page shows a red dot | It refuses to be framed: press **Use snapshot** to put a picture of it on the board, components kept |
| Window screenshots are blank or missing | Allow the app you run Claude Code in under System Settings › Privacy & Security › Screen Recording, then reopen it |
| A server isn't listed | Start it, then press ↻ Refresh, or type its URL |
| `/sketch` isn't there | Run `claude plugin list` to check it's installed and enabled, then start a new session |

## What's in this repo

A Claude Code marketplace with two plugins:

| Plugin | What it is |
|---|---|
| [`sketch-notes-pane`](plugins/sketch-notes-pane) | the `/sketch` board |
| [`sketch-notes`](plugins/sketch-notes) | the skill, in Markdown only: how Claude reads a sketch, and when to suggest drawing one |

[`install.sh`](install.sh) is the quick installer, and [`docs/canvas-spec.md`](docs/canvas-spec.md) the board's design.

## Releasing

Claude Code sees a new release by one thing: the `version` in a plugin's `.claude-plugin/plugin.json` on `main`. A push that leaves the version as it was reaches no one who has the plugin installed, and the version is set there only (never also in `marketplace.json`).

1. Make the change, then run `claude plugin validate --strict plugins/<plugin>` and `claude plugin test plugins/sketch-notes-pane`.
2. Bump `version` in that plugin's `plugin.json`: a patch (1.0.1) for fixes, a minor (1.1.0) for new features, a major (2.0.0) for anything that changes how people use it (a renamed command or setting).
3. Add the version to [`CHANGELOG.md`](CHANGELOG.md).
4. Push to `main`.
5. Optionally, tag the release: `claude plugin tag plugins/<plugin> --push` creates `<plugin>--v<version>`. Tags are history and something to roll back to; updates don't read them.

Never rename a plugin: its name is how every install finds it.

## License

MIT
