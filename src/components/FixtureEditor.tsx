'use client';

import { useMemo, useState } from 'react';
import { download, readFile } from '@/lib/browser';
import { encodeLatin1 } from '@/lib/gma1/binary';
import { type GmaChannel, buildFixtureType, channelsFromGdtf, describeSubstitutions } from '@/lib/gma1/buildType';
import { type ShowDoc, addFixtureType } from '@/lib/gma1/doc';
import { buildGma1FixtureText, gma1FixtureFileName, isMover } from '@/lib/gma1/textFixture';
import { parseGdtf } from '@/lib/mvr/gdtf';
import { Button, EditCell, FileButton, Section, inputClass } from './ui';

interface Draft {
  key: string;
  name: string;
  manufacturer: string;
  shortName: string;
  channels: GmaChannel[];
  source: string;
  added: boolean;
}

let counter = 0;
const draftKey = () => `d${++counter}`;

export function FixtureEditor({ doc, onChange }: { doc: ShowDoc; onChange: (doc: ShowDoc) => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Only attributes that actually exist in this show's pretyp can be picked.
  const attributeNames = useMemo(() => [...doc.show.attributeInfo.keys()].sort(), [doc.show]);

  function edit(key: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch, added: false } : d)));
  }
  function editChannels(key: string, fn: (ch: GmaChannel[]) => GmaChannel[]) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, channels: fn(d.channels), added: false } : d)));
  }

  function addBlank() {
    setDrafts((prev) => [...prev, {
      key: draftKey(), name: 'New Fixture', manufacturer: '', shortName: 'New',
      channels: [{ attribute: attributeNames.includes('DIM') ? 'DIM' : attributeNames[0], sixteenBit: false, dmxBreak: 1 }],
      source: 'blank', added: false,
    }]);
  }

  async function addGdtf(files: File[]) {
    setError(null);
    const next: Draft[] = [];
    for (const f of files) {
      try {
        const gdtf = parseGdtf(await readFile(f));
        gdtf.modes.forEach((mode) =>
          next.push({
            key: draftKey(),
            name: `${gdtf.name}${gdtf.modes.length > 1 ? ` ${mode.name}` : ''}`.slice(0, 18),
            manufacturer: gdtf.manufacturer,
            shortName: (gdtf.shortName || gdtf.name).slice(0, 18),
            channels: channelsFromGdtf(mode),
            source: `GDTF ${mode.name}`,
            added: false,
          }));
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setDrafts((prev) => [...prev, ...next]);
  }

  function addToShow(d: Draft) {
    setError(null);
    setNote(null);
    let built: ReturnType<typeof buildFixtureType>;
    try {
      built = buildFixtureType({ name: d.name, manufacturer: d.manufacturer, shortName: d.shortName, channels: d.channels, attributes: doc.show.attributes });
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (!built.raw.channelTypes.length) {
      setError(`"${d.name}": no DMX channels.`);
      return;
    }
    onChange(addFixtureType(doc, built.raw)[0]);
    edit(d.key, {});
    setDrafts((prev) => prev.map((x) => (x.key === d.key ? { ...x, added: true } : x)));
    setNote(`Added "${d.name}" (${built.raw.channelTypes.length} slots)` +
      `${built.substituted.length ? ` — stand-ins: ${describeSubstitutions(built.substituted)}` : ''}. Use it in “Add fixtures”.`);
  }

  function downloadText(d: Draft) {
    const { text, missing } = buildGma1FixtureText({
      name: d.name, manufacturer: d.manufacturer, shortName: d.shortName,
      headMover: isMover(d.channels), channels: d.channels, attributeInfo: doc.show.attributeInfo,
    });
    download(gma1FixtureFileName(d.manufacturer, d.name), encodeLatin1(text));
    setNote(missing.length
      ? `Downloaded ${d.name}.TXT — attributes with no match: ${missing.join(', ')}`
      : `Downloaded a gma1 fixture file for "${d.name}". Import it via the console's fixture library.`);
  }

  return (
    <Section
      title="Fixture editor"
      actions={
        <>
          <Button onClick={addBlank}>New blank fixture</Button>
          <FileButton label="Load GDTF…" accept=".gdtf" multiple onFiles={addGdtf} />
        </>
      }
    >
      {!drafts.length && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Build a gma1 fixture type by hand or from a GDTF mode — no MVR needed. Add it to the show, or
          download it as a gma1 fixture-library file (<code>.TXT</code>) for import on the console. Only
          attributes that exist in this show can be chosen.
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {note && <p className="mb-2 text-sm text-amber-700 dark:text-amber-300">{note}</p>}

      <div className="space-y-4">
        {drafts.map((d) => {
          const slots = d.channels.reduce((n, c) => n + (c.sixteenBit ? 2 : 1), 0);
          return (
            <div key={d.key} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-2 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-zinc-500">Name
                  <EditCell value={d.name} className="w-48" commit={(t) => { if (!t.trim() || t.length > 18) return false; edit(d.key, { name: t }); return true; }} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">Short
                  <EditCell value={d.shortName} className="w-28" commit={(t) => { if (t.length > 18) return false; edit(d.key, { shortName: t }); return true; }} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">Manufacturer
                  <EditCell value={d.manufacturer} className="w-40" commit={(t) => { edit(d.key, { manufacturer: t }); return true; }} />
                </label>
                <span className="text-xs text-zinc-500">{d.source} · {d.channels.length} channels · {slots} DMX slots</span>
                <div className="ml-auto flex gap-1">
                  <Button variant="quiet" className="!py-0.5 text-xs" onClick={() => downloadText(d)}>Download .TXT</Button>
                  <Button variant={d.added ? 'quiet' : 'secondary'} className="!py-0.5 text-xs" onClick={() => addToShow(d)}>{d.added ? 'Add again' : 'Add to show'}</Button>
                  <Button variant="quiet" className="!py-0.5 text-xs" onClick={() => setDrafts((p) => p.filter((x) => x.key !== d.key))}>Remove</Button>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr><th className="w-10 py-1">#</th><th className="py-1 pr-2">Attribute</th><th className="w-20 py-1 pr-2">16-bit</th><th className="w-20 py-1 pr-2">Break</th><th className="w-28 py-1" /></tr>
                </thead>
                <tbody>
                  {d.channels.map((c, i) => (
                    <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-0.5 text-zinc-500">{i + 1}</td>
                      <td className="py-0.5 pr-2">
                        <select
                          className={`${inputClass} ${attributeNames.includes(c.attribute) ? '' : 'border-red-500'}`}
                          value={c.attribute}
                          onChange={(e) => editChannels(d.key, (ch) => ch.map((x, j) => (j === i ? { ...x, attribute: e.target.value } : x)))}
                        >
                          {!attributeNames.includes(c.attribute) && <option value={c.attribute}>{c.attribute} (not in show)</option>}
                          {attributeNames.map((a) => <option key={a} value={a}>{a}{doc.show.attributeInfo.get(a)?.pretty && doc.show.attributeInfo.get(a)!.pretty !== a ? ` — ${doc.show.attributeInfo.get(a)!.pretty}` : ''}</option>)}
                        </select>
                      </td>
                      <td className="py-0.5 pr-2">
                        <input type="checkbox" checked={c.sixteenBit} onChange={(e) => editChannels(d.key, (ch) => ch.map((x, j) => (j === i ? { ...x, sixteenBit: e.target.checked } : x)))} />
                      </td>
                      <td className="py-0.5 pr-2">
                        <input className={`${inputClass} w-16`} value={c.dmxBreak} inputMode="numeric"
                          onChange={(e) => { const v = Number(e.target.value) || 1; editChannels(d.key, (ch) => ch.map((x, j) => (j === i ? { ...x, dmxBreak: v } : x))); }} />
                      </td>
                      <td className="py-0.5 text-right">
                        <Button variant="quiet" className="!px-1.5 !py-0.5 text-xs" onClick={() => editChannels(d.key, (ch) => i > 0 ? ch.map((x, j) => j === i - 1 ? ch[i] : j === i ? ch[i - 1] : x) : ch)}>↑</Button>
                        <Button variant="quiet" className="!px-1.5 !py-0.5 text-xs" onClick={() => editChannels(d.key, (ch) => i < ch.length - 1 ? ch.map((x, j) => j === i + 1 ? ch[i] : j === i ? ch[i + 1] : x) : ch)}>↓</Button>
                        <Button variant="quiet" className="!px-1.5 !py-0.5 text-xs" onClick={() => editChannels(d.key, (ch) => ch.filter((_, j) => j !== i))}>✕</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button variant="quiet" className="mt-1 !py-0.5 text-xs" onClick={() => editChannels(d.key, (ch) => [...ch, { attribute: attributeNames[0], sixteenBit: false, dmxBreak: 1 }])}>
                + Add channel
              </Button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
