/**
 * Tyneside Cleaning — WhatsApp booking.
 * No calendar, no backend. The form only composes a wa.me message.
 */
(function () {
  const btn = document.getElementById("wa-book");
  const form = document.getElementById("wa-form");
  if (!btn) return;

  const phone = (btn.getAttribute("data-phone") || "").replace(/\D/g, "");
  const DEFAULT =
    "Hi, I'd like to book a £30 / 2-hour clean with Tyneside Cleaning in Howden Ward.";

  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function compose() {
    const lines = [];
    const name = val("guest-name");
    const area = val("guest-area");
    const when = val("guest-when");
    const notes = val("guest-notes");
    if (name) lines.push("Name: " + name);
    if (area) lines.push("Area: " + area);
    if (when) lines.push("Preferred: " + when);
    if (notes) lines.push("Notes: " + notes);

    const msg = lines.length ? DEFAULT + "\n\n" + lines.join("\n") : DEFAULT;
    const href = "https://wa.me/" + phone + "?text=" + encodeURIComponent(msg);
    btn.setAttribute("href", href);
    return href;
  }

  form?.addEventListener("input", compose);
  form?.addEventListener("change", compose);
  form?.addEventListener("submit", function (e) {
    e.preventDefault();
    const href = compose();
    window.open(href, "_blank", "noopener,noreferrer");
  });
})();
