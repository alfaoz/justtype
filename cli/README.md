# justtype

A beautiful terminal UI for distraction-free writing.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│      ╦╦ ╦╔═╗╔╦╗╔╦╗╦ ╦╔═╗╔═╗                          │
│      ║║ ║╚═╗ ║  ║ ╚╦╝╠═╝║╣                           │
│     ╚╝╚═╝╚═╝ ╩  ╩  ╩ ╩  ╚═╝                          │
│              v1.3.0                                  │
│                                                      │
│   distraction-free writing for your terminal         │
│                                                      │
│   your notes are stored locally in ~/.justtype       │
│   login to sync across devices                       │
│                                                      │
│            [ press enter to get started ]            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Install

```bash
curl -fsSL https://justtype.io/cli/install.sh | bash
```

## Update

The CLI checks for updates automatically. When an update is available, you'll see a notification on the home screen. Go to **settings** and select **update** to install it.

Or reinstall:
```bash
curl -fsSL https://justtype.io/cli/install.sh | bash
```

## Usage

Just run:

```bash
justtype
```

### First Run
1. Welcome screen
2. Choose your preferred editor (nano, vim, nvim, code, etc.)
3. Start writing!

### Navigation
| Key | Action |
|-----|--------|
| `↑`/`k` | Move up |
| `↓`/`j` | Move down |
| `Enter` | Select |
| `n` | New slate |
| `e` | Edit in your editor |
| `s` | Save |
| `d` | Delete |
| `/` | Search |
| `Esc` | Go back |
| `q` | Quit |

## Features

### Works Offline
All slates are stored locally in `~/.justtype/`. No account needed.

### Cloud Sync
Login to sync to [justtype.io](https://justtype.io) and access your notes anywhere.

### Editor Integration
Choose your editor during setup: nano, vim, nvim, VS Code, Sublime, micro, emacs, or helix. Change it anytime in settings.

### Export
Export all slates as `.txt` files to any directory.

### Auto-Update
Checks for updates on startup. One-click update from settings.

## Files

- `~/.justtype/slates.json` - Your notes
- `~/.justtype/config.json` - Settings

## Platforms

- Linux (amd64, arm64)
- macOS (Intel, Apple Silicon)

## License

MIT
