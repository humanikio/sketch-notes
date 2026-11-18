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

### Which plugin?

This repo is a Claude Code marketplace with two plugins. Install one of them, not both:

| Plugin | What you get | Where from |
|---|---|---|
| **`sketch-notes`** (most people) | the `/sketch` board, and the skill that tells Claude how to read a sketch | this repo, with any of the three ways below |
| `sketch-notes-skill` | the skill alone, Markdown only: Claude reads the sketches and annotated screenshots you attach, but there's no board | the Claude plugin directory, or this repo |

The board runs programs on your Mac (`ruby`, Chrome, `lsof`; see [Privacy and security](#privacy-and-security)), so it installs from this repo rather than the directory. If you have `sketch-notes-skill` from the directory and want the board, install `sketch-notes` below: the quick install removes `sketch-notes-skill` for you, since `sketch-notes` has the same skill in it.

### Quick install

```sh
curl -fsSL https://raw.githubusercontent.com/humanikio/sketch-notes/main/install.sh | sh
```

It checks for Claude Code, `ruby` and a Chromium browser, then installs `sketch-notes` for your user, or updates it if it is there (and removes `sketch-notes-skill` or the old `sketch-notes-pane` if it finds them). All it runs is `claude plugin` commands, plus one settings change with `--auto-update` (see [Updating](#updating)); [read it](install.sh) before you pipe it into `sh`. Options go after `sh -s --`:

```sh
curl -fsSL https://raw.githubusercontent.com/humanikio/sketch-notes/main/install.sh | sh -s -- --scope project
```

### In Claude Code

At the prompt of a Claude Code session:

```
/plugin install sketch-notes --marketplace humanikio/sketch-notes
```

Answer `y` to add the marketplace, then pick a scope. For the skill alone, use `sketch-notes-skill` in place of `sketch-notes`.

### From a shell

```sh
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

`/sketch path/to/image.png` starts with an image; `/sketch pane` draws in the terminal instead. The full guide is in the [plugin's README](plugins/sketch-notes/README.md).

## Configuration

In `/config`, on the `sketch-notes` row, or with `claude plugin configure sketch-notes@sketch-notes`:

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
claude plugin update sketch-notes@sketch-notes
```

then restart Claude Code (or `/reload-plugins`).

**See what you have.** `claude plugin list` shows each installed version; the [changelog](CHANGELOG.md) says what changed in each.

## Uninstalling

```sh
curl -fsSL https://raw.githubusercontent.com/humanikio/sketch-notes/main/install.sh | sh -s -- --uninstall
```

or `claude plugin uninstall sketch-notes@sketch-notes` (and `sketch-notes-skill`, if you have it). Your sketches stay in `~/.claude/sketches`, and the board's browser profile in `~/.claude/sketch-notes`: delete those folders to remove them too.

## Privacy and security

- Nothing leaves your machine from this plugin: no telemetry and no server of its own. The board runs on `127.0.0.1` behind a one-time token.
- Live pages run in a separate Chrome profile (`~/.claude/sketch-notes/inspect-profile`) with its DevTools port open on `127.0.0.1`, which is how components are read. Web pages can't reach that port; other programs on your Mac could while it's open, so close its windows when you're done.
- To find source lines, it reads the source files of the local dev servers you put on the board. It never writes to your projects.
- A sketch reaches Claude only when you send the prompt that mentions it.

Everything it runs and reads is listed in [What it runs and sends](plugins/sketch-notes/README.md#what-it-runs-and-sends).

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
| [`sketch-notes`](plugins/sketch-notes) | the `/sketch` board (`hooks/`, `scripts/`) and the skill (`skills/read-sketches`) |
| [`sketch-notes-skill`](plugins/sketch-notes-skill) | the same skill on its own, the one listed in the Claude plugin directory |

[`install.sh`](install.sh) is the quick installer, and [`docs/canvas-spec.md`](docs/canvas-spec.md) the board's design.

## Releasing

Claude Code sees a new release by one thing: the `version` in a plugin's `.claude-plugin/plugin.json` on `main`. A push that leaves the version as it was reaches no one who has the plugin installed, and the version is set there only (never also in `marketplace.json`).

1. Make the change, then run `claude plugin validate --strict plugins/sketch-notes` and `claude plugin test plugins/sketch-notes`.
   - The skill is in both plugins. Edit `plugins/sketch-notes/skills/read-sketches/SKILL.md`, copy it to `plugins/sketch-notes-skill/skills/read-sketches/SKILL.md`, and check they match with `cmp plugins/*/skills/read-sketches/SKILL.md`. Then run `claude plugin validate --profile directory plugins/sketch-notes-skill`.
2. Bump `version` in the `plugin.json` of each plugin you changed (both, for a skill change): a patch (1.0.1) for fixes, a minor (1.1.0) for new features, a major (2.0.0) for anything that changes how people use it (a renamed command or setting).
3. Add the version to [`CHANGELOG.md`](CHANGELOG.md).
4. Push to `main`. The directory picks up `sketch-notes-skill` from `main` within about 6 hours (minutes, once the Claude GitHub App is connected on its directory page) and scans it before it goes live.
5. Optionally, tag the release: `claude plugin tag plugins/<plugin> --push` creates `<plugin>--v<version>`. Tags are history and something to roll back to; updates don't read them.

Never rename a plugin: its name is how every install finds it.

## License

MIT
