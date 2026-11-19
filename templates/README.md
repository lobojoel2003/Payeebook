# Payeebook form templates

Every report Payeebook produces comes from a plain YAML file in this folder. A
template says which totals a form needs, how to compute them from the tagged
ledger, which questions to ask, and which checks must pass before filing.

**Templates are MIT licensed** (see [LICENSE](LICENSE)), separately from the
GPL app, so courts, legal aid groups and other software can reuse them.

| File                                                                             | Form                                                           | Status          |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------- |
| [`ssa/ssa-623-payee-report.yaml`](ssa/ssa-623-payee-report.yaml)                 | SSA-623 / SSA-6230 Representative Payee Report worksheet       | Community draft |
| [`us/generic/annual-account.yaml`](us/generic/annual-account.yaml)               | Annual account of guardian or conservator (standard schedules) | Generic         |
| [`us/il/guardian-estate-account.yaml`](us/il/guardian-estate-account.yaml)       | Illinois — account of guardian of the estate                   | Community draft |
| [`us/mn/conservator-annual-account.yaml`](us/mn/conservator-annual-account.yaml) | Minnesota — conservator's annual account                       | Community draft |
| [`other/family-summary.yaml`](other/family-summary.yaml)                         | Family summary (not a filing)                                  | Generic         |

**Status** tells users how far to trust a template:

- `verified` – a maintainer compared every line with the current official form.
- `draft` – written from public descriptions; needs someone with the real form to check it.
- `generic` – not tied to one official form (standard schedules, summaries).

## Add your state's form in an afternoon

1. **Get the official form.** Download the blank form and any instructions from
   your court or agency website. Note its URL.
2. **Start from the closest template.** Copy
   [`us/generic/annual-account.yaml`](us/generic/annual-account.yaml) to
   `us/<state>/<form-name>.yaml` (for example `us/oh/guardian-annual-account.yaml`),
   or download the starter file from **Form templates → Starter file** in the app.
3. **Edit the header**: a unique `id`, the form's `name`, `jurisdiction`, the
   `roles` that file it, `references` (link the official form), `status: draft`
   and `version: 0.1.0`.
4. **Mirror the form's sections and lines**, in the same order and with the same
   wording as the official form, so people can copy numbers across line by line.
5. **Try it.** In Payeebook open **Form templates → Add a template…** and pick
   your file. Errors point at the exact line. Then open the demo book and use the
   template on the Reports page.
6. **Optional: fill the official PDF.** If the court publishes a _fillable_ PDF,
   use **Form templates → Inspect a PDF form** to list its field names and add an
   `acroform` section (see below).
7. **Share it.** Open a pull request. CI validates every template and runs it
   against sample data. Please say in the PR how you checked it.

