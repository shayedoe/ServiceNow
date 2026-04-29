# Help Desk Simulator

A local desktop app that mimics ServiceNow incident workflows. Generate a shift of 10 tickets, triage them (assign group, set priority, add notes, resolve or escalate), and get scored on each one.

## Tech stack
- **Frontend:** Electron (desktop, no browser required)
- **Backend:** Node.js + Express (runs in-process inside Electron)
- **Data:** JSON files (no database)

## Project structure
```
helpdesk-simulator/
├─ app/                  # Electron renderer UI
│  ├─ index.html
│  ├─ renderer.js
│  └─ styles.css
├─ server/               # Express API
│  └─ server.js
├─ engine/               # Ticket generator + scoring logic
│  ├─ generator.js
│  └─ scoring.js
├─ data/
│  └─ scenarios.json     # Ticket templates / categories
├─ main.js               # Electron main process (boots Express + window)
├─ preload.js
└─ package.json
```

## Run it

1. Install Node.js 18+ (https://nodejs.org).
2. Open a terminal in this folder and install dependencies:
   ```powershell
   npm install
   ```
3. Launch the desktop app:
   ```powershell
   npm start
   ```
4. Click **Start Shift** in the top-right to generate 10 random tickets.

The Express API is started automatically by Electron on `http://localhost:3017`.
You can also run it standalone for debugging:
```powershell
npm run server
```

## How it works

- **Start Shift** — `POST /api/shift/start` calls `engine/generator.js` to produce 10 tickets. Each ticket has `short_description`, `description`, `priority` (1–5), `category`, `assignment_group`, `correct_action`, `correct_group`, and `correct_steps`.
- **Scenario engine** — Generator may produce a *multi-ticket outage* batch (3–5 tickets sharing the same `short_description`). Single-user issues are also produced.
- **Triage** — Click a ticket to open the right-side detail view. Assign a group, set priority, change state (New → In Progress → Resolved), and add work notes.
- **Resolve / Escalate** — Submitting a resolution calls `POST /api/tickets/:number/resolve`, which runs `engine/scoring.js`:
  - Compares your assignment group vs `correct_group`
  - Compares your action (resolve vs escalate) vs `correct_action`
  - Compares your priority vs the ticket's expected priority
  - **Pattern detection:** If 3+ tickets in the queue share the same `short_description`, the correct action is forced to `escalate` regardless of the template.
- **Score** — Each resolved ticket returns `"X/3 correct"` plus an explanation per check and the recommended steps.

## Build a Windows .exe

This project includes `electron-builder`. To produce an installer:

```powershell
npm install
npm run build
```

The output `.exe` installer will be placed in `dist/` (e.g. `dist/HelpDeskSimulator Setup 1.0.0.exe`).

## Add your own scenarios

Edit [data/scenarios.json](data/scenarios.json). Each category has an `assignment_group` and a list of `templates`. A template can opt into outages by setting `outage_capable: true` and providing `outage_short_description`, `outage_description`, `outage_correct_action`, and `outage_correct_group`.
