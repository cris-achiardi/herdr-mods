# Space Menu for Herdr

A right-click menu for the Spaces list in the [Herdr](https://herdr.dev) desktop app that opens folders the way an editor does: pick a folder and a space starts there, instead of making an empty space and `cd`-ing to where you wanted to be.

![Space Menu](preview.png)

## What it adds

- **New space**: Herdr's own command, unchanged.
- **Open folder…**: the system folder picker, then a new space in the chosen folder. The space is named after the folder (or its repository), as Herdr names any unnamed space.
- **Open folders…**: a dialog that collects several folders, then makes **one space with a tab per folder**, each tab named after its folder. Optionally the first tab starts Claude Code with the other folders passed as `--add-dir`.
- On a space's row, the menu also carries Herdr's own space items (Rename, New/Open/Remove worktree, Close), so it replaces the shipped space menu without losing anything.

## Install

Ask your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/cris-achiardi/herdr-space-menu

It follows [RECIPE.md](RECIPE.md). Installation has two parts, and the second is the one that matters:

1. Copy `mods/space-menu/` into `~/.config/herdr-app/mods/`.
2. **Point your Spaces sidebar's right-click at it.** `mod.json` uses `"place": "none"`, and a sidebar opens Herdr's shipped `menu` mod on right-click, so copying the folder alone changes nothing. The sidebar mod has to open `space-menu` instead. RECIPE.md has the exact edit for Herdr's stock `spaces` mod and for [Better Sidebar](https://github.com/munza/herdr-mods/tree/main/better-sidebar).

Herdr's shipped mods and layouts are read-only and restored on every start, so on a stock setup step 2 means cloning the `spaces` mod and your layout and editing the clones. Clones are yours and stop receiving Herdr's updates to those files.

### Without touching the sidebar

`mod.json` declares the menu as a popup, so a key can open it with no sidebar change. In `~/.config/herdr-app/keys.json`, under `global`:

```json
"<your key>": "mod.open:space-menu"
```

Opened this way it shows New space, Open folder… and Open folders…, without the per-space items.

## What it runs

- The system folder picker (`pickFolder`), on this computer only.
- `git rev-parse` in a right-clicked space's folder, to decide whether to offer the worktree items.
- Herdr's installed-agent check (`knownAgents`), to decide whether to offer the Claude Code option.
- App commands: `space.new`, `space.rename`, `space.close`, `tab.new`, `tab.rename`, `tab.select`.

No network access. It reads no files and writes nothing outside Herdr's own state.

## Limits

- **A multi-folder space is not a sandbox.** A Herdr space is a starting point, not a fence: any terminal in it can `cd` anywhere. `--add-dir` sets which folders Claude Code works in; it does not restrict the shell.
- The folder picker returns one folder at a time, so Open folders… adds them one by one.
- Folders are picked on this computer. Spaces on other machines are not supported.
- The Claude Code option appears only when Herdr reports Claude Code as installed. Other agents are not offered.
- Built and used on Windows with Herdr 0.1.15. macOS and Linux are untested.

## License

MIT, see [LICENSE](LICENSE). The per-space items and the menu's look follow Herdr's shipped `menu` mod; icons are referenced from Herdr's shipped `workspace-chrome` mod, not copied.
