import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const command = new SlashCommandBuilder()
  .setName("timer")
  .setDescription("Ultimate Timer Bot")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Start a timer")
      .addStringOption((opt) =>
        opt
          .setName("time")
          .setDescription("Time format: 10s / 5m / 1h, 1:30, 1h30m")
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("label")
          .setDescription("Optional label for the timer")
          .setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt
          .setName("allow_dm")
          .setDescription("Allow DM fallback if I can't post in the channel")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("cancel")
      .setDescription("Cancel a timer")
      .addStringOption((opt) =>
        opt.setName("id").setDescription("Timer ID").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List your active timers")
  )
  .addSubcommand((sub) =>
    sub
      .setName("stats")
      .setDescription("Show total time users have set timers")
      .addStringOption((opt) =>
        opt
          .setName("timeframe")
          .setDescription("Timeframe to aggregate: all/today/week")
          .setRequired(false)
          .addChoices(
            { name: "all", value: "all" },
            { name: "today", value: "today" },
            { name: "week", value: "week" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName("help").setDescription("Show usage help for /timer")
  )
  .addSubcommandGroup((group) =>
    group
      .setName("pomodoro")
      .setDescription("Pomodoro timers (work/break cycles)")
      .addSubcommand((sub) =>
        sub
          .setName("start")
          .setDescription("Start a pomodoro")
          .addStringOption((opt) =>
            opt
              .setName("work")
              .setDescription("Work duration (e.g., 25m, 1:30)")
              .setRequired(false)
          )
          .addStringOption((opt) =>
            opt
              .setName("break")
              .setDescription("Break duration (e.g., 5m)")
              .setRequired(false)
          )
          .addIntegerOption((opt) =>
            opt
              .setName("cycles")
              .setDescription("Number of work/break cycles (default 4)")
              .setRequired(false)
          )
          .addStringOption((opt) =>
            opt
              .setName("label")
              .setDescription("Optional label for the pomodoro")
          )
          .addBooleanOption((opt) =>
            opt
              .setName("allow_dm")
              .setDescription(
                "Allow DM fallback if I can't post in the channel"
              )
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("stop")
          .setDescription("Stop your active pomodoro (or provide id)")
          .addStringOption((opt) =>
            opt
              .setName("id")
              .setDescription("Pomodoro ID to stop")
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("status").setDescription("Show your active pomodoro status")
      )
  );

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: [command.toJSON()],
    });
    console.log("✅ Commands registered");
  } catch (err) {
    console.error(err);
  }
})();
