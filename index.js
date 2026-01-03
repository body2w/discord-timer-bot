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
import { recomputeTotalsFromHistory } from "./lib/totals.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const timers = new Map();
const totals = new Map();
const pomodoros = new Map();
const history = [];
// Per-guild map of authorized user IDs allowed to run reset
const allowedResetters = new Map();
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

function hasManagePermissions(interaction) {
  try {
    const perms = interaction.member?.permissions;
    if (!perms) return false;
    if (typeof perms.has === "function") {
      return perms.has([
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.Administrator,
      ]);
    }
    return false;
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
      participants: t.participants ? [...t.participants] : [t.userId],
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
      allowDM: !!p.allowDM,
      participants: p.participants ? [...p.participants] : [],
    };
  }

  // Serialize allowedResetters as plain object guildId -> [userId...]
  const plainAllowedResetters = {};
  for (const [gid, set] of allowedResetters.entries()) {
    plainAllowedResetters[gid] = [...set];
  }

  await saveState({
    timers: plainTimers,
    totals: plainTotals,
    pomodoros: plainPomos,
    history: history.slice(),
    allowedResetters: plainAllowedResetters,
  });
}

function computePomodoroTotals(p) {
  const now = Date.now();
  const remainingMs = Math.max(0, p.endsAt - now);
  let totalRemaining = remainingMs;
  let curState = p.state;
  let curCycle = p.currentCycle || 0;

  // Simulate forward until the number of completed cycles reaches totalCycles.
  while (true) {
    if (curState === "work") {
      // after work ends there's a break
      totalRemaining += p.breakDuration;
      curState = "break";
    } else {
      // after break ends the cycle completes
      curCycle += 1;
      if (curCycle >= p.totalCycles) break;
      // otherwise a new work session starts
      totalRemaining += p.workDuration;
      curState = "work";
    }
  }
  return { remainingMs, totalRemaining };
}

// parseParticipants moved to utils.js; keep a temporary shim for compatibility
import { parseParticipants as _parseParticipants } from "./utils.js";

async function updatePomodoroMessage(id) {
  const p = pomodoros.get(id);
  if (!p) return;
  try {
    const now = Date.now();
    const labelPrefix = p.label ? `${p.label} - ` : "";
    const remainingMs = Math.max(0, (p.endsAt || now) - now);
    const { totalRemaining } = computePomodoroTotals(p);
    const cycle =
      p.state === "work" ? (p.currentCycle || 0) + 1 : p.currentCycle || 0 || 0;
    const participantsText = p.participants
      ? [...p.participants].map((id) => `<@${id}>`).join(" ")
      : `<@${p.userId}>`;
    let content;
    if (p.state === "work") {
      content = `🟢 ${labelPrefix}Cycle ${cycle}/${
        p.totalCycles
      } — Work (${formatDuration(
        p.workDuration
      )}) • Cycle time left: ${formatDuration(
        remainingMs
      )} • Total time left: ${formatDuration(totalRemaining)}${
        participantsText ? ` • Participants: ${participantsText}` : ""
      }`;
    } else {
      content = `⏰ ${labelPrefix}Break — ${formatDuration(
        p.breakDuration
      )} • Break time left: ${formatDuration(
        remainingMs
      )} • Total time left: ${formatDuration(totalRemaining)}${
        participantsText ? ` • Participants: ${participantsText}` : ""
      }`;
    }

    const channel = await getChannel(p.channelId);
    if (channel && channel.isTextBased && canSendInChannel(channel)) {
      if (p.messageId) {
        const msg = await channel.messages.fetch(p.messageId).catch(() => null);
        if (msg)
          await msg
            .edit({ content, components: msg?.components || [] })
            .catch(() => null);
        else await channel.send(content).catch(() => null);
      }
    }
  } catch (err) {
    // Suppress errors from frequent updates
  }
}

function parseParticipants(input) {
  return _parseParticipants(input);
}

