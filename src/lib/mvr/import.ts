import {
  type FixtureModel, type ShowDoc, addFixtureType, addFixtures, addLayer, appendableLayers, canCreate,
  nextFreeId, updateFixture,
} from '../gma1/doc';
import { type BuiltType, buildFixtureType, channelsFromGdtf, describeSubstitutions } from '../gma1/buildType';
import type { FixtureType } from '../gma1/types';
import { NAME_MAX } from '../gma1/records';
import type { GdtfMode, GdtfType } from './gdtf';
import type { MvrFile, MvrFixture } from './mvr';

/** A mapping choice: an existing show fixture-type index, or "create" a new type from the GDTF. */
export type TypeChoice = number | 'create' | null;

/** A distinct GDTF type + mode used in the MVR. */
export interface MvrTypeGroup {
  key: string;
  spec: string;
  mode: string;
  gdtf?: GdtfType;
  gdtfMode?: GdtfMode;
  fixtures: MvrFixture[];
}

export const groupKey = (f: MvrFixture) => `${f.gdtfSpec}|${f.gdtfMode}`;

export function groupMvr(mvr: MvrFile, gdtf: Map<string, GdtfType>): MvrTypeGroup[] {
  const groups = new Map<string, MvrTypeGroup>();
  for (const f of mvr.fixtures) {
    const key = groupKey(f);
    let g = groups.get(key);
    if (!g) {
      const type = gdtf.get(f.gdtfSpec);
      g = {
        key, spec: f.gdtfSpec, mode: f.gdtfMode, gdtf: type,
        gdtfMode: type?.modes.find((m) => m.name === f.gdtfMode) ?? type?.modes[0],
        fixtures: [],
      };
      groups.set(key, g);
    }
    g.fixtures.push(f);
  }
  return [...groups.values()];
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1));

/** Best matching show fixture type: same footprint first, then shared name tokens. */
export function suggestType(group: MvrTypeGroup, types: FixtureType[], show: ShowDoc['show']): number | null {
  const want = tokens(`${group.gdtf?.manufacturer ?? ''} ${group.gdtf?.name ?? group.spec} ${group.mode}`);
  let best: { index: number; score: number } | null = null;
  for (const t of types) {
    if (!canCreate(show, t.index) && !group.fixtures.length) continue;
    let score = 0;
    if (group.gdtfMode && !t.unknown && t.breaks.join() === group.gdtfMode.breaks.join()) score += 10;
    for (const tok of tokens(t.name)) if (want.has(tok)) score += 3;
    if (score > 0 && (!best || score > best.score)) best = { index: t.index, score };
  }
  return best && best.score >= 3 ? best.index : null;
}

export interface ImportOptions {
  /** Update names of fixtures that already exist in the show. */
  renameExisting: boolean;
  /** Take stage positions from the MVR. */
  positions: boolean;
}

export interface ImportReport {
  updated: number;
  created: number;
  skipped: string[];
  notes: string[];
}

/**
 * Apply MVR fixtures to the show: fixtures whose fixture ID exists are re-addressed, others are
 * appended (to a layer named like the MVR layer when possible).
 */
