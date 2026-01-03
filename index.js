import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from "discord.js";
import { loadState, saveState } from "./storage.js";
import { parseTime, formatDuration } from "./utils.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const timers = new Map();
const totals = new Map();
const pomodoros = new Map();
const history = [];
const REQUIRED_PERMS = 67584n;

function canSendInChannel(channel) {
  try {
    if (!channel || !channel.permissionsFor) return false;
    const perms = channel.permissionsFor(client.user);
    if (!perms) return false;
    // Prefer the readable .has API when available
    if (typeof perms.has === "function") {
      return perms.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ]);
    }
    // Fallback to bitmask comparison
    return (BigInt(perms.bitfield) & REQUIRED_PERMS) === REQUIRED_PERMS;
  } catch (e) {
    return false;
  }
}

// Ephemeral reply flag (use 64 instead of deprecated `ephemeral: true`)
const EPHEMERAL = 1 << 6;

// Cache-first channel fetch helper to avoid unnecessary REST calls which can
// fail with Missing Access (50001) if the bot later loses permissions.
async function getChannel(channelId) {
  const cached = client.channels.cache.get(channelId);
  if (cached) return cached;
  try {
    return await client.channels.fetch(channelId);
  } catch (e) {
    if (e && e.code === 50001) {
      console.warn(
        `Missing Access to channel ${channelId}. Will fallback to DM if allowed.`
      );
    } else {
      console.warn(`Could not fetch channel ${channelId}:`, e);
    }
    return null;
  }
}

function addHistory(entry) {
  // entry fields: id, userId, channelId, duration, label, type, endedAt, canceled
  history.push(entry);
  // cap history to last 2000 entries
  if (history.length > 2000) history.splice(0, history.length - 2000);
}

// Try to edit an existing message in-channel or send a new message. If the
// channel is unavailable or we lack access, optionally fallback to DM when
// allowDM is true. Returns { channel: boolean, dm: boolean } indicating which
// channel the message was delivered to.
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID || null;
const OWNER_ID = process.env.OWNER_ID || null;

async function sendNotification({
  channelId,
  messageId,
  userId,
  content,
  components = [],
  allowDM = false,
}) {
  // Try channel first
  const channel = await getChannel(channelId);
  if (channel && channel.isTextBased && canSendInChannel(channel)) {
    try {
      if (messageId) {
        const orig = await channel.messages.fetch(messageId).catch(() => null);
        if (orig) {
          await orig.edit({ content, components });
          return { channel: true, dm: false };
        }
      }
      await channel.send({ content, components });
      return { channel: true, dm: false };
    } catch (err) {
      console.warn(`Channel send/edit failed for ${channelId}:`, err);
      // fall through to DM fallback
    }
  }

  // DM fallback
  if (allowDM && userId) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(content);
      return { channel: false, dm: true };
    } catch (err) {
      console.error(`DM fallback failed for ${userId}:`, err);
      // fall through to reporting
    }
  }

  // Report to admin channel or owner if configured
  try {
    const adminId = ADMIN_CHANNEL_ID || OWNER_ID;
    if (adminId) {
      const adminChannel = ADMIN_CHANNEL_ID
        ? await getChannel(ADMIN_CHANNEL_ID)
        : null;
      const guildInfo =
        (client.channels.cache.get(channelId) || {}).guild || null;
      const guildText = guildInfo ? `in guild ${guildInfo.id}` : "";
      const report = `⚠️ Could not deliver message for user ${userId} to channel ${channelId} ${guildText}. DM fallback ${
        allowDM ? "was allowed" : "not allowed"
      }.`;

      if (
        adminChannel &&
        adminChannel.isTextBased &&
        canSendInChannel(adminChannel)
      ) {
        await adminChannel.send(report).catch(() => null);
      } else if (OWNER_ID) {
        const owner = await client.users.fetch(OWNER_ID).catch(() => null);
        if (owner) await owner.send(report).catch(() => null);
      }
    }
  } catch (err) {
    console.warn("Failed to report delivery issue to admin/owner:", err);
  }

  return { channel: false, dm: false };
}

