# Tyneside Cleaning — book by WhatsApp

**Live:** https://tyneside.cleaning/book.html

There is no calendar widget and no backend. A booking is a WhatsApp
message to Master (`+44 7411 949215`).

- Homepage and nav **Book a clean** go to `/book.html`
- That page opens WhatsApp with a starter message (`£30 / 2-hour clean`)
- Optional name / area / time / notes are appended to the same message

Rebuild:

```powershell
python -m site_generator cleaning
```

Then publish the `output/cleaning/` tree to the `tyneside.cleaning` Pages repo
(CI needs `PAGES_DEPLOY_TOKEN`; without it, push the Pages repo directly).