async function handlePomodoroTick(id) {
  const p = pomodoros.get(id);
  if (!p) return;
  const now = Date.now();

  const labelPrefix = p.label ? `${p.label} - ` : "";

  if (p.state === "work") {
    // Work finished -> increment totals and record history for each participant (use helper)
    const participants = p.participants ? [...p.participants] : [p.userId];
    // Record work and update totals (synchronously) then notify channel only (no DMs)
    try {
      const mod = await import("./lib/pomodoro-utils.js");
      mod.recordPomodoroWork({
        id,
        participants,
        duration: p.workDuration,
        channelId: p.channelId,
        label: p.label,
        totalsMap: totals,
        historyArray: history,
        now,
      });
    } catch (err) {
      console.warn("Failed to record pomodoro work via helper:", err);
    }

    // Build totals text to show updated totals per participant
    const totalsText = participants
      .map((uid) => `<@${uid}> ${formatDuration(totals.get(uid) || 0)}`)
      .join(" • ");

    // Send channel-only message mentioning participants and their new totals
    try {
      const participantsText = participants.map((id) => `<@${id}>`).join(" ");
      const content = `⏰ ${labelPrefix}${participantsText}, work session complete — ${formatDuration(
        p.workDuration
      )} added to totals (${totalsText}). Break started — ${formatDuration(
        p.breakDuration
      )}. Cycle time left: ${formatDuration(
        cycleRemaining
      )} • Total time left: ${formatDuration(totalRemaining)}.`;

      const channel = await getChannel(p.channelId);
      if (channel && channel.isTextBased && canSendInChannel(channel)) {
        const msg = p.messageId
          ? await channel.messages.fetch(p.messageId).catch(() => null)
          : null;
        if (msg)
          await msg
            .edit({ content, components: msg?.components || [] })
            .catch(() => null);
        else await channel.send(content).catch(() => null);
      } else {
        console.warn(
          `Channel unavailable for pomodoro ${id}; not sending DM notifications.`
        );
      }
    } catch (err) {
      console.warn(
        "Failed to send channel notification for pomodoro work->break:",
        err
      );
    }

    p.state = "break";
    p.endsAt = now + p.breakDuration;

    // compute cycle and total remaining
    const { remainingMs: cycleRemaining, totalRemaining } =
      computePomodoroTotals(p);

    // refresh message every second while on break
    if (p.interval) clearInterval(p.interval);
    p.interval = setInterval(() => {
      updatePomodoroMessage(id).catch(() => null);
    }, 1000);
    updatePomodoroMessage(id).catch(() => null);

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
          const participantsText = p.participants
            ? [...p.participants].map((id) => `<@${id}>`).join(" ")
            : `<@${p.userId}>`;
          const totalsText = p.participants
            ? [...p.participants]
                .map(
                  (uid) => `<@${uid}> ${formatDuration(totals.get(uid) || 0)}`
                )
                .join(" • ")
            : `<@${p.userId}> ${formatDuration(totals.get(p.userId) || 0)}`;
          const content = `✅ ${labelPrefix}${participantsText}, pomodoro completed! (${p.totalCycles} cycles) • Totals: ${totalsText}`;
          if (msg)
            await msg.edit({
              content,
              components: [],
            });
          else await channel.send(content);
        } else {
          // Channel unavailable — do not send DMs for pomodoro events per configuration
          console.warn(
            `Channel unavailable for pomodoro ${id} completion; not sending DM notifications.`
          );
        }
      } catch (err) {
        console.warn("Failed to notify users on pomodoro completion:", err);
      }

      // Finalize completion: clear updater, remove pomodoro and persist
      if (p.interval) clearInterval(p.interval);
      pomodoros.delete(id);
      await persist();
      return;
    } else {
      // Continue to next cycle
      const { remainingMs: cycleRemaining, totalRemaining } =
        computePomodoroTotals(p);
      const cycle = (p.currentCycle || 0) + 1;

      try {
        const channel = await getChannel(p.channelId);
        if (channel && channel.isTextBased && canSendInChannel(channel)) {
          const msg = p.messageId
            ? await channel.messages.fetch(p.messageId).catch(() => null)
            : null;
          const participantsText = p.participants
            ? [...p.participants].map((id) => `<@${id}>`).join(" ")
            : `<@${p.userId}>`;
          if (msg)
            await msg.edit({
              content: `🟢 ${labelPrefix}Cycle ${cycle}/${
                p.totalCycles
              } — Work started (${formatDuration(
                p.workDuration
              )}) • Cycle time left: ${formatDuration(
                cycleRemaining
              )} • Total time left: ${formatDuration(totalRemaining)}${
                participantsText ? ` • Participants: ${participantsText}` : ""
              }`,
              components: msg?.components,
            });
          else
            await channel.send(
              `🟢 ${labelPrefix}Cycle ${cycle}/${
                p.totalCycles
              } — Work started (${formatDuration(
                p.workDuration
              )}) • Cycle time left: ${formatDuration(
                cycleRemaining
              )} • Total time left: ${formatDuration(totalRemaining)}${
                participantsText ? ` • Participants: ${participantsText}` : ""
              }`
            );
        } else {
          // Channel unavailable — do not send DMs for pomodoro events per configuration
          console.warn(
            `Channel unavailable for pomodoro ${id} next work start; not sending DM notifications.`
          );
        }
      } catch (err) {
        console.warn("Failed to notify users on pomodoro next work:", err);
      }

      // refresh message every second while on work
      if (p.interval) clearInterval(p.interval);
      p.interval = setInterval(() => {
        updatePomodoroMessage(id).catch(() => null);
      }, 1000);
      updatePomodoroMessage(id).catch(() => null);

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
    // Restore totals from persistent totals if present
    for (const [uid, ms] of Object.entries(state.totals || {}))
      totals.set(uid, ms);
    // Recompute totals from history to be authoritative (fair competition)
    import("./lib/totals.js").then((m) =>
      m.recomputeTotalsFromHistory(totals, state.history || [])
    );

    // Restore history (cap to last 2000 entries)
    for (const h of state.history || []) history.push(h);
    if (history.length > 2000) history.splice(0, history.length - 2000);

    const now = Date.now();
    for (const [id, t] of Object.entries(state.timers || {})) {
      const remaining = t.endTime - now;
      const participantsArr =
        t.participants && t.participants.length ? t.participants : [t.userId];
      const participantsSet = new Set(participantsArr);

      if (remaining <= 0) {
        // Timer expired while offline — try to send message in channel, else DM
        try {
          const channel = await getChannel(t.channelId);
          // Build content mentioning participants
          const participantsText = [...participantsSet]
            .map((id) => `<@${id}>`)
            .join(" ");
          // Use sendNotification helper for offline-expired timers (no single-user DM fallback)
          const res = await sendNotification({
            channelId: t.channelId,
            messageId: t.messageId,
            userId: null,
            content: `⏰ ${participantsText} — Your timer (${formatDuration(
              t.duration
            )}) ended while I was offline.`,
            components: [],
            allowDM: !!t.allowDM,
          });

          // Record history and recompute totals for all participants
          for (const uid of participantsSet) {
            addHistory({
              id,
              userId: uid,
              channelId: t.channelId,
              duration: t.duration,
              label: t.label || null,
              type: "timer",
              endedAt: now,
              canceled: false,
            });
            totals.set(uid, (totals.get(uid) || 0) + t.duration);
          }
          // Recompute totals now that we've appended history for an expired timer
          recomputeTotalsFromHistory(totals, state.history || []);
          await persist();

          if (res.channel) continue;
          if (res.dm) continue;
          // otherwise fall through (log already handled in sendNotification)
        } catch (err) {
          console.warn(
            `Could not notify participants for expired timer ${id}:`,
            err
          );
        }
        // Fallback DM (only if allowed) — DM all participants
        if (t.allowDM) {
          for (const uid of participantsSet) {
            try {
              const user = await client.users.fetch(uid);
              await user.send(
                `⏰ Your timer (${formatDuration(
                  t.duration
                )}) ended while I was offline.`
              );
              // history/persist already saved above
            } catch (err) {
              console.error(
                `Failed to DM participant ${uid} for expired timer ${id}:`,
                err
              );
            }
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
            const participantsText = participantsArr
              .map((id) => `<@${id}>`)
              .join(" ");
            if (channel && channel.isTextBased && canSendInChannel(channel)) {
              if (t.messageId) {
                const orig = await channel.messages
                  .fetch(t.messageId)
                  .catch(() => null);
                if (orig) {
                  await orig.edit({
                    content: `⏰ ${participantsText} — Your timer (${
                      t.label ? `${t.label} - ` : ""
                    }${formatDuration(t.duration)}) ended!`,
                    components: [],
                  });
                } else {
                  await channel.send(
                    `⏰ ${participantsText} — Your timer (${
                      t.label ? `${t.label} - ` : ""
                    }${formatDuration(t.duration)}) ended!`
                  );
                }
              } else {
                await channel.send(
                  `⏰ ${participantsText} — Your timer (${
                    t.label ? `${t.label} - ` : ""
                  }${formatDuration(t.duration)}) ended!`
                );
              }
            } else {
              if (t.allowDM) {
                for (const uid of participantsSet) {
                  const user = await client.users.fetch(uid);
                  await user.send(
                    `⏰ Your timer (${
                      t.label ? `${t.label} - ` : ""
                    }${formatDuration(t.duration)}) ended!`
                  );
                }
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
          participants: new Set(t.participants || [t.userId]),
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
          const pomParticipants =
            p.participants && p.participants.length
              ? p.participants
              : [p.userId];
          const participantsText = pomParticipants
            .map((id) => `<@${id}>`)
            .join(" ");
          if (channel && channel.isTextBased && canSendInChannel(channel)) {
            if (p.messageId) {
              const orig = await channel.messages
                .fetch(p.messageId)
                .catch(() => null);
              if (orig) {
                await orig.edit({
                  content: `⏰ ${participantsText}, your pomodoro session ${labelPrefix} progressed while I was offline.`,
                  components: [],
                });
                continue;
              }
            }
            await channel.send(
              `⏰ ${participantsText}, your pomodoro session ${labelPrefix} progressed while I was offline.`
            );
            continue;
          }
        } catch (err) {
          console.warn(
            `Could not notify participants for pomodoro ${id}:`,
            err
          );
        }
        // Channel unavailable for restored pomodoro progression — do not send DMs per configuration
        console.warn(
          `Channel unavailable for restored pomodoro ${id}; not sending DM notifications.`
        );
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
          allowDM: !!p.allowDM,
          participants: new Set(p.participants || []),
        });

        // start per-second updates for restored pomodoro
        const restored = pomodoros.get(id);
        restored.interval = setInterval(() => {
          updatePomodoroMessage(id).catch(() => null);
        }, 1000);
        updatePomodoroMessage(id).catch(() => null);
      }
    }

    // Restore allowed resetters per guild
    for (const [gid, arr] of Object.entries(state.allowedResetters || {})) {
      allowedResetters.set(gid, new Set(arr || []));
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
      const isOwner = OWNER_ID && interaction.user.id === OWNER_ID;
      const isAuthorized =
        interaction.guildId &&
        allowedResetters.get(interaction.guildId)?.has(interaction.user.id);
      if (
        !timer ||
        (timer.userId !== interaction.user.id && !isOwner && !isAuthorized)
      )
        return safeReply(interaction, {
          content:
            "❌ Timer not found or not yours (or you lack permission to cancel)",
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
      const isOwner = OWNER_ID && interaction.user.id === OWNER_ID;
      const isAuthorized =
        interaction.guildId &&
        allowedResetters.get(interaction.guildId)?.has(interaction.user.id);
      if (!p || (p.userId !== interaction.user.id && !isOwner && !isAuthorized))
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

  if (group === "manage") {
    const ms = sub; // authorize|revoke|list
    if (interaction.user.id !== OWNER_ID)
      return safeReply(interaction, {
        content: "❌ Only the bot owner can manage authorizations.",
        flags: EPHEMERAL,
      });
    if (!interaction.guildId)
      return safeReply(interaction, {
        content:
          "❌ Authorization is guild-scoped and must be run in a server.",
        flags: EPHEMERAL,
      });

    const guildId = interaction.guildId;

    if (ms === "authorize") {
      const u = interaction.options.getUser("user");
      if (!u)
        return safeReply(interaction, {
          content: "❌ Please provide a valid user to authorize.",
          flags: EPHEMERAL,
        });
      const set = allowedResetters.get(guildId) || new Set();
      set.add(u.id);
      allowedResetters.set(guildId, set);
      await persist();
      return safeReply(interaction, {
        content: `✅ Authorized <@${u.id}> to reset timers in this guild.`,
        flags: EPHEMERAL,
      });
    }

    if (ms === "revoke") {
      const u = interaction.options.getUser("user");
      if (!u)
        return safeReply(interaction, {
          content: "❌ Please provide a valid user to revoke.",
          flags: EPHEMERAL,
        });
      const set = allowedResetters.get(guildId);
      if (!set || !set.has(u.id))
        return safeReply(interaction, {
          content: `ℹ️ <@${u.id}> is not authorized in this guild.`,
          flags: EPHEMERAL,
        });
      set.delete(u.id);
      if (set.size === 0) allowedResetters.delete(guildId);
      else allowedResetters.set(guildId, set);
      await persist();
      return safeReply(interaction, {
        content: `✅ Revoked reset authorization for <@${u.id}> in this guild.`,
        flags: EPHEMERAL,
      });
    }

    if (ms === "list") {
      const set = allowedResetters.get(guildId);
      if (!set || set.size === 0)
        return safeReply(interaction, {
          content: "📭 No authorized resetters in this guild.",
          flags: EPHEMERAL,
        });
      const lines = [...set].map((id) => `<@${id}>`).join("\n");
      return safeReply(interaction, {
        content: `📋 Authorized resetters in this guild:\n${lines}`,
        flags: EPHEMERAL,
      });
    }

    return;
  }

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

      const participantsStr =
        interaction.options.getString("participants") || "";
      const parsed = parseParticipants(participantsStr);
      // Ensure owner is included
      if (!parsed.includes(interaction.user.id))
        parsed.push(interaction.user.id);
      const participantsSet = new Set(parsed);

      const now = Date.now();
      const endsAt = now + workDuration;

      const totalRemaining = cycles * (workDuration + breakDuration);

      // create participants mention text
      const participantsText = [...participantsSet]
        .map((id) => `<@${id}>`)
        .join(" ");

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
        )} • Total time left: ${formatDuration(totalRemaining)}${
          participantsText ? `\nParticipants: ${participantsText}` : ""
        }`,
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
        allowDM: !!allowDM,
        participants: participantsSet,
      });

      // start per-second updates and update immediately
      const created = pomodoros.get(id);
      created.interval = setInterval(() => {
        updatePomodoroMessage(id).catch(() => null);
      }, 1000);
      updatePomodoroMessage(id).catch(() => null);

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
      if (
        !p ||
        (p.userId !== interaction.user.id && !hasManagePermissions(interaction))
      )
        return interaction.reply({
          content: "❌ Pomodoro not found or not yours.",
          flags: EPHEMERAL,
        });
      clearTimeout(p.timeout);
      if (p.interval) clearInterval(p.interval);

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

    if (ps === "participants") {
      const id = interaction.options.getString("id");
      let p = null;
      if (id) p = pomodoros.get(id);
      else
        p = [...pomodoros.values()].find(
          (x) => x.userId === interaction.user.id
        );
      if (!p)
        return safeReply(interaction, {
          content: "📭 No active pomodoro found.",
          flags: EPHEMERAL,
        });

      const isOwner = OWNER_ID && interaction.user.id === OWNER_ID;
      const isAuthorized =
        interaction.guildId &&
        allowedResetters.get(interaction.guildId)?.has(interaction.user.id);
      const isParticipant = p.participants
        ? p.participants.has(interaction.user.id)
        : p.userId === interaction.user.id;
      if (!isOwner && !isAuthorized && !isParticipant)
        return safeReply(interaction, {
          content:
            "❌ You are not authorized to view participants for this pomodoro.",
          flags: EPHEMERAL,
        });

      const parts = p.participants ? [...p.participants] : [p.userId];
      const text = parts.map((id) => `<@${id}>`).join(" \n");
      return safeReply(interaction, {
        content: `📋 Participants for pomodoro ${
          p.label ? `**${p.label}** ` : ""
        }${p.messageId || id ? `(${p.messageId || id})` : ""}:\n${text}`,
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

    const participantsStr = interaction.options.getString("participants") || "";
    const parsed = parseParticipants(participantsStr);
    if (parsed.length === 0) parsed.push(interaction.user.id);
    const participantsSet = new Set(parsed);

    let messageId = null;
    const timeout = setTimeout(async () => {
      console.log(`⏰ Timer ${id} fired for ${userId} in channel ${channelId}`);
      const labelPrefix = label ? `${label} - ` : "";
      try {
        const channel = await getChannel(channelId);

        const participantsText = [...participantsSet]
          .map((id) => `<@${id}>`)
          .join(" ");
        const content = `⏰ ${participantsText} — ${labelPrefix}Timer (${formatDuration(
          duration
        )}) ended!`;

        // Use sendNotification helper which handles edit/send (no single-user DM fallback)
        const res = await sendNotification({
          channelId,
          messageId,
          userId: null,
          content,
          components: [],
          allowDM,
        });

        if (res.channel)
          console.log(`⏰ Timer ${id} delivered in channel ${channelId}`);
        else if (res.dm) console.log(`Sent DM for timer ${id}`);
        else
          console.warn(
            `Could not deliver timer ${id} (no channel access and DM not allowed).`
          );

        // If DM fallback is allowed, DM all participants individually
        if (!res.channel && allowDM) {
          for (const uid of participantsSet) {
            try {
              const user = await client.users.fetch(uid).catch(() => null);
              if (user)
                await user
                  .send(
                    `⏰ Your timer (${labelPrefix}${formatDuration(
                      duration
                    )}) ended!`
                  )
                  .catch(() => null);
            } catch (err) {
              console.warn(
                `Failed to DM participant ${uid} for timer ${id}:`,
                err
              );
            }
          }
        }
      } catch (err) {
        console.error("Failed to send timer message:", err);
      } finally {
        // Record history and increment totals for each participant
        for (const uid of participantsSet) {
          addHistory({
            id,
            userId: uid,
            channelId,
            duration,
            label: label || null,
            type: "timer",
            endedAt: Date.now(),
            canceled: false,
          });
          totals.set(uid, (totals.get(uid) || 0) + duration);
        }
        timers.delete(id);
        await persist();
      }
    }, duration);

    // We track completed work totals from history (fair competition).
    // Do not increment totals when a timer is scheduled; totals are only
    // incremented when timers fire (see below) or when pomodoro work completes.
    // This prevents inflating totals with scheduled-but-not-completed time.

    console.log(
      `Started timer ${id} for ${userId} (${timeStr}) in channel ${channelId}, ends at ${new Date(
        endTime
      ).toISOString()}`
    );

    const participantsText = [...participantsSet]
      .map((id) => `<@${id}>`)
      .join(" ");

    const follow = await interaction.followUp({
      content: `✅ Timer started for ${timeStr}${
        participantsText ? ` — Participants: ${participantsText}` : ""
      }`,
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
      participants: participantsSet,
    });
    await persist();
  }

  if (sub === "cancel") {
    const id = interaction.options.getString("id");
    const timer = timers.get(id);
    const isOwner = OWNER_ID && interaction.user.id === OWNER_ID;
    const isAuthorized =
      interaction.guildId &&
      allowedResetters.get(interaction.guildId)?.has(interaction.user.id);
    if (
      !timer ||
      (timer.userId !== interaction.user.id && !isOwner && !isAuthorized)
    )
      return safeReply(interaction, "❌ Timer not found or not yours.");
    clearTimeout(timer.timeout);

    // Record canceled entry for each participant
    const canceledParticipants = timer.participants
      ? [...timer.participants]
      : [timer.userId];
    for (const uid of canceledParticipants) {
      addHistory({
        id,
        userId: uid,
        channelId: timer.channelId,
        duration: timer.duration,
        label: timer.label || null,
        type: "timer",
        endedAt: Date.now(),
        canceled: true,
      });
    }

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
    const isOwner = OWNER_ID && interaction.user.id === OWNER_ID;
    const isAuthorized =
      interaction.guildId &&
      allowedResetters.get(interaction.guildId)?.has(interaction.user.id);

    const now = Date.now();

    if (isOwner || isAuthorized) {
      const allTimers = [...timers.entries()];
      if (!allTimers.length)
        return safeReply(interaction, "📭 There are no active timers.");
      const text = allTimers
        .map(([id, t]) => {
          const remainingMs = Math.max(0, t.endTime - now);
          return `🆔 ${id} → ${formatDuration(
            remainingMs
          )} remaining • Owner: <@${t.userId}> • Channel: <#${t.channelId}>${
            t.label ? ` • ${t.label}` : ""
          }`;
        })
        .join("\n");
      return safeReply(interaction, `📋 All active timers:\n${text}`);
    }

    // Fallback: show only the requester's timers
    const userTimers = [...timers.entries()].filter(
      ([, t]) => t.userId === interaction.user.id
    );
    if (!userTimers.length)
      return safeReply(interaction, "📭 You have no active timers.");

    const text = userTimers
      .map(([id, t]) => {
        const remainingMs = Math.max(0, t.endTime - now);
        return `🆔 ${id} → ${formatDuration(remainingMs)} remaining`;
      })
      .join("\n");

    return safeReply(interaction, `📋 Your active timers:\n${text}`);
  }

  if (sub === "reset") {
    // Only allow OWNER_ID or an authorized user in this guild to run reset
    const isOwner = OWNER_ID && interaction.user.id === OWNER_ID;
    const isAuthorized =
      interaction.guildId &&
      allowedResetters.get(interaction.guildId)?.has(interaction.user.id);
    if (!isOwner && !isAuthorized) {
      return safeReply(interaction, {
        content:
          "❌ Only the bot owner or an authorized user can run this command.",
        flags: EPHEMERAL,
      });
    }

    // Cancel timers
    for (const [id, t] of timers.entries()) {
      try {
        clearTimeout(t.timeout);
        addHistory({
          id,
          userId: t.userId,
          channelId: t.channelId,
          duration: t.duration,
          label: t.label || null,
          type: "timer",
          endedAt: Date.now(),
          canceled: true,
        });

        // Try to update original message
        if (t.messageId) {
          const channel = await getChannel(t.channelId);
          if (channel && channel.isTextBased) {
            const msg = await channel.messages
              .fetch(t.messageId)
              .catch(() => null);
            if (msg)
              await msg.edit({
                content: `🧹 Timer ${id} reset by <@${interaction.user.id}>`,
                components: [],
              });
          }
        } else if (t.allowDM) {
          const user = await client.users.fetch(t.userId).catch(() => null);
          if (user)
            await user
              .send(
                `🧹 Your timer (${
                  t.label ? t.label + " - " : ""
                }${formatDuration(t.duration)}) was reset by the owner.`
              )
              .catch(() => null);
        }
      } catch (err) {
        console.warn(`Failed to reset timer ${id}:`, err);
      }
    }

    // Cancel pomodoros
    for (const [id, p] of pomodoros.entries()) {
      try {
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

        if (p.messageId) {
          const channel = await getChannel(p.channelId);
          if (channel && channel.isTextBased) {
            const msg = await channel.messages
              .fetch(p.messageId)
              .catch(() => null);
            if (msg)
              await msg.edit({
                content: `🧹 Pomodoro ${id} reset by <@${interaction.user.id}>`,
                components: [],
              });
          }
        } else {
          // Channel unavailable for reset notification — do not send DMs per configuration
          console.warn(
            `Channel unavailable for pomodoro ${id} reset; not sending DM notifications.`
          );
        }
      } catch (err) {
        console.warn(`Failed to reset pomodoro ${id}:`, err);
      }
    }

    timers.clear();
    pomodoros.clear();

    // Clear aggregated totals and history (reset storage)
    totals.clear();
    history.splice(0, history.length);

    await persist();

    return safeReply(interaction, {
      content:
        "✅ All active timers and pomodoros have been reset and storage cleared.",
      flags: EPHEMERAL,
    });
  }

  if (sub === "help") {
    return safeReply(interaction, {
      content:
        "Usage:\n/timer start time:<10s|5m|1h|1:30|1h30m> [label] [allow_dm:true|false] [participants:@alice @bob]\n/timer cancel id:<id>\n/timer list\n/timer reset\n/timer stats [timeframe: all|today|week]\n/timer pomodoro start work:<25m> break:<5m> cycles:<4> [label] [allow_dm:true|false] [participants:@alice @bob]",
      flags: EPHEMERAL,
    });
  }

  if (sub === "stats") {
    const timeframe = interaction.options.getString("timeframe") || "all";
    const global = !!interaction.options.getBoolean("global");
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

    // If not requesting global leaderboard, show only the caller's total
    if (!global) {
      // Aggregate from history for completed run time (not scheduled/started time)
      const filtered = history.filter(
        (h) =>
          !h.canceled &&
          (h.type === "timer" || h.type === "pomodoro_work") &&
          (timeframe === "all" || h.endedAt >= start) &&
          h.userId === interaction.user.id
      );
      const mine = filtered.reduce((s, h) => s + (h.duration || 0), 0);
      return safeReply(interaction, {
        content: `📊 Your timer total (${timeframe}): ${formatDuration(mine)}`,
        flags: EPHEMERAL,
      });
    }

    // Aggregate completed run time from history (counts only ended, non-canceled timers and pomodoro work sessions)
    const agg = new Map();
    const filtered = history.filter(
      (h) =>
        !h.canceled &&
        (h.type === "timer" || h.type === "pomodoro_work") &&
        (timeframe === "all" || h.endedAt >= start)
    );
    for (const h of filtered)
      agg.set(h.userId, (agg.get(h.userId) || 0) + (h.duration || 0));

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
