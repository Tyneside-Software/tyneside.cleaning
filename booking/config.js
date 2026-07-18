/**
 * Tyneside Cleaning — booking configuration
 *
 * Live mode needs:
 *   1. googleApiKey  — Google Cloud API key (Calendar API enabled)
 *   2. calendarId    — full calendar ID (email or …@group.calendar.google.com)
 *                      NOT the word "primary" (that only works when signed in)
 *   3. bookingWebhookUrl — Google Apps Script web-app URL (writes to YOUR calendar)
 *
 * Without an API key the page runs in demo mode with sample busy blocks.
 * See sites/cleaning/README.md for the click-by-click Google setup.
 */
const CONFIG = {
  // --- Google (fill these in) ---
  googleApiKey: "AIzaSyChyxjxLGBzwB-Mm6aShlMOJK_RWaYT1PI",
  calendarId: "REPLACE_WITH_CALENDAR_ID",
  /** Apps Script web app URL — creates events on the host calendar. Preferred. */
  bookingWebhookUrl: "",
  /**
   * Optional OAuth client ID. Only needed if you skip the Apps Script webhook;
   * guests sign in and create an invite on their own calendar.
   */
  googleClientId: "",

  ownerEmail: "michael@tyneside.software",
  ownerName: "Tyneside Cleaning",
  businessName: "Book a clean",
  businessDescription:
    "Choose a free start time over the next 28 days. Each clean is 2 hours. Busy times from our calendar are blocked automatically.",

  // --- Slot rules (Calendly-style) ---
  /** Length of each booking. */
  slotDurationMinutes: 120,
  /** How often a clean can start (every N minutes). */
  slotStepMinutes: 10,
  /** 0=Sun … 6=Sat — all seven days. */
  businessDays: [0, 1, 2, 3, 4, 5, 6],
  /** Inclusive start; last start is end minus slotDuration. */
  businessHours: { start: "08:00", end: "18:00" },
  bookingWindowDays: 28,
  minNoticeHours: 24,
  timeZone: "Europe/London",
  refreshIntervalMs: 5 * 60 * 1000,

  hideEventDetails: true,
  eventSummaryPrefix: "Cleaning for",
  bookingNoun: "clean",
};
