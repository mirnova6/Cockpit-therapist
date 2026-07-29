# PDF & Document Text Extraction Plan (Phase 6)

Status: **plan.** Today the app **stores** uploaded PDFs as encrypted blobs but
does **not** extract their text; the knowledge library and inputs ask for pasted
text so nothing is silently fabricated from an unreadable file. This is the
honest current behavior and the UI says so.

## Privacy principles (non-negotiable)

1. **Local by default.** Text/OCR extraction must run on-device. No PDF or page
   image is sent to any external service by default.
2. **No cloud PDF parsing / no external OCR by default.** If a clinician ever
   opts into an online extraction provider, it must obey the *same* gates as
   online AI: master switch off by default, consent, provider approval,
   attestation, confirmed outbound preview, per-client local-only override, and
   the kill switch.
3. **Manual pasted text always available.** The current fallback stays as the
   guaranteed, fully-private path.
4. **Extraction output is data, not truth.** Extracted text enters the normal
   pipeline as an untrusted input and still requires clinician review; nothing
   is auto-approved.

## Phased implementation

### Phase 6a — Local digital-PDF text extraction
- Bundle a local, dependency-free PDF text layer extractor (e.g. `pdf.js`
  `getTextContent`, wasm-compiled and inlined so it works offline and under the
  strict CSP).
- Extract the embedded text layer of *digital* PDFs (exported reports,
  typed notes). No network, no OCR.
- Show the extracted text in a review pane before it is stored as an input or
  knowledge chunk. Preserve page markers so citations keep page numbers.
- Detect image-only PDFs and clearly report "no text layer found — OCR or manual
  paste needed" rather than storing nothing silently.

### Phase 6b — Local OCR (opt-in, on-device)
- For scanned/image PDFs, offer on-device OCR (e.g. Tesseract wasm) as an
  explicit, clearly-labeled action. Warn about accuracy limits; OCR output is
  always reviewable and editable before use.
- Runs entirely locally; no image leaves the device.

### Phase 6c — Optional online extraction (only if requested)
- Would reuse the online-AI governance stack verbatim. Not planned unless
  explicitly requested, and never the default.

## Integration points (already prepared)

- Knowledge sources already chunk pasted/`.txt`/`.md` text with section/page
  markers; extracted PDF text flows into the same chunker unchanged.
- Clinical inputs already accept large text; extracted text becomes an input the
  extraction/pipeline engines process normally.
- Because extraction is local and produces plain text, the encryption, review,
  and isolation model is unaffected.

## What stays true regardless

- A stored-but-unreadable PDF is never treated as if its content were known.
- The app never claims to have read a PDF it has not actually extracted.
