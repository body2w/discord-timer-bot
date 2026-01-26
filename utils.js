/**
 * Utility functions for parsing and formatting time
 */

export function parseTime(input) {
  if (!input || typeof input !== "string") return null;
  input = input.trim().toLowerCase();

  // Support mm:ss (e.g., 1:30) and hh:mm:ss
  if (input.includes(":")) {
    const parts = input.split(":").map((p) => {
      const num = parseInt(p, 10);
      return isNaN(num) ? null : num;
    });

    if (parts.includes(null)) return null;

    if (parts.length === 2) {
      // mm:ss format
      return (parts[0] * 60 + parts[1]) * 1000;
    }

    if (parts.length === 3) {
      // hh:mm:ss format
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }

    return null;
  }

  // Support combined formats like "1h30m", "2d 5h", "90s"
  const formats = [
    { pattern: /(\d+)\s*d(?:ays?)?/i, factor: 86400 },
    { pattern: /(\d+)\s*h(?:ours?)?/i, factor: 3600 },
    { pattern: /(\d+)\s*m(?:inutes?)?/i, factor: 60 },
    { pattern: /(\d+)\s*s(?:econds?)?/i, factor: 1 },
  ];

  let totalSeconds = 0;
  let found = false;

  for (const { pattern, factor } of formats) {
    const match = pattern.exec(input);
    if (match) {
      totalSeconds += parseInt(match[1], 10) * factor;
      found = true;
      input = input.substring(match.index + match[0].length);
    }
  }

  return found ? totalSeconds * 1000 : null;
}

export function formatDuration(ms) {
  if (ms < 0) ms = 0;

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

export function parseParticipants(input) {
  if (!input || typeof input !== "string") return [];

  const ids = new Set();

  // Match Discord user mentions: <@userid> or <@!userid>
  const mentionRegex = /<@!?(\d+)>/g;
  let match;
  while ((match = mentionRegex.exec(input))) {
    ids.add(match[1]);
  }

  // Also match plain user IDs
  const idRegex = /\b(\d{18,20})\b/g;
  while ((match = idRegex.exec(input))) {
    ids.add(match[1]);
  }

  return Array.from(ids);
}

export function generateId() {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
