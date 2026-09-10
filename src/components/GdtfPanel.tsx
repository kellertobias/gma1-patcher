'use client';

import { useState } from 'react';
import { download, readFile } from '@/lib/browser';
import { buildFixtureType } from '@/lib/gma1/buildType';
import { type ShowDoc, addFixtureType } from '@/lib/gma1/doc';
import { encodeLatin1 } from '@/lib/gma1/binary';
import { buildGma1FixtureText, gma1FixtureFileName, isMover } from '@/lib/gma1/textFixture';
import { type GdtfType, parseGdtf } from '@/lib/mvr/gdtf';
import { Button, EditCell, FileButton, Section, inputClass } from './ui';

interface Entry {
  key: string;
  gdtf: GdtfType;
  modeIndex: number;
  name: string;
  shortName: string;
  added: boolean;
}

let counter = 0;

export function GdtfPanel({ doc, onChange }: { doc: ShowDoc; onChange: (doc: ShowDoc) => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function addFiles(files: File[]) {
    setError(null);
    const next: Entry[] = [];
    for (const f of files) {
      try {
        const gdtf = parseGdtf(await readFile(f));
        gdtf.modes.forEach((_, i) =>
          next.push({
            key: `g${++counter}`,
            gdtf,
            modeIndex: i,
            name: gdtf.name.slice(0, 18),
            shortName: (gdtf.shortName || gdtf.name).slice(0, 18),
            added: false,
          }));
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setEntries((prev) => [...prev, ...next]);
  }

  function update(key: string, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  function addToShow(e: Entry) {
    setError(null);
    setNote(null);
    const mode = e.gdtf.modes[e.modeIndex];
    const built = buildFixtureType({ name: e.name, manufacturer: e.gdtf.manufacturer, shortName: e.shortName, mode, attributes: doc.show.attributes });
    if (!built.raw.channelTypes.length) {
      setError(`"${e.name}": no usable DMX channels (attributes not recognised: ${built.missing.join(', ')})`);
      return;
    }
    const [next] = addFixtureType(doc, built.raw);
    onChange(next);
    update(e.key, { added: true });
    setNote(`Added "${e.name}" (${mode.breaks.join('/')} slots)${built.missing.length ? ` — no attribute for: ${built.missing.join(', ')}` : ''}. Use it in “Add fixtures”.`);
  }

  function downloadText(e: Entry) {
    const mode = e.gdtf.modes[e.modeIndex];
    const { text, missing } = buildGma1FixtureText({
      name: e.name, manufacturer: e.gdtf.manufacturer, shortName: e.shortName, mode, headMover: isMover(mode),
    });
    download(gma1FixtureFileName(e.gdtf.manufacturer, e.name), encodeLatin1(text));
    setNote(missing.length
      ? `Downloaded ${e.name}.TXT — check attributes with no grandMA1 match: ${missing.join(', ')}`
      : `Downloaded a grandMA1 fixture file for "${e.name}". Import it via the console's fixture library.`);
  }

  return (
    <Section
      title="Fixture types from GDTF"
      actions={<FileButton label="Add GDTF files…" accept=".gdtf" multiple onFiles={addFiles} variant={entries.length ? 'secondary' : 'primary'} />}
    >
      {!entries.length && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Load GDTF files to add their fixture types to the show, or to download them as grandMA1 fixture
          files (<code>.TXT</code>) for import on the console — no MVR needed. Edit the name and short name first
          if you like.
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {note && <p className="mb-2 text-sm text-amber-700 dark:text-amber-300">{note}</p>}
      {entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-1 pr-2">GDTF</th>
                <th className="w-40 py-1 pr-2">Mode</th>
                <th className="w-48 py-1 pr-2">Name</th>
                <th className="w-32 py-1 pr-2">Short</th>
                <th className="w-16 py-1 pr-2 text-right">Slots</th>
                <th className="w-56 py-1" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const mode = e.gdtf.modes[e.modeIndex];
                return (
                  <tr key={e.key} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 pr-2">{e.gdtf.manufacturer} {e.gdtf.name}</td>
                    <td className="py-1 pr-2">
                      {e.gdtf.modes.length > 1 ? (
                        <select className={inputClass} value={e.modeIndex} onChange={(ev) => update(e.key, { modeIndex: Number(ev.target.value), added: false })}>
                          {e.gdtf.modes.map((m, i) => <option key={i} value={i}>{m.name || `Mode ${i + 1}`}</option>)}
                        </select>
                      ) : (mode.name || '—')}
                    </td>
                    <td className="py-1 pr-2">
                      <EditCell value={e.name} commit={(t) => { if (!t.trim() || t.length > 18) return false; update(e.key, { name: t, added: false }); return true; }} />
                    </td>
                    <td className="py-1 pr-2">
                      <EditCell value={e.shortName} commit={(t) => { if (t.length > 18) return false; update(e.key, { shortName: t }); return true; }} />
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{mode.breaks.join('/')}</td>
                    <td className="py-1 text-right">
                      <Button variant="quiet" className="!py-0.5 text-xs" onClick={() => downloadText(e)}>Download .TXT</Button>
                      <Button variant={e.added ? 'quiet' : 'secondary'} className="ml-1 !py-0.5 text-xs" onClick={() => addToShow(e)}>
                        {e.added ? 'Add again' : 'Add to show'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
