# Timer Bot

A Discord timer & Pomodoro bot built with discord.js.

Features

- Slash commands: `/timer start`, `/timer cancel`, `/timer list`, `/timer stats`, `/timer pomodoro start/stop/status`
- Persistent timers and pomodoro state across restarts (stored in `timers-data.json`)
- Per-user totals and history with timeframe-based stats (`all`, `today`, `week`)
- Channel-first delivery with DM fallback via `allow_dm`
- Helpful `help` subcommand

Important Notes

- The bot checks for required permissions using mask `67584` (SendMessages/ViewChannel). If the bot lacks permission to post in the channel, set `allow_dm=true` to allow the bot to DM you when a timer ends.
- Data file: `timers-data.json` in the project root.

Development

- Install dependencies: `npm install`
- Register commands: `npm run deploy-commands`
- Run the bot: `npm start`
- Run tests (simple utils tests): `npm test`

Contributing

- Tests are minimal. Feel free to extend tests and add linting.

License: MIT
