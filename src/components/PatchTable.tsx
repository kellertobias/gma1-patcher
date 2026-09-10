'use client';

import { useMemo, useState } from 'react';
import { formatAddress, formatRange, parseAddress } from '@/lib/gma1/address';
import { type ShowDoc, removeFixture, removeLayer, updateFixture } from '@/lib/gma1/doc';
import { NAME_MAX } from '@/lib/gma1/records';
import type { Problem } from '@/lib/gma1/rules';
import { Button, EditCell, Section, inputClass } from './ui';

function parseId(text: string): number | null {
  const t = text.trim();
  if (t === '' || t === '-') return 0;
  return /^\d+$/.test(t) ? Number(t) : null;
}

export function PatchTable({ doc, problems, onChange }: {
  doc: ShowDoc;
  problems: Problem[];
  onChange: (doc: ShowDoc) => void;
}) {
  const [filter, setFilter] = useState('');
  const byKey = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of problems) m.set(p.key, [...(m.get(p.key) ?? []), p.message]);
    return m;
  }, [problems]);

  const q = filter.trim().toLowerCase();
  const visible = (f: ShowDoc['fixtures'][number]) =>
    !q || [f.name, String(f.fixId), String(f.chanId), doc.show.types[f.typeIndex]?.name ?? '',
      f.patch.map(formatAddress).join(' ')].some((s) => s.toLowerCase().includes(q));

  return (
    <Section
      title={`Patch — ${doc.fixtures.length} fixtures in ${doc.layers.length} layers`}
      actions={
        <input
          placeholder="Filter by name, ID, type or address"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={`${inputClass} w-72`}
        />
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="w-20 py-1 pr-2">Fix ID</th>
              <th className="w-20 py-1 pr-2">Chan ID</th>
              <th className="py-1 pr-2">Name</th>
              <th className="py-1 pr-2">Type</th>
              <th className="w-14 py-1 pr-2 text-right">Slots</th>
              <th className="w-32 py-1 pr-2">Address</th>
              <th className="w-28 py-1 pr-2">Range</th>
              <th className="w-24 py-1" />
            </tr>
          </thead>
          {doc.layers.map((layer) => {
            const fixtures = doc.fixtures.filter((f) => f.layerKey === layer.key);
            const shown = fixtures.filter(visible);
            if (q && !shown.length) return null;
            return (
              <tbody key={layer.key} className="border-t border-zinc-200 dark:border-zinc-800">
                <tr>
                  <td colSpan={8} className="pb-1 pt-3 text-xs font-semibold text-zinc-500">
                    Layer “{layer.name}” {!layer.node && <span className="ml-1 rounded bg-amber-100 px-1.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">new</span>}
                    <span className="ml-2 font-normal">{fixtures.length} fixtures</span>
                    {!layer.node && !fixtures.length && (
                      <Button variant="quiet" className="ml-2 !py-0.5 text-xs" onClick={() => onChange(removeLayer(doc, layer.key))}>
                        remove layer
                      </Button>
                    )}
                  </td>
                </tr>
                {shown.map((f) => {
                  const type = doc.show.types[f.typeIndex];
                  const sizes = type && !type.unknown ? type.breaks : f.patch.map(() => 1);
                  const issues = byKey.get(f.key) ?? [];
                  const blocking = issues.filter((m) => !doc.baseline.has(m));
                  return (
                    <tr key={f.key} className={blocking.length ? 'bg-red-50 dark:bg-red-950/30' : issues.length ? 'bg-yellow-50 dark:bg-yellow-950/20' : ''}>
                      <td className="py-0.5 pr-2">
                        <EditCell value={f.fixId ? String(f.fixId) : ''} placeholder="–"
                          commit={(t) => { const id = parseId(t); if (id === null) return false; onChange(updateFixture(doc, f.key, { fixId: id })); return true; }} />
                      </td>
                      <td className="py-0.5 pr-2">
                        <EditCell value={f.chanId ? String(f.chanId) : ''} placeholder="–"
                          commit={(t) => { const id = parseId(t); if (id === null) return false; onChange(updateFixture(doc, f.key, { chanId: id })); return true; }} />
                      </td>
                      <td className="py-0.5 pr-2">
                        <EditCell value={f.name}
                          commit={(t) => { if (!t.trim() || t.length > NAME_MAX) return false; onChange(updateFixture(doc, f.key, { name: t })); return true; }} />
                        {issues.map((m) => (
                          <div key={m} className={`text-xs ${doc.baseline.has(m) ? 'text-yellow-700 dark:text-yellow-400' : 'text-red-600'}`}>
                            {m}{doc.baseline.has(m) && ' (already in the loaded show)'}
                          </div>
                        ))}
                      </td>
                      <td className="py-0.5 pr-2 text-zinc-600 dark:text-zinc-400">
                        {type?.name ?? `#${f.typeIndex}`}
                        {!f.node && <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{f.origin ?? 'new'}</span>}
                      </td>
                      <td className="py-0.5 pr-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        {type && !type.unknown ? type.breaks.join('/') : '?'}
                      </td>
                      <td className="py-0.5 pr-2">
                        <EditCell value={f.patch.map(formatAddress).join(' ')} className="font-mono" title="line.slot, one per DMX break; - = unpatched"
                          commit={(t) => {
                            const parts = t.trim() ? t.trim().split(/\s+/) : ['-'];
                            const patch = parts.map(parseAddress);
                            if (patch.some((a) => a === null) || patch.length !== f.patch.length) return false;
                            onChange(updateFixture(doc, f.key, { patch: patch as number[] }));
                            return true;
                          }} />
                      </td>
                      <td className="py-0.5 pr-2 font-mono text-xs text-zinc-500">
                        {f.patch.map((a, i) => formatRange(a, sizes[i] ?? 1)).join(' ')}
                      </td>
                      <td className="py-0.5 text-right">
                        {f.node ? (
                          f.patch.some((a) => a >= 0) && (
                            <Button variant="quiet" className="!py-0.5 text-xs" onClick={() => onChange(removeFixture(doc, f.key))}>unpatch</Button>
                          )
                        ) : (
                          <Button variant="quiet" className="!py-0.5 text-xs" onClick={() => onChange(removeFixture(doc, f.key))}>remove</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      {!doc.fixtures.length && <p className="text-sm text-zinc-500">This show has no fixtures yet.</p>}
    </Section>
  );
}
