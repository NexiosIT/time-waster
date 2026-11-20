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

## Games sized to Claude's work

When you send a prompt, the plugin asks Claude to start its reply with a line like
`Estimate: ~5 min`. The arcade reads it and shows a line at the top of the menu:

```
 Claude ~6 min left  ·  suggested: Reflex (~1 min, new)
```

`, new` means that game is still `NEW`: fewer than 3 finished runs for a `rounds`/`open`
game, none for a `timed` game (see `NEW` below).

The suggested game is pre-selected and marked `★`; it is only a suggestion, so you can
pick any other game, and a run is never ended because Claude finished. Other menu text:

| Text                     | Meaning                                                                                                                     |
|--------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| `Claude: estimating…`    | A task started and Claude has not given its estimate yet                                                                    |
| `Claude is running over` | The estimate has passed; no suggestion                                                                                      |
| `~N min (you)`           | Game length learned from your own finished runs                                                                             |
| `~N min (est.)`          | The author's guess (plus a safety margin), not enough runs of yours yet                                                     |
| `NEW`                    | A `rounds`/`open` game with fewer than 3 finished runs of yours, or a `timed` game with none; new games are suggested first |

Learned lengths are the 75th percentile of your last 20 finished runs, so the suggestion
tends to end before Claude does. Timed games (Reflex) have an exact length.

To turn the estimate and the suggestion off, open `/config` and set
**Suggest a game that fits Claude's estimated time** (`suggestGames`) to off. It is
separate from `autoOpen`.

## Keys

| Where   | Key            | Action                                            |
|---------|----------------|---------------------------------------------------|
| Menu    | Up / Down      | Select a game                                     |
| Menu    | Enter          | Play                                              |
| Menu    | H              | Heckling on / off (passive-aggressive pep talk)   |
| Menu    | Q              | Quit the arcade                                   |
| Menu    | O              | Share scores online / your online account (when online scores are on) |
| In game | P              | Pause / resume                                    |
| In game | Esc            | End the run (score is saved), back to the menu    |
| Results | Enter           | Play again                                        |
| Results | Esc             | Back to the menu                                  |
| Results | Tab             | Switch between your scores and the world board (when online scores are on) |
| Crash   | Enter / Esc     | Back to the menu                                  |
| Anywhere | Ctrl+C         | Save a run in progress, restore terminal, exit    |

All other keys go to the game; each game shows its own controls in the status line.

### The jinx

If your OS username or online login contains `thomas` (any case), every game runs 33%
faster, about 1 in 8 key presses is dropped or doubled, and the screen glitches now and
then. Esc, P and Ctrl+C are never affected. It's a joke; see `src/core/jinx.ts`.

## Where data lives

Everything is under `%USERPROFILE%\.time-waster\`:

- `scores.json` - your local high scores (top 10 per game)
- `runs.json` - how long your finished runs took (last 20 per game); used for game lengths
- `settings.json` - your settings (heckling on/off)
- `events.jsonl` - recent Claude start / estimate / done / needs-you events written by the plugin hooks
- `bin\arcade.cmd` - the `arcade` command shim
- `arcade.alive` - heartbeat of an open arcade, so the plugin does not open a second one
- `online.json` - your online session (server, session token, GitHub username), only once you sign in
- `outbox.jsonl` - finished runs waiting to be sent to the online board, only once you sign in

Scores are per machine and nothing is sent anywhere, unless you join the online high scores.

## Online high scores

The leaderboards are also on the web: <https://lobster-app-di8o6.ondigitalocean.app/>
(one page per game, with a few kind words for whoever is on top).

Sharing scores is opt-in. Until you sign in, the arcade only downloads leaderboards (the
world best per game, shown next to your own best) and sends no score or name.

To join, press **O** in the menu. The arcade shows a GitHub address and a short code: open
the address in a browser, enter the code and approve. You never type your GitHub password
into the arcade, and the arcade never keeps a GitHub token. From then on every finished
run is sent to the shared board; on the results screen, **Tab** switches between your own
scores and the world top 10 with your rank.

What the server stores: your GitHub numeric id and username, and your scores. Nothing else.
It keeps no IP addresses (they are held only in memory, briefly, for rate limiting).

To leave, press **O** in the menu while signed in:

- **S** signs out on this PC and ends the session on the server; your online scores stay on the board.
- **D** signs out and deletes all your online scores (asks Y/N first). If the server cannot be
  reached, you stay signed in and the arcade says your scores were not deleted; try again later.

If you cannot reach the arcade any more, open an issue on this repository and we remove
your data. Running the score server yourself: see [server/README.md](server/README.md).

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

The arcade runs on Node 20 or newer; the server tests in `npm test` need Node 22.13 or newer
(`node:sqlite`).
