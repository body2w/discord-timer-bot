import assert from "assert";
import { parseTime, formatDuration } from "../utils.js";

console.log("Running tests...");

// parseTime tests
assert.strictEqual(parseTime("10s"), 10000);
assert.strictEqual(parseTime("5m"), 5 * 60 * 1000);
assert.strictEqual(parseTime("1h"), 3600000);
assert.strictEqual(parseTime("1d"), 86400000);
assert.strictEqual(parseTime("1:30"), 90000);
assert.strictEqual(parseTime("01:02:03"), (1 * 3600 + 2 * 60 + 3) * 1000);
assert.strictEqual(parseTime("1h30m"), (1 * 3600 + 30 * 60) * 1000);
assert.strictEqual(parseTime("2d 3h"), (2 * 24 + 3) * 3600 * 1000);
assert.strictEqual(parseTime("invalid"), null);

// formatDuration tests
assert.strictEqual(formatDuration(1000), "1s");
assert.strictEqual(formatDuration(65000), "1m 5s");
assert.ok(formatDuration(3600000).includes("1h"));

assert.strictEqual(formatDuration((1 * 3600 + 2 * 60 + 3) * 1000), "1h 2m 3s");

console.log("All tests passed ✅");