async function safeReply(interaction, options) {
  // options can be a string or an object
  try {
    return await interaction.reply(options);
  } catch (err) {
    // Unknown interaction (10062) — try followUp, then DM the user as last resort
    if (err && err.code === 10062) {
      try {
        return await interaction.followUp(
          typeof options === "string" ? { content: options } : options
        );
      } catch (err2) {
        try {
          const user = await client.users.fetch(interaction.user.id);
          await user.send(
            typeof options === "string" ? options : options.content
          );
          return;
        } catch (err3) {
          console.warn("Failed to fallback-deliver reply:", err3);
          throw err;
        }
      }
    }

    throw err;
  }
}

async function persist() {
  const plainTimers = {};
  for (const [id, t] of timers.entries()) {
    plainTimers[id] = {
      userId: t.userId,
      endTime: t.endTime,
      channelId: t.channelId,
      messageId: t.messageId,
      duration: t.duration,
      label: t.label || null,
      allowDM: !!t.allowDM,
    };
  }
  const plainTotals = {};
  for (const [uid, ms] of totals.entries()) plainTotals[uid] = ms;
  const plainPomos = {};
  for (const [id, p] of pomodoros.entries()) {
    plainPomos[id] = {
      userId: p.userId,
      channelId: p.channelId,
      messageId: p.messageId,
      state: p.state,
      currentCycle: p.currentCycle,
      totalCycles: p.totalCycles,
      workDuration: p.workDuration,
      breakDuration: p.breakDuration,
      endsAt: p.endsAt,
      label: p.label || null,
    };
  }
  await saveState({
    timers: plainTimers,
    totals: plainTotals,
    pomodoros: plainPomos,
    history: history.slice(),
  });
}

function computePomodoroTotals(p) {
  const now = Date.now();
  const remainingMs = Math.max(0, p.endsAt - now);
  let totalRemaining = remainingMs;
  let curState = p.state;
  let curCycle = p.currentCycle;
  while (curCycle < p.totalCycles) {
    if (curState === "work") {
      // after work ends there's a break
      totalRemaining += p.breakDuration;
      curState = "break";
    } else {
      // after break ends there's a work session, which completes a cycle
      totalRemaining += p.workDuration;
      curState = "work";
      curCycle += 1;
    }
  }
  return { remainingMs, totalRemaining };
}

