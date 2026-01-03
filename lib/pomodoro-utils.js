export function recordPomodoroWork({
  id,
  participants = [],
  duration,
  channelId = null,
  label = null,
  totalsMap,
  historyArray,
  now = Date.now(),
}) {
  if (!Array.isArray(participants) || !totalsMap || !historyArray) return;
  for (const uid of participants) {
    totalsMap.set(uid, (totalsMap.get(uid) || 0) + duration);

    historyArray.push({
      id: `${id}_work_${uid}`,
      userId: uid,
      channelId,
      duration,
      label: label || null,
      type: "pomodoro_work",
      endedAt: now,
      canceled: false,
    });
  }
}
