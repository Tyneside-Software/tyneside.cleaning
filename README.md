# Cleaning booking (Google Calendar)

Static booking UI under `static/booking/`. Page: generated `book.html`.

1. Put a restricted Google Calendar API key and calendar ID in `static/booking/config.js`.
2. Make the calendar public (free/busy is enough).
3. Rebuild: `python -m site_generator cleaning`

Without a key, `book.html` runs in demo mode.
