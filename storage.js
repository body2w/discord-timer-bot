import fs from "fs/promises";
import path from "path";

const DATA_FILE = path.resolve(process.cwd(), "timers-data.json");
const BACKUP_FILE = `${DATA_FILE}.backup`;

export async function loadState() {
  try {
    const content = await fs.readFile(DATA_FILE, "utf8");
    return JSON.parse(content);
  } catch (err) {
    if (err.code === "ENOENT") {
      // File doesn't exist, return default state
      return {
        timers: {},
        pomodoros: {},
        totals: {},
        history: [],
        allowedResetters: {},
      };
    }

    // If file exists but is corrupted, try to use backup
    console.error("Error reading state file:", err);
    try {
      const backupContent = await fs.readFile(BACKUP_FILE, "utf8");
      console.log("Using backup state file");
      return JSON.parse(backupContent);
    } catch (backupErr) {
      console.error("Backup file not available, starting fresh");
      return {
        timers: {},
        pomodoros: {},
        totals: {},
        history: [],
        allowedResetters: {},
      };
    }
  }
}

export async function saveState(state) {
  try {
    const data = {
      timers: state.timers || {},
      pomodoros: state.pomodoros || {},
      totals: state.totals || {},
      history: state.history || [],
      allowedResetters: state.allowedResetters || {},
      lastSaved: new Date().toISOString(),
    };

    const json = JSON.stringify(data, null, 2);

    // Write to temporary file first
    const tempFile = `${DATA_FILE}.tmp`;
    await fs.writeFile(tempFile, json, "utf8");

    // Create backup of existing file
    try {
      const existing = await fs.readFile(DATA_FILE, "utf8");
      await fs.writeFile(BACKUP_FILE, existing, "utf8");
    } catch (err) {
      // No existing file to backup
    }

    // Atomic rename
    await fs.rename(tempFile, DATA_FILE);
    console.log("State saved successfully");
  } catch (err) {
    console.error("Fatal error saving state:", err);
    throw err;
  }
}
