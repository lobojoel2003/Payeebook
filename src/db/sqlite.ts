import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

let loading: Promise<SqlJsStatic> | null = null;

/** Load the SQLite WebAssembly engine once. It ships with the app, so this works offline. */
export function loadSql(): Promise<SqlJsStatic> {
  loading ??= initSqlJs({ locateFile: () => wasmUrl });
  return loading;
}
