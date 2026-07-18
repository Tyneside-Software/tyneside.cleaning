# Cleaning booking (Google Calendar · Calendly-style)

Static booking UI under `static/booking/`. Generated page: `book.html`.

**Behaviour**

- 2-hour cleans
- Can start every **10 minutes** from **08:00–16:00** (so the clean ends by 18:00)
- **7 days** a week
- Busy blocks come from **one Google Calendar** (you put “no cleaners” / personal busy there yourself)
- Bookings are written back onto **that same calendar** via a tiny Apps Script webhook

---

## Easiest finish path (about 15 minutes)

You only need three secrets in `static/booking/config.js`:

| Field | What it is |
|-------|------------|
| `calendarId` | The calendar’s ID string |
| `googleApiKey` | API key that can call Calendar freeBusy |
| `bookingWebhookUrl` | Apps Script web-app URL that creates events |

### A. Calendar (you have Google Calendar open)

1. Create a calendar named e.g. **Tyneside Cleaning Bookings** (or use an existing one).
2. **Settings** (gear) → open that calendar → **Integrate calendar**.
3. Copy **Calendar ID** (looks like `something@group.calendar.google.com` or your Gmail).
4. Under **Access permissions for events**:
   - Turn on **Make available to public**
   - Set to **See only free/busy (hide details)** — enough for the site; keeps titles private.
5. Paste the ID into `config.js` → `calendarId`.

Busy management later: just create normal events on this calendar (“No cleaners”, holidays, etc.). Those times stop being bookable.

### B. API key (read free/busy)

1. [Google Cloud Console](https://console.cloud.google.com/) → create or pick a project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **Credentials → Create credentials → API key**.
4. Restrict the key:
   - **API restrictions**: only Google Calendar API
   - **Application restrictions** (HTTP referrers), e.g.:
     - `https://tyneside.cleaning/*`
     - `http://localhost/*` / `http://127.0.0.1/*` for local preview
5. Paste into `config.js` → `googleApiKey`.

### C. Apps Script (write bookings onto your calendar)

Plain API keys **cannot** create events on your calendar. A one-file Apps Script web app is the simplest writer (no server, free, runs as you).

1. Open [script.google.com](https://script.google.com) → **New project**.
2. Paste `static/booking/apps-script/Code.gs`.
3. Set `CALENDAR_ID` to the **same** calendar ID as in `config.js`.
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Authorise when prompted.
6. Copy the **Web app URL** into `config.js` → `bookingWebhookUrl`.
7. Open that URL in a browser — you should see `{"ok":true,"service":"tyneside-cleaning-booking",...}`.

### D. Rebuild & check

```bash
python -m site_generator cleaning
```

Open `book.html` (local preview or live). Status pill should say **Synced with Google Calendar**.

Book a test slot with Master’s own email. It should appear on the bookings calendar within seconds; refresh the page and that window should show busy.

---

## Optional: OAuth guest path

If `bookingWebhookUrl` is empty but `googleClientId` is set, guests can sign in with Google and create an invite on **their** calendar with Master as attendee. Prefer the Apps Script path for true host-calendar ownership.

Without webhook **or** client ID, confirm still opens a Google Calendar **template** tab (guest must click save).

---

## Config knobs (`config.js`)

| Key | Default | Meaning |
|-----|---------|---------|
| `slotDurationMinutes` | `120` | Length of each clean |
| `slotStepMinutes` | `10` | Start every N minutes |
| `businessHours` | `08:00`–`18:00` | Day window (last start = end − duration) |
| `businessDays` | all 7 | `0`=Sun … `6`=Sat |
| `minNoticeHours` | `24` | No same-day short notice |
| `bookingWindowDays` | `28` | How far ahead to show |

---

## Privacy note

Public free/busy is enough for availability. Customer names live on **your** calendar via Apps Script (only you and the guest invite see details), not on a fully public event feed.
