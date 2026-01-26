import {
  parseTime,
  formatDuration,
  parseParticipants,
  generateId,
} from "../utils.js";

const OWNER_ID = process.env.OWNER_ID;

/**
 * CommandHandler - Routes and processes all slash commands
 */
export class CommandHandler {
  constructor(client, timerManager, pomodoroManager) {
    this.client = client;
    this.timerManager = timerManager;
    this.pomodoroManager = pomodoroManager;
  }

  async handleCommand(interaction, globalState, timerManager, pomodoroManager) {
    const { commandName, options, member, guildId, user } = interaction;

    try {
      await interaction.deferReply({ ephemeral: false });
    } catch (err) {
      console.warn("Could not defer reply:", err);
    }

    switch (commandName) {
      case "timer":
        await this.handleTimerCommand(
          interaction,
          options,
          globalState,
          timerManager,
          pomodoroManager
        );
        break;
      case "pomodoro":
        await this.handlePomodoroCommand(
          interaction,
          options,
          globalState,
          timerManager,
          pomodoroManager
        );
        break;
      case "authorize":
        await this.handleAuthorize(
          interaction,
          options,
          guildId,
          pomodoroManager,
          globalState
        );
        break;
      case "revoke":
        await this.handleRevoke(
          interaction,
          options,
          guildId,
          pomodoroManager,
          globalState
        );
        break;
      case "allowedresetters":
        await this.handleListResetters(interaction, guildId, pomodoroManager);
        break;
      default:
        await this.reply(interaction, `Unknown command: ${commandName}`);
    }
  }

  async handleTimerCommand(
    interaction,
    options,
    globalState,
    timerManager,
    pomodoroManager
  ) {
    const subcommand = options.getSubcommand();
    const { guildId, user, member } = interaction;

    switch (subcommand) {
      case "start":
        await this.timerStart(interaction, options, timerManager, globalState);
        break;
      case "cancel":
        await this.timerCancel(interaction, options, timerManager, globalState);
        break;
      case "list":
        await this.timerList(interaction, timerManager, user);
        break;
      case "stats":
        await this.timerStats(interaction, options, timerManager);
        break;
      case "reset":
        await this.timerReset(
          interaction,
          guildId,
          pomodoroManager,
          timerManager,
          globalState
        );
        break;
      default:
        await this.reply(
          interaction,
          `Unknown timer subcommand: ${subcommand}`
        );
    }
  }

  async handlePomodoroCommand(
    interaction,
    options,
    globalState,
    timerManager,
    pomodoroManager
  ) {
    const subcommand = options.getSubcommand();
    const { guildId, user } = interaction;

    switch (subcommand) {
      case "start":
        await this.pomodoroStart(
          interaction,
          options,
          pomodoroManager,
          globalState
        );
        break;
      case "stop":
        await this.pomodoroStop(
          interaction,
          options,
          pomodoroManager,
          globalState
        );
        break;
      case "status":
        await this.pomodoroStatus(interaction, pomodoroManager, user);
        break;
      case "participants":
        await this.pomodoroParticipants(interaction, options, pomodoroManager);
        break;
      default:
        await this.reply(
          interaction,
          `Unknown pomodoro subcommand: ${subcommand}`
        );
    }
  }

