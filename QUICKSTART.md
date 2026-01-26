# Quick Start Guide

## Step 1: Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Name it "Timer Bot"
4. Go to "Bot" section and click "Add Bot"
5. Under TOKEN, click "Copy" to copy your bot token
6. Go to OAuth2 → URL Generator
7. Select scopes: `bot` and `applications.commands`
8. Select permissions: `Send Messages`, `Read Messages`, `Use Slash Commands`
9. Copy the generated URL and open it in a browser to invite the bot to your server

## Step 2: Set Up Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

- `DISCORD_TOKEN` - Your bot token from Developer Portal
- `CLIENT_ID` - Your application ID (from General Information)
- `GUILD_ID` - (Optional) Your server ID for faster command deployment (right-click server → Copy Server ID)
- `OWNER_ID` - Your Discord user ID (right-click yourself → Copy User ID)

## Step 3: Install Dependencies

```bash
npm install
```

## Step 4: Deploy Commands

```bash
npm run deploy
```

You should see: `✅ Commands deployed successfully!`

## Step 5: Start the Bot

```bash
npm start
```

You should see: `✅ Bot logged in as YourBotName#1234`

## Step 6: Test in Discord

In your server, type:

```
/timer start time:10s label:Test
```

The bot should respond with the timer info!

## Tips

- Use `GUILD_ID` in `.env` to deploy commands to one server (instant, for testing)
- Remove `GUILD_ID` to deploy globally (takes up to 1 hour to appear)
- Bot needs "Send Messages" and "Read Messages" permissions in channels where you use it
- Keep the bot running in a terminal or use a process manager like PM2 for production

## Next Steps

Check out the full [README.md](README.md) for all commands and features!