async function handlePomodoroTick(id) {
  const p = pomodoros.get(id);
  if (!p) return;
  const now = Date.now();

  const labelPrefix = p.label ? `${p.label} - ` : "";

  if (p.state === "work") {
    // Work finished -> increment totals and start break
    totals.set(p.userId, (totals.get(p.userId) || 0) + p.workDuration);

    // Record history for the work session
    addHistory({
      id: `${id}_work_${(p.currentCycle || 0) + 1}`,
      userId: p.userId,
      channelId: p.channelId,
      duration: p.workDuration,
      label: p.label || null,
      type: "pomodoro_work",
      endedAt: now,
      canceled: false,
    });

    p.state = "break";
    p.endsAt = now + p.breakDuration;

    // compute cycle and total remaining
    const { remainingMs: cycleRemaining, totalRemaining } =
      computePomodoroTotals(p);

    try {
      const res = await sendNotification({
        channelId: p.channelId,
        messageId: p.messageId,
        userId: p.userId,
        content: `⏰ ${labelPrefix}<@${
          p.userId
        }>, work session complete. Break started — ${formatDuration(
          p.breakDuration
        )}. Cycle time left: ${formatDuration(
          cycleRemaining
        )} • Total time left: ${formatDuration(totalRemaining)}.`,
        components: p.messageId ? undefined : p.messageId?.components || [],
        allowDM: !!p.allowDM,
      });
      if (!res.channel && !res.dm && !p.allowDM) {
        console.warn(
          `Channel unavailable for pomodoro ${id} and DM fallback not allowed.`
        );
      }
    } catch (err) {
      console.warn("Failed to notify users on pomodoro work->break:", err);
    }

    clearTimeout(p.timeout);
    p.timeout = setTimeout(async () => {
      try {
        await handlePomodoroTick(id);
      } catch (err) {
        console.error("Pomodoro tick error:", err);
      }
    }, p.breakDuration);

    await persist();
    return;
  }

  if (p.state === "break") {
    // Break finished -> complete cycle
    p.currentCycle = (p.currentCycle || 0) + 1;

    if (p.currentCycle >= p.totalCycles) {
      // Complete pomodoro
      try {
        const channel = await getChannel(p.channelId);
        if (channel && channel.isTextBased && canSendInChannel(channel)) {
          const msg = p.messageId
            ? await channel.messages.fetch(p.messageId).catch(() => null)
            : null;
          if (msg)
            await msg.edit({
              content: `✅ ${labelPrefix}<@${p.userId}>, pomodoro completed! (${p.totalCycles} cycles)`,
              components: [],
            });
          else
            await channel.send(
              `✅ ${labelPrefix}<@${p.userId}>, pomodoro completed! (${p.totalCycles} cycles)`
            );
        } else {
          if (p.allowDM) {
            const user = await client.users.fetch(p.userId);
            await user.send(
              `✅ ${labelPrefix}Your pomodoro completed! (${p.totalCycles} cycles)`
            );
          } else {
            console.warn(
              `Channel unavailable for pomodoro ${id} completion and DM fallback not allowed.`
            );
          }
        }
      } catch (err) {
        console.warn("Failed to notify users on pomodoro completion:", err);
      }

      clearTimeout(p.timeout);
      pomodoros.delete(id);
      await persist();
      return;
    }

    // Start next work session
    p.state = "work";
    const cycle = p.currentCycle + 1;
    p.endsAt = now + p.workDuration;

    // compute cycle and total remaining
    const { remainingMs: cycleRemaining, totalRemaining } =
      computePomodoroTotals(p);

    try {
      const channel = await getChannel(p.channelId);
      if (channel && channel.isTextBased && canSendInChannel(channel)) {
        const msg = p.messageId
          ? await channel.messages.fetch(p.messageId).catch(() => null)
          : null;
        if (msg)
          await msg.edit({
            content: `🟢 ${labelPrefix}Cycle ${cycle}/${
              p.totalCycles
            } — Work started (${formatDuration(
              p.workDuration
            )}) • Cycle time left: ${formatDuration(
              cycleRemaining
            )} • Total time left: ${formatDuration(totalRemaining)}`,
            components: msg.components,
          });
        else
          await channel.send(
            `🟢 ${labelPrefix}Cycle ${cycle}/${
              p.totalCycles
            } — Work started (${formatDuration(
              p.workDuration
            )}) • Cycle time left: ${formatDuration(
              cycleRemaining
            )} • Total time left: ${formatDuration(totalRemaining)}`
          );
      } else {
        if (p.allowDM) {
          const user = await client.users.fetch(p.userId);
          await user.send(
            `🟢 ${labelPrefix}Cycle ${cycle}/${
              p.totalCycles
            } — Work started (${formatDuration(
              p.workDuration
            )}) • Cycle time left: ${formatDuration(
              cycleRemaining
            )} • Total time left: ${formatDuration(totalRemaining)}`
          );
        } else {
          console.warn(
            `Channel unavailable for pomodoro ${id} and DM fallback not allowed.`
          );
        }
      }
    } catch (err) {
      console.warn("Failed to notify users on pomodoro next work:", err);
    }

    clearTimeout(p.timeout);
    p.timeout = setTimeout(async () => {
      try {
        await handlePomodoroTick(id);
      } catch (err) {
        console.error("Pomodoro tick error:", err);
      }
    }, p.workDuration);

    await persist();
    return;
  }
}

