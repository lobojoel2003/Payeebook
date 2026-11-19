# Contributing to Payeebook

Thank you for helping families keep honest, easy books. There are three good
ways to help, and only one of them needs code.

## 1. Add or check a form template (no coding)

The most valuable contribution is a template for your state's or county's
guardianship or conservatorship accounting form, or a check of an existing
draft against the real form. Start with the
[template guide](templates/README.md). Templates are MIT licensed.

## 2. Report a problem or an idea

Open an [issue](https://github.com/lobojoel2003/Payeebook/issues/new/choose).
**Never attach real financial data, receipts, names, case numbers or Social
Security numbers.** Use the demo book or made-up numbers to show a problem.

## 3. Improve the app

```bash
git clone https://github.com/lobojoel2003/Payeebook.git
cd Payeebook
npm ci
npm run dev            # http://localhost:5173
```

Before you open a pull request:

```bash
npm run lint
npm run format:check   # npm run format fixes it
npm run typecheck
npm test               # unit tests (Vitest)
npm run build && npm run test:e2e   # browser tests (Playwright)
```

The desktop shell needs Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):

```bash
npm run desktop:dev
```

### Guidelines

- Keep everything on the device. No analytics, no remote calls, no CDNs at
  runtime. New dependencies must work offline.
- Money is integer cents; dates are `YYYY-MM-DD` strings. Use the helpers in
  `src/core/money.ts` and `src/core/dates.ts`.
- Every change to a book goes through `Store` inside a transaction and writes
  an audit entry.
- Put logic in `src/core` with unit tests; keep React components thin.
- Write for a tired family member at the kitchen table: plain words, no jargon,
  and say what to do next.
- Add a line to `CHANGELOG.md` under **Unreleased**.

By contributing you agree that your code is licensed under GPL-3.0-or-later and
template files under MIT, and you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
