import { useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, History } from 'lucide-react';
import { useBook, useQuery } from '../../state/AppContext';
import { PageHead, Empty } from '../components/Empty';
import { fingerprint } from '../../core/sha256';
import { formatDate } from '../../core/dates';

export function Activity() {
  const { store, book } = useBook();
  const [limit, setLimit] = useState(200);
  const [q, setQ] = useState('');
  const entries = useQuery((s) => s.listAudit(book.id, 5000), [book.id]);
  const verify = useQuery((s) => s.verifyAudit(book.id), [book.id]);
  const filtered = useMemo(
    () =>
      q
        ? entries.filter((e) =>
            `${e.summary} ${e.actor} ${e.action}`.toLowerCase().includes(q.toLowerCase()),
          )
        : entries,
    [entries, q],
  );
  void store;

  return (
    <>
      <PageHead
        title="Activity log"
        sub="Every change to these books, who made it and when. Entries are chained with SHA-256, so editing or deleting one breaks the chain."
      />
      <section
        className={`callout ${verify.ok ? 'callout-ok' : 'callout-danger'}`}
        style={{ marginBottom: 16 }}
        data-testid="audit-status"
      >
        {verify.ok ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
        <div>
          {verify.ok ? (
            <>
              <b>Chain verified.</b> All {verify.count} entries are intact. Latest fingerprint{' '}
              <code>{fingerprint(verify.head)}</code>.
            </>
          ) : (
            <>
              <b>The chain is broken at entry #{verify.brokenAt}.</b> Someone changed the log
              outside Payeebook. Earlier entries can still be trusted.
            </>
          )}
        </div>
      </section>
      <div className="filters">
        <label className="field search">
          <span>Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. rent, import, filed"
          />
        </label>
      </div>
      <section className="card">
        {filtered.length === 0 ? (
          <Empty icon={<History size={32} />} title="No activity" />
        ) : (
          <div>
            {filtered.slice(0, limit).map((e) => (
              <div className="audit-row" key={e.seq}>
                <div className="small muted">
                  {formatDate(e.ts.slice(0, 10))} {e.ts.slice(11, 16)}
                  <div className="tiny">
                    #{e.seq} · {e.actor}
                  </div>
                </div>
                <div>
                  <span className="badge" style={{ marginRight: 8 }}>
                    {e.action}
                  </span>
                  {e.summary}
                </div>
              </div>
            ))}
            {filtered.length > limit && (
              <button
                className="btn btn-sm"
                style={{ marginTop: 12 }}
                onClick={() => setLimit(limit + 500)}
              >
                Show more
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
