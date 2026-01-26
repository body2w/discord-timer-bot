# Timer Bot v2.0

A clean, reliable Discord timer and Pomodoro bot built with discord.js.

## Features

✅ **Simple and Reliable** - Rewritten from scratch with clean architecture  
⏱️ **Timer Support** - Start timers with flexible time formats (10s, 5m, 1h, 1:30, etc.)  
🍅 **Pomodoro Sessions** - Multi-cycle Pomodoro support with configurable work/break durations  
💾 **Persistent Storage** - All timers and data are saved and restored on restart  
👥 **Multi-Participant** - Add participants to timers and Pomodoros  
📊 **Statistics & Leaderboard** - Track completed work time per user  
🔐 **Permission System** - Owner-only and authorized resetter controls  
✨ **No Spam** - Efficient message updates and minimal Discord API calls

## Setup

### 1. Prerequisites

- Node.js 16 or higher
- Discord Bot Token
- Discord Application Client ID

### 2. Installation

```bash
npm install
```

### 3. Configuration

Copy `.env.example` to `.env` and fill in your details:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=optional_guild_id_for_faster_testing
OWNER_ID=your_discord_user_id
```

### 4. Deploy Commands

Deploy slash commands to Discord:

```bash
npm run deploy
```

### 5. Start the Bot

```bash
npm start
```

## Commands

### /timer start

Start a timer with flexible time formats.

```
/timer start time:5m label:Work Pomodoro participants:@alice @bob allow_dm:true
```

**Options:**

- `time` _(required)_ - Duration: `10s`, `5m`, `1h`, `1:30`, `1h30m`, etc.
- `label` _(optional)_ - Description for the timer
- `participants` _(optional)_ - Space-separated user mentions or IDs
- `allow_dm` _(optional)_ - Allow DM notifications if channel is unavailable

### /timer cancel

Cancel an active timer.

```
/timer cancel id:1234567890_abc123
```

**Permissions:** Timer owner or authorized resetter

### /timer list

List all your active timers with remaining time.

```
/timer list
```

### /timer stats

View your completed work statistics or a leaderboard.

```
/timer stats timeframe:all global:false
/timer stats timeframe:today global:true
```

**Options:**

- `timeframe` - `all`, `today`, or `week`
- `global` - Show leaderboard if true

### /timer reset

Reset all timers and clear all history.

```
/timer reset
```

**Permissions:** Bot owner only

### /timer manage

Manage users authorized to reset timers.

```
/timer manage authorize user:@alice
/timer manage revoke user:@alice
/timer manage list
```

**Permissions:** Bot owner only

### /pomodoro start

Start a Pomodoro session with multiple cycles.

```
/pomodoro start work:25m break:5m cycles:4 label:Sprint participants:@alice @bob
```

**Options:**

- `work` _(required)_ - Work phase duration
- `break` _(required)_ - Break phase duration
- `cycles` _(optional)_ - Number of cycles (1-100, default 4)
- `label` _(optional)_ - Session label
- `participants` _(optional)_ - Space-separated mentions
- `allow_dm` _(optional)_ - Allow DM notifications

### /pomodoro stop

Stop an active Pomodoro session.

```
/pomodoro stop id:1234567890_abc123
```

**Permissions:** Session owner or authorized resetter

### /pomodoro status

Check your active Pomodoro's current status.

```
/pomodoro status
```

Shows:

- Current cycle and total cycles
- Whether you're in work or break phase
- Time remaining in current phase
- Total time remaining

### /pomodoro participants

View participants in a Pomodoro session.

```
/pomodoro participants id:1234567890_abc123
```

## Time Format Examples

The bot supports flexible time input:

```
10s          → 10 seconds
5m           → 5 minutes
1h           → 1 hour
1:30         → 1 minute 30 seconds (mm:ss format)
1:30:45      → 1 hour 30 minutes 45 seconds (hh:mm:ss format)
1h30m        → 1 hour 30 minutes
2d 5h        → 2 days 5 hours
90s          → 90 seconds
1d           → 1 day
```

## Data Storage

All bot data is stored in `timers-data.json`:

- Active timers and Pomodoros
- User work totals
- History of completed sessions
- Authorized resetters per guild

**Backup file** (`timers-data.json.backup`) is created on each save.

## Architecture

The bot is organized into clean, modular components:

- **`index.js`** - Main bot entry point and state management
- **`storage.js`** - Data persistence with atomic writes
- **`utils.js`** - Time parsing, formatting, participant parsing
- **`lib/timer-manager.js`** - Timer lifecycle management
- **`lib/pomodoro-manager.js`** - Pomodoro session management
- **`lib/command-handler.js`** - Slash command routing and processing

## Troubleshooting

### Commands not showing up

1. Check that `DISCORD_TOKEN` and `CLIENT_ID` are correct in `.env`
2. Run `npm run deploy` again
3. Wait up to 1 hour if deploying globally (not using `GUILD_ID`)
4. Try restarting Discord

### Bot doesn't respond to commands

1. Make sure bot is logged in: check console for `✅ Bot logged in`
2. Verify bot has permissions to read/write in the channel
3. Check that commands were deployed successfully

### Timers not persisting after restart

1. Verify `timers-data.json` exists and is readable
2. Check bot logs for save errors
3. Backup file `timers-data.json.backup` is created on each save

### DM notifications not working

1. User must not have DMs disabled from the bot
2. Bot must have access to send DMs
3. Enable `allow_dm:true` when starting a timer/pomodoro

## Development

### Project Structure

```
timerBot/
├── index.js                    # Main bot file
├── storage.js                  # Data persistence
├── utils.js                    # Utility functions
├── deploy-commands.js          # Command deployment
├── package.json
├── .env.example               # Environment template
├── timers-data.json           # Persistent storage
├── lib/
│   ├── timer-manager.js       # Timer management
│   ├── pomodoro-manager.js    # Pomodoro management
│   └── command-handler.js     # Command routing
└── tests/                      # Tests (if any)
```

### Running Tests

```bash
npm test
```

## License

MIT

## Support

For issues or feature requests, please check the logs and ensure:

1. All environment variables are set correctly
2. Bot token is valid and not expired
3. Bot has necessary Discord permissions
4. Node.js version is 16 or higher