Editors with the YAML language server (VS Code's _YAML_ extension) give
autocompletion and inline errors from [`schema.json`](schema.json) thanks to the
first line of each file:

```yaml
# yaml-language-server: $schema=../../schema.json
```

## Reference

```yaml
schema: payeebook/template@1 # always this
id: us-oh-guardian-annual-account # lowercase, digits, dashes; unique
name: Ohio — Guardian's account (community draft)
short_name: OH guardian account # optional, used on buttons and file names
version: 0.1.0 # bump on every change
kind: court # ssa | court | va | other
status: draft # verified | draft | generic
jurisdiction: { country: US, state: OH, county: null, court: Probate Court }
roles: [guardian, conservator] # ssa_payee ssi_payee va_fiduciary guardian conservator trustee other
description: What the form is and who files it.
references:
  - { title: Official form, url: 'https://…' }
period:
  default: appointment-year # appointment-year | calendar-year | last-12-months | custom
```

### Inputs: questions asked when preparing the report

```yaml
inputs:
  - id: case_number
    label: Case number
    type: text # text | textarea | money | number | date | yesno | choice
    default: '{{ book.case_number }}'
  - id: lived_with
    label: Where did the ward live?
    type: choice
    options: [At home, Nursing home, Group home]
```

### Sections and lines

```yaml
sections:
  - id: receipts
    title: Schedule A — Receipts
    itemize: true # list every transaction behind each line in the PDF
    # itemize: { min_amount: 25 } # list only items of $25 or more; combine the rest
    total: { label: Total receipts } # or `total: false`
    lines:
      - id: benefits
        label: 'Social Security, SSI and VA benefits' # quote labels that contain commas
        sum: { court: [receipts.benefits] }
      - id: other
        label: 'All other receipts'
        sum: { kinds: [income], exclude: [benefits_ssa, benefits_ssi, benefits_va] }
```

Each line has exactly one source:

| Source   | Meaning                                                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sum:`   | Add up tagged ledger lines in the period. Filters below. Income is counted as money in; expenses and savings as positive amounts out; refunds tagged to an expense reduce it. |
| `value:` | A formula, e.g. `receipts.total - disbursements.total`.                                                                                                                       |
| `input:` | The answer to one of the `inputs`.                                                                                                                                            |
| `text:`  | Text with `{{ }}` placeholders.                                                                                                                                               |

Optional line settings: `format` (`money`, `number`, `text`, `date`, `yesno`),
`emphasis: true` (bold row), `help`, and `in_total` (by default only `sum` lines
count toward the section total).

**`sum` filters** (a line matches if it satisfies any listed selector, then
`exclude`, `accounts` and `direction` narrow it):

| Filter       | Values                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `categories` | tag ids: `benefits_ssa`, `benefits_ssi`, `benefits_va`, `pension`, `wages`, `interest`, `refund`, `other_income`, `housing`, `utilities`, `care_facility`, `food`, `medical`, `clothing`, `personal`, `education`, `recreation`, `transportation`, `insurance`, `fees`, `legal`, `taxes`, `debt`, `other_expense`, `saved`, `transfer`                             |
| `kinds`      | `income`, `expense`, `saving`, `transfer`                                                                                                                                                                                                                                                                                                                          |
| `ssa`        | `benefits`, `other_income`, `food_housing`, `other_needs`, `saved`, `none`                                                                                                                                                                                                                                                                                         |
| `court`      | `receipts.benefits`, `receipts.pension`, `receipts.earned`, `receipts.investment`, `receipts.other`, `disbursements.residence`, `disbursements.food`, `disbursements.medical`, `disbursements.personal`, `disbursements.transport`, `disbursements.insurance`, `disbursements.administration`, `disbursements.debt`, `disbursements.other`, `transfers`, `savings` |
| `exclude`    | tag ids to leave out                                                                                                                                                                                                                                                                                                                                               |
| `accounts`   | `checking`, `savings`, `cash`, `prepaid`, `investment`, `other`                                                                                                                                                                                                                                                                                                    |
| `direction`  | `in` or `out`                                                                                                                                                                                                                                                                                                                                                      |
| `untagged`   | `true` to total untagged lines                                                                                                                                                                                                                                                                                                                                     |

Prefer `court` groups and `ssa` buckets over long category lists: they keep
working when users add their own tags.

### Formulas

Formulas reference other lines as `section.line` and section totals as
`section.total`, plus these built-ins (money is in cents):

| Name                                                                                     | Meaning                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `balance.start`, `balance.end`                                                           | All of the beneficiary's money at the start / end of the period                                                                      |
| `balance.accounts_start`, `balance.accounts_end`                                         | Only the tracked accounts                                                                                                            |
| `balance.saved_start`, `balance.saved_end`                                               | Savings accounts plus money tagged _Saved_                                                                                           |
| `balance.cash_end`                                                                       | Non-savings accounts at the end                                                                                                      |
| `totals.income`, `totals.expense`, `totals.saved`, `totals.transfers`, `totals.untagged` | Period totals                                                                                                                        |
| `count.untagged`, `count.transactions`, `count.missing_receipts`                         | Counts in the period                                                                                                                 |
| `period.start`, `period.end`, `period.days`, `today`                                     | Dates                                                                                                                                |
| `book.*`                                                                                 | `beneficiary_name`, `fiduciary_name`, `role_label`, `state`, `county`, `court`, `case_number`, `claim_number`, `appointment_date`, … |
| `inputs.*`                                                                               | Answers to the template's inputs                                                                                                     |

Operators: `+ - * / %`, comparisons `== != < <= > >=`, `&& || !`, `cond ? a : b`.
Functions: `max`, `min`, `abs`, `round`, `floor`, `ceil`, `if(cond, a, b)`,
`dollars(25)` (= 2500 cents). Text fields accept `{{ formula }}` and
`{{ formula | money }}`, `| date`, `| yesno`, `| number`.

### Checks, notes and the signature block

```yaml
checks:
  - label: Start + receipts − disbursements = end
    assert: summary.opening + receipts.total - disbursements.total == summary.closing
  - label: Every transaction is tagged
    assert: count.untagged == 0
    severity: warning # error (default) blocks "Mark as filed"; warning only warns
    help: Shown when the check fails.
notes:
  - Printed under the totals.
attestation: >-
  I, {{ book.fiduciary_name }}, state that this account is true and complete.
signatures: [Guardian, Date]
receipts:
  attach: true # add receipts to the PDF (default)
  min_amount: 0 # only receipts for transactions of at least this many dollars
```

### Filling an official fillable PDF

Payeebook never ships official forms. Users download the blank form themselves
and Payeebook writes into its fields:

```yaml
acroform:
  fields:
    'Total Receipts': receipts.total # numbers are written as 1,234.56
    'Number of items': count.transactions # counts and days are written as plain numbers
    'Period ends': period.end | date # optional filters: money, number, date, yesno, text
    'Case No': '{{ inputs.case_number }}' # text with placeholders
  checkboxes:
    'Lived at home': inputs.lived_with == "At home"
```

## Review checklist for template pull requests

- [ ] File lives under `templates/<country>/<state>/` (or `ssa/`, `va/`, `other/`).
- [ ] `references` link the official form or statute.
- [ ] Line labels and order match the official form.
- [ ] Balance check (`start + in − out = end`) is included.
- [ ] `status` is honest: `verified` only if you compared it with the current form.
- [ ] `npm run templates:validate` passes.
