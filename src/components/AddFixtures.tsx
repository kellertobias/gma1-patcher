'use client';

import { useMemo, useState } from 'react';
import { formatAddress, parseAddress } from '@/lib/gma1/address';
import {
  type FixtureModel, type ShowDoc, addFixtures, addLayer, appendableLayers, canCreate, nextFreeId,
} from '@/lib/gma1/doc';
import { NAME_MAX } from '@/lib/gma1/records';
import { firstFreeAddress, occupiedSlots } from '@/lib/gma1/rules';
import { Button, Field, Section, inputClass } from './ui';

const NEW_LAYER = '__new__';

export function AddFixtures({ doc, onChange }: { doc: ShowDoc; onChange: (doc: ShowDoc) => void }) {
  const creatable = useMemo(() => doc.show.types.filter((t) => canCreate(doc.show, t.index)), [doc.show]);
  const layers = appendableLayers(doc);
  const [typeIndex, setTypeIndex] = useState<number>(creatable[0]?.index ?? -1);
  const [count, setCount] = useState('1');
  const [layerKey, setLayerKey] = useState<string>(layers.at(-1)?.key ?? NEW_LAYER);
  const [layerName, setLayerName] = useState('New layer');
  const [prefix, setPrefix] = useState('');
  const [fixStart, setFixStart] = useState('');
  const [chanStart, setChanStart] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const type = doc.show.types[typeIndex];
  const layerValid = layerKey === NEW_LAYER || layers.some((l) => l.key === layerKey);

  if (!creatable.length) {
    return (
      <Section title="Add fixtures">
        <p className="text-sm text-zinc-500">
          The show contains no fixture types this app can instantiate. Import fixture types on the console first.
        </p>
      </Section>
    );
  }

  function add() {
    setError(null);
    const n = Number(count);
    if (!type || !Number.isInteger(n) || n < 1 || n > 500) return setError('Choose a type and a count between 1 and 500.');
    const fixFirst = fixStart.trim() ? Number(fixStart) : nextFreeId(doc, 'fixId');
    const chanFirst = chanStart.trim() ? Number(chanStart) : 0;
    if (!Number.isInteger(fixFirst) || !Number.isInteger(chanFirst)) return setError('IDs must be whole numbers.');
    const start = address.trim() ? parseAddress(address) : null;
    if (address.trim() && (start === null || start < 0)) return setError('Start address must look like 1.001.');

    let next = doc;
    let target = layerKey;
    if (!layerValid || layerKey === NEW_LAYER) {
      const [withLayer, layer] = addLayer(doc, (layerName.trim() || 'New layer').slice(0, NAME_MAX));
      next = withLayer;
      target = layer.key;
    }
    const used = occupiedSlots(next);
    const sizes = type.unknown ? [1] : type.breaks;
    let cursor = start ?? 0;
    const fixtures: Omit<FixtureModel, 'key' | 'node'>[] = [];
    for (let i = 0; i < n; i++) {
      const patch = sizes.map((size) => {
        const a = start !== null && i === 0 && used.has(cursor) === false ? cursor : firstFreeAddress(used, size, cursor);
        if (a === null) return -1;
        for (let s = a; s < a + size; s++) used.add(s);
        cursor = a + size;
        return a;
      });
      fixtures.push({
        layerKey: target,
        name: `${(prefix.trim() || type.name).slice(0, NAME_MAX - 4)} ${i + 1}`,
        fixId: fixFirst > 0 ? fixFirst + i : 0,
        chanId: chanFirst > 0 ? chanFirst + i : 0,
        typeIndex: type.index,
        patch,
      });
    }
    onChange(addFixtures(next, fixtures));
    setFixStart('');
    setChanStart('');
    setAddress(formatAddress(cursor));
  }

  return (
    <Section title="Add fixtures">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <div className="col-span-2">
          <Field label="Fixture type (from the show)">
            <select className={inputClass} value={typeIndex} onChange={(e) => setTypeIndex(Number(e.target.value))}>
              {creatable.map((t) => (
                <option key={t.index} value={t.index}>{t.name} — {t.unknown ? '?' : t.breaks.join('/')} slots</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Count">
          <input className={inputClass} value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Layer">
          <select className={inputClass} value={layerValid ? layerKey : NEW_LAYER} onChange={(e) => setLayerKey(e.target.value)}>
            {layers.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
            <option value={NEW_LAYER}>New layer…</option>
          </select>
        </Field>
        {(!layerValid || layerKey === NEW_LAYER) && (
          <Field label="New layer name">
            <input className={inputClass} value={layerName} maxLength={NAME_MAX} onChange={(e) => setLayerName(e.target.value)} />
          </Field>
        )}
        <Field label="Name prefix">
          <input className={inputClass} value={prefix} placeholder={type?.name} onChange={(e) => setPrefix(e.target.value)} />
        </Field>
        <Field label="First fixture ID">
          <input className={inputClass} value={fixStart} placeholder={String(nextFreeId(doc, 'fixId'))} onChange={(e) => setFixStart(e.target.value)} />
        </Field>
        <Field label="First channel ID">
          <input className={inputClass} value={chanStart} placeholder="none" onChange={(e) => setChanStart(e.target.value)} />
        </Field>
        <Field label="Start address">
          <input className={`${inputClass} font-mono`} value={address} placeholder="first free" onChange={(e) => setAddress(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={add}>Add</Button>
        <span className="text-xs text-zinc-500">
          New fixtures go to the end of the last layer or into new layers, so existing cues and presets keep pointing
          at the right channels. Consecutive free addresses are used.
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Section>
  );
}
