import { zipSync } from 'fflate';

export interface ShowFiles {
  baseName: string;
  /** Optional on open: when absent, the loader rebuilds it from the archive's `info` member. */
  sho?: Uint8Array;
  tgz: Uint8Array;
}

/** Pick `<name>.tar.gz` (required) and `<name>.sho` (optional) from a file selection. */
export async function readShowFiles(files: File[]): Promise<ShowFiles> {
  const sho = files.find((f) => f.name.toLowerCase().endsWith('.sho'));
  const tgz = files.find((f) => f.name.toLowerCase().endsWith('.tar.gz'));
  if (!tgz) throw new Error('Select the show archive <name>.tar.gz (the <name>.sho is optional).');
  const baseName = (sho ? sho.name.slice(0, -4) : tgz.name.slice(0, -7));
  if (sho && tgz.name.slice(0, -7) !== sho.name.slice(0, -4)) {
    throw new Error(`"${tgz.name}" does not belong to "${sho.name}".`);
  }
  return {
    baseName,
    sho: sho ? new Uint8Array(await sho.arrayBuffer()) : undefined,
    tgz: new Uint8Array(await tgz.arrayBuffer()),
  };
}

export async function readFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function download(name: string, data: Uint8Array) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadShow(files: ShowFiles, asZip: boolean) {
  if (!files.sho) throw new Error('the generated show is missing its .sho header');
  const sho = `${files.baseName}.sho`;
  const tgz = `${files.baseName}.tar.gz`;
  if (asZip) {
    download(`${files.baseName}.zip`, zipSync({ [sho]: files.sho, [tgz]: files.tgz }, { level: 0 }));
  } else {
    download(sho, files.sho);
    setTimeout(() => download(tgz, files.tgz), 300);
  }
}

// --- blank show template (IndexedDB, stays in this browser) -------------------------------------

const DB = 'gma1-patcher';
const STORE = 'templates';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTemplate(files: ShowFiles): Promise<void> {
  await withStore('readwrite', (s) => s.put(files, 'blank'));
}

export async function loadTemplate(): Promise<ShowFiles | null> {
  try {
    return (await withStore<ShowFiles | undefined>('readonly', (s) => s.get('blank'))) ?? null;
  } catch {
    return null;
  }
}
