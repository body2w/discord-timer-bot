import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Collection,
  PermissionFlagsBits,
} from "discord.js";
import { loadState, saveState } from "./storage.js";
import { TimerManager } from "./lib/timer-manager.js";
import { PomodoroManager } from "./lib/pomodoro-manager.js";
import { CommandHandler } from "./lib/command-handler.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// State Management
const timerManager = new TimerManager();
const pomodoroManager = new PomodoroManager();
const commandHandler = new CommandHandler(
  client,
  timerManager,
  pomodoroManager
);

// Storage
let globalState = {
  timers: {},
  pomodoros: {},
  totals: {},
  history: [],
  allowedResetters: {},
};

// Save state periodically
setInterval(async () => {
  try {
    await saveState(globalState);
  } catch (err) {
    console.error("Error saving state:", err);
  }
}, 60000); // Save every 60 seconds

// Load state on startup
async function loadAndRestoreState() {
  try {
    const state = await loadState();
    globalState = state;

    // Restore timers
    for (const [id, timerData] of Object.entries(state.timers || {})) {
      timerManager.restoreTimer(id, timerData, client);
    }

    // Restore pomodoros
    for (const [id, pomoData] of Object.entries(state.pomodoros || {})) {
      pomodoroManager.restorePomodoro(id, pomoData, client);
    }

    // Restore totals
    for (const [userId, total] of Object.entries(state.totals || {})) {
      timerManager.setTotal(userId, total);
    }

    // Restore allowed resetters
    for (const [guildId, userIds] of Object.entries(
      state.allowedResetters || {}
    )) {
      for (const userId of userIds) {
        pomodoroManager.addAuthorizedResetter(guildId, userId);
      }
    }

    console.log("State restored successfully");
  } catch (err) {
    console.error("Error loading state:", err);
  }
}

// Event: Ready
client.on("ready", async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  await loadAndRestoreState();
});

// Event: Interaction (slash commands)
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  try {
    await commandHandler.handleCommand(
      interaction,
      globalState,
      timerManager,
      pomodoroManager
    );
  } catch (err) {
    console.error("Error handling command:", err);
    try {
      const reply =
        "❌ An error occurred while processing your command. Please try again.";
      if (interaction.replied) {
        await interaction.followUp({ content: reply, ephemeral: true });
      } else {
        await interaction.reply({ content: reply, ephemeral: true });
      }
    } catch (replyErr) {
      console.error("Error sending error reply:", replyErr);
    }
  }
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  try {
    await saveState(globalState);
    await client.destroy();
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown:", err);
    process.exit(1);
  }
});

// Login
const token = process.env.TOKEN;
if (!token) {
  console.error("❌ DISCORD_TOKEN not found in .env file");
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("❌ Failed to login:", err);
  process.exit(1);
});

export { client, timerManager, pomodoroManager, globalState };
