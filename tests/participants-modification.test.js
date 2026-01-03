import assert from "assert";
import {
  client,
  addParticipantTo,
  removeParticipantFrom,
  pomodoros,
  timers,
} from "../index.js";

console.log("Running participants modification tests...");

// Prepare fake channel and messages
let lastSent = null;
const fakeMsg = {
  id: "m_orig",
  content: "Initial content",
  editCalls: 0,
  edit: async (payload) => {
    fakeMsg.editCalls += 1;
    fakeMsg.content = payload.content;
    return fakeMsg;
  },
};
const fakeChannel = {
  isTextBased: true,
  permissionsFor: () => ({ has: () => true }),
  messages: {
    fetch: async (id) => (id === "m_orig" ? fakeMsg : null),
  },
  send: async (content) => {
    lastSent = { id: "m_sent", content };
    return lastSent;
  },
};

client.channels = client.channels || {};
client.channels.fetch = async () => fakeChannel;
client.channels.cache = client.channels.cache || new Map();

// Test adding participant to pomodoro
const pomoId = "ptest1";
pomodoros.set(pomoId, {
  userId: "uowner",
  channelId: "c1",
  messageId: "m_orig",
  state: "work",
  currentCycle: 0,
  totalCycles: 2,
  workDuration: 10,
  breakDuration: 5,
  endsAt: Date.now() + 10,
  label: "Test",
  allowDM: false,
  participants: new Set(["uowner"]),
});
(async () => {
  await addParticipantTo(pomoId, "u2", "uowner");
  const p = pomodoros.get(pomoId);
  assert.ok(p.participants.has("u2"));

  // After add, updatePomodoroMessage was called which should attempt to edit the original message.
  // Since fakeMsg.edit updates content, check that the content now contains u2 mention
  // (updatePomodoroMessage uses p.participants to build mentions)
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(
    fakeMsg.content.includes("<@u2>") || lastSent.content.includes("<@u2>")
  );

  // Test removing participant
  await removeParticipantFrom(pomoId, "u2", "uowner");
  const p2 = pomodoros.get(pomoId);
  assert.ok(!p2.participants.has("u2"));

  console.log("participants modification tests passed ✅");
})();
