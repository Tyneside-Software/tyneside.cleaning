# Cleaning booking (Google Calendar · Calendly-style)

Static booking UI under `booking/`. Page: `book.html`.

**Backend:** [tyneside-api](https://github.com/Tyneside-Software/tyneside-api) on Google Cloud Run.

| Call | Endpoint |
|------|----------|
| Busy slots | `GET /v1/cleaning/busy` |
| Confirm booking | `POST /v1/cleaning/bookings` |

Secrets (calendar ID, Google credentials, WhatsApp) live on Cloud Run only.  
`booking/config.js` only needs `apiBaseUrl`.

## Config (`booking/config.js`)

| Key | Meaning |
|-----|---------|
| `apiBaseUrl` | Cloud Run URL, no trailing slash |
| `apiKey` | Only if API has `API_KEY` set |

Slot knobs (duration, hours, notice, etc.) stay in this file.

## One-time Google + Cloud Run

1. **Calendar** — e.g. *Tyneside Cleaning Bookings*; copy Calendar ID.
2. On Cloud Run env: `GOOGLE_CALENDAR_ID=…@group.calendar.google.com`
3. **Writes (pick one):**
   - Service account JSON → `GOOGLE_SERVICE_ACCOUNT_JSON`, share calendar with SA email (**Make changes to events**), or
   - Share calendar with Cloud Run runtime SA (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`), or
   - Apps Script web app → `BOOKING_WEBHOOK_URL`
4. **Reads:** same SA/ADC, **or** public free/busy + `GOOGLE_API_KEY`
5. Enable **Google Calendar API** on the GCP project.

## Deploy

- API: push `tyneside-api` `main` (continuous deploy) or `gcloud run deploy …`
- Site: push `tyneside.cleaning` (GitHub Pages) or rebuild from site-generator

Open `/book.html` — status should say **Live calendar** when `/health` is up and freeBusy succeeds.

## Behaviour

- 2-hour cleans, start every **10 minutes**, **08:00–18:00**, 7 days
- Busy from host Google Calendar
- Bookings written to that calendar via the API
- Optional WhatsApp alert to Master on new booking