  async timerStart(interaction, options, timerManager, globalState) {
    const timeStr = options.getString("time");
    const label = options.getString("label") || "";
    const allowDM = options.getBoolean("allow_dm") || false;
    const participantsStr = options.getString("participants") || "";

    const duration = parseTime(timeStr);
    if (!duration || duration <= 0) {
      await this.reply(
        interaction,
        `❌ Invalid time format. Use: 10s, 5m, 1h, 1:30, 1h30m, etc.`
      );
      return;
    }

    const participants = parseParticipants(participantsStr);
    const id = generateId();

    const timer = timerManager.createTimer({
      id,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      duration,
      label,
      participants,
      allowDM,
    });

    // Set message ID for updates
    const msg = await this.reply(
      interaction,
      `⏱️ Timer started: ${label || "Unnamed"} (${formatDuration(duration)})`
    );
    if (msg && msg.id) {
      timerManager.setMessageId(id, msg.id);
    }

    // Schedule timer completion
    setTimeout(async () => {
      try {
        const timer = timerManager.completeTimer(id);
        if (timer) {
          try {
            const channel = await this.client.channels.fetch(timer.channelId);
            if (channel && channel.isTextBased) {
              const participantsText = timer.participants
                ? [...timer.participants].map((uid) => `<@${uid}>`).join(" ")
                : "";
              const msg = `✅ Timer "${
                timer.label || "Unnamed"
              }" completed! ${participantsText}`;
              await channel.send(msg).catch(() => null);
            }
          } catch (err) {
            console.warn(`Could not send timer completion message:`, err);
          }
          globalState.timers = timerManager.serialize();
          globalState.totals = timerManager.serializeTotals();
        }
      } catch (err) {
        console.error("Error in timer completion:", err);
      }
    }, duration);

    // Update global state
    globalState.timers = timerManager.serialize();
  }

  async timerCancel(interaction, options, timerManager, globalState) {
    const id = options.getString("id");
    const timer = timerManager.getTimer(id);

    if (!timer) {
      await this.reply(interaction, `❌ Timer ${id} not found`);
      return;
    }

    const isOwner = timer.userId === interaction.user.id;
    const isAuthorized =
      interaction.user.id === OWNER_ID ||
      (await this.isAuthorized(interaction.guildId, interaction.user.id));

    if (!isOwner && !isAuthorized) {
      await this.reply(
        interaction,
        `❌ You don't have permission to cancel this timer`
      );
      return;
    }

    timerManager.cancelTimer(id);
    await this.reply(
      interaction,
      `✅ Timer ${id} cancelled (${formatDuration(timer.duration)})`
    );

    globalState.timers = timerManager.serialize();
  }

  async timerList(interaction, timerManager, user) {
    const timers = timerManager.getTimersByUser(user.id);

    if (timers.length === 0) {
      await this.reply(interaction, `📋 You have no active timers`);
      return;
    }

    let msg = `📋 Your active timers:\n`;
    for (const timer of timers) {
      const remaining = timerManager.getTimeRemaining(timer.id);
      const label = timer.label || "Unnamed";
      msg += `- **${timer.id}**: ${label} (${formatDuration(
        remaining
      )} left)\n`;
    }

    await this.reply(interaction, msg);
  }

  async timerStats(interaction, options, timerManager) {
    const timeframe = options.getString("timeframe") || "all";
    const global = options.getBoolean("global") || false;

    if (global) {
      // Leaderboard
      const leaderboard = timerManager.getLeaderboard(10);
      if (leaderboard.length === 0) {
        await this.reply(interaction, `📊 No stats yet`);
        return;
      }

      let msg = `📊 Leaderboard (Top 10):\n`;
      for (let i = 0; i < leaderboard.length; i++) {
        const { userId, total } = leaderboard[i];
        msg += `${i + 1}. <@${userId}>: ${formatDuration(total)}\n`;
      }

      await this.reply(interaction, msg);
    } else {
      // User stats
      const total = timerManager.getTotal(interaction.user.id);
      await this.reply(
        interaction,
        `📊 Your completed time: **${formatDuration(total)}**`
      );
    }
  }

  async timerReset(
    interaction,
    guildId,
    pomodoroManager,
    timerManager,
    globalState
  ) {
    const isOwner = interaction.user.id === OWNER_ID;
    const isAuthorized = await this.isAuthorized(
      guildId,
      interaction.user.id,
      pomodoroManager
    );

    if (!isOwner && !isAuthorized) {
      await this.reply(
        interaction,
        `❌ You don't have permission to reset timers`
      );
      return;
    }

    timerManager.timers.clear();
    pomodoroManager.pomodoros.clear();
    timerManager.resetTotals();

    globalState.timers = {};
    globalState.pomodoros = {};
    globalState.totals = {};
    globalState.history = [];

    await this.reply(
      interaction,
      `✅ All timers and pomodoros have been reset`
    );
  }