export function applyMvr(doc: ShowDoc, groups: MvrTypeGroup[], mapping: Record<string, TypeChoice>,
                         opts: ImportOptions): [ShowDoc, ImportReport] {
  const report: ImportReport = { updated: 0, created: 0, skipped: [], notes: [] };
  let next = doc;

  for (const g of groups) {
    let choice = mapping[g.key];
    if (choice === 'create') {
      const made = createTypeForGroup(next, g);
      if (typeof made === 'string') {
        report.skipped.push(`${g.fixtures.length} × ${g.spec} (${g.mode}): ${made}`);
        continue;
      }
      next = made.doc;
      choice = made.index;
      report.notes.push(`Created fixture type "${next.show.types[choice].name}" (${next.show.types[choice].breaks.join('/')} slots)` +
        (made.substituted.length ? ` — stand-ins: ${describeSubstitutions(made.substituted)}` : ''));
    }
    const typeIndex = choice;
    if (typeIndex === null || typeIndex === undefined) {
      report.skipped.push(`${g.fixtures.length} × ${g.spec} (${g.mode}): no gma1 type chosen`);
      continue;
    }
    const type = next.show.types[typeIndex];
    if (g.gdtfMode && !type.unknown && type.breaks.join() !== g.gdtfMode.breaks.join()) {
      report.notes.push(`${g.spec} (${g.mode}) uses ${g.gdtfMode.breaks.join('/')} slots, ` +
        `"${type.name}" uses ${type.breaks.join('/')} — check the mapping`);
    }

    for (const m of g.fixtures) {
      const patch = type.breaks.map((_, i) => m.addresses.find((a) => a.dmxBreak === i)?.address ?? -1);
      const existing = m.fixtureId > 0 ? next.fixtures.find((f) => f.fixId === m.fixtureId) : undefined;
      if (existing) {
        if (existing.typeIndex !== typeIndex) {
          report.notes.push(`"${existing.name}" (ID ${m.fixtureId}) is a "${next.show.types[existing.typeIndex]?.name}" ` +
            `in the show, not "${type.name}"; only its address was changed`);
        }
        next = updateFixture(next, existing.key, {
          patch: existing.patch.map((_, i) => patch[i] ?? -1),
          ...(opts.renameExisting && m.name ? { name: m.name.slice(0, NAME_MAX) } : {}),
          ...(opts.positions ? { position: m.position } : {}),
        });
        report.updated++;
        continue;
      }
      if (!canCreate(next.show, typeIndex)) {
        report.skipped.push(`"${m.name}": fixtures of "${type.name}" cannot be created`);
        continue;
      }
      const layerKey = layerFor(next, m.layer || 'MVR');
      next = layerKey[0];
      const fixture: Omit<FixtureModel, 'key' | 'node'> = {
        layerKey: layerKey[1],
        name: (m.name || `${type.name} ${m.fixtureId}`).slice(0, NAME_MAX),
        fixId: m.fixtureId > 0 ? m.fixtureId : nextFreeId(next, 'fixId'),
        chanId: 0,
        typeIndex,
        patch,
        position: opts.positions ? m.position : undefined,
        origin: 'MVR',
      };
      next = addFixtures(next, [fixture]);
      report.created++;
    }
  }
  return [next, report];
}

/** Whether a GDTF group can have a gma1 type generated from it (needs its GDTF mode). */
export function canCreateType(group: MvrTypeGroup): boolean {
  return !!group.gdtfMode && group.gdtfMode.channels.some((c) => c.offsets.length > 0);
}

function createTypeForGroup(doc: ShowDoc, g: MvrTypeGroup):
  { doc: ShowDoc; index: number; substituted: BuiltType['substituted'] } | string {
  if (!g.gdtfMode) return 'GDTF not loaded, cannot create a type';
  let built: BuiltType;
  try {
    built = buildFixtureType({
      name: g.gdtf?.name || g.spec,
      manufacturer: g.gdtf?.manufacturer || '',
      shortName: g.gdtf?.shortName || '',
      channels: channelsFromGdtf(g.gdtfMode),
      attributes: doc.show.attributes,
    });
  } catch (e) {
    return (e as Error).message;
  }
  if (!built.raw.channelTypes.length) return 'no usable DMX channels in the GDTF mode';
  const [next, index] = addFixtureType(doc, built.raw);
  return { doc: next, index, substituted: built.substituted };
}

/** A layer that can take new fixtures and is named `name`; created at the end when needed. */
function layerFor(doc: ShowDoc, name: string): [ShowDoc, string] {
  const hit = appendableLayers(doc).find((l) => l.name === name);
  if (hit) return [doc, hit.key];
  const [next, layer] = addLayer(doc, name.slice(0, NAME_MAX));
  return [next, layer.key];
}
