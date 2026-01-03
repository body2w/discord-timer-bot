export function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function parseTime(input) {
  if (!input || typeof input !== "string") return null;
  input = input.trim();

  // Support mm:ss (e.g., 1:30) and hh:mm:ss
  if (input.includes(":")) {
    const parts = input.split(":").map((p) => Number(p));
    if (parts.some((n) => Number.isNaN(n))) return null;
    if (parts.length === 2) {
      return (parts[0] * 60 + parts[1]) * 1000;
    }
    if (parts.length === 3) {
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }
    return null;
  }

  // Support combined units like "1h30m" or "2d 5h" or "90s"
  const re =
    /(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i;
  const m = input.match(re);
  if (m && (m[1] || m[2] || m[3] || m[4])) {
    const days = Number(m[1] || 0);
    const hours = Number(m[2] || 0);
    const minutes = Number(m[3] || 0);
    const seconds = Number(m[4] || 0);
    return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  }

  // Fallback to simple formats like 10s, 5m, 1h, 1d
  const match = input.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  return unit === "s"
    ? value * 1000
    : unit === "m"
    ? value * 60000
    : unit === "h"
    ? value * 3600000
    : unit === "d"
    ? value * 86400000
    : null;
}

export function parseParticipants(input) {
  if (!input || typeof input !== "string") return [];
  const ids = new Set();
  // Match mention formats: <@123...> or <@!123...>
  const re = /<@!?(\d+)>/g;
  let m;
  while ((m = re.exec(input))) ids.add(m[1]);
  // Also accept plain IDs separated by spaces/commas
  const tokens = input.split(/[\s,]+/).map((t) => t.trim());
  for (const t of tokens) {
    if (/^\d+$/.test(t)) ids.add(t);
  }
  return [...ids];
}
