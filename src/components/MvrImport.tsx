'use client';

import { useMemo, useState } from 'react';
import { readFile } from '@/lib/browser';
import { type ShowDoc, canCreate } from '@/lib/gma1/doc';
import { type GdtfType, parseGdtf } from '@/lib/mvr/gdtf';
import {
  type ImportReport, type MvrTypeGroup, type TypeChoice, applyMvr, canCreateType, groupMvr, suggestType,
} from '@/lib/mvr/import';
import { type MvrFile, gdtfFileFor, parseMvr } from '@/lib/mvr/mvr';
import { Button, FileButton, Section, inputClass } from './ui';

export function MvrImport({ doc, onChange }: { doc: ShowDoc; onChange: (doc: ShowDoc) => void }) {
  const [mvr, setMvr] = useState<{ name: string; file: MvrFile } | null>(null);
  const [gdtf, setGdtf] = useState<Map<string, GdtfType>>(new Map());
  const [mapping, setMapping] = useState<Record<string, TypeChoice>>({});
  const [renameExisting, setRenameExisting] = useState(false);
  const [positions, setPositions] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => (mvr ? groupMvr(mvr.file, gdtf) : []), [mvr, gdtf]);
  const existingIds = useMemo(() => new Set(doc.fixtures.map((f) => f.fixId).filter((x) => x > 0)), [doc.fixtures]);

  function suggestAll(gs: MvrTypeGroup[], current: Record<string, TypeChoice>) {
    const next = { ...current };
    for (const g of gs) {
      if (g.key in next) continue;
      const match = suggestType(g, doc.show.types, doc.show);
      next[g.key] = match ?? (canCreateType(g) ? 'create' : null);
    }
    return next;
  }

  async function openMvr(files: File[]) {
    setError(null);
    setReport(null);
    try {
      const file = parseMvr(await readFile(files[0]));
      const types = new Map(gdtf);
      for (const spec of new Set(file.fixtures.map((f) => f.gdtfSpec))) {
        const data = gdtfFileFor(file, spec);
        if (!data) continue;
        try {
          types.set(spec, parseGdtf(data));
        } catch {
          /* unreadable GDTF: the type can still be mapped by hand */
        }
      }
      setGdtf(types);
      setMvr({ name: files[0].name, file });
      setMapping(suggestAll(groupMvr(file, types), {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addGdtf(files: File[]) {
    setError(null);
    const types = new Map(gdtf);
    for (const f of files) {
      try {
        const parsed = parseGdtf(await readFile(f));
        // GDTFSpec in an MVR is the file name, with or without extension
        types.set(f.name, parsed);
        types.set(f.name.replace(/\.gdtf$/i, ''), parsed);
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setGdtf(types);
  }

  function apply() {
    const [next, r] = applyMvr(doc, groups, mapping, { renameExisting, positions });
    onChange(next);
    setReport(r);
  }

  return (
    <Section
      title="Import from MVR / GDTF"
      actions={
        <>
          <FileButton label={mvr ? 'Other MVR…' : 'Open MVR…'} accept=".mvr" onFiles={openMvr} />
          {mvr && <FileButton label="Add GDTF files…" accept=".gdtf" multiple onFiles={addGdtf} />}
        </>
      }
    >
      {!mvr && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Load an MVR scene (e.g. exported from Vectorworks, Capture, etc.). Fixtures whose fixture ID already
          exists in the show get the MVR address; the others are added. Each GDTF type is mapped to a fixture type in
          the show — the DMX footprint is compared for you.
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {mvr && (
        <>
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            {mvr.name}: {mvr.file.fixtures.length} fixtures, {groups.length} type/mode combinations,
            {' '}{mvr.file.fixtures.filter((f) => existingIds.has(f.fixtureId)).length} match existing fixture IDs.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-1 pr-2">GDTF type / mode</th>
                  <th className="w-16 py-1 pr-2 text-right">Count</th>
                  <th className="w-24 py-1 pr-2 text-right">GDTF slots</th>
                  <th className="py-1 pr-2">gma1 fixture type</th>
                  <th className="w-24 py-1 text-right">MA1 slots</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const chosen = mapping[g.key];
                  const t = typeof chosen === 'number' ? doc.show.types[chosen] : undefined;
                  const gdtfSlots = g.gdtfMode?.breaks.join('/');
                  const mismatch = t && gdtfSlots && !t.unknown && t.breaks.join('/') !== gdtfSlots;
                  return (
                    <tr key={g.key} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1 pr-2">
                        <div>{g.gdtf ? `${g.gdtf.manufacturer} ${g.gdtf.name}` : g.spec}</div>
                        <div className="text-xs text-zinc-500">{g.mode || '—'}{!g.gdtf && ' · GDTF not loaded'}</div>
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{g.fixtures.length}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{gdtfSlots ?? '?'}</td>
                      <td className="py-1 pr-2">
                        <select
                          className={inputClass}
                          value={chosen === 'create' ? 'create' : chosen ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMapping({ ...mapping, [g.key]: v === '' ? null : v === 'create' ? 'create' : Number(v) });
                          }}
                        >
                          <option value="">— skip —</option>
                          {canCreateType(g) && <option value="create">➕ Create new type from GDTF</option>}
                          {doc.show.types.map((type) => (
                            <option key={type.index} value={type.index}>
                              {type.name}{canCreate(doc.show, type.index) ? '' : ' (re-address only)'}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`py-1 text-right tabular-nums ${mismatch ? 'font-semibold text-red-600' : ''}`}>
                        {chosen === 'create' ? gdtfSlots : t ? (t.unknown ? '?' : t.breaks.join('/')) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={renameExisting} onChange={(e) => setRenameExisting(e.target.checked)} />
              Rename existing fixtures to the MVR names
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={positions} onChange={(e) => setPositions(e.target.checked)} />
              Take stage positions from the MVR
            </label>
            <Button variant="primary" onClick={apply}>Apply to patch</Button>
          </div>
          {report && (
            <div className="mt-3 rounded-md bg-zinc-100 p-3 text-sm dark:bg-zinc-800">
              <p>{report.updated} fixtures re-addressed, {report.created} added.</p>
              {[...report.notes, ...report.skipped].map((m) => <p key={m} className="text-xs text-zinc-600 dark:text-zinc-400">• {m}</p>)}
            </div>
          )}
        </>
      )}
    </Section>
  );
}
