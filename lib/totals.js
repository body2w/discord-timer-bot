export function recomputeTotalsFromHistory(totalsMap, historyArray) {
  if (!totalsMap || !historyArray) return;
  totalsMap.clear();
  for (const h of historyArray) {
    if (h.canceled) continue;
    if (h.type !== "timer" && h.type !== "pomodoro_work") continue;
    totalsMap.set(h.userId, (totalsMap.get(h.userId) || 0) + (h.duration || 0));
  }
}
