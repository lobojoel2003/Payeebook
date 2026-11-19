# Security policy

Payeebook handles sensitive financial records of vulnerable people, so we take
security reports seriously.

## Supported versions

Security fixes are released for the latest minor version. Update to the newest
[release](https://github.com/lobojoel2003/Payeebook/releases).

## Reporting a vulnerability

Please report privately through
[GitHub security advisories](https://github.com/lobojoel2003/Payeebook/security/advisories/new).
Do not open a public issue, and never include real financial data. We aim to
acknowledge reports within 7 days.

## How Payeebook protects data

- **No server.** Books live in the browser's IndexedDB or the desktop app's data
  folder on the user's device. Nothing is uploaded; there are no accounts,
  analytics or third-party requests at runtime.
- **On-device OCR.** Receipt images are read by Tesseract compiled to
  WebAssembly, served from the app itself.
- **Read-only sharing** uses AES-256-GCM with a key derived from the passphrase
  by PBKDF2-SHA256 (600,000 iterations). An unencrypted snapshot only reveals the
  names it contains if the sender chooses not to set a passphrase.
- **Integrity.** Snapshots carry a SHA-256 fingerprint, and the activity log is a
  per-book SHA-256 hash chain that Payeebook verifies on demand. These detect
  accidental or casual tampering; they are not a digital signature.
- **Backups** are plain SQLite files. Store them on an encrypted drive.

Anyone with access to the unlocked device or browser profile can read the books.
Use a device password and keep the operating system up to date.
