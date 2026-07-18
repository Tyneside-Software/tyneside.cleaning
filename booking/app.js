/**
 * Tyneside Cleaning — Calendly-style booking
 * Pure client-side — GitHub Pages compatible.
 *
 * Flow: pick a day (next N days) → pick a start time → enter details → confirm
 * Busy: Google freeBusy · Write: Apps Script webhook → OAuth → template link
 */

(function () {
  "use strict";

  const STORAGE_KEY = "tyneside-cleaning-booking-v1";
  const CANCELLED_KEY = "tyneside-cleaning-booking-cancelled-v1";
  const BOOKING_MARKER = "Booking-ID:";

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  function addMinutes(date, mins) {
    return new Date(date.getTime() + mins * 60000);
  }

  function formatRange(start, end) {
    const optsDate = {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: tz(),
    };
    const optsTime = { hour: "numeric", minute: "2-digit", timeZone: tz() };
    const d = start.toLocaleDateString(undefined, optsDate);
    const t1 = start.toLocaleTimeString(undefined, optsTime);
    const t2 = end.toLocaleTimeString(undefined, optsTime);
    return `${d} · ${t1} – ${t2}`;
  }

  function formatTime(date) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz(),
    });
  }

  function formatLongDate(date) {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: tz(),
    });
  }

  function formatIsoLocal(date) {
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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    const bar = document.getElementById("loading-bar");
    if (bar) bar.classList.toggle("active", on);
  }

  function setStatus(mode, text) {
    const pill = document.getElementById("sync-status");
    const label = document.getElementById("sync-status-text");
    if (pill) pill.className = "status-pill " + mode;
    if (label) label.textContent = text;
  }

  function showBanner(text) {
    const el = document.getElementById("alert-banner");
    if (!el) return;
    if (!text) {
      el.classList.remove("show");
      el.textContent = "";
      return;
    }
    el.textContent = text;
    el.classList.add("show");
  }

  // ---------------------------------------------------------------------------
  // Persistence
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

  function loadCancelledSlots() {
    try {
      const raw = localStorage.getItem(CANCELLED_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      const now = Date.now();
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
      if (c.googleEventId && (ev.id === c.googleEventId || props.googleEventId === c.googleEventId)) {
        return true;
      }
      if (c.id && description.includes(String(c.id).toLowerCase())) return true;
      if (timesMatch(startIso, c.start) && timesMatch(endIso, c.end)) return true;
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
      title: "Busy",
      start: booking.start,
      end: booking.end,
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
  // Demo + Google
  // ---------------------------------------------------------------------------

  function buildDemoBusyEvents() {
    const events = [];
    const now = new Date();
    const startDay = startOfDay(now);

    for (let d = 0; d < CONFIG.bookingWindowDays; d++) {
      const day = new Date(startDay);
      day.setDate(day.getDate() + d);
      if (!CONFIG.businessDays.includes(day.getDay())) continue;

      const seed = day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate();
      const blocks = [
        { h: 10, m: 0, dur: 60 },
        { h: 13, m: 0, dur: 90 },
        { h: 15, m: 30, dur: 30 },
      ];

      blocks.forEach((s, i) => {
        if ((seed + i * 7) % 3 === 0) return;
        const start = new Date(day);
        start.setHours(s.h, s.m, 0, 0);
        const end = addMinutes(start, s.dur);
        if (end <= now) return;
        events.push({
          id: "demo-" + seed + "-" + i,
          title: "Busy",
          start: start.toISOString(),
          end: end.toISOString(),
          extendedProps: { kind: "google" },
        });
      });
    }
    return events;
  }

  function isLiveMode() {
    return Boolean(CONFIG.googleApiKey && CONFIG.googleApiKey.trim());
  }

  async function fetchGoogleBusy(timeMin, timeMax) {
    const calendarId = (CONFIG.calendarId || "").trim();
    if (!calendarId || calendarId === "primary" || calendarId === "REPLACE_WITH_CALENDAR_ID") {
      throw new Error(
        'Set calendarId in config.js to the full Calendar ID (not "primary").'
      );
    }

    const params = new URLSearchParams({ key: CONFIG.googleApiKey });
    const url = `https://www.googleapis.com/calendar/v3/freeBusy?${params}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: tz(),
        items: [{ id: calendarId }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      let detail = res.statusText;
      try {
        detail = JSON.parse(body).error?.message || detail;
      } catch {
        /* ignore */
      }
      throw new Error(`Google freeBusy (${res.status}): ${detail}`);
    }

    const data = await res.json();
    const cal = data.calendars && data.calendars[calendarId];
    if (!cal) throw new Error("Calendar not returned by freeBusy — check calendarId.");
    if (cal.errors && cal.errors.length) {
      const msg = cal.errors.map((e) => e.reason || e.message).join("; ");
      throw new Error(
        "freeBusy calendar error: " +
          msg +
          ". Make the calendar public (free/busy is enough) and check the ID."
      );
    }

    return (cal.busy || []).map((block, i) => {
      const start = new Date(block.start);
      const end = new Date(block.end);
      return {
        id: "busy-" + start.toISOString() + "-" + i,
        title: "Busy",
        start: start.toISOString(),
        end: end.toISOString(),
        extendedProps: { kind: "google", summary: "Busy", description: "", googleEventId: null },
      };
    });
  }

  function bookingDescription(booking) {
    return (
      (booking.notes ? booking.notes + "\n\n" : "") +
      `Booked via web calendar.\nGuest: ${booking.name} <${booking.email}>\n` +
      `${BOOKING_MARKER} ${booking.id}`
    );
  }

  async function createEventWithWebhook(booking) {
    const url = (CONFIG.bookingWebhookUrl || "").trim();
    if (!url) throw new Error("bookingWebhookUrl not configured");

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        id: booking.id,
        name: booking.name,
        email: booking.email,
        notes: booking.notes || "",
        start: booking.start,
        end: booking.end,
        summary: `${eventSummaryPrefix()} ${booking.name}`,
        description: bookingDescription(booking),
        timeZone: tz(),
      }),
      redirect: "follow",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || "Booking webhook failed (" + res.status + ")");
    }
    return { id: data.id || null, htmlLink: data.htmlLink || null };
  }

  async function createEventWithOAuth(accessToken, booking) {
    const body = {
      summary: `${eventSummaryPrefix()} ${booking.name}`,
      description: bookingDescription(booking),
      start: { dateTime: booking.start, timeZone: tz() },
      end: { dateTime: booking.end, timeZone: tz() },
      attendees: [{ email: CONFIG.ownerEmail }, { email: booking.email }],
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
    if (res.ok || res.status === 204 || res.status === 404 || res.status === 410) return true;
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
  // Availability
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

  /** All free start times across the booking window (default 28 days). */
  function generateAvailableSlots(busy) {
    const slots = [];
    const now = new Date();
    const minStart = addMinutes(now, (CONFIG.minNoticeHours || 0) * 60);
    const { h: startH, m: startM } = parseHHMM(CONFIG.businessHours.start);
    const { h: endH, m: endM } = parseHHMM(CONFIG.businessHours.end);
    const duration = CONFIG.slotDurationMinutes || 120;
    const step = CONFIG.slotStepMinutes || duration;
    const windowDays = CONFIG.bookingWindowDays || 28;

    const day0 = startOfDay(now);

    for (let d = 0; d < windowDays; d++) {
      const current = new Date(day0);
      current.setDate(current.getDate() + d);
      if (!CONFIG.businessDays.includes(current.getDay())) continue;

      let cursor = new Date(current);
      cursor.setHours(startH, startM, 0, 0);
      const dayEnd = new Date(current);
      dayEnd.setHours(endH, endM, 0, 0);

      while (addMinutes(cursor, duration) <= dayEnd) {
        const slotEnd = addMinutes(cursor, duration);
        if (cursor >= minStart && isSlotFree(cursor, slotEnd, busy)) {
          slots.push({ start: new Date(cursor), end: new Date(slotEnd) });
        }
        cursor = addMinutes(cursor, step);
      }
    }
    return slots;
  }

  function recomputeAvailability() {
    const busy = getBusyIntervals(state.googleEvents, state.localBookings);
    state.availableSlots = generateAvailableSlots(busy);
    state.slotsByDay = {};
    state.availableSlots.forEach((s) => {
      const key = toDateKey(s.start);
      if (!state.slotsByDay[key]) state.slotsByDay[key] = [];
      state.slotsByDay[key].push(s);
    });
  }

  function windowBounds() {
    const start = startOfDay(new Date());
    const end = new Date(start);
    end.setDate(end.getDate() + (CONFIG.bookingWindowDays || 28) - 1);
    return { start, end };
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = {
    googleEvents: [],
    localBookings: loadLocalBookings(),
    cancelledSlots: loadCancelledSlots(),
    availableSlots: [],
    slotsByDay: {},
    selectedDateKey: null,
    selectedSlot: null,
    oauthToken: null,
    step: "slots",
  };

  // ---------------------------------------------------------------------------
  // UI: steps (date/time buttons — no month calendar)
  // ---------------------------------------------------------------------------

  function showStep(step) {
    state.step = step;
    ["slots", "details", "success"].forEach((name) => {
      const el = document.getElementById("step-" + name);
      if (el) el.hidden = name !== step;
    });
    updateSelectedSummary();
  }

  function updateSelectedSummary() {
    const box = document.getElementById("selected-summary");
    const text = document.getElementById("selected-summary-text");
    if (!box || !text) return;

    if (state.selectedSlot) {
      box.hidden = false;
      text.textContent = formatRange(state.selectedSlot.start, state.selectedSlot.end);
      return;
    }
    if (state.selectedDateKey) {
      const [y, m, d] = state.selectedDateKey.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      box.hidden = false;
      text.textContent = formatLongDate(dt);
      return;
    }
    box.hidden = true;
    text.textContent = "";
  }

  /** Ordered list of date keys that still have free starts. */
  function availableDateKeys() {
    return Object.keys(state.slotsByDay)
      .filter((k) => (state.slotsByDay[k] || []).length > 0)
      .sort();
  }

  function formatDateBtnParts(date) {
    const weekday = date.toLocaleDateString(undefined, {
      weekday: "short",
      timeZone: tz(),
    });
    const day = date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      timeZone: tz(),
    });
    return { weekday, day };
  }

  function renderDateList() {
    const list = document.getElementById("date-list");
    if (!list) return;

    const keys = availableDateKeys();
    if (!keys.length) {
      list.innerHTML =
        '<p class="cal-dates-empty">No free starts in the next ' +
        (CONFIG.bookingWindowDays || 28) +
        " days. Try again later or WhatsApp us.</p>";
      const times = document.getElementById("time-list");
      if (times) {
        times.innerHTML = '<p class="cal-times-empty">No times available.</p>';
      }
      return;
    }

    // Keep selection if still valid; otherwise pick the first free day
    if (!state.selectedDateKey || !keys.includes(state.selectedDateKey)) {
      state.selectedDateKey = keys[0];
    }

    list.innerHTML = keys
      .map((key) => {
        const [y, m, d] = key.split("-").map(Number);
        const date = new Date(y, m - 1, d);
        const parts = formatDateBtnParts(date);
        const count = (state.slotsByDay[key] || []).length;
        const selected = key === state.selectedDateKey ? " is-selected" : "";
        return (
          `<button type="button" class="cal-date-btn${selected}" data-date="${key}" ` +
          `role="option" aria-selected="${key === state.selectedDateKey}">` +
          `<span class="cal-date-weekday">${escapeHtml(parts.weekday)}</span>` +
          `<span class="cal-date-day">${escapeHtml(parts.day)}</span>` +
          `<span class="cal-date-count">${count} free</span>` +
          `</button>`
        );
      })
      .join("");

    list.querySelectorAll(".cal-date-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectDate(btn.getAttribute("data-date"));
      });
    });

    renderTimeList();
  }

  function selectDate(dateKey) {
    state.selectedDateKey = dateKey;
    state.selectedSlot = null;
    renderDateList();
    updateSelectedSummary();
  }

  function renderTimeList() {
    const list = document.getElementById("time-list");
    const heading = document.getElementById("time-heading");
    const sub = document.getElementById("time-sub");
    if (!list) return;

    if (!state.selectedDateKey) {
      list.innerHTML = '<p class="cal-times-empty">Pick a date to see times.</p>';
      return;
    }

    const [y, m, d] = state.selectedDateKey.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (heading) heading.textContent = "Time";
    if (sub) {
      sub.hidden = false;
      sub.textContent =
        formatLongDate(date) +
        " · until end = start + " +
        (CONFIG.slotDurationMinutes || 120) +
        " min";
    }

    const slots = state.slotsByDay[state.selectedDateKey] || [];
    if (!slots.length) {
      list.innerHTML =
        '<p class="cal-times-empty">No free starts on this day. Pick another date.</p>';
      return;
    }

    list.innerHTML = slots
      .map((s, i) => {
        const startLabel = formatTime(s.start);
        const endLabel = formatTime(s.end);
        return (
          `<button type="button" class="cal-time" data-slot-index="${i}" role="option">` +
          `<span>${escapeHtml(startLabel)}</span>` +
          `<span class="cal-time-end">until ${escapeHtml(endLabel)}</span>` +
          `</button>`
        );
      })
      .join("");

    list.querySelectorAll(".cal-time").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-slot-index"));
        const slot = slots[idx];
        if (!slot) return;
        openDetails(slot.start, slot.end);
      });
    });
  }

  function openDetails(start, end) {
    const startDate = start instanceof Date ? start : new Date(start);
    const endDate = end instanceof Date ? end : new Date(end);
    state.selectedSlot = { start: startDate, end: endDate };
    const slotEl = document.getElementById("modal-slot");
    if (slotEl) slotEl.textContent = formatRange(startDate, endDate);
    const form = document.getElementById("booking-form");
    if (form) form.reset();
    updateSelectedSummary();
    showStep("details");
    const name = document.getElementById("guest-name");
    if (name) name.focus();
  }

  function renderUpcoming() {
    const list = document.getElementById("upcoming-list");
    const count = document.getElementById("booking-count");
    if (!list) return;

    const upcoming = [...state.localBookings].sort(
      (a, b) => new Date(a.start) - new Date(b.start)
    );
    if (count) count.textContent = upcoming.length ? `(${upcoming.length})` : "";

    if (!upcoming.length) {
      list.innerHTML = '<p class="empty">None yet on this device.</p>';
      return;
    }

    list.innerHTML = upcoming
      .map(
        (b) => `
      <div class="booking-item" data-id="${escapeHtml(b.id)}">
        <strong>${escapeHtml(b.name)}</strong>
        <div class="meta">${escapeHtml(formatRange(new Date(b.start), new Date(b.end)))}</div>
        <div class="meta">${escapeHtml(b.email)}</div>
        <div class="actions">
          <button type="button" data-cancel="${escapeHtml(b.id)}">Cancel</button>
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.disabled = true;
        cancelBooking(btn.getAttribute("data-cancel"));
      });
    });
  }

  function refreshUi() {
    recomputeAvailability();
    if (state.selectedDateKey && !(state.slotsByDay[state.selectedDateKey] || []).length) {
      state.selectedDateKey = null;
      if (state.step === "details") {
        state.selectedSlot = null;
        showStep("slots");
      }
    }
    if (state.step === "slots" || state.step === "details") {
      renderDateList();
    }
    if (state.selectedSlot && state.step === "details") {
      const slotEl = document.getElementById("modal-slot");
      if (slotEl) {
        slotEl.textContent = formatRange(state.selectedSlot.start, state.selectedSlot.end);
      }
    }
    updateSelectedSummary();
    renderUpcoming();
  }

  async function cancelBooking(id) {
    const booking = state.localBookings.find((b) => b.id === id);
    if (!booking) {
      recomputeAvailability();
      refreshUi();
      return;
    }

    if (booking.googleEventId && CONFIG.googleClientId) {
      try {
        const token = state.oauthToken || (await requestGoogleAccessToken());
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
    await syncCalendar();
    toast("Booking cancelled — that start is free again", "ok");
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
      await syncCalendar();

      const busy = getBusyIntervals(state.googleEvents, state.localBookings);
      if (!isSlotFree(start, end, busy)) {
        toast("That slot is no longer available. Please pick another.", "err");
        state.selectedSlot = null;
        showStep("slots");
        renderDateList();
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

      let mode = "local";

      if (CONFIG.bookingWebhookUrl && CONFIG.bookingWebhookUrl.trim()) {
        try {
          const created = await createEventWithWebhook(booking);
          if (created.htmlLink) booking.htmlLink = created.htmlLink;
          if (created.id) booking.googleEventId = created.id;
          mode = "webhook";
        } catch (whErr) {
          console.error("Webhook booking failed:", whErr);
          toast(whErr.message || "Could not save to calendar", "err");
          return;
        }
      } else if (CONFIG.googleClientId && CONFIG.googleClientId.trim()) {
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

      state.cancelledSlots = (state.cancelledSlots || []).filter(
        (c) => !(timesMatch(c.start, booking.start) && timesMatch(c.end, booking.end))
      );
      saveCancelledSlots(state.cancelledSlots);

      state.localBookings.push(booking);
      saveLocalBookings(state.localBookings);

      if (mode === "webhook" || mode === "oauth") {
        injectOptimisticBusy(booking);
      }

      recomputeAvailability();
      renderUpcoming();

      const successText = document.getElementById("success-text");
      if (successText) {
        successText.textContent =
          formatRange(new Date(booking.start), new Date(booking.end)) +
          " — confirmation details have been noted for " +
          booking.email +
          ".";
      }
      showStep("success");

      if (mode === "webhook") {
        toast("Booked! It's on our calendar.", "ok");
        await syncCalendar();
      } else if (mode === "oauth") {
        toast("Booked! Calendar invite sent.", "ok");
        await syncCalendar();
      } else {
        toast("Booked! Opening Google Calendar to save the event…", "ok");
        window.open(buildGoogleTemplateUrl(booking), "_blank", "noopener,noreferrer");
      }

      state.selectedSlot = null;
      state.selectedDateKey = null;
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
    const rangeStart = startOfDay(new Date());
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + (CONFIG.bookingWindowDays || 28) + 1);

    try {
      state.cancelledSlots = loadCancelledSlots();

      if (isLiveMode()) {
        state.googleEvents = await fetchGoogleBusy(rangeStart, rangeEnd);
        setStatus("live", "Live calendar");
        showBanner("");
      } else {
        state.googleEvents = buildDemoBusyEvents();
        setStatus("demo", "Demo mode");
        showBanner(
          "Demo mode: sample busy times. Add googleApiKey, calendarId, and bookingWebhookUrl in config.js to go live."
        );
      }
      refreshUi();
    } catch (err) {
      console.error(err);
      setStatus("error", "Sync failed");
      showBanner(
        "Could not load Google Calendar: " +
          err.message +
          " Showing any local bookings only."
      );
      state.googleEvents = [];
      refreshUi();
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  function applyBranding() {
    const mins = CONFIG.slotDurationMinutes || 120;
    const hours = mins >= 60 && mins % 60 === 0 ? mins / 60 : null;
    const durationLabel = hours ? hours + (hours === 1 ? " hour" : " hours") : mins + " minutes";
    const windowDays = CONFIG.bookingWindowDays || 28;

    document.title = CONFIG.businessName || "Book a clean";
    const name = document.getElementById("business-name");
    const desc = document.getElementById("business-desc");
    if (name) name.textContent = CONFIG.businessName || "Book a clean";
    if (desc) {
      desc.textContent =
        CONFIG.businessDescription ||
        "Choose a free start time. Each clean is " + durationLabel + ".";
    }
    const owner = document.getElementById("owner-line");
    if (owner) {
      owner.textContent = CONFIG.ownerName || "Tyneside Cleaning";
    }
    const metaDur = document.getElementById("meta-duration");
    if (metaDur) metaDur.textContent = durationLabel;
    const metaWin = document.getElementById("meta-window");
    if (metaWin) metaWin.textContent = "Next " + windowDays + " days";
    const winDays = document.getElementById("window-days");
    if (winDays) winDays.textContent = String(windowDays);
  }

  function bindUi() {
    document.getElementById("btn-refresh")?.addEventListener("click", () => {
      syncCalendar().then(() => toast("Times refreshed", "ok"));
    });

    document.getElementById("btn-back-time")?.addEventListener("click", () => {
      state.selectedSlot = null;
      showStep("slots");
      renderDateList();
    });

    document.getElementById("btn-cancel")?.addEventListener("click", () => {
      state.selectedSlot = null;
      showStep("slots");
      renderDateList();
    });

    document.getElementById("btn-change-slot")?.addEventListener("click", () => {
      state.selectedSlot = null;
      showStep("slots");
      renderDateList();
    });

    document.getElementById("btn-book-another")?.addEventListener("click", () => {
      state.selectedSlot = null;
      state.selectedDateKey = null;
      showStep("slots");
      renderDateList();
    });

    document.getElementById("booking-form")?.addEventListener("submit", submitBooking);

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (state.step === "details") {
        state.selectedSlot = null;
        showStep("slots");
        renderDateList();
      }
    });
  }

  async function main() {
    if (typeof CONFIG === "undefined") {
      document.body.innerHTML =
        "<p style='padding:2rem;font-family:sans-serif'>Missing config.js</p>";
      return;
    }

    applyBranding();
    bindUi();
    showStep("slots");
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
