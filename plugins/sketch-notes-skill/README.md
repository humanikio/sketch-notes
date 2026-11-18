# sketch-notes-skill

The skill from [sketch-notes](https://github.com/humanikio/sketch-notes), on its own. It tells Claude how to read a sketch you attach to a prompt (ink on a blank canvas, marks over a screenshot, or a board with notes pinned to components) and when to suggest drawing one instead of describing something spatial in words.

It is Markdown only: no hooks, no scripts, nothing runs. It does not make sketches. That is the `/sketch` board, in the `sketch-notes` plugin.

## Which one do I need?

| You want | Install |
|---|---|
| Claude to read the sketches and annotated screenshots you attach | this plugin, `sketch-notes-skill` |
| the `/sketch` board too: live local pages, window screenshots, notes on components with their source lines | `sketch-notes`, which has this skill in it already |

You never need both. If you install `sketch-notes`, uninstall this one.

## Install

From the Claude plugin directory, or at the prompt of a Claude Code session:

```
/plugin install sketch-notes-skill --marketplace humanikio/sketch-notes
```

## Get the board

The board needs `ruby` on your PATH (macOS ships one), and Google Chrome, Brave, Edge or Chromium for reading components. In Claude Code:

```
/plugin uninstall sketch-notes-skill
/plugin install sketch-notes --marketplace humanikio/sketch-notes
```

Then start a new session and run `/sketch`. The [sketch-notes README](https://github.com/humanikio/sketch-notes#readme) covers setup, what the board runs, and what it reads.

## What it does

- When a prompt carries a sketch, Claude looks at it first, reads the rough shapes for intent (a circle singles something out, an arrow points, a cross removes), names what each mark points at, and goes to the files and lines a note names.
- When you are struggling to say where something is or how parts connect, Claude suggests `/sketch` once, or, if the board isn't installed, says once how to get it.

## Privacy

This plugin collects and sends nothing. It is instructions for Claude, read from this folder.

## License

MIT