  async handleAuthorize(
    interaction,
    options,
    guildId,
    pomodoroManager,
    globalState
  ) {
    const isOwner = interaction.user.id === OWNER_ID;
    if (!isOwner) {
      await this.reply(
        interaction,
        `❌ Only the owner can authorize resetters`
      );
      return;
    }

    const userToAdd = options.getUser("user");
    pomodoroManager.addAuthorizedResetter(guildId, userToAdd.id);
    globalState.allowedResetters =
      pomodoroManager.serializeAuthorizedResetters();
    await this.reply(
      interaction,
      `✅ <@${userToAdd.id}> is now authorized to reset timers`
    );
  }

  async handleRevoke(
    interaction,
    options,
    guildId,
    pomodoroManager,
    globalState
  ) {
    const isOwner = interaction.user.id === OWNER_ID;
    if (!isOwner) {
      await this.reply(
        interaction,
        `❌ Only the owner can revoke authorization`
      );
      return;
    }

    const userToRemove = options.getUser("user");
    pomodoroManager.removeAuthorizedResetter(guildId, userToRemove.id);
    globalState.allowedResetters =
      pomodoroManager.serializeAuthorizedResetters();
    await this.reply(
      interaction,
      `✅ <@${userToRemove.id}> is no longer authorized`
    );
  }

  async handleListResetters(interaction, guildId, pomodoroManager) {
    const isOwner = interaction.user.id === OWNER_ID;
    if (!isOwner) {
      await this.reply(interaction, `❌ Only the owner can list resetters`);
      return;
    }

    const authorized = pomodoroManager.getAuthorizedResetters(guildId);
    if (authorized.length === 0) {
      await this.reply(
        interaction,
        `📋 No authorized resetters for this guild`
      );
    } else {
      const msg = `📋 Authorized resetters:\n${authorized
        .map((id) => `- <@${id}>`)
        .join("\n")}`;
      await this.reply(interaction, msg);
    }
  }

  async handlePomodoroAdvance(id, pomodoroManager, globalState) {
    try {
      const result = pomodoroManager.advancePomodoro(id);
      if (!result) return;

      const pomodoro = result.completed ? result.pomodoro : result.pomodoro;
      const participantsText = pomodoro.participants
        ? [...pomodoro.participants].map((uid) => `<@${uid}>`).join(" ")
        : "";

      try {
        const channel = await this.client.channels.fetch(pomodoro.channelId);
        if (channel && channel.isTextBased) {
          if (result.completed) {
            // Pomodoro session completed
            const msg = `🎉 Pomodoro "${
              pomodoro.label || "Unnamed"
            }" completed! ${participantsText}`;
            await channel.send(msg).catch(() => null);
          } else {
            // State changed (work -> break or break -> work)
            if (pomodoro.state === "break") {
              await channel
                .send(
                  `⏰ Break time! ${formatDuration(
                    pomodoro.breakDuration
                  )} break starting now. ${participantsText}`
                )
                .catch(() => null);
            } else {
              const cycle = pomodoro.currentCycle + 1;
              await channel
                .send(
                  `🟢 Cycle ${cycle}/${
                    pomodoro.totalCycles
                  }: Work time! ${formatDuration(
                    pomodoro.workDuration
                  )} starting now. ${participantsText}`
                )
                .catch(() => null);
            }

            // Schedule next transition
            const nextDuration =
              pomodoro.state === "work"
                ? pomodoro.workDuration
                : pomodoro.breakDuration;
            setTimeout(() => {
              this.handlePomodoroAdvance(id, pomodoroManager, globalState);
            }, nextDuration);
          }
        }
      } catch (err) {
        console.warn(`Could not send pomodoro message:`, err);
      }

      globalState.pomodoros = pomodoroManager.serialize();
    } catch (err) {
      console.error("Error advancing pomodoro:", err);
    }
  }

