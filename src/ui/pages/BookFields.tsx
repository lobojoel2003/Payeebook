import type { BookInput } from '../../db/types';
import { ROLE_LABELS } from '../../db/types';

export const US_STATES: [string, string][] = [
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['DC', 'District of Columbia'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['PR', 'Puerto Rico'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
];

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const EMPTY_BOOK: BookInput = {
  beneficiary_name: '',
  beneficiary_dob: null,
  fiduciary_name: '',
  fiduciary_phone: null,
  fiduciary_address: null,
  role: 'ssa_payee',
  state: null,
  county: null,
  court: null,
  case_number: null,
  claim_number: null,
  appointment_date: null,
  report_month: null,
  notes: null,
};

type Setter = (patch: Partial<BookInput>) => void;

export function PeopleFields({ value, set }: { value: BookInput; set: Setter }) {
  return (
    <div className="form-grid">
      <label className="field">
        <span>Whose money is it?</span>
        <input
          required
          autoFocus
          value={value.beneficiary_name}
          onChange={(e) => set({ beneficiary_name: e.target.value })}
          placeholder="Beneficiary’s full name"
        />
      </label>
      <label className="field">
        <span>
          Their date of birth <span className="hint">(optional)</span>
        </span>
        <input
          type="date"
          value={value.beneficiary_dob ?? ''}
          onChange={(e) => set({ beneficiary_dob: e.target.value || null })}
        />
      </label>
      <label className="field">
        <span>Your name</span>
        <input
          required
          value={value.fiduciary_name}
          onChange={(e) => set({ fiduciary_name: e.target.value })}
          placeholder="The person keeping these books"
        />
      </label>
      <label className="field">
        <span>Your role</span>
        <select
          value={value.role}
          onChange={(e) => set({ role: e.target.value as BookInput['role'] })}
        >
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>
          Your phone <span className="hint">(printed on reports, optional)</span>
        </span>
        <input
          type="tel"
          value={value.fiduciary_phone ?? ''}
          onChange={(e) => set({ fiduciary_phone: e.target.value || null })}
        />
      </label>
      <label className="field">
        <span>
          Your mailing address <span className="hint">(optional)</span>
        </span>
        <input
          value={value.fiduciary_address ?? ''}
          onChange={(e) => set({ fiduciary_address: e.target.value || null })}
        />
      </label>
    </div>
  );
}

export function ReportingFields({ value, set }: { value: BookInput; set: Setter }) {
  return (
    <div className="form-grid">
      <label className="field">
        <span>State</span>
        <select value={value.state ?? ''} onChange={(e) => set({ state: e.target.value || null })}>
          <option value="">Choose…</option>
          {US_STATES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>County</span>
        <input
          value={value.county ?? ''}
          onChange={(e) => set({ county: e.target.value || null })}
        />
      </label>
      <label className="field">
        <span>
          Date appointed{' '}
          <span className="hint">(court accountings usually follow this anniversary)</span>
        </span>
        <input
          type="date"
          value={value.appointment_date ?? ''}
          onChange={(e) => set({ appointment_date: e.target.value || null })}
        />
      </label>
      <label className="field">
        <span>
          Reporting year starts in <span className="hint">(SSA report period, if you know it)</span>
        </span>
        <select
          value={value.report_month ?? ''}
          onChange={(e) => set({ report_month: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Same as appointment date</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>
          Court <span className="hint">(guardians and conservators)</span>
        </span>
        <input
          value={value.court ?? ''}
          onChange={(e) => set({ court: e.target.value || null })}
          placeholder="e.g. Ramsey County District Court"
        />
      </label>
      <label className="field">
        <span>Court case number</span>
        <input
          value={value.case_number ?? ''}
          onChange={(e) => set({ case_number: e.target.value || null })}
        />
      </label>
      <label className="field span-2">
        <span>
          SSA or VA claim number{' '}
          <span className="hint">
            (optional; you may prefer to write it on the printed form instead)
          </span>
        </span>
        <input
          value={value.claim_number ?? ''}
          onChange={(e) => set({ claim_number: e.target.value || null })}
          autoComplete="off"
        />
      </label>
    </div>
  );
}
