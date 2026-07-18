/**
 * Tyneside Cleaning — booking write endpoint (Google Apps Script)
 *
 * Deploy once, then paste the web-app URL into config.js → bookingWebhookUrl.
 *
 * Setup:
 * 1. https://script.google.com → New project
 * 2. Paste this file (replace CALENDAR_ID)
 * 3. Deploy → New deployment → Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the web-app URL into sites/cleaning/static/booking/config.js
 *
 * Share the same calendar with this Google account (owner is fine).
 * Put busy / "no cleaners" blocks on that calendar; freeBusy on the site
 * will hide those times automatically.
 */

/** Full calendar ID from Google Calendar → Settings → Integrate calendar. */
var CALENDAR_ID = "REPLACE_WITH_CALENDAR_ID";

function doPost(e) {
  try {
    var data = parseBody_(e);
    if (!data.start || !data.end || !data.name || !data.email) {
      return json_({ ok: false, error: "Missing required fields" }, 400);
    }

    var cal = CalendarApp.getCalendarById(CALENDAR_ID);
    if (!cal) {
      return json_({ ok: false, error: "Calendar not found for this account" }, 500);
    }

    var start = new Date(data.start);
    var end = new Date(data.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return json_({ ok: false, error: "Invalid start/end" }, 400);
    }

    // Refuse double-book against anything already on the host calendar
    var conflicts = cal.getEvents(start, end);
    if (conflicts && conflicts.length > 0) {
      return json_({ ok: false, error: "That slot is no longer free" }, 409);
    }

    var summary =
      data.summary ||
      "Cleaning for " + data.name;
    var description =
      data.description ||
      buildDescription_(data);

    var options = {
      description: description,
      guests: data.email,
      sendInvites: true,
    };

    var event = cal.createEvent(summary, start, end, options);

    return json_({
      ok: true,
      id: event.getId(),
      htmlLink: event.getHtmlLink ? event.getHtmlLink() : null,
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}

/** Health check — open the web-app URL in a browser. */
function doGet() {
  return json_({
    ok: true,
    service: "tyneside-cleaning-booking",
    calendarId: CALENDAR_ID,
  });
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("Empty body");
  }
  return JSON.parse(e.postData.contents);
}

function buildDescription_(data) {
  var lines = [];
  if (data.notes) lines.push(data.notes, "");
  lines.push("Booked via web calendar.");
  lines.push("Guest: " + data.name + " <" + data.email + ">");
  if (data.id) lines.push("Booking-ID: " + data.id);
  return lines.join("\n");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
