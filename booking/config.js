/**
 * Tyneside Cleaning — booking configuration
 *
 * Live mode: tyneside-api on Google Cloud Run
 *   https://github.com/Tyneside-Software/tyneside-api
 *
 * Secrets (calendar ID, API keys, service account) live on Cloud Run only.
 * This file only needs the public API base URL.
 */
const CONFIG = {
  // --- Backend (Cloud Run) ---
  /** No trailing slash. Empty = demo mode with sample busy blocks. */
  apiBaseUrl: "https://tyneside-api-git-975511976696.europe-west1.run.app",
  /** Only if Cloud Run has API_KEY set — sent as X-Tyneside-Key. */
  apiKey: "",

  // Legacy direct-Google fields (unused when apiBaseUrl is set)
  googleApiKey: "",
  calendarId: "",
  bookingWebhookUrl: "",
  googleClientId: "",

  ownerEmail: "michael@tyneside.software",
  ownerName: "Tyneside Cleaning",
  businessName: "Book a clean",
  businessDescription:
    "Choose a free start time over the next 28 days. Each clean is 2 hours. Busy times from our calendar are blocked automatically.",

  // --- Slot rules (Calendly-style) ---
  slotDurationMinutes: 120,
  slotStepMinutes: 10,
  businessDays: [0, 1, 2, 3, 4, 5, 6],
  businessHours: { start: "08:00", end: "18:00" },
  bookingWindowDays: 28,
  minNoticeHours: 24,
  timeZone: "Europe/London",
  refreshIntervalMs: 5 * 60 * 1000,

  hideEventDetails: true,
  eventSummaryPrefix: "Cleaning for",
  bookingNoun: "clean",
};
