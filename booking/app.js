/**
 * Google Calendar Booking System
 * Pure client-side HTML + JS — GitHub Pages compatible.
 *
 * - Loads busy times from a public Google Calendar (API key)
 * - Generates free slots only outside those events
 * - Bookings: Google Calendar event (OAuth) or template link + localStorage
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const STORAGE_KEY = "tyneside-cleaning-booking-v1";
  const CANCELLED_KEY = "tyneside-cleaning-booking-cancelled-v1";
  const BOOKING_MARKER = "Booking-ID:";

  function eventSummaryPrefix() {
    return CONFIG.eventSummaryPrefix || "Meeting with";
  }

  function bookingNoun() {
    return CONFIG.bookingNoun || "appointment";
  }

  function tz() {
    return CONFIG.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function parseHHMM(str) {
    const [h, m] = str.split(":").map(Number);
    return { h, m };
  }

  function toDateKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  function addMinutes(date, mins) {
    return new Date(date.getTime() + mins * 60000);
  }

  function formatRange(start, end) {
    const optsDate = { weekday: "short", month: "short", day: "numeric", timeZone: tz() };
    const optsTime = { hour: "numeric", minute: "2-digit", timeZone: tz() };
    const d = start.toLocaleDateString(undefined, optsDate);
    const t1 = start.toLocaleTimeString(undefined, optsTime);
    const t2 = end.toLocaleTimeString(undefined, optsTime);
    return `${d} · ${t1} – ${t2}`;
  }

  function formatIsoLocal(date) {
    // YYYYMMDDTHHmmss for Google Calendar template links (local wall time)
    return (
      date.getFullYear() +
      pad(date.getMonth() + 1) +
      pad(date.getDate()) +
      "T" +
      pad(date.getHours()) +
      pad(date.getMinutes()) +
      pad(date.getSeconds())
    );
  }

  function uid() {
    return "b_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function toast(msg, type) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast show " + (type || "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.className = "toast";
    }, 4200);
  }

  function setLoading(on) {
    document.getElementById("loading-bar").classList.toggle("active", on);
  }

  function setStatus(mode, text) {
    const pill = document.getElementById("sync-status");
    const label = document.getElementById("sync-status-text");
    pill.className = "status-pill " + mode;
    label.textContent = text;
  }

  function showBanner(text) {
    const el = document.getElementById("alert-banner");
    if (!text) {
      el.classList.remove("show");
      el.textContent = "";
      return;
    }
    el.textContent = text;
    el.classList.add("show");
  }

  // ---------------------------------------------------------------------------
  // Persistence (local bookings — optimistic UI + same-browser pending)
  // ---------------------------------------------------------------------------

  function loadLocalBookings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      const now = Date.now();
      return list.filter((b) => new Date(b.end).getTime() > now);
    } catch {
      return [];
    }
  }

  function saveLocalBookings(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  /** Slots the user cancelled — ignored if they still appear on Google Calendar. */
  function loadCancelledSlots() {
    try {
      const raw = localStorage.getItem(CANCELLED_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      const now = Date.now();
      // Keep for 14 days or until the slot end has passed + 1 day
      return list.filter((c) => {
        const end = new Date(c.end).getTime();
        const cancelledAt = new Date(c.cancelledAt || 0).getTime();
        if (end + 24 * 60 * 60 * 1000 < now) return false;
        if (cancelledAt && now - cancelledAt > 14 * 24 * 60 * 60 * 1000) return false;
        return true;
      });
    } catch {
      return [];
    }
  }

  function saveCancelledSlots(list) {
    localStorage.setItem(CANCELLED_KEY, JSON.stringify(list));
  }

  function rememberCancelledBooking(booking) {
    const list = loadCancelledSlots().filter(
      (c) => !(c.start === booking.start && c.end === booking.end)
    );
    list.push({
      id: booking.id,
      start: booking.start,
      end: booking.end,
      email: booking.email || "",
      cancelledAt: new Date().toISOString(),
      googleEventId: booking.googleEventId || null,
    });
    saveCancelledSlots(list);
    state.cancelledSlots = list;
  }

  function timesMatch(isoA, isoB, toleranceMs) {
    const tol = toleranceMs == null ? 60 * 1000 : toleranceMs;
    return Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime()) <= tol;
  }

  function isCancelledWebBookingEvent(ev) {
    const cancelled = state.cancelledSlots || [];
    if (!cancelled.length) return false;

    const startIso = typeof ev.start === "string" ? ev.start : new Date(ev.start).toISOString();
    const endIso = typeof ev.end === "string" ? ev.end : new Date(ev.end).toISOString();
    const props = ev.extendedProps || {};
    const summary = (props.summary || ev.title || "").toLowerCase();
    const description = (props.description || "").toLowerCase();
    const prefix = eventSummaryPrefix().toLowerCase();
    const looksLikeWebBooking =
      description.includes("booked by") ||
      description.includes("booked via web calendar") ||
      description.includes(BOOKING_MARKER.toLowerCase()) ||
      summary.startsWith("meeting with") ||
      summary.startsWith(prefix);

    return cancelled.some((c) => {
      // Explicit Google event id from OAuth create
      if (c.googleEventId && (ev.id === c.googleEventId || props.googleEventId === c.googleEventId)) {
        return true;
      }
      // Description still contains our Booking-ID marker
      if (c.id && description.includes(String(c.id).toLowerCase())) {
        return true;
      }
      // Same window as cancelled booking (covers free/busy-only calendars with no description,
      // and invites that landed on the host calendar after the guest saved the template)
      if (timesMatch(startIso, c.start) && timesMatch(endIso, c.end)) {
        return true;
      }
      // Broader match when event looks like a web booking but times are slightly off
      if (
        looksLikeWebBooking &&
        timesMatch(startIso, c.start, 5 * 60 * 1000) &&
        timesMatch(endIso, c.end, 5 * 60 * 1000)
      ) {
        return true;
      }
      return false;
    });
  }

  function filterActiveGoogleEvents(events) {
    return (events || []).filter((ev) => !isCancelledWebBookingEvent(ev));
  }

  /** Immediately mark a slot busy on this client after a successful OAuth book. */
  function injectOptimisticBusy(booking) {
    const id = booking.googleEventId || "opt-" + booking.id;
    const exists = state.googleEvents.some(
      (ev) =>
        ev.id === id ||
        (timesMatch(ev.start, booking.start) && timesMatch(ev.end, booking.end))
    );
    if (exists) return;
    state.googleEvents.push({
      id: id,
      title: CONFIG.hideEventDetails ? "Busy" : "Booking: " + booking.name,
      start: booking.start,
      end: booking.end,
      classNames: ["event-busy"],
      editable: false,
      overlap: false,
      display: "block",
      extendedProps: {
        kind: "google",
        summary: "Booking: " + booking.name,
        description:
          "Booked via web calendar\nGuest: " +
          booking.name +
          " <" +
          booking.email +
          ">\n" +
          BOOKING_MARKER +
          " " +
          booking.id,
        googleEventId: booking.googleEventId || id,
        optimistic: true,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Demo busy events (when no API key)
  // ---------------------------------------------------------------------------

  function buildDemoBusyEvents() {
    const events = [];
    const now = new Date();
    const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (let d = 0; d < CONFIG.bookingWindowDays; d++) {
      const day = new Date(startDay);
      day.setDate(day.getDate() + d);
      const dow = day.getDay();
      if (!CONFIG.businessDays.includes(dow)) continue;

      // Pseudo-random but stable per day
      const seed = day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate();
      const slots = [
        { h: 10, m: 0, dur: 60, title: "Team standup" },
        { h: 13, m: 0, dur: 90, title: "Client call" },
        { h: 15, m: 30, dur: 30, title: "Focus block" },
      ];

      slots.forEach((s, i) => {
        if ((seed + i * 7) % 3 === 0) return; // skip some days
        const start = new Date(day);
        start.setHours(s.h, s.m, 0, 0);
        const end = addMinutes(start, s.dur);
        if (end <= now) return;
        events.push({
          id: "demo-" + seed + "-" + i,
          title: CONFIG.hideEventDetails ? "Busy" : s.title,
          start: start.toISOString(),
          end: end.toISOString(),
          classNames: ["event-busy"],
          editable: false,
          overlap: false,
          extendedProps: { kind: "google" },
        });
      });
    }
    return events;
  }

  // ---------------------------------------------------------------------------
  // Google Calendar API
  // ---------------------------------------------------------------------------

  function isLiveMode() {
    return Boolean(CONFIG.googleApiKey && CONFIG.googleApiKey.trim());
  }

  async function fetchGoogleEvents(timeMin, timeMax) {
    const calId = encodeURIComponent(CONFIG.calendarId || "primary");
    const params = new URLSearchParams({
      key: CONFIG.googleApiKey,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      timeZone: tz(),
    });

    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?${params}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      let detail = res.statusText;
      try {
        const j = JSON.parse(body);
        detail = j.error?.message || detail;
      } catch {
        /* ignore */
      }
      throw new Error(`Google Calendar API (${res.status}): ${detail}`);
    }
    const data = await res.json();
    return (data.items || [])
      .filter((ev) => ev.status !== "cancelled")
      .map((ev) => {
        const allDay = Boolean(ev.start.date && !ev.start.dateTime);
        let start;
        let end;
        if (allDay) {
          start = new Date(ev.start.date + "T00:00:00");
          end = new Date(ev.end.date + "T00:00:00");
        } else {
          start = new Date(ev.start.dateTime);
          end = new Date(ev.end.dateTime || ev.start.dateTime);
        }
        return {
          id: ev.id,
          title: CONFIG.hideEventDetails ? "Busy" : ev.summary || "Busy",
          start: start.toISOString(),
          end: end.toISOString(),
          allDay,
          classNames: ["event-busy"],
          editable: false,
          overlap: false,
          display: "block",
          extendedProps: {
            kind: "google",
            summary: ev.summary || "",
            description: ev.description || "",
            googleEventId: ev.id,
          },
        };
      });
  }

  /**
   * Create a calendar event via OAuth (visitor signed in).
   * Event is created on the visitor's primary calendar with the owner as attendee.
   */
  function bookingDescription(booking) {
    return (
      (booking.notes ? booking.notes + "\n\n" : "") +
      `Booked via web calendar.\nGuest: ${booking.name} <${booking.email}>\n` +
      `${BOOKING_MARKER} ${booking.id}`
    );
  }

  async function createEventWithOAuth(accessToken, booking) {
    const body = {
      summary: `${eventSummaryPrefix()} ${booking.name}`,
      description: bookingDescription(booking),
      start: { dateTime: booking.start, timeZone: tz() },
      end: { dateTime: booking.end, timeZone: tz() },
      attendees: [
        { email: CONFIG.ownerEmail },
        { email: booking.email },
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 60 },
          { method: "popup", minutes: 15 },
        ],
      },
    };

    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || "Failed to create Google Calendar event");
    }
    return res.json();
  }

  async function deleteEventWithOAuth(accessToken, eventId) {
    if (!accessToken || !eventId) return false;
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      {
        method: "DELETE",
        headers: { Authorization: "Bearer " + accessToken },
      }
    );
    // 204 success, 410 already gone, 404 not found — all fine for cancel
    if (res.ok || res.status === 204 || res.status === 404 || res.status === 410) {
      return true;
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "Failed to delete calendar event");
  }

  function buildGoogleTemplateUrl(booking) {
    const start = new Date(booking.start);
    const end = new Date(booking.end);
    const text = encodeURIComponent(
      `${eventSummaryPrefix()} ${booking.name} — ${CONFIG.ownerName || CONFIG.businessName}`
    );
    const details = encodeURIComponent(
      `Booked by ${booking.name} (${booking.email})` +
        (booking.notes ? `\n\nNotes: ${booking.notes}` : "") +
        `\n\nService: ${bookingNoun()}` +
        `\n\n${BOOKING_MARKER} ${booking.id}`
    );
    const dates = `${formatIsoLocal(start)}/${formatIsoLocal(end)}`;
    const add = encodeURIComponent(CONFIG.ownerEmail || "");
    return (
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      `&text=${text}&dates=${dates}&details=${details}` +
      (add ? `&add=${add}` : "")
    );
  }

  function requestGoogleAccessToken() {
    return new Promise((resolve, reject) => {
      if (!CONFIG.googleClientId || !window.google?.accounts?.oauth2) {
        reject(new Error("Google Identity Services not available"));
        return;
      }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.googleClientId,
        scope: "https://www.googleapis.com/auth/calendar.events",
        callback: (resp) => {
          if (resp.error) {
            reject(new Error(resp.error));
            return;
          }
          resolve(resp.access_token);
        },
        error_callback: (err) => reject(err || new Error("OAuth cancelled")),
      });
      client.requestAccessToken({ prompt: "" });
    });
  }

  // ---------------------------------------------------------------------------
  // Free slot generation
  // ---------------------------------------------------------------------------

  function getBusyIntervals(googleEvents, localBookings, exceptId) {
    const intervals = [];
    filterActiveGoogleEvents(googleEvents).forEach((ev) => {
      intervals.push({ start: new Date(ev.start), end: new Date(ev.end) });
    });
    localBookings.forEach((b) => {
      if (exceptId && b.id === exceptId) return;
      intervals.push({ start: new Date(b.start), end: new Date(b.end) });
    });
    return intervals;
  }

  function isSlotFree(start, end, busy) {
    return !busy.some((b) => overlaps(start, end, b.start, b.end));
  }

  function generateAvailableSlots(busy) {
    const slots = [];
    const now = new Date();
    const minStart = addMinutes(now, CONFIG.minNoticeHours * 60);
    const { h: startH, m: startM } = parseHHMM(CONFIG.businessHours.start);
    const { h: endH, m: endM } = parseHHMM(CONFIG.businessHours.end);
    const duration = CONFIG.slotDurationMinutes;

    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (let d = 0; d < CONFIG.bookingWindowDays; d++) {
      const current = new Date(day);
      current.setDate(current.getDate() + d);
      if (!CONFIG.businessDays.includes(current.getDay())) continue;

      let cursor = new Date(current);
      cursor.setHours(startH, startM, 0, 0);
      const dayEnd = new Date(current);
      dayEnd.setHours(endH, endM, 0, 0);

      while (addMinutes(cursor, duration) <= dayEnd) {
        const slotEnd = addMinutes(cursor, duration);
        if (cursor >= minStart && isSlotFree(cursor, slotEnd, busy)) {
          slots.push({
            start: new Date(cursor),
            end: new Date(slotEnd),
          });
        }
        cursor = slotEnd;
      }
    }
    return slots;
  }

  function slotsToEvents(slots) {
    return slots.map((s) => ({
      id: "free-" + s.start.toISOString(),
      title: "Available",
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      classNames: ["event-available"],
      editable: false,
      overlap: false,
      extendedProps: { kind: "available" },
    }));
  }

  function localBookingsToEvents(bookings) {
    return bookings.map((b) => ({
      id: b.id,
      title: "Pending: " + b.name,
      start: b.start,
      end: b.end,
      classNames: ["event-pending"],
      editable: false,
      overlap: false,
      extendedProps: { kind: "local", booking: b },
    }));
  }

  // ---------------------------------------------------------------------------
  // App state & UI
  // ---------------------------------------------------------------------------

  const state = {
    googleEvents: [],
    localBookings: loadLocalBookings(),
    cancelledSlots: loadCancelledSlots(),
    availableEvents: [],
    calendar: null,
    selectedSlot: null,
    oauthToken: null,
  };

  function allCalendarEvents() {
    return [
      ...filterActiveGoogleEvents(state.googleEvents),
      ...localBookingsToEvents(state.localBookings),
      ...state.availableEvents,
    ];
  }

  function recomputeAvailability() {
    const busy = getBusyIntervals(state.googleEvents, state.localBookings);
    const slots = generateAvailableSlots(busy);
    state.availableEvents = slotsToEvents(slots);
  }

  function refreshCalendarEvents() {
    if (!state.calendar) return;
    // Prefer refetch via event source (reliable redraw after cancel/book)
    const sources = state.calendar.getEventSources();
    if (sources && sources.length) {
      sources.forEach((src) => src.refetch());
      return;
    }
    // Fallback: hard replace
    state.calendar.batchRendering(() => {
      state.calendar.getEvents().forEach((ev) => ev.remove());
      allCalendarEvents().forEach((ev) => state.calendar.addEvent(ev));
    });
  }

  function renderUpcoming() {
    const list = document.getElementById("upcoming-list");
    const count = document.getElementById("booking-count");
    const upcoming = [...state.localBookings].sort(
      (a, b) => new Date(a.start) - new Date(b.start)
    );
    count.textContent = upcoming.length ? `(${upcoming.length})` : "";

    if (!upcoming.length) {
      list.innerHTML =
        '<p class="empty">No bookings yet. Pick a green slot to book a ' +
        escapeHtml(bookingNoun()) +
        ".</p>";
      return;
    }

    list.innerHTML = upcoming
      .map(
        (b) => `
      <div class="booking-item" data-id="${b.id}">
        <strong>${escapeHtml(b.name)}</strong>
        <div class="meta">${escapeHtml(formatRange(new Date(b.start), new Date(b.end)))}</div>
        <div class="meta">${escapeHtml(b.email)}</div>
        <div class="actions">
          <button type="button" data-cancel="${b.id}">Cancel</button>
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cancelId = btn.getAttribute("data-cancel");
        btn.disabled = true;
        Promise.resolve(cancelBooking(cancelId)).finally(() => {
          // list is re-rendered; ignore if node is gone
        });
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function cancelBooking(id) {
    const booking = state.localBookings.find((b) => b.id === id);
    if (!booking) {
      const leftover = state.calendar?.getEventById(id);
      if (leftover) leftover.remove();
      recomputeAvailability();
      refreshCalendarEvents();
      renderUpcoming();
      return;
    }

    // OAuth path: delete event from the guest's calendar if we created one
    if (booking.googleEventId && CONFIG.googleClientId) {
      try {
        const token =
          state.oauthToken || (await requestGoogleAccessToken());
        if (token) {
          state.oauthToken = token;
          await deleteEventWithOAuth(token, booking.googleEventId);
        }
      } catch (err) {
        console.warn("Could not delete Google Calendar event:", err);
      }
    }

    state.localBookings = state.localBookings.filter((b) => b.id !== id);
    saveLocalBookings(state.localBookings);
    rememberCancelledBooking(booking);

    if (state.calendar) {
      state.calendar.getEvents().forEach((ev) => {
        const kind = ev.extendedProps?.kind;
        if (ev.id === id || ev.extendedProps?.booking?.id === id) {
          ev.remove();
          return;
        }
        if (
          kind === "local" &&
          timesMatch(ev.start.toISOString(), booking.start) &&
          timesMatch(ev.end.toISOString(), booking.end)
        ) {
          ev.remove();
          return;
        }
        if (
          kind === "google" &&
          isCancelledWebBookingEvent({
            id: ev.id,
            start: ev.start.toISOString(),
            end: ev.end.toISOString(),
            title: ev.title,
            extendedProps: ev.extendedProps,
          })
        ) {
          ev.remove();
        }
      });
    }

    recomputeAvailability();
    refreshCalendarEvents();
    renderUpcoming();
    // Pull host calendar so other devices/guests see the free slot after cancel
    await syncCalendar();
    toast("Booking cancelled — slot is free again for another " + bookingNoun(), "ok");
  }

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------

  function openModal(start, end) {
    state.selectedSlot = { start, end };
    document.getElementById("modal-slot").textContent = formatRange(start, end);
    document.getElementById("booking-form").reset();
    document.getElementById("booking-modal").classList.add("open");
    document.getElementById("guest-name").focus();
  }

  function closeModal() {
    state.selectedSlot = null;
    document.getElementById("booking-modal").classList.remove("open");
  }

  async function submitBooking(e) {
    e.preventDefault();
    if (!state.selectedSlot) return;

    const name = document.getElementById("guest-name").value.trim();
    const email = document.getElementById("guest-email").value.trim();
    const notes = document.getElementById("guest-notes").value.trim();
    const start = state.selectedSlot.start;
    const end = state.selectedSlot.end;

    const confirmBtn = document.getElementById("btn-confirm");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Checking…";

    try {
      // Fresh calendar pull so we don't offer a slot that just filled
      await syncCalendar();

      const busy = getBusyIntervals(state.googleEvents, state.localBookings);
      if (!isSlotFree(start, end, busy)) {
        toast("That slot is no longer available. Please pick another.", "err");
        closeModal();
        return;
      }

      const booking = {
        id: uid(),
        name,
        email,
        notes,
        start: start.toISOString(),
        end: end.toISOString(),
        createdAt: new Date().toISOString(),
      };

      confirmBtn.textContent = "Booking…";

      let mode = "local"; // local | oauth

      if (CONFIG.googleClientId && CONFIG.googleClientId.trim()) {
        try {
          const token = state.oauthToken || (await requestGoogleAccessToken());
          state.oauthToken = token;
          const created = await createEventWithOAuth(token, booking);
          if (created.htmlLink) booking.htmlLink = created.htmlLink;
          if (created.id) booking.googleEventId = created.id;
          mode = "oauth";
        } catch (oauthErr) {
          console.warn("OAuth booking failed, falling back to template link:", oauthErr);
          mode = "local";
        }
      }

      // Clear cancel-suppress for this window so the new booking shows as busy
      state.cancelledSlots = (state.cancelledSlots || []).filter(
        (c) => !(timesMatch(c.start, booking.start) && timesMatch(c.end, booking.end))
      );
      saveCancelledSlots(state.cancelledSlots);

      state.localBookings.push(booking);
      saveLocalBookings(state.localBookings);

      // Optimistic busy block so the slot cannot be re-clicked while GCal API catches up
      if (mode === "oauth") {
        injectOptimisticBusy(booking);
      }

      recomputeAvailability();
      refreshCalendarEvents();
      renderUpcoming();
      closeModal();

      if (mode === "oauth") {
        toast("Booked! Calendar invite sent.", "ok");
        await syncCalendar();
      } else {
        toast("Booked! Opening Google Calendar to save the event…", "ok");
        window.open(buildGoogleTemplateUrl(booking), "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error(err);
      toast(err.message || "Booking failed", "err");
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Confirm " + bookingNoun();
    }
  }

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  async function syncCalendar() {
    setLoading(true);
    const rangeStart = new Date();
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + CONFIG.bookingWindowDays + 1);

    try {
      // Keep cancelled list in sync with storage (other tabs / long sessions)
      state.cancelledSlots = loadCancelledSlots();

      if (isLiveMode()) {
        state.googleEvents = await fetchGoogleEvents(rangeStart, rangeEnd);
        setStatus("live", "Synced with Google Calendar");
        showBanner("");
      } else {
        state.googleEvents = buildDemoBusyEvents();
        setStatus("demo", "Demo mode — add API key in config.js");
        showBanner(
          "Demo mode: showing sample busy times. Set googleApiKey and calendarId in config.js for live sync."
        );
      }
      recomputeAvailability();
      refreshCalendarEvents();
    } catch (err) {
      console.error(err);
      setStatus("error", "Sync failed");
      showBanner(
        "Could not load Google Calendar: " +
          err.message +
          " Using any local bookings only. Check API key, Calendar ID, and that the calendar is public."
      );
      state.googleEvents = [];
      recomputeAvailability();
      refreshCalendarEvents();
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // FullCalendar init
  // ---------------------------------------------------------------------------

  function initCalendar() {
    const el = document.getElementById("calendar");
    const { h: startH } = parseHHMM(CONFIG.businessHours.start);
    const { h: endH, m: endM } = parseHHMM(CONFIG.businessHours.end);
    // Show a little padding around business hours
    const slotMin = pad(Math.max(0, startH - 1)) + ":00:00";
    const slotMaxHour = endM > 0 ? endH + 1 : endH;
    const slotMax = pad(Math.min(24, slotMaxHour + 1)) + ":00:00";

    state.calendar = new FullCalendar.Calendar(el, {
      initialView: window.matchMedia("(max-width: 700px)").matches
        ? "timeGridDay"
        : "timeGridWeek",
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "timeGridDay,timeGridWeek",
      },
      height: "auto",
      allDaySlot: false,
      nowIndicator: true,
      slotMinTime: slotMin,
      slotMaxTime: slotMax,
      slotDuration: "00:30:00",
      snapDuration: "00:" + pad(CONFIG.slotDurationMinutes) + ":00",
      weekends: CONFIG.businessDays.includes(0) || CONFIG.businessDays.includes(6),
      businessHours: {
        daysOfWeek: CONFIG.businessDays,
        startTime: CONFIG.businessHours.start,
        endTime: CONFIG.businessHours.end,
      },
      selectable: false,
      eventClick(info) {
        const ev = info.event;
        const kind = ev.extendedProps?.kind;
        const classes = Array.isArray(ev.classNames)
          ? ev.classNames
          : [...(ev.classNames || [])];
        if (kind === "available" || classes.includes("event-available")) {
          openModal(ev.start, ev.end);
          return;
        }
        if (kind === "google" || classes.includes("event-busy")) {
          toast("That time is busy on the calendar.", "err");
          return;
        }
        if (kind === "local" || classes.includes("event-pending")) {
          toast("You already have a pending booking here.", "err");
        }
      },
      eventDidMount(info) {
        const names = info.event.classNames || [];
        const list = Array.isArray(names) ? names : [...names];
        if (list.includes("event-available") || info.event.extendedProps?.kind === "available") {
          info.el.title = "Click to book this slot";
        }
      },
      // Function source so cancel/book can refetch cleanly
      events(fetchInfo, successCallback) {
        successCallback(allCalendarEvents());
      },
    });

    state.calendar.render();
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  function applyBranding() {
    document.title = CONFIG.businessName || "Book a Meeting";
    document.getElementById("business-name").textContent =
      CONFIG.businessName || "Book a Meeting";
    document.getElementById("business-desc").textContent =
      CONFIG.businessDescription || "";
    document.getElementById("owner-line").textContent = CONFIG.ownerName
      ? `Host: ${CONFIG.ownerName}${CONFIG.ownerEmail ? " · " + CONFIG.ownerEmail : ""}`
      : "Host calendar synced for availability.";
  }

  function bindUi() {
    document.getElementById("btn-refresh").addEventListener("click", () => {
      syncCalendar().then(() => toast("Calendar refreshed", "ok"));
    });
    document.getElementById("btn-cancel").addEventListener("click", closeModal);
    document.getElementById("booking-modal").addEventListener("click", (e) => {
      if (e.target.id === "booking-modal") closeModal();
    });
    document.getElementById("booking-form").addEventListener("submit", submitBooking);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  async function main() {
    if (typeof CONFIG === "undefined") {
      document.body.innerHTML =
        "<p style='padding:2rem;font-family:sans-serif'>Missing config.js</p>";
      return;
    }
    if (typeof FullCalendar === "undefined") {
      document.body.innerHTML =
        "<p style='padding:2rem;font-family:sans-serif'>Failed to load FullCalendar CDN.</p>";
      return;
    }

    applyBranding();
    bindUi();
    initCalendar();
    renderUpcoming();
    await syncCalendar();

    if (CONFIG.refreshIntervalMs > 0) {
      setInterval(() => {
        syncCalendar();
      }, CONFIG.refreshIntervalMs);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
