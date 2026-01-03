import assert from "assert";
import { recordPomodoroWork } from "../lib/pomodoro-utils.js";

console.log("Running pomodoro participants tests...");

// Set up ephemeral totals and history
const totals = new Map();
const history = [];

recordPomodoroWork({
  id: "testpomo",
  participants: ["u1", "u2"],
  duration: 60000,
  channelId: "c1",
  label: "Focus",
  totalsMap: totals,
  historyArray: history,
  now: 1600000000000,
});

assert.strictEqual(totals.get("u1"), 60000);
assert.strictEqual(totals.get("u2"), 60000);
assert.strictEqual(history.length, 2);
assert.strictEqual(history[0].userId, "u1");
assert.strictEqual(history[1].userId, "u2");

console.log("Pomodoro participants tests passed ✅");
