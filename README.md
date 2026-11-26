# Basestar

The Guided Growth Early Learning team app. It shows at a glance who is available, on break, at lunch, or out, along with the shared schedule, time off, closures and shift swaps. It's built for phones and can be added to the home screen.

## Deploying to Netlify

1. In Netlify, choose **Add new site → Import an existing project → GitHub → `brandtz/basestar`**.
2. Leave the build settings alone; `netlify.toml` already sets them (`pnpm run build`, publish `dist`, functions in `netlify/functions`).
3. Deploy. Storage is **Netlify Blobs**, which turns on automatically, so there's no database to set up.
4. **Sign in as the owner right away.** Open the site, enter `mindy.brandt@ggearlylearning.com`, and create a password. Until this account is claimed, anyone who knows that address could claim it.

Optional environment variable:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | 32+ random characters for signing sessions. If it isn't set, the app generates a secret and stores it in Blobs, which works fine. Setting it later signs everyone out once. |

## How sign-in works

- The login page asks for a **username** first.
  - If the person is on the team list and has a password, a password field appears.
  - If they're on the list but have no password yet (new hire, or a password reset), they create one, and it's saved from then on.
  - If they're not on the list, they can't get in.
- Mindy's account (`mindy.brandt@ggearlylearning.com`) is created automatically as the **Owner** with no password, so her first sign-in is the create-password step.
- The owner adds people under **Manage → People**. Usernames are usually `firstname.lastname`.
- **Forgot password:** a manager taps **Reset password**, and the person creates a new one at their next sign-in. Resetting or deactivating someone signs them out on every device.
- Sessions last 30 days and renew with use. Eight wrong passwords lock that username for 15 minutes.

### Roles

| Role | Can do |
|---|---|
| **Owner** (`super`) | Everything, including adding managers, changing roles, and settings |
| **Manager** | Add and edit staff, edit any day's hours, approve requests, add closures and time off for others, view and export timesheets, and update anyone's status (clock in or out, start or end break or lunch), either now or at an earlier time today. Those entries are marked on the timesheet |
| **Staff** | Clock in and out, take breaks and lunch, see the team board and schedules, request time off, swaps, covers and hour changes |

## Features

- **Now** (home tab): your status, with large buttons for clock in, break, lunch, I'm back and clock out. Below that, the team grouped into *On break or at lunch* (with minutes away), *Available* and *Not in* (with the reason: off, scheduled later, clocked out, vacation). It refreshes every 30 seconds while open and pauses when the phone is locked.
- **Schedule**
  - *Day*: your hours plus a timeline of everyone working, with planned lunches and a "now" line.
  - *My week*: your seven days.
  - *Team*: a people × days grid with time off, pending requests, closures and changed days marked.
  - Tap any cell to request a swap, cover, change of hours or time off. Managers can also edit that day directly.
- **Requests**
  - Time off: vacation, sick, personal, unpaid, or part-day.
  - Shift changes: swap with a coworker, ask someone to cover, or adjust your own hours.
  - Inboxes for *waiting on you* and *to approve*, plus upcoming team time off and closures.
- **Manage** (managers only)
  - People and their regular weekly hours.
  - Closures.
  - Timesheets with CSV download. Lunch is unpaid and subtracted; rest breaks are paid.
  - Settings (owner only).

Approval rules can be changed under **Manage → Settings**:

| Setting | Default |
|---|---|
| Time off needs approval | on |
| Swaps and covers need approval | off: it goes on the schedule once the coworker accepts |
| Changing your own hours needs approval | on |

## Gusto

Gusto's [Time Tracking API](https://docs.gusto.com/app-integrations/docs/syncing-time-tracking-data) accepts **completed shifts**, not live punches (`POST /v1/companies/{company_uuid}/time_tracking/time_sheets`). Connecting it requires:

1. A Time Tracking application in the Gusto Developer Portal, connected to GGEL's Gusto account over OAuth.
2. **Turning off Gusto's own time tracking**, which makes this app the official time clock.
3. Classifying hours (regular, overtime, double) before sending them.

The hook is already in place. `server/gusto.ts → sendCompletedShift()` runs at every clock-out with the shift start and end plus lunch and break minutes, and each person has a *Gusto employee ID* field. Until it's implemented, staff still clock in on Gusto. The reminder under the clock-in button says so, and Mindy can change or clear it in Settings. The timesheet CSV is there for checking hours against Gusto.

## Local development

```bash
pnpm install
pnpm dev        # web on http://localhost:5173, API on :8788, data saved as JSON in ./.data
pnpm test:api   # end-to-end API checks against in-memory storage
pnpm build      # type-check and production build
```

No Netlify CLI is needed. `scripts/dev-server.ts` runs the same API code against local files. (`netlify dev` also works and uses a local Blobs sandbox.)

## How it's built

```
netlify/functions/api.mts   Netlify Function: every /api/* request
server/app.ts               routes and handlers (Fetch Request → Response)
server/domain.ts            schedule resolution, timesheet math, validation
server/auth.ts              scrypt password hashing, JOSE JWT in an HttpOnly cookie
server/store.ts             key-value layer: Netlify Blobs (prod), files (dev), memory (tests)
server/gusto.ts             Gusto integration seam
shared/                     types and timezone-aware date helpers used by both sides
src/                        Vue 3 + Vite mobile web app
```

- **Storage:** a handful of JSON documents in the `basestar` Blobs store: `users`, `settings`, `status`, `timeoff`, `closures`, `requests`, `overrides/YYYY-MM` (single-day schedule changes), `punches/YYYY-MM-DD` (clock events) and `audit/YYYY-MM`. Every write is a read-modify-write that only succeeds if the document hasn't changed (ETag check), with retries, so two people tapping at the same moment don't overwrite each other.
- **Schedules:** each person has regular weekly hours. A day's effective hours are any one-day change for that date, otherwise the regular hours. Approved all-day time off and closures blank the day.
- **Times:** stored as wall-clock times in the center's timezone (America/Los_Angeles by default), so "today" is always the center's today.
- **Deletes:** nothing is hard-deleted. People are deactivated, closures are soft-deleted, and requests are cancelled.
- **Security:** same-origin JSON-only writes (cross-site POSTs are rejected), HttpOnly SameSite cookies, and server-side role checks on every endpoint.
