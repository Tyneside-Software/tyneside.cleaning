/**
 * Tyneside Cleaning — booking configuration
 * Leave googleApiKey empty for demo mode (sample busy blocks).
 * Live: paste a restricted Calendar API key + public calendar ID.
 */
const CONFIG = {
  googleApiKey: "",
  calendarId: "primary",
  ownerEmail: "michael@tyneside.software",
  ownerName: "Tyneside Cleaning",
  businessName: "Book a clean",
  businessDescription:
    "Pick a free green slot. Busy times from our calendar are blocked automatically.",
  googleClientId: "",
  slotDurationMinutes: 120,
  businessDays: [1, 2, 3, 4, 5, 6],
  businessHours: { start: "08:00", end: "18:00" },
  bookingWindowDays: 28,
  minNoticeHours: 24,
  timeZone: "Europe/London",
  refreshIntervalMs: 5 * 60 * 1000,
  hideEventDetails: true,
  eventSummaryPrefix: "Cleaning for",
  bookingNoun: "clean",
};
