import assert from "assert";
import { sendNotification, client } from "../index.js";

console.log("Running sendNotification tests...");

// Test: if edit fails, sendNotification should send a new channel message and return {channel:true, dm:false}
(async () => {
  // Prepare fake channel where fetch returns a message whose edit throws
  const fakeChannel = {
    isTextBased: true,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: async (id) => ({
        edit: async () => {
          throw new Error("edit failed");
        },
      }),
    },
    send: async (payload) => ({ id: "sent" }),
  };

  // Make the client return our fake channel
  client.channels = client.channels || {};
  client.channels.cache = client.channels.cache || new Map();
  client.channels.cache.get = () => null;
  client.channels.fetch = async () => fakeChannel;

  const res = await sendNotification({
    channelId: "c1",
    messageId: "m1",
    userId: null,
    content: "hi",
    components: [],
    allowDM: false,
  });

  assert.deepStrictEqual(res, { channel: true, dm: false });

  // Test: when channel unavailable and allowDM true, DM fallback is used
  client.channels.fetch = async () => null;
  client.users = client.users || {};
  client.users.fetch = async () => ({ send: async () => ({}) });

  const res2 = await sendNotification({
    channelId: "c1",
    messageId: null,
    userId: "u1",
    content: "hello",
    components: [],
    allowDM: true,
  });

  assert.deepStrictEqual(res2, { channel: false, dm: true });

  console.log("sendNotification tests passed ✅");
})();
