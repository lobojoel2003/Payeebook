import { createStore, del, get, set } from 'idb-keyval';

/**
 * Local-first persistence. The whole SQLite database is kept as one blob in
 * IndexedDB on this device. Nothing is sent to a server.
 */
const kv = createStore('payeebook', 'kv');
const DB_KEY = 'db:v1';
const SHARED_KEY = 'shared:v1';
const CHANNEL = 'payeebook';

export async function loadDatabase(): Promise<Uint8Array | null> {
  const v = await get<Uint8Array>(DB_KEY, kv);
  return v ?? null;
}

export async function saveDatabase(bytes: Uint8Array): Promise<void> {
  await set(DB_KEY, bytes, kv);
}

export async function clearDatabase(): Promise<void> {
  await del(DB_KEY, kv);
}

/** The last shared (read-only) book opened on this device, stored exactly as received. */
export async function loadSharedSnapshot(): Promise<string | null> {
  return (await get<string>(SHARED_KEY, kv)) ?? null;
}

export async function saveSharedSnapshot(json: string): Promise<void> {
  await set(SHARED_KEY, json, kv);
}

export async function clearSharedSnapshot(): Promise<void> {
  await del(SHARED_KEY, kv);
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageInfo(): Promise<{ persisted: boolean; usage: number; quota: number }> {
  try {
    const [persisted, est] = await Promise.all([
      navigator.storage?.persisted?.() ?? false,
      navigator.storage?.estimate?.() ?? {},
    ]);
    return {
      persisted: Boolean(persisted),
      usage: (est as StorageEstimate).usage ?? 0,
      quota: (est as StorageEstimate).quota ?? 0,
    };
  } catch {
    return { persisted: false, usage: 0, quota: 0 };
  }
}

/**
 * Debounced saver. Writes are batched so a bulk import is one IndexedDB write,
 * and other open tabs are told to reload.
 */
export class Saver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private saving: Promise<void> = Promise.resolve();
  private channel: BroadcastChannel | null =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
  readonly tabId = Math.random().toString(36).slice(2);
  onStatus?: (status: 'saving' | 'saved' | 'error', error?: unknown) => void;

  constructor(private getBytes: () => Uint8Array) {}

  schedule(delay = 250) {
    this.pending = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return this.saving;
    this.pending = false;
    const bytes = this.getBytes();
    this.onStatus?.('saving');
    this.saving = this.saving
      .then(() => saveDatabase(bytes))
      .then(() => {
        this.onStatus?.('saved');
        this.channel?.postMessage({ type: 'saved', from: this.tabId });
      })
      .catch((e) => {
        this.pending = true;
        this.onStatus?.('error', e);
      });
    return this.saving;
  }

  get hasPending() {
    return this.pending;
  }

  onRemoteSave(fn: () => void) {
    if (!this.channel) return () => {};
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'saved' && e.data.from !== this.tabId) fn();
    };
    this.channel.addEventListener('message', handler);
    return () => this.channel?.removeEventListener('message', handler);
  }
}
