# Herdr mods

Mods for the [Herdr](https://herdr.dev) desktop app. Each mod lives in its own folder with a `README.md`, a `RECIPE.md` (the brief an agent installs or rebuilds it from), a `preview.png` and the runtime files under `mods/<name>/`.

| Mod | What it does |
|---|---|
| [Space Menu](space-menu/) | A right-click menu for the Spaces list: open a folder as a space, or several folders as one space with a tab per folder. |
| [GitHub](github/) | A side panel listing the repository's open GitHub issues and pull requests and, across repositories, the ones waiting on you, with each one's description and conversation. |
| [Figma Bridge](figma-bridge/) | A sidebar section showing the Figma files connected to the figma-console-mcp bridge and the agent working on each. |
| [Skills](skills/) | A side panel listing the Claude Code skills and slash commands of the project and of `~/.claude`, with each one's text. |
| [Servers](servers/) | A sidebar section listing the local servers running on your computer under their space, each with a stop button and an open-in-browser button. |
| [Scripts](scripts/) | A side panel listing the project's `package.json` scripts; a click runs one in a new terminal pane. |
| [Workspaces](workspaces/) | A "Workspace" link in the tab bar that opens a menu of your layouts; each layout is its own set of mods, so picking one switches them. Includes a clean copy of Herdr's default with the link, listed in place of the original. |
| [Mod Switches](mod-switches/) | Ctrl+Shift+M opens a dialog with an on/off switch for every mod on screen (sidebar sections, panels, bars); off hides it without uninstalling, per layout. |
| [Herdr orchestration](herdr-orchestration/) | Not a mod: a Claude Code skill, role templates and scripts for running Claude workers and a Codex reviewer in split panes, with a tested list of hc/Codex/Windows frictions. |

## Install

Ask your Herdr agent, with the folder of the mod you want:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/cris-achiardi/herdr-mods/tree/main/space-menu

Each mod's README says what it runs and what it needs wired up after copying.

## Contributing

These mods are maintained by Cristian Morales, but suggestions and improvements are welcome.

**Reporting issues.** Found a bug, or a mod that breaks on your Herdr version or platform? [Open an issue](https://github.com/cris-achiardi/herdr-mods/issues) with the mod's name, your Herdr version (`herdr-app --version`) and what `herdr-app status` reports.

**Proposing improvements.** To change a mod:

1. Fork the repository.
2. Make your change in the mod's folder, and update its `README.md` and `RECIPE.md` to match.
3. Run `herdr-app check` on the mod and try it in the app.
4. Open a pull request saying what changed and how you checked it.

## License

MIT, see [LICENSE](LICENSE).

Copyright (c) 2026 cris-achiardi

## Links

- **Website:** [giorris.dev](https://giorris.dev)
- **GitHub:** [@cris-achiardi](https://github.com/cris-achiardi)
- **LinkedIn:** [Cristian Morales Achiardi](https://www.linkedin.com/in/cristian-morales-achiardi/)
- **YouTube:** [@giongiorris](https://www.youtube.com/@giongiorris)
- **Issues:** [GitHub Issues](https://github.com/cris-achiardi/herdr-mods/issues)

## Buy me a coffee

If these mods save you time, you can support the work:

[![Buy Me A Coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=giorris&button_colour=5146e6&font_colour=ffffff&font_family=Comic&outline_colour=ffffff&coffee_colour=FFDD00)](https://www.buymeacoffee.com/giorris)
