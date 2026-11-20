# time-waster

A terminal arcade for the moments Claude Code is busy. It opens in its own Windows
Terminal tab as soon as you send Claude a prompt. While you play, the plugin tells
the arcade when Claude is done or needs you, as a one-line banner that never pauses
or interrupts your run.

## Requirements

- Windows (Windows Terminal recommended; plain conhost works too)
- Node 20 or newer on your PATH
- A terminal window of at least 62 x 23 characters

## Install

In Claude Code:

```
/plugin marketplace add NexiosIT/time-waster
/plugin install time-waster@time-waster
```

Restart Claude Code. On session start the plugin creates
`%USERPROFILE%\.time-waster\bin\arcade.cmd`.

## Start the arcade

The arcade opens by itself: when you send Claude a prompt, the plugin opens it in a
new Windows Terminal tab (or a console window if Windows Terminal is not installed).
If an arcade is already open, nothing happens. Leave it open and go back to it
whenever Claude is busy.

To turn this off, open `/config` and set the time-waster option
**Open the arcade when Claude starts working** (`autoOpen`) to off.

You can also start the arcade yourself by typing `arcade` in any terminal. For that,
add the bin folder to your PATH once. Run this in PowerShell, then open a new terminal:

```powershell
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';' + "$env:USERPROFILE\.time-waster\bin", 'User')
```

## Keys

| Where   | Key            | Action                                            |
|---------|----------------|---------------------------------------------------|
| Menu    | Up / Down      | Select a game                                     |
| Menu    | Enter          | Play                                              |
| Menu    | Q              | Quit the arcade                                   |
| In game | P              | Pause / resume                                    |
| In game | Esc            | End the run (score is saved), back to the menu    |
| Results | Enter           | Play again                                        |
| Results | Esc             | Back to the menu                                  |
| Crash   | Enter / Esc     | Back to the menu                                  |
| Anywhere | Ctrl+C         | Save a run in progress, restore terminal, exit    |

All other keys go to the game; each game shows its own controls in the status line.

## Where data lives

Everything is under `%USERPROFILE%\.time-waster\`:

- `scores.json` - your local high scores (top 10 per game)
- `events.jsonl` - recent Claude done / needs-you events written by the plugin hooks
- `bin\arcade.cmd` - the `arcade` command shim
- `arcade.alive` - heartbeat of an open arcade, so the plugin does not open a second one

Scores are per machine; nothing is sent anywhere.

## Add a game

See [docs/adding-a-game.md](docs/adding-a-game.md). A game is one folder in
`src/games/<id>/`; you do not touch any shared file.

## The `dist/` rule

The plugin is installed straight from git and there is no install step, so the built
`dist/` folder (`arcade.js`, `signal.js`, `launch.js`) is committed **on `main` only**.
Game and feature branches never commit `dist/` (run `npm run build` locally to play),
which avoids merge conflicts. After merging to `main`, whoever merges runs
`npm run build` and commits `dist/` on `main`.

## Develop

```
npm install
npm test             # vitest
npm run test:mod     # the Claude Code mod hook (hooks/register.ts), via claude plugin test
npm run build        # bundles dist/ and regenerates the game list
npm run typecheck    # tsc --noEmit
npm run dev -- <id>  # build into .dev/ (git-ignored; dist/ is untouched), then run the arcade
```
