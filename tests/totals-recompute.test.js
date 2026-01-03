import assert from "assert";
import { recomputeTotalsFromHistory } from "../lib/totals.js";

console.log("Running totals recompute tests...");

const totals = new Map();
const history = [
  { userId: "u1", duration: 10000, type: "timer", canceled: false },
  { userId: "u1", duration: 20000, type: "timer", canceled: true },
  { userId: "u2", duration: 60000, type: "pomodoro_work", canceled: false },
  { userId: "u3", duration: 15000, type: "other", canceled: false },
];

recomputeTotalsFromHistory(totals, history);
assert.strictEqual(totals.get("u1"), 10000);
assert.strictEqual(totals.get("u2"), 60000);
assert.strictEqual(totals.has("u3"), false);

console.log("totals recompute tests passed ✅");