client.once("clientReady", async () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);

  // Load persisted state and reschedule timers
  try {
    const state = await loadState();
    // Restore totals
    for (const [uid, ms] of Object.entries(state.totals || {}))
      totals.set(uid, ms);

    // Restore history (cap to last 2000 entries)
    for (const h of state.history || []) history.push(h);
    if (history.length > 2000) history.splice(0, history.length - 2000);

    const now = Date.now();
    for (const [id, t] of Object.entries(state.timers || {})) {
      const remaining = t.endTime - now;
      if (remaining <= 0) {
        // Timer expired while offline — try to send message in channel, else DM
        try {
          const channel = await getChannel(t.channelId);
          // Use sendNotification helper for offline-expired timers
          const res = await sendNotification({
            channelId: t.channelId,
            messageId: t.messageId,
            userId: t.userId,
            content: `⏰ <@${t.userId}>, your timer (${formatDuration(
              t.duration
            )}) ended while I was offline.`,
            components: [],
            allowDM: !!t.allowDM,
          });

          addHistory({
            id,
            userId: t.userId,
            channelId: t.channelId,
            duration: t.duration,
            label: t.label || null,
            type: "timer",
            endedAt: now,
            canceled: false,
          });
          await persist();

          if (res.channel) continue;
          if (res.dm) continue;
          // otherwise fall through (log already handled in sendNotification)
        } catch (err) {
          console.warn(
            `Could not notify user ${t.userId} for expired timer ${id}:`,
            err
          );
        }
        // Fallback DM (only if allowed)
        // If sendNotification above didn't deliver, attempt DM fallback explicitly
        if (t.allowDM) {
          try {
            const user = await client.users.fetch(t.userId);
            await user.send(
              `⏰ Your timer (${formatDuration(
                t.duration
              )}) ended while I was offline.`
            );
            // history/persist already saved above
          } catch (err) {
            console.error(
              `Failed to DM user ${t.userId} for expired timer ${id}:`,
              err
            );
          }
        } else {
          console.warn(
            `Timer ${id} expired while offline but DM fallback not allowed.`
          );
        }
      } else {
        // Recreate timeout
        const timeout = setTimeout(async () => {
          try {
            const channel = await getChannel(t.channelId);
            if (channel && channel.isTextBased && canSendInChannel(channel)) {
              if (t.messageId) {
                const orig = await channel.messages
                  .fetch(t.messageId)
                  .catch(() => null);
                if (orig) {
                  await orig.edit({
                    content: `⏰ <@${t.userId}>, your timer (${
                      t.label ? `${t.label} - ` : ""
                    }${formatDuration(t.duration)}) ended!`,
                    components: [],
                  });
                } else {
                  await channel.send(
                    `⏰ <@${t.userId}>, your timer (${
                      t.label ? `${t.label} - ` : ""
                    }${formatDuration(t.duration)}) ended!`
                  );
                }
              } else {
                await channel.send(
                  `⏰ <@${t.userId}>, your timer (${
                    t.label ? `${t.label} - ` : ""
                  }${formatDuration(t.duration)}) ended!`
                );
              }
            } else {
              if (t.allowDM) {
                const user = await client.users.fetch(t.userId);
                await user.send(
                  `⏰ Your timer (${
                    t.label ? `${t.label} - ` : ""
                  }${formatDuration(t.duration)}) ended!`
                );
              } else {
                console.warn(
                  `Channel unavailable for restored timer ${id} and DM fallback not allowed.`
                );
              }
            }
          } catch (err) {
            console.error("Failed to fire restored timer:", err);
          } finally {
            timers.delete(id);
            await persist();
          }
        }, remaining);
        timers.set(id, {
          userId: t.userId,
          timeout,
          endTime: t.endTime,
          channelId: t.channelId,
          messageId: t.messageId,
          duration: t.duration,
          label: t.label,
          allowDM: !!t.allowDM,
        });
      }
    }

    // Restore pomodoros
    for (const [id, p] of Object.entries(state.pomodoros || {})) {
      const remaining = (p.endsAt || 0) - now;
      const labelPrefix = p.label ? `${p.label} - ` : "";
      if (remaining <= 0) {
        // If the session ended while offline, attempt to notify user and mark progressed
        try {
          const channel = await getChannel(p.channelId);
          if (channel && channel.isTextBased && canSendInChannel(channel)) {
            if (p.messageId) {
              const orig = await channel.messages
                .fetch(p.messageId)
                .catch(() => null);
              if (orig) {
                await orig.edit({
                  content: `⏰ <@${p.userId}>, your pomodoro session ${labelPrefix} progressed while I was offline.`,
                  components: [],
                });
                continue;
              }
            }
            await channel.send(
              `⏰ <@${p.userId}>, your pomodoro session ${labelPrefix} progressed while I was offline.`
            );
            continue;
          }
        } catch (err) {
          console.warn(
            `Could not notify user ${p.userId} for pomodoro ${id}:`,
            err
          );
        }
        // Fallback DM
        try {
          const user = await client.users.fetch(p.userId);
          await user.send(
            `⏰ Your pomodoro session ${labelPrefix}progressed while I was offline.`
          );
        } catch (err) {
          console.error(
            `Failed to DM user ${p.userId} for pomodoro ${id}:`,
            err
          );
        }
      } else {
        // Recreate timeout and restore state
        const timeout = setTimeout(async () => {
          try {
            await handlePomodoroTick(id);
          } catch (err) {
            console.error("Failed to handle restored pomodoro tick:", err);
          }
        }, remaining);
        pomodoros.set(id, {
          userId: p.userId,
          timeout,
          channelId: p.channelId,
          messageId: p.messageId,
          state: p.state,
          currentCycle: p.currentCycle,
          totalCycles: p.totalCycles,
          workDuration: p.workDuration,
          breakDuration: p.breakDuration,
          endsAt: p.endsAt,
          label: p.label,
        });
      }
    }

    console.log(
      `Restored ${timers.size} timers and ${totals.size} user totals`
    );
  } catch (err) {
    console.error("Failed to restore timers from storage:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  // Handle buttons
  if (interaction.isButton()) {
    // Timer cancel button
    if (interaction.customId.startsWith("cancel_")) {
      const id = interaction.customId.split("_")[1];
      const timer = timers.get(id);
      if (!timer || timer.userId !== interaction.user.id)
        return safeReply(interaction, {
          content: "❌ Timer not found or not yours",
          flags: EPHEMERAL,
        });
      clearTimeout(timer.timeout);
      addHistory({
        id,
        userId: timer.userId,
        channelId: timer.channelId,
        duration: timer.duration,
        label: timer.label || null,
        type: "timer",
        endedAt: Date.now(),
        canceled: true,
      });
      timers.delete(id);

      // Try to edit the original message to mark canceled
      try {
        const channel = await getChannel(timer.channelId);
        if (channel && timer.messageId) {
          const msg = await channel.messages
            .fetch(timer.messageId)
            .catch(() => null);
          if (msg)
            await msg.edit({
              content: `🛑 Timer ${id} canceled by <@${interaction.user.id}>`,
              components: [],
            });
        }
      } catch (err) {
        console.warn(
          `Failed to edit original message for canceled timer ${id}:`,
          err
        );
      }

      await persist();
      return interaction.update({
        content: `🛑 Timer ${id} canceled`,
        components: [],
      });
    }

    // Pomodoro stop button
    if (interaction.customId.startsWith("pomodoro_stop_")) {
      const id = interaction.customId.split("_")[2];
      const p = pomodoros.get(id);
      if (!p || p.userId !== interaction.user.id)
        return safeReply(interaction, {
          content: "❌ Pomodoro not found or not yours",
          flags: EPHEMERAL,
        });
      clearTimeout(p.timeout);

      addHistory({
        id,
        userId: p.userId,
        channelId: p.channelId,
        duration: 0,
        label: p.label || null,
        type: "pomodoro",
        endedAt: Date.now(),
        canceled: true,
      });

      pomodoros.delete(id);

      try {
        const channel = await getChannel(p.channelId);
        if (channel && p.messageId) {
          const msg = await channel.messages
            .fetch(p.messageId)
            .catch(() => null);
          if (msg)
            await msg.edit({
              content: `🛑 Pomodoro ${id} stopped by <@${interaction.user.id}>`,
              components: [],
            });
        }
      } catch (err) {
        console.warn(
          `Failed to edit original message for stopped pomodoro ${id}:`,
          err
        );
      }

      await persist();
      return interaction.update({
        content: `🛑 Pomodoro ${id} stopped`,
        components: [],
      });
    }

    return;
  }

  if (!interaction.isChatInputCommand() || interaction.commandName !== "timer")
    return;
  const group = interaction.options.getSubcommandGroup?.();
  const sub = interaction.options.getSubcommand();

  if (group === "pomodoro") {
    const ps = sub; // start|stop|status
    if (ps === "start") {
      const workStr = interaction.options.getString("work") || "25m";
      const breakStr = interaction.options.getString("break") || "5m";
      const cycles = interaction.options.getInteger("cycles") || 4;
      const label = interaction.options.getString("label");

      const workDuration = parseTime(workStr);
      const breakDuration = parseTime(breakStr);
      const allowDM = !!interaction.options.getBoolean("allow_dm");
      if (
        !workDuration ||
        !breakDuration ||
        !Number.isInteger(cycles) ||
        cycles <= 0
      )
        return safeReply(interaction, {
          content:
            "❌ Invalid pomodoro options. Use valid durations and cycles > 0.",
          flags: EPHEMERAL,
        });

      // Check channel permissions: require SendMessages/ViewChannel unless allowDM
      let channelAccessible = false;
      let channelObj = null;
      try {
        channelObj = await getChannel(interaction.channelId);
      } catch (err) {
        channelObj = null;
      }

      if (channelObj && channelObj.isTextBased && channelObj.isTextBased()) {
        const botMember = interaction.guild?.members?.me;
        if (!interaction.guild || !botMember) channelAccessible = true;
        else {
          const perms = channelObj.permissionsFor(botMember);
          if (perms && typeof perms.has === "function") {
            if (
              perms.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
              ])
            )
              channelAccessible = true;
          } else if (
            perms &&
            (BigInt(perms.bitfield) & REQUIRED_PERMS) === REQUIRED_PERMS
          ) {
            channelAccessible = true;
          }
        }
      }

      if (!channelAccessible && !allowDM) {
        return safeReply(interaction, {
          content:
            "❌ I don't have permission to send messages in this channel. Either grant me Send Messages/View Channel permissions or set `allow_dm=true` to allow DM fallback.",
          flags: EPHEMERAL,
        });
      }

      await interaction.deferReply();

      const id = Date.now().toString(36);
      const channelId = interaction.channelId;
      const userId = interaction.user.id;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`pomodoro_stop_${id}`)
          .setLabel("Stop Pomodoro")
          .setStyle(ButtonStyle.Danger)
      );

      const now = Date.now();
      const endsAt = now + workDuration;

      const totalRemaining = cycles * (workDuration + breakDuration);

      // create message
      const follow = await interaction.followUp({
        content: `🟢 Pomodoro started ${
          label ? `— ${label} ` : ""
        }• Work: ${formatDuration(workDuration)} • Break: ${formatDuration(
          breakDuration
        )} • Cycles: ${cycles} \nCycle 1/${cycles} — Work (${formatDuration(
          workDuration
        )}) • Cycle time left: ${formatDuration(
          workDuration
        )} • Total time left: ${formatDuration(totalRemaining)}`,
        components: [row],
      });

      const timeout = setTimeout(async () => {
        try {
          await handlePomodoroTick(id);
        } catch (err) {
          console.error("Pomodoro tick failed:", err);
        }
      }, workDuration);

      pomodoros.set(id, {
        userId,
        timeout,
        channelId,
        messageId: follow.id,
        state: "work",
        currentCycle: 0,
        totalCycles: cycles,
        workDuration,
        breakDuration,
        endsAt,
        label,
        allowDM,
      });

      await persist();
      return;
    }

    if (ps === "stop") {
      const id = interaction.options.getString("id");
      let p = null;
      if (id) p = pomodoros.get(id);
      else
        p = [...pomodoros.values()].find(
          (x) => x.userId === interaction.user.id
        );
      if (!p || p.userId !== interaction.user.id)
        return interaction.reply({
          content: "❌ Pomodoro not found or not yours.",
          flags: EPHEMERAL,
        });
      clearTimeout(p.timeout);

      addHistory({
        id: p.messageId || id || `${Date.now().toString(36)}_pstop`,
        userId: p.userId,
        channelId: p.channelId,
        duration: 0,
        label: p.label || null,
        type: "pomodoro",
        endedAt: Date.now(),
        canceled: true,
      });

      pomodoros.delete(p.messageId ? p.messageId : id);

      try {
        const channel = await getChannel(p.channelId);
        if (channel && p.messageId) {
          const msg = await channel.messages
            .fetch(p.messageId)
            .catch(() => null);
          if (msg)
            await msg.edit({
              content: `🛑 Pomodoro stopped by <@${interaction.user.id}>`,
              components: [],
            });
        }
      } catch (err) {
        console.warn(
          `Failed to edit original message for stopped pomodoro ${id}:`,
          err
        );
      }

      await persist();
      return safeReply(interaction, {
        content: `🛑 Pomodoro stopped`,
        flags: EPHEMERAL,
      });
    }

    if (ps === "status") {
      const p = [...pomodoros.values()].find(
        (x) => x.userId === interaction.user.id
      );
      if (!p)
        return safeReply(interaction, {
          content: "📭 You have no active pomodoro.",
          flags: EPHEMERAL,
        });
      const { remainingMs, totalRemaining } = computePomodoroTotals(p);
      const stateText =
        p.state === "work"
          ? `Work — ${formatDuration(p.workDuration)}`
          : `Break — ${formatDuration(p.breakDuration)}`;
      return interaction.reply({
        content: `📊 Pomodoro ${
          p.label ? `**${p.label}** — ` : ""
        }${stateText} • Cycle ${p.currentCycle + 1}/${
          p.totalCycles
        } • Cycle time left: ${formatDuration(
          remainingMs
        )} • Total time left: ${formatDuration(totalRemaining)}`,
        flags: EPHEMERAL,
      });
    }

    return;
  }

  if (sub === "start") {
    const timeStr = interaction.options.getString("time");
    const label = interaction.options.getString("label");
    const allowDM = !!interaction.options.getBoolean("allow_dm");
    const duration = parseTime(timeStr);
    if (!duration)
      return safeReply(interaction, {
        content:
          "❌ Invalid time format. Use formats like 10s, 5m, 1h, 1:30, or 1h30m.",
        flags: EPHEMERAL,
      });

    const channelId = interaction.channelId;
    const userId = interaction.user.id;

    // Check channel permissions: require SendMessages/ViewChannel unless allowDM is true
    let channelAccessible = false;
    let channelObj = null;
    try {
      channelObj = await getChannel(channelId);
    } catch (err) {
      channelObj = null;
    }

    if (channelObj && channelObj.isTextBased && channelObj.isTextBased()) {
      const botMember = interaction.guild?.members?.me;
      if (!interaction.guild || !botMember) channelAccessible = true;
      else {
        const perms = channelObj.permissionsFor(botMember);
        if (
          perms &&
          (BigInt(perms.bitfield) & REQUIRED_PERMS) === REQUIRED_PERMS
        )
          channelAccessible = true;
      }
    }

    if (!channelAccessible && !allowDM) {
      return safeReply(interaction, {
        content:
          "❌ I don't have permission to send messages in this channel. Either grant me Send Messages/View Channel permissions or set `allow_dm=true` to allow DM fallback.",
        flags: EPHEMERAL,
      });
    }

    await interaction.deferReply();

    const id = Date.now().toString(36);
    const endTime = Date.now() + duration;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cancel_${id}`)
        .setLabel("Cancel Timer")
        .setStyle(ButtonStyle.Danger)
    );

    let messageId = null;
    const timeout = setTimeout(async () => {
      console.log(`⏰ Timer ${id} fired for ${userId} in channel ${channelId}`);
      const labelPrefix = label ? `${label} - ` : "";
      try {
        const channel = await getChannel(channelId);

        // Use sendNotification helper which handles edit/send and DM fallback
        const res = await sendNotification({
          channelId,
          messageId,
          userId,
          content: `⏰ <@${userId}>, your timer (${labelPrefix}${formatDuration(
            duration
          )}) ended!`,
          components: [],
          allowDM,
        });

        if (res.channel)
          console.log(`⏰ Timer ${id} delivered in channel ${channelId}`);
        else if (res.dm) console.log(`Sent DM to ${userId} for timer ${id}`);
        else
          console.warn(
            `Could not deliver timer ${id} (no channel access and DM not allowed).`
          );
      } catch (err) {
        console.error("Failed to send timer message:", err);
      } finally {
        addHistory({
          id,
          userId,
          channelId,
          duration,
          label: label || null,
          type: "timer",
          endedAt: Date.now(),
          canceled: false,
        });
        timers.delete(id);
        await persist();
      }
    }, duration);

    // Track total time the user has set across all timers
    totals.set(userId, (totals.get(userId) || 0) + duration);

    console.log(
      `Started timer ${id} for ${userId} (${timeStr}) in channel ${channelId}, ends at ${new Date(
        endTime
      ).toISOString()}`
    );

    const follow = await interaction.followUp({
      content: `✅ Timer started for ${timeStr}`,
      components: [row],
    });

    // Keep the follow-up message id so we can edit it when the timer ends
    messageId = follow.id;

    timers.set(id, {
      userId,
      timeout,
      endTime,
      channelId,
      messageId,
      duration,
      label,
      allowDM,
    });
    await persist();
  }

  if (sub === "cancel") {
    const id = interaction.options.getString("id");
    const timer = timers.get(id);
    if (!timer || timer.userId !== interaction.user.id)
      return safeReply(interaction, "❌ Timer not found or not yours.");
    clearTimeout(timer.timeout);

    addHistory({
      id,
      userId: timer.userId,
      channelId: timer.channelId,
      duration: timer.duration,
      label: timer.label || null,
      type: "timer",
      endedAt: Date.now(),
      canceled: true,
    });

    timers.delete(id);

    // Edit original message if possible
    try {
      const channel = await getChannel(timer.channelId);
      if (channel && timer.messageId) {
        const msg = await channel.messages
          .fetch(timer.messageId)
          .catch(() => null);
        if (msg)
          await msg.edit({
            content: `🛑 Timer ${id} canceled by <@${interaction.user.id}>`,
            components: [],
          });
      }
    } catch (err) {
      console.warn(
        `Failed to edit original message for canceled timer ${id}:`,
        err
      );
    }

    await persist();
    return safeReply(interaction, `🛑 Timer ${id} canceled`);
  }

  if (sub === "list") {
    const userTimers = [...timers.entries()].filter(
      ([, t]) => t.userId === interaction.user.id
    );
    if (!userTimers.length)
      return safeReply(interaction, "📭 You have no active timers.");

    const now = Date.now();
    const text = userTimers
      .map(([id, t]) => {
        const remainingMs = Math.max(0, t.endTime - now);
        return `🆔 ${id} → ${formatDuration(remainingMs)} remaining`;
      })
      .join("\n");

    return safeReply(interaction, `📋 Your active timers:\n${text}`);
  }

  if (sub === "help") {
    return safeReply(interaction, {
      content:
        "Usage:\n/timer start time:<10s|5m|1h|1:30|1h30m> [label] [allow_dm:true|false]\n/timer cancel id:<id>\n/timer list\n/timer stats [timeframe: all|today|week]\n/timer pomodoro start work:<25m> break:<5m> cycles:<4> [label] [allow_dm:true|false]",
      flags: EPHEMERAL,
    });
  }

  if (sub === "stats") {
    const timeframe = interaction.options.getString("timeframe") || "all";
    const now = Date.now();
    let start = 0;
    if (timeframe === "today") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      start = d.getTime();
    } else if (timeframe === "week") {
      start = now - 7 * 24 * 3600 * 1000;
    } else {
      start = 0; // all
    }

    // Aggregate from history if timeframe is not "all", otherwise fall back to totals
    let agg = new Map();

    if (timeframe === "all") {
      for (const [uid, ms] of totals.entries()) agg.set(uid, ms);
    } else {
      const filtered = history.filter(
        (h) =>
          !h.canceled &&
          h.endedAt >= start &&
          (h.type === "timer" || h.type === "pomodoro_work")
      );
      for (const h of filtered)
        agg.set(h.userId, (agg.get(h.userId) || 0) + (h.duration || 0));
    }

    if (!agg.size)
      return safeReply(interaction, "📭 No timers in that timeframe.");

    const entries = [...agg.entries()];
    entries.sort((a, b) => b[1] - a[1]);
    const top = entries.slice(0, 10);

    const lines = await Promise.all(
      top.map(async ([uid, ms]) => {
        const user = await client.users.fetch(uid).catch(() => null);
        const name = user ? `${user.tag}` : uid;
        return `**${name}** → ${formatDuration(ms)}`;
      })
    );

    const mine = agg.get(interaction.user.id) || 0;

    return safeReply(
      interaction,
      `📊 Timer totals (${timeframe}) (top ${top.length}):\n${lines.join(
        "\n"
      )}\n\n**Your total:** ${formatDuration(mine)}`
    );
  }
});

client.login(process.env.TOKEN);
