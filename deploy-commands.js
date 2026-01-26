import "dotenv/config";
import { REST, Routes } from "discord.js";

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error("❌ DISCORD_TOKEN and CLIENT_ID are required in .env file");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

const timerCommands = [
  {
    name: "timer",
    description: "Manage timers",
    options: [
      {
        name: "start",
        description: "Start a new timer",
        type: 1,
        options: [
          {
            name: "time",
            description: "Duration (e.g., 10s, 5m, 1h, 1:30)",
            type: 3,
            required: true,
          },
          {
            name: "label",
            description: "Optional label for the timer",
            type: 3,
            required: false,
          },
          {
            name: "participants",
            description: "Space-separated participant mentions or IDs",
            type: 3,
            required: false,
          },
          {
            name: "allow_dm",
            description: "Allow DM notifications",
            type: 5,
            required: false,
          },
        ],
      },
      {
        name: "cancel",
        description: "Cancel a timer",
        type: 1,
        options: [
          {
            name: "id",
            description: "Timer ID to cancel",
            type: 3,
            required: true,
          },
        ],
      },
      {
        name: "list",
        description: "List your active timers",
        type: 1,
      },
      {
        name: "stats",
        description: "View timer statistics",
        type: 1,
        options: [
          {
            name: "timeframe",
            description: "Time period (all/today/week)",
            type: 3,
            required: false,
            choices: [
              { name: "All time", value: "all" },
              { name: "Today", value: "today" },
              { name: "This week", value: "week" },
            ],
          },
          {
            name: "global",
            description: "Show global leaderboard",
            type: 5,
            required: false,
          },
        ],
      },
      {
        name: "reset",
        description: "Reset all timers (owner only)",
        type: 1,
      },
      {
        name: "authorize",
        description: "Authorize a user to reset timers (owner only)",
        type: 1,
        options: [
          {
            name: "user",
            description: "User to authorize",
            type: 6,
            required: true,
          },
        ],
      },
      {
        name: "revoke",
        description: "Revoke authorization (owner only)",
        type: 1,
        options: [
          {
            name: "user",
            description: "User to revoke",
            type: 6,
            required: true,
          },
        ],
      },
      {
        name: "allowedresetters",
        description: "List authorized resetters (owner only)",
        type: 1,
      },
    ],
  },
  {
    name: "pomodoro",
    description: "Manage Pomodoro sessions",
    options: [
      {
        name: "start",
        description: "Start a new Pomodoro session",
        type: 1,
        options: [
          {
            name: "work",
            description: "Work duration (e.g., 25m)",
            type: 3,
            required: true,
          },
          {
            name: "break",
            description: "Break duration (e.g., 5m)",
            type: 3,
            required: true,
          },
          {
            name: "cycles",
            description: "Number of cycles (1-100, default 4)",
            type: 4,
            required: false,
          },
          {
            name: "label",
            description: "Optional label for the session",
            type: 3,
            required: false,
          },
          {
            name: "participants",
            description: "Space-separated participant mentions",
            type: 3,
            required: false,
          },
          {
            name: "allow_dm",
            description: "Allow DM notifications",
            type: 5,
            required: false,
          },
        ],
      },
      {
        name: "stop",
        description: "Stop your active Pomodoro",
        type: 1,
        options: [
          {
            name: "id",
            description: "Pomodoro ID to stop",
            type: 3,
            required: true,
          },
        ],
      },
      {
        name: "status",
        description: "Check your active Pomodoro status",
        type: 1,
      },
      {
        name: "participants",
        description: "View Pomodoro participants",
        type: 1,
        options: [
          {
            name: "id",
            description: "Pomodoro ID",
            type: 3,
            required: true,
          },
        ],
      },
    ],
  },
];

async function deployCommands() {
  try {
    console.log("🔄 Deploying commands...");

    let route;
    if (guildId) {
      // Deploy to specific guild (faster for testing)
      route = Routes.applicationGuildCommands(clientId, guildId);
      console.log(`📍 Deploying to guild: ${guildId}`);
    } else {
      // Deploy globally (takes up to 1 hour to propagate)
      route = Routes.applicationCommands(clientId);
      console.log(`🌍 Deploying globally (may take up to 1 hour to propagate)`);
    }

    await rest.put(route, { body: timerCommands });

    console.log("✅ Commands deployed successfully!");
    console.log(`📊 Deployed ${timerCommands.length} command groups`);
  } catch (err) {
    console.error("❌ Error deploying commands:", err);
    process.exit(1);
  }
}

deployCommands();
