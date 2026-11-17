# sketch-notes

The skill half of [sketch-notes](../..): it tells Claude how to read a sketch you drew to explain a prompt (ink on a blank canvas, or marks over a screenshot), and when to suggest drawing one instead of describing something spatial in words.

It is Markdown only: no hooks, no scripts. The canvas itself is in [`sketch-notes-pane`](../sketch-notes-pane).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install sketch-notes --marketplace humanikio/sketch-notes
```

Answer `y` to add the marketplace if asked, then pick a scope.

## What it does

- When a prompt carries a sketch from `/sketch`, Claude looks at it first, reads the rough shapes for intent (a circle singles something out, an arrow points, a cross removes), names what each mark points at when the sketch is over an image, and says how it read the colors when you did not.
- When you are struggling to say where something is or how parts connect, Claude suggests `/sketch` once, if the pane is installed.

## License

MIT
