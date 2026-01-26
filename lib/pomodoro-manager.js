import { formatDuration } from "../utils.js";

/**
 * PomodoroManager - Manages Pomodoro sessions
 */
export class PomodoroManager {
  constructor() {
    this.pomodoros = new Map();
    this.authorizedResetters = new Map(); // guildId -> Set of userIds
    this.intervals = new Map();
  }

  createPomodoro(options) {
    const {
      id,
      userId,
      channelId,
      workDuration,
      breakDuration,
      cycles,
      label,
      participants = [],
      allowDM = false,
    } = options;

    const pomodoro = {
      id,
      userId,
      channelId,
      workDuration,
      breakDuration,
      totalCycles: cycles,
      currentCycle: 0,
      label,
      participants: new Set([userId, ...participants]),
      allowDM,
      state: "work", // work or break
      startTime: Date.now(),
      endsAt: Date.now() + workDuration,
      messageId: null,
      sessionStart: Date.now(),
      workSessions: [], // Track when work sessions complete
    };

    this.pomodoros.set(id, pomodoro);
    return pomodoro;
  }

  getPomodoro(id) {
    return this.pomodoros.get(id);
  }

  getAllPomodoros() {
    return Array.from(this.pomodoros.values());
  }

  getPomodorosByUser(userId) {
    return Array.from(this.pomodoros.values()).filter(
      (p) => p.userId === userId
    );
  }

  getActivePomodoroByUser(userId) {
    const userPomos = this.getPomodorosByUser(userId);
    return userPomos.find((p) => p.currentCycle < p.totalCycles);
  }

  cancelPomodoro(id) {
    const pomodoro = this.pomodoros.get(id);
    if (pomodoro) {
      if (this.intervals.has(id)) {
        clearInterval(this.intervals.get(id));
        this.intervals.delete(id);
      }
      this.pomodoros.delete(id);
      return true;
    }
    return false;
  }

  advancePomodoro(id) {
    const pomodoro = this.pomodoros.get(id);
    if (!pomodoro) return null;

    if (pomodoro.state === "work") {
      // Work session completed, switch to break
      pomodoro.workSessions.push({
        cycle: pomodoro.currentCycle,
        duration: pomodoro.workDuration,
      });
      pomodoro.state = "break";
      pomodoro.endsAt = Date.now() + pomodoro.breakDuration;
    } else {
      // Break completed, advance to next cycle
      pomodoro.currentCycle += 1;

      if (pomodoro.currentCycle >= pomodoro.totalCycles) {
        // Pomodoro session complete
        this.cancelPomodoro(id);
        return { completed: true, pomodoro };
      }

      pomodoro.state = "work";
      pomodoro.endsAt = Date.now() + pomodoro.workDuration;
    }

    return { completed: false, pomodoro };
  }

  getTimeRemaining(id) {
    const pomodoro = this.pomodoros.get(id);
    if (!pomodoro) return 0;
    const remaining = pomodoro.endsAt - Date.now();
    return Math.max(0, remaining);
  }

  addParticipant(id, userId) {
    const pomodoro = this.pomodoros.get(id);
    if (pomodoro) {
      pomodoro.participants.add(userId);
      return true;
    }
    return false;
  }

  removeParticipant(id, userId) {
    const pomodoro = this.pomodoros.get(id);
    if (pomodoro && pomodoro.userId !== userId) {
      pomodoro.participants.delete(userId);
      return true;
    }
    return false;
  }

  setMessageId(id, messageId) {
    const pomodoro = this.pomodoros.get(id);
    if (pomodoro) {
      pomodoro.messageId = messageId;
      return true;
    }
    return false;
  }

  getStatus(id) {
    const pomodoro = this.pomodoros.get(id);
    if (!pomodoro) return null;

    const remaining = this.getTimeRemaining(id);
    const totalRemaining = this.calculateTotalRemaining(pomodoro);

    return {
      state: pomodoro.state,
      cycle: pomodoro.currentCycle,
      totalCycles: pomodoro.totalCycles,
      timeRemaining: remaining,
      totalTimeRemaining: totalRemaining,
      label: pomodoro.label,
    };
  }

  calculateTotalRemaining(pomodoro) {
    let total = pomodoro.endsAt - Date.now();
    const cyclesLeft = pomodoro.totalCycles - pomodoro.currentCycle;

    if (pomodoro.state === "work") {
      // Current work session + breaks + remaining cycles
      total += cyclesLeft * (pomodoro.breakDuration + pomodoro.workDuration);
    } else {
      // Current break + remaining cycles
      total +=
        (cyclesLeft - 1) * (pomodoro.workDuration + pomodoro.breakDuration);
    }

    return Math.max(0, total);
  }

  addAuthorizedResetter(guildId, userId) {
    if (!this.authorizedResetters.has(guildId)) {
      this.authorizedResetters.set(guildId, new Set());
    }
    this.authorizedResetters.get(guildId).add(userId);
  }

  removeAuthorizedResetter(guildId, userId) {
    if (this.authorizedResetters.has(guildId)) {
      return this.authorizedResetters.get(guildId).delete(userId);
    }
    return false;
  }

  isAuthorizedResetter(guildId, userId) {
    if (this.authorizedResetters.has(guildId)) {
      return this.authorizedResetters.get(guildId).has(userId);
    }
    return false;
  }

  getAuthorizedResetters(guildId) {
    if (this.authorizedResetters.has(guildId)) {
      return Array.from(this.authorizedResetters.get(guildId));
    }
    return [];
  }

  restorePomodoro(id, pomoData, client) {
    const endsAt = pomoData.endsAt;
    const now = Date.now();

    if (endsAt <= now && pomoData.currentCycle >= pomoData.totalCycles) {
      // Pomodoro has already completed
      return;
    }

    const pomodoro = {
      id,
      userId: pomoData.userId,
      channelId: pomoData.channelId,
      workDuration: pomoData.workDuration,
      breakDuration: pomoData.breakDuration,
      totalCycles: pomoData.totalCycles,
      currentCycle: pomoData.currentCycle || 0,
      label: pomoData.label,
      participants: new Set(pomoData.participants || [pomoData.userId]),
      allowDM: pomoData.allowDM,
      state: pomoData.state || "work",
      startTime: pomoData.startTime || now,
      endsAt,
      messageId: pomoData.messageId,
      sessionStart: now,
      workSessions: [],
    };

    this.pomodoros.set(id, pomodoro);
  }

  serialize() {
    const result = {};
    for (const [id, pomodoro] of this.pomodoros.entries()) {
      result[id] = {
        userId: pomodoro.userId,
        channelId: pomodoro.channelId,
        workDuration: pomodoro.workDuration,
        breakDuration: pomodoro.breakDuration,
        totalCycles: pomodoro.totalCycles,
        currentCycle: pomodoro.currentCycle,
        label: pomodoro.label,
        participants: Array.from(pomodoro.participants),
        allowDM: pomodoro.allowDM,
        state: pomodoro.state,
        startTime: pomodoro.startTime,
        endsAt: pomodoro.endsAt,
        messageId: pomodoro.messageId,
      };
    }
    return result;
  }

  serializeAuthorizedResetters() {
    const result = {};
    for (const [guildId, userIdSet] of this.authorizedResetters.entries()) {
      result[guildId] = Array.from(userIdSet);
    }
    return result;
  }
}
