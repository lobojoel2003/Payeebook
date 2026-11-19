# Changelog

All notable changes to Payeebook are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release also
carries a build number (the CI run that produced it) and the commit it was
built from; both are shown under **Settings → About**.

## [Unreleased]

## [1.0.0] - 2026-11-19

First public release.

### Added

- **Books for every kind of family fiduciary.** One book per beneficiary, for
  Social Security and SSI representative payees, VA fiduciaries, guardians,
  conservators and trustees. Several books can live side by side.
- **Bank import.** CSV files from any bank (columns detected automatically,
  including files with preamble lines, separate debit/credit columns and no
  header row) and OFX/QFX files (OFX 1.x SGML and 2.x XML). Column choices are
  remembered per bank. Re-importing an overlapping statement never duplicates
  a transaction.
- **Tag it once.** Every transaction gets one tag (housing, food, medical,
  saved…). Tag a payee once and Payeebook offers to tag every past and future
  transaction from that payee the same way. Payments that covered several
  things can be split across tags.
- **Receipts with on-device OCR.** Snap a photo or upload a PDF. Tesseract
  (WebAssembly) reads the total, date and store on the device, then Payeebook
  suggests the payment it belongs to or records a new cash purchase.
- **Running balance across all of the beneficiary's money**, including
  savings moved out of tracked accounts, with monthly reconciliation against
  bank statements.
- **Reports from plain YAML templates** with a safe formula language, checks
  that catch mistakes before filing, itemized schedules and a receipts
  appendix in the PDF:
  - SSA-623 / SSA-6230 Representative Payee Report worksheet (community draft)
  - Annual account of guardian or conservator, standard charge-and-discharge
    schedules
  - Illinois guardian of the estate account (community draft)
  - Minnesota conservator annual account (community draft)
  - Family summary for siblings and the beneficiary
- **Fill official fillable PDFs.** Templates can map their totals onto the
  fields of a court's own PDF form, and a built-in inspector lists a form's
  field names for template authors.
- **Filing locks the books.** Marking a report as filed locks every
  transaction in its period; reopening is recorded.
- **Read-only sharing.** Export an AES-256 encrypted snapshot that a sibling or
  attorney opens in Payeebook read-only, with a SHA-256 fingerprint both sides
  can read aloud to confirm the copy is unaltered.
- **Tamper-evident activity log.** Every change is recorded in a SHA-256 hash
  chain that Payeebook verifies on demand.
- **Local-first storage.** SQLite (sql.js) in IndexedDB; no account, no
  server. Full backups and restores as a single `.sqlite` file, printable
  ledger PDF and CSV export.
- **Installable everywhere.** Offline-capable PWA, plus desktop apps for
  Windows, macOS and Linux built with Tauri 2.
- Light and dark themes, a phone layout with bottom navigation, and a demo book
  to explore.
- Template library under the MIT licence with a JSON Schema for editor
  autocompletion, a starter template and an authoring guide.

[Unreleased]: https://github.com/lobojoel2003/Payeebook/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/lobojoel2003/Payeebook/releases/tag/v1.0.0
