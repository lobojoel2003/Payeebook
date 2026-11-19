import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { SqlJsStatic } from 'sql.js';
import { loadSql } from '../db/sqlite';
import { Store } from '../db/store';
import {
  clearSharedSnapshot,
  loadDatabase,
  loadSharedSnapshot,
  requestPersistentStorage,
  saveSharedSnapshot,
  Saver,
} from '../db/persist';
import { openSnapshot, type SnapshotEnvelope } from '../db/snapshot';
import type { Book } from '../db/types';

export interface SharedInfo {
  fingerprint: string;
  integrity: 'verified' | 'mismatch';
  envelope: SnapshotEnvelope;
}

interface AppValue {
  SQL: SqlJsStatic;
  /** The store being viewed: the local book, or a shared read-only snapshot. */
  store: Store;
  local: Store;
  readOnly: boolean;
  shared: SharedInfo | null;
  book: Book | null;
  books: Book[];
  version: number;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  setActiveBook: (id: string) => void;
  openShared: (json: string, passphrase?: string) => Promise<SharedInfo>;
  closeShared: () => void;
  replaceLocal: (bytes: Uint8Array | null) => Promise<void>;
  flush: () => Promise<void>;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

/** Memoise a synchronous store query until the data changes. */
export function useQuery<T>(fn: (store: Store) => T, deps: unknown[] = []): T {
  const { store, version } = useApp();
  const key = JSON.stringify(deps);
  // The query re-runs whenever the data changes (version) or its inputs change (key).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => fn(store), [store, version, key]);
}

export function useBook(): { store: Store; book: Book; readOnly: boolean; version: number } {
  const { store, book, readOnly, version } = useApp();
  if (!book) throw new Error('No book is open');
  return { store, book, readOnly, version };
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; SQL: SqlJsStatic; local: Store };

export function AppProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: (state: { status: 'loading' } | { status: 'error'; message: string }) => ReactNode;
}) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [shared, setShared] = useState<{ store: Store; info: SharedInfo } | null>(null);
  const [version, setVersion] = useState(0);
  const [saveState, setSaveState] = useState<AppValue['saveState']>('idle');
  const saverRef = useRef<Saver | null>(null);
  const localRef = useRef<Store | null>(null);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const flush = useCallback(() => saverRef.current?.flush() ?? Promise.resolve(), []);
  const scheduleNow = useCallback(async () => {
    saverRef.current?.schedule(0);
    await saverRef.current?.flush();
  }, []);

  const attach = useCallback(
    (SQL: SqlJsStatic, bytes: Uint8Array | null) => {
      const store = Store.open(SQL, bytes, {
        onChange: () => {
          saverRef.current?.schedule();
          bump();
        },
      });
      localRef.current?.close();
      localRef.current = store;
      if (!saverRef.current) {
        saverRef.current = new Saver(() => localRef.current!.export());
        saverRef.current.onStatus = (s) => setSaveState(s);
      }
      return store;
    },
    [bump],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [SQL, bytes] = await Promise.all([loadSql(), loadDatabase()]);
        if (cancelled) return;
        const local = attach(SQL, bytes);
        if (!bytes) void scheduleNow();
        setLoad({ status: 'ready', SQL, local });
        // Re-open the last shared book, if it was not passphrase protected.
        const snap = await loadSharedSnapshot();
        if (snap && !cancelled) {
          try {
            const opened = await openSnapshot(snap);
            setShared({
              store: Store.open(SQL, opened.bytes, { readOnly: true }),
              info: {
                fingerprint: opened.fingerprint,
                integrity: opened.integrity,
                envelope: opened.envelope,
              },
            });
          } catch {
            /* protected or invalid: stay on the local book */
          }
        }
        if (local.listBooks().length) void requestPersistentStorage();
      } catch (e) {
        if (!cancelled) setLoad({ status: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attach, scheduleNow]);

  // Save when the tab is hidden, and pick up saves made in other tabs.
  useEffect(() => {
    if (load.status !== 'ready') return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    const off = saverRef.current?.onRemoteSave(async () => {
      if (saverRef.current?.hasPending) return;
      const bytes = await loadDatabase();
      const local = attach(load.SQL, bytes);
      setLoad({ status: 'ready', SQL: load.SQL, local });
      bump();
    });
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      off?.();
    };
  }, [load, attach, bump, flush]);

  const value = useMemo<AppValue | null>(() => {
    if (load.status !== 'ready') return null;
    const local = load.local;
    const store = shared?.store ?? local;
    const books = store.listBooks();
    const activeId = store.getMeta('active_book');
    const book = books.find((b) => b.id === activeId) ?? books[0] ?? null;
    return {
      SQL: load.SQL,
      store,
      local,
      readOnly: Boolean(shared),
      shared: shared?.info ?? null,
      book,
      books,
      version,
      saveState,
      setActiveBook: (id: string) => {
        if (shared) return;
        local.setMeta('active_book', id);
      },
      openShared: async (json: string, passphrase?: string) => {
        const opened = await openSnapshot(json, passphrase);
        const ro = Store.open(load.SQL, opened.bytes, { readOnly: true });
        const info: SharedInfo = {
          fingerprint: opened.fingerprint,
          integrity: opened.integrity,
          envelope: opened.envelope,
        };
        if (opened.envelope.encryption) await clearSharedSnapshot();
        else await saveSharedSnapshot(json);
        setShared((prev) => {
          prev?.store.close();
          return { store: ro, info };
        });
        bump();
        return info;
      },
      closeShared: () => {
        setShared((prev) => {
          prev?.store.close();
          return null;
        });
        void clearSharedSnapshot();
        bump();
      },
      replaceLocal: async (bytes: Uint8Array | null) => {
        const next = attach(load.SQL, bytes);
        setLoad({ status: 'ready', SQL: load.SQL, local: next });
        await scheduleNow();
        bump();
      },
      flush,
    };
    // version is included so books/book are re-read after every change
  }, [load, shared, version, saveState, attach, bump, flush, scheduleNow]);

  // The context callbacks read refs only when they are invoked from event handlers, never during render.
  // eslint-disable-next-line react-hooks/refs
  if (load.status !== 'ready' || !value)
    return <>{fallback(load.status === 'error' ? load : { status: 'loading' })}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
