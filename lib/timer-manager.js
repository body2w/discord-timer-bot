import { formatDuration, parseTime } from "../utils.js";

/**
 * TimerManager - Manages individual timers
 */
export class TimerManager {
  constructor() {
    this.timers = new Map();
    this.totals = new Map();
    this.intervals = new Map();
  }

  createTimer(options) {
    const {
      id,
      userId,
      channelId,
      duration,
      label,
      participants = [],
      allowDM = false,
    } = options;

    const timer = {
      id,
      userId,
      channelId,
      duration,
      label,
      participants: new Set([userId, ...participants]),
      allowDM,
      startTime: Date.now(),
      endTime: Date.now() + duration,
      messageId: null,
      notified: false,
    };

    this.timers.set(id, timer);
    return timer;
  }

  getTimer(id) {
    return this.timers.get(id);
  }

  getAllTimers() {
    return Array.from(this.timers.values());
  }

  getTimersByUser(userId) {
    return Array.from(this.timers.values()).filter((t) => t.userId === userId);
  }

  getTimersByChannel(channelId) {
    return Array.from(this.timers.values()).filter(
      (t) => t.channelId === channelId
    );
  }

  cancelTimer(id) {
    const timer = this.timers.get(id);
    if (timer) {
      if (this.intervals.has(id)) {
        clearInterval(this.intervals.get(id));
        this.intervals.delete(id);
      }
      this.timers.delete(id);
      return true;
    }
    return false;
  }

  completeTimer(id) {
    const timer = this.timers.get(id);
    if (timer) {
      // Add to totals for all participants
      for (const userId of timer.participants) {
        this.totals.set(
          userId,
          (this.totals.get(userId) || 0) + timer.duration
        );
      }
      this.cancelTimer(id);
      return timer;
    }
    return null;
  }

  getTimeRemaining(id) {
    const timer = this.timers.get(id);
    if (!timer) return 0;
    const remaining = timer.endTime - Date.now();
    return Math.max(0, remaining);
  }

  addParticipant(id, userId) {
    const timer = this.timers.get(id);
    if (timer) {
      timer.participants.add(userId);
      return true;
    }
    return false;
  }

  removeParticipant(id, userId) {
    const timer = this.timers.get(id);
    if (timer && timer.userId !== userId) {
      timer.participants.delete(userId);
      return true;
    }
    return false;
  }

  setMessageId(id, messageId) {
    const timer = this.timers.get(id);
    if (timer) {
      timer.messageId = messageId;
      return true;
    }
    return false;
  }

  setTotal(userId, amount) {
    this.totals.set(userId, amount);
  }

  getTotal(userId) {
    return this.totals.get(userId) || 0;
  }

  resetTotals() {
    this.totals.clear();
  }

  getLeaderboard(limit = 10) {
    return Array.from(this.totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([userId, total]) => ({ userId, total }));
  }

  restoreTimer(id, timerData, client) {
    const endTime = timerData.endTime;
    const now = Date.now();

    if (endTime <= now) {
      // Timer has already ended
      return;
    }

    const timer = {
      id,
      userId: timerData.userId,
      channelId: timerData.channelId,
      duration: timerData.duration,
      label: timerData.label,
      participants: new Set(timerData.participants || [timerData.userId]),
      allowDM: timerData.allowDM,
      startTime: timerData.startTime,
      endTime,
      messageId: timerData.messageId,
      notified: false,
    };

    this.timers.set(id, timer);
  }

  serialize() {
    const result = {};
    for (const [id, timer] of this.timers.entries()) {
      result[id] = {
        userId: timer.userId,
        channelId: timer.channelId,
        duration: timer.duration,
        label: timer.label,
        participants: Array.from(timer.participants),
        allowDM: timer.allowDM,
        startTime: timer.startTime,
        endTime: timer.endTime,
        messageId: timer.messageId,
      };
    }
    return result;
  }

  serializeTotals() {
    const result = {};
    for (const [userId, total] of this.totals.entries()) {
      result[userId] = total;
    }
    return result;
  }
}
