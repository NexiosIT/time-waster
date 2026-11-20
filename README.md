# time-waster

A terminal arcade for the moments Claude Code is busy. It runs in its own Windows
Terminal tab. While you play, a Claude Code plugin tells the arcade when Claude is
done or needs you, as a one-line banner that never pauses or interrupts your run.

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

- In Claude Code, run `/arcade` (also reachable as `/time-waster:arcade`). It opens a
  new Windows Terminal tab running the arcade.
- Claude Code queues slash commands while it is busy, so to start the arcade *while
  Claude is working*, type `arcade` in any other terminal. For that, add the bin
  folder to your PATH once. Run this in PowerShell, then open a new terminal:

```powershell
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';' + "$env:USERPROFILE\.time-waster\bin", 'User')
```

`/arcade` prints this line too if the folder is not on your PATH yet.

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
| Crash   | Enter           | Back to the menu                                  |
| Anywhere | Ctrl+C         | Restore the terminal and exit                     |

All other keys go to the game; each game shows its own controls in the status line.

## Where data lives

Everything is under `%USERPROFILE%\.time-waster\`:

- `scores.json` - your local high scores (top 10 per game)
- `events.jsonl` - recent Claude done / needs-you events written by the plugin hooks
- `bin\arcade.cmd` - the `arcade` command shim

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
npm run build        # bundles dist/ and regenerates the game list
npm run dev -- <id>  # build, then run the arcade
```
