import { isDesktopApp } from '../buildInfo';

/** Save bytes to a file: a native save dialog in the desktop app, a download in the browser. */
export async function saveFile(
  name: string,
  data: Uint8Array | string,
  mime: string,
): Promise<boolean> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (isDesktopApp) {
    // Native "Save as" dialog; the bytes travel as a raw IPC body, not JSON.
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<boolean>('save_file', bytes, { headers: { 'x-file-name': name } });
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
