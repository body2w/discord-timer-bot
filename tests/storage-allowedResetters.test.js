import assert from "assert";
import { loadState, saveState } from "../storage.js";

console.log("Running storage allowedResetters tests...");

(async function () {
  const orig = await loadState();
  const backup = JSON.parse(JSON.stringify(orig));

  try {
    const testState = {
      ...orig,
      allowedResetters: { testGuild: ["tuser1", "tuser2"] },
    };
    await saveState(testState);
    const loaded = await loadState();
    assert.ok(loaded.allowedResetters.testGuild.includes("tuser1"));
    assert.ok(loaded.allowedResetters.testGuild.includes("tuser2"));
    console.log("storage allowedResetters tests passed ✅");
  } finally {
    // restore original state to avoid side effects
    await saveState(backup);
  }
})();