  async pomodoroStart(interaction, options, pomodoroManager, globalState) {
    const workStr = options.getString("work");
    const breakStr = options.getString("break");
    const cycles = options.getInteger("cycles") || 4;
    const label = options.getString("label") || "";
    const allowDM = options.getBoolean("allow_dm") || false;
    const participantsStr = options.getString("participants") || "";

    const workDuration = parseTime(workStr);
    const breakDuration = parseTime(breakStr);

    if (!workDuration || workDuration <= 0) {
      await this.reply(interaction, `❌ Invalid work time format`);
      return;
    }

    if (!breakDuration || breakDuration <= 0) {
      await this.reply(interaction, `❌ Invalid break time format`);
      return;
    }

    if (cycles < 1 || cycles > 100) {
      await this.reply(interaction, `❌ Cycles must be between 1 and 100`);
      return;
    }

    const participants = parseParticipants(participantsStr);
    const id = generateId();

    const pomodoro = pomodoroManager.createPomodoro({
      id,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      workDuration,
      breakDuration,
      cycles,
      label,
      participants,
      allowDM,
    });

    const msg = await this.reply(
      interaction,
      `🍅 Pomodoro started: ${label || "Unnamed"} (${cycles} cycles)`
    );
    if (msg && msg.id) {
      pomodoroManager.setMessageId(id, msg.id);
    }

    // Schedule first transition
    setTimeout(async () => {
      await this.handlePomodoroAdvance(id, pomodoroManager, globalState);
    }, workDuration);

    globalState.pomodoros = pomodoroManager.serialize();
  }

  async pomodoroStop(interaction, options, pomodoroManager, globalState) {
    const id = options.getString("id");
    const pomodoro = pomodoroManager.getPomodoro(id);

    if (!pomodoro) {
      await this.reply(interaction, `❌ Pomodoro ${id} not found`);
      return;
    }

    const isOwner = pomodoro.userId === interaction.user.id;
    const isAuthorized =
      interaction.user.id === OWNER_ID ||
      (await this.isAuthorized(interaction.guildId, interaction.user.id));

    if (!isOwner && !isAuthorized) {
      await this.reply(
        interaction,
        `❌ You don't have permission to stop this pomodoro`
      );
      return;
    }

    pomodoroManager.cancelPomodoro(id);
    await this.reply(interaction, `✅ Pomodoro ${id} stopped`);

    globalState.pomodoros = pomodoroManager.serialize();
  }

  async pomodoroStatus(interaction, pomodoroManager, user) {
    const pomodoro = pomodoroManager.getActivePomodoroByUser(user.id);

    if (!pomodoro) {
      await this.reply(interaction, `❌ You have no active pomodoro`);
      return;
    }

    const status = pomodoroManager.getStatus(pomodoro.id);
    const stateEmoji = status.state === "work" ? "🟢" : "⏰";

    await this.reply(
      interaction,
      `${stateEmoji} **${pomodoro.label || "Pomodoro"}**\nCycle: ${
        status.cycle
      }/${status.totalCycles}\nTime left: ${formatDuration(
        status.timeRemaining
      )}\nTotal time left: ${formatDuration(status.totalTimeRemaining)}`
    );
  }

  async pomodoroParticipants(interaction, options, pomodoroManager) {
    const id = options.getString("id");
    const pomodoro = pomodoroManager.getPomodoro(id);

    if (!pomodoro) {
      await this.reply(interaction, `❌ Pomodoro ${id} not found`);
      return;
    }

    const participants = Array.from(pomodoro.participants);
    const msg = `👥 Participants:\n${participants
      .map((id) => `- <@${id}>`)
      .join("\n")}`;

    await this.reply(interaction, msg);
  }

  async isAuthorized(guildId, userId, pomodoroManager) {
    if (!guildId || !pomodoroManager) return false;
    return pomodoroManager.isAuthorizedResetter(guildId, userId);
  }

  async reply(interaction, content) {
    try {
      const options = typeof content === "string" ? { content } : content;

      if (interaction.replied || interaction.deferred) {
        return await interaction.editReply(options);
      } else {
        return await interaction.reply(options);
      }
    } catch (err) {
      console.error("Error replying:", err);
      return null;
    }
  }
}
