# Timer Bot

A Discord timer & Pomodoro bot built with discord.js.

---

## 🚀 Features

**Overview:** The bot supports one-off timers and multi-cycle Pomodoros, with persistent storage, per-guild authorization for administrative actions, channel-wide broadcasts, DM fallbacks, and per-user accounting for completed work.

### Commands

- **/timer start time:<...>** — Start a timer (supports `10s`, `5m`, `1h`, `1:30`, `1h30m`, etc.)

  - Options:
    - `label` — short text label for the timer
    - `allow_dm` — boolean; allow DM fallback when the bot can't post to the channel
    - `broadcast` — boolean; announce to the channel with `@here` (requires send permissions)

- **/timer cancel id:<id>** — Cancel a timer. Owners/authorized users can cancel any timer; regular users can cancel their own.

- **/timer list** — List timers. Owners/authorized see **all** active timers; regular users see only their own.

- **/timer stats [timeframe: all|today|week] [global:true|false]** — Show completed run time totals. By default shows the caller's completed time (aggregated from history of ended timers and pomodoro work sessions). Set `global=true` to view a leaderboard (top users by completed time).

- **/timer reset** — Reset all active timers and pomodoros and clear stored totals and history. This is restricted to the bot owner (`OWNER_ID`) or per-guild authorized users.

- **/timer manage authorize|revoke|list** — Owner-only subcommands to manage per-guild authorized resetters:

  - `authorize user:@id` — add an authorized resetter for the guild (persists across restarts)
  - `revoke user:@id` — revoke authorization
  - `list` — list authorized users in the guild

- **/timer pomodoro start work:<...> break:<...> cycles:<n>** — Start a Pomodoro session with repeated cycles.

  - Options:
    - `label` — short label for the pomodoro
    - `allow_dm` — send participant DMs when channel posting is unavailable or when configured
    - `broadcast` — announce cycles and completions `@here` in the channel
    - `participants` — space-separated mentions or IDs (e.g., `@alice @bob`); the command issuer is automatically included

- **/timer pomodoro stop [id]** — Stop a Pomodoro (owner/authorized may stop others)

- **/timer pomodoro status** — Show your active Pomodoro's current cycle, cycle time left, and total time left (formatted in `H M S`)

- **/timer pomodoro participants [id]** — Show the participant list for an active Pomodoro (owner/authorized may view all; participants can view their own sessions)

### Behavior & Persistence

- **Persistent storage:** The bot saves state to `timers-data.json` (atomic write). Persisted fields include active `timers`, `pomodoros`, per-user `totals`, `history`, and `allowedResetters` (per-guild authorized resetters).

- **Human-friendly time formatting:** Durations are shown as `1h 2m 3s`, `5m 30s`, etc., both for cycle time left and total time left in Pomodoro messages.

- **Pomodoro accounting & participant support:**

  - When a pomodoro work session completes, each participant listed is credited with the actual work duration in the per-user totals and a history entry (type `pomodoro_work`) is recorded.
  - If `allow_dm` is set (or channel posting is unavailable), the bot will send DMs to participants notifying them of work/break starts and completion.
  - The participants list is persisted on the pomodoro object and can be viewed with ` /timer pomodoro participants`.

- **Broadcasts:** `broadcast=true` makes messages channel-wide announcements that include `@here` (requires the bot to have ViewChannel/SendMessages and the ability to mention `@here`). If the bot lacks channel permissions and `allow_dm` is not set, the command is rejected.

- **Permission model:**

  - `OWNER_ID` (set via `.env`) is the primary owner with full access.
  - The owner can grant per-guild reset privileges to other users via `/timer manage authorize`.
  - Owners and authorized users can view the full timers list and cancel any timer; non-authorized users can only see/cancel their own timers.

- **Reset semantics:** `/timer reset` cancels all active timers/pomodoros, records canceled entries in history, and clears aggregated totals and history from storage. This is a destructive operation—only allowed for the owner and per-guild authorized resetters.

- **Buttons & interactions:** When possible the bot posts messages with buttons (e.g., cancel timer, stop pomodoro) for quick actions.

---

## ⚙️ Configuration & Environment

Set required environment variables in `.env`:

- `TOKEN` — Discord bot token
- `CLIENT_ID` — Application client id (for registering global commands)
- `OWNER_ID` — Your Discord user id (owner)
- (optional) `ADMIN_CHANNEL_ID` — Channel to receive delivery/failure reports instead of DMs to owner

After editing `.env`, restart the bot to pick up changes.

---

## 📦 Development

1. Install dependencies:

```bash
npm install
```

2. Register slash commands (run when you change command definitions):

```bash
npm run deploy-commands
```

3. Run the bot:

```bash
npm start
```

4. Tests (utility tests):

```bash
node tests/run-tests.js
```

---

## 📝 Troubleshooting & Notes

- If the bot lacks channel permissions and `allow_dm` is not set, the bot will refuse to create channel-wide timers/pomodoros or will instruct you to enable `allow_dm` so participants can be notified by DM.
- Delivery failures are reported to `ADMIN_CHANNEL_ID` when configured, or DM'd to `OWNER_ID`.
- The bot persists `allowedResetters` per guild; this means authorizations survive restarts.
- Consider the security of `OWNER_ID` and careful use of `/timer reset` since it clears stored totals and history.

---

## Examples

- Start a personal timer: ` /timer start time:10m label:Study`
- Start a channel-wide timer: ` /timer start time:15m broadcast:true`
- Start a pomodoro with participants and DM notifications: ` /timer pomodoro start work:25m break:5m cycles:4 participants:@alice @bob allow_dm:true label:Focus`
- Show pomodoro participants (if you're in the session or authorized): ` /timer pomodoro participants`
- Authorize a user (owner only): ` /timer manage authorize user:@alice`
- Reset and clear storage (owner or authorized): `/timer reset`

---

## Contributing

Pull requests welcome. Tests are minimal — consider adding unit tests for DM flows and permission edge cases (e.g., reset/manage authorization and owner vs non-owner behavior).

---

License: MIT
