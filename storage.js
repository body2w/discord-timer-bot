import fs from "fs/promises";
import path from "path";

const DATA_FILE = path.resolve(process.cwd(), "timers-data.json");
const TEMP_FILE = `${DATA_FILE}.tmp`;

export async function loadState() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const state = JSON.parse(raw);
    return {
      timers: state.timers || {},
      totals: state.totals || {},
      pomodoros: state.pomodoros || {},
      history: state.history || [],
      allowedResetters: state.allowedResetters || {},
    };
  } catch (err) {
    if (err.code === "ENOENT")
      return {
        timers: {},
        totals: {},
        pomodoros: {},
        history: [],
        allowedResetters: {},
      };
    console.error("Failed to load state, backing up and starting fresh:", err);
    try {
      await fs.copyFile(DATA_FILE, `${DATA_FILE}.bak`);
    } catch (copyErr) {
      // ignore
    }
    return {
      timers: {},
      totals: {},
      pomodoros: {},
      history: [],
      allowedResetters: {},
    };
  }
}

export async function saveState(state) {
  const out = {
    timers: state.timers || {},
    totals: state.totals || {},
    pomodoros: state.pomodoros || {},
    history: state.history || [],
    allowedResetters: state.allowedResetters || {},
    savedAt: new Date().toISOString(),
  };

  const text = JSON.stringify(out, null, 2);
  await fs.writeFile(TEMP_FILE, text, "utf8");
  await fs.rename(TEMP_FILE, DATA_FILE);
}
