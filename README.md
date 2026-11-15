# Herdr mods

Mods for the [Herdr](https://herdr.dev) desktop app. Each mod lives in its own folder with a `README.md`, a `RECIPE.md` (the brief an agent installs or rebuilds it from), a `preview.png` and the runtime files under `mods/<name>/`.

| Mod | What it does |
|---|---|
| [Space Menu](space-menu/) | A right-click menu for the Spaces list: open a folder as a space, or several folders as one space with a tab per folder. |
| [GitHub](github/) | A side panel listing the repository's open GitHub issues and pull requests, with each one's description and conversation. |
| [Figma Bridge](figma-bridge/) | A sidebar section showing the Figma files connected to the figma-console-mcp bridge and the agent working on each. |
| [Skills](skills/) | A side panel listing the Claude Code skills and slash commands of the project and of `~/.claude`, with each one's text. |
| [Servers](servers/) | A sidebar section listing the local servers running on your computer under their space, each with a stop button and an open-in-browser button. |

## Install

Ask your Herdr agent, with the folder of the mod you want:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/cris-achiardi/herdr-mods/tree/main/space-menu

Each mod's README says what it runs and what it needs wired up after copying.

## License

MIT, see [LICENSE](LICENSE).
