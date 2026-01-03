import assert from "assert";
import { parseParticipants } from "../utils.js";

console.log("Running parseParticipants tests...");

let r = parseParticipants("<@123> 456 <@!789>");
assert.ok(r.includes("123"));
assert.ok(r.includes("456"));
assert.ok(r.includes("789"));
assert.strictEqual(r.length, 3);

r = parseParticipants("");
assert.deepStrictEqual(r, []);

r = parseParticipants(null);
assert.deepStrictEqual(r, []);

console.log("parseParticipants tests passed ✅");
