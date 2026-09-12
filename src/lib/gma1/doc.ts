import { type Bytes, FormatError, concat, equalBytes, u32, view } from './binary';
import { gzipLikeConsole, writeTar } from './archive';
import { serializeFixtureTypePool } from './fixtureTypes';
import type { RawFixtureType } from './fixtureTypes';
import { type LoadedShow, parseSho, renameSho, showFileName, withFixtureTypePool } from './show';
import { type PicNode, parseMemberStrict, serializeMember } from './tree';
import {
  TAG_CHANNEL, TAG_FIXTURE, TAG_LAYER, type FixtureRecord, channelOldIndex, decodeFixture, decodeLayer,
  encodeFixture, encodeLayer, newLayerRecord, readFixtureBlock, withChannelOldIndex, withLayerIdRange,
  writeFixtureBlock,
} from './records';
import { type Problem, findProblems } from './rules';
import type { ChannelType, FixtureType } from './types';

export interface LayerModel {
  key: string;
  name: string;
  /** Set for layers that exist in the loaded show. */
  node?: PicNode;
}

export interface FixtureModel {
  key: string;
  layerKey: string;
  name: string;
  fixId: number;
  chanId: number;
  typeIndex: number;
  /** One absolute 0-based address per DMX break, -1 = unpatched. */
  patch: number[];
  /** Stage position in metres; undefined keeps the stored position. */
  position?: [number, number, number];
  /** Rotation as XYZ Euler degrees; undefined keeps the stored rotation. */
  rotation?: [number, number, number];
  /** Set for fixtures that exist in the loaded show (their order and layer are fixed). */
  node?: PicNode;
  /** Where a new fixture came from, e.g. "MVR". */
  origin?: string;
}

/**
 * Editable view of a show. Existing layers and fixtures keep their order: cues, presets and groups
 * refer to channels by position, so new fixtures are only appended (to the last existing layer or to
 * new layers) and existing fixtures are unpatched rather than deleted.
 */
export interface ShowDoc {
  show: LoadedShow;
  layers: LayerModel[];
  fixtures: FixtureModel[];
  /** Problems already present in the loaded show; they do not block writing. */
  baseline: Set<string>;
}

let counter = 0;
export const newKey = (prefix: string) => `${prefix}${++counter}`;

export function docFromShow(show: LoadedShow): ShowDoc {
  const doc: ShowDoc = { show, layers: [], fixtures: [], baseline: new Set() };
  for (const ln of show.root.children) {
    const layerKey = newKey('L');
    doc.layers.push({ key: layerKey, name: decodeLayer(ln.head).name, node: ln });
    for (const fn of ln.children) {
      const r = decodeFixture(fn.head);
      const b = readFixtureBlock(r.block);
      void b; // position/rotation stay undefined (overrides) so unchanged fixtures round-trip exactly
      doc.fixtures.push({
        key: newKey('F'), layerKey, name: r.name, fixId: b.fixId, chanId: b.chanId,
        typeIndex: r.typeIndex, patch: [...r.patch], node: fn,
      });
    }
  }
  doc.baseline = new Set(findProblems(doc).map((p) => p.message));
  return doc;
}

/** Problems introduced by the edits (the ones that block writing). */
export function newProblems(doc: ShowDoc): Problem[] {
  return findProblems(doc).filter((p) => !doc.baseline.has(p.message));
}

/** Layers that can take new fixtures without moving existing channels. */
export function appendableLayers(doc: ShowDoc): LayerModel[] {
  const existing = doc.layers.filter((l) => l.node);
  const last = existing[existing.length - 1];
  return doc.layers.filter((l) => !l.node || l === last);
}

export function templateFor(show: LoadedShow, typeIndex: number): PicNode | undefined {
  for (const layer of show.root.children) {
    for (const f of layer.children) if (decodeFixture(f.head).typeIndex === typeIndex) return f;
  }
  return undefined;
}

/** A fixture of this type can be created: by copying an existing one or from the type itself. */
export function canCreate(show: LoadedShow, typeIndex: number): boolean {
  const t = show.types[typeIndex];
  return !!t && (t.unknown === 0 || !!templateFor(show, typeIndex));
}

/**
 * Append a new fixture type to the show's pool and return [doc, its index]. The type is created
 * from its own channel definitions when fixtures of it are later added, so it is always creatable.
 */
export function addFixtureType(doc: ShowDoc, raw: RawFixtureType): [ShowDoc, number] {
  const pool = doc.show.fixtureTypePool;
  const index = pool.types.length;
  const show = withFixtureTypePool(doc.show, { ...pool, types: [...pool.types, raw] });
  return [{ ...doc, show }, index];
}

export function addLayer(doc: ShowDoc, name: string): [ShowDoc, LayerModel] {
  const layer = { key: newKey('L'), name };
  return [{ ...doc, layers: [...doc.layers, layer] }, layer];
}

export function removeLayer(doc: ShowDoc, key: string): ShowDoc {
  const layer = doc.layers.find((l) => l.key === key);
  if (!layer || layer.node || doc.fixtures.some((f) => f.layerKey === key)) return doc;
  return { ...doc, layers: doc.layers.filter((l) => l.key !== key) };
}

export function addFixtures(doc: ShowDoc, fixtures: Omit<FixtureModel, 'key' | 'node'>[]): ShowDoc {
  const allowed = new Set(appendableLayers(doc).map((l) => l.key));
  for (const f of fixtures) {
    if (!allowed.has(f.layerKey)) throw new Error('new fixtures can only go into the last layer or a new layer');
    if (!canCreate(doc.show, f.typeIndex)) throw new Error(`fixtures of type #${f.typeIndex} cannot be created`);
  }
  return { ...doc, fixtures: [...doc.fixtures, ...fixtures.map((f) => ({ ...f, key: newKey('F') }))] };
}

export type FixtureChange = Partial<Pick<FixtureModel, 'name' | 'fixId' | 'chanId' | 'patch' | 'position' | 'rotation' | 'layerKey'>>;

export function updateFixture(doc: ShowDoc, key: string, change: FixtureChange): ShowDoc {
  return {
    ...doc,
    fixtures: doc.fixtures.map((f) => {
      if (f.key !== key) return f;
      // Existing fixtures cannot change layer: that would reorder channels.
      const { layerKey, ...rest } = change;
      return { ...f, ...rest, ...(layerKey && !f.node ? { layerKey } : {}) };
    }),
  };
}

/** New fixtures are removed; existing ones are unpatched. */
export function removeFixture(doc: ShowDoc, key: string): ShowDoc {
  const f = doc.fixtures.find((x) => x.key === key);
  if (!f) return doc;
  if (f.node) return updateFixture(doc, key, { patch: f.patch.map(() => -1) });
  return { ...doc, fixtures: doc.fixtures.filter((x) => x.key !== key) };
}

export function nextFreeId(doc: ShowDoc, kind: 'fixId' | 'chanId'): number {
  return Math.max(0, ...doc.fixtures.map((f) => f[kind])) + 1;
}

/** Current position and rotation of a fixture: the edited override, else the stored values. */
export function fixturePlacement(f: FixtureModel): { position: [number, number, number]; rotation: [number, number, number] } {
  const stored = f.node ? readFixtureBlock(decodeFixture(f.node.head).block) : undefined;
  return {
    position: f.position ?? stored?.position ?? [0, 0, 0],
    rotation: f.rotation ?? stored?.rotation ?? [0, 0, 0],
  };
}

export function isDirty(doc: ShowDoc): boolean {
  return doc.fixtures.some((f) => !f.node || recordChanged(f)) || doc.layers.some((l) => !l.node);
}

function recordChanged(f: FixtureModel): boolean {
  return !!f.node && !equalBytes(encodeExisting(f), f.node.head);
}

// --- building the show ---------------------------------------------------------------------------

const EMPTY = new Uint8Array(0);

function randomGuid(): Bytes {
  const g = new Uint8Array(16);
  crypto.getRandomValues(g);
  return g;
}

function applyFields(rec: FixtureRecord, f: FixtureModel, extra: { oldIndex?: number; guid?: Bytes } = {}): Bytes {
  return encodeFixture({
    ...rec,
    name: f.name,
    patch: f.patch,
    block: writeFixtureBlock(rec.block, { fixId: f.fixId, chanId: f.chanId, position: f.position, rotation: f.rotation, ...extra }),
  });
}

function encodeExisting(f: FixtureModel): Bytes {
  return applyFields(decodeFixture(f.node!.head), f);
}

/** Record for a fixture whose type has no instance in the show (values as seen in console files). */
function blankRecord(show: LoadedShow, f: FixtureModel): FixtureRecord {
  const pre = new Uint8Array(12);
  pre.set([0x50, 0x49, TAG_FIXTURE, 0]);
  const block = new Uint8Array(0x5c);
  const dv = view(block);
  dv.setInt16(6, -1, true);
  const any = show.root.children.flatMap((l) => l.children)[0];
  if (any) block.set(decodeFixture(any.head).block.subarray(20, 52), 20); // rotation (quaternion)
  else dv.setFloat64(44, 1, true);
  dv.setUint32(52, 0x40, true); // flags
  dv.setUint32(56, 0x00ffffff, true); // static colour
  [60, 64, 68].forEach((o) => dv.setFloat32(o, 1, true)); // body scale
  const strings = new Uint8Array(8).fill(0xff); // colour + gobo string: null
  const stage = new Uint8Array(80);
  for (let i = 0; i < 4; i++) stage.fill(0xff, i * 20, i * 20 + 8);
  const post = new Uint8Array(16); // two empty data blocks, two null strings
  view(post).setInt32(8, -1, true);
  view(post).setInt32(12, -1, true);
  return { pre, name: f.name, block, mid: concat([strings, stage]), typeIndex: f.typeIndex, patch: f.patch, post };
}

/** One channel per coarse channel type, values taken from the type (as the console does). */
function channelFromType(ct: ChannelType, typeChannelIndex: number, oldIndex: number): PicNode {
  const h = new Uint8Array(48);
  const dv = view(h);
  h.set([0x50, 0x49, TAG_CHANNEL, 0x80]);
  dv.setUint32(4, 0x40, true);
  dv.setUint32(12, 0x18, true);
  h.set(ct.block.subarray(0, 16), 16); // default, highlight, stage, fade
  const flags = u32(ct.block, 16);
  dv.setUint32(32, ((flags >> 5) & 1) | (((flags >> 6) & 1) << 1), true); // snap, invert
  dv.setInt16(36, oldIndex, true);
  dv.setInt16(38, -1, true);
  dv.setInt32(40, typeChannelIndex, true);
  dv.setInt32(44, ct.profile, true);
  return { tag: TAG_CHANNEL, empty: true, head: h, coll: false, children: [], tail: EMPTY };
}

/**
 * One channel object per coarse (0) and virtual (2) channel type, as the console writes them — a fine
 * channel type gets none (checked on its own types: LED PAR56 6 channels for 5 slots + virtual dimmer,
 * A7 14 channels for 16 channel types).
 */
export function channelsFromType(type: FixtureType, nextIndex: () => number): PicNode[] {
  return type.channelTypes.flatMap((ct, j) => (ct.kind === 0 || ct.kind === 2 ? [channelFromType(ct, j, nextIndex())] : []));
}

function createFixture(show: LoadedShow, f: FixtureModel, index: number, nextChannel: () => number,
                       useTemplate = true): PicNode {
  const template = useTemplate ? templateFor(show, f.typeIndex) : undefined;
  if (template) {
    const head = applyFields(decodeFixture(template.head), f, { oldIndex: index, guid: randomGuid() });
    const children = template.children.map((c) => ({ ...c, head: withChannelOldIndex(c.head, nextChannel()) }));
    return { ...template, head, children };
  }
  const type = show.types[f.typeIndex];
  if (!type || type.unknown) throw new FormatError(`cannot create "${f.name}": fixture type not understood`);
  const head = applyFields(blankRecord(show, f), f, { oldIndex: index, guid: randomGuid() });
  return { tag: TAG_FIXTURE, empty: false, head, coll: true, children: channelsFromType(type, nextChannel), tail: EMPTY };
}

function dateFields(now: Date): [number, number] {
  const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const days = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000) + 719163;
  return [seconds, days];
}

export interface BuildResult {
  baseName: string;
  sho: Bytes;
  tgz: Bytes;
  fixtures: number;
  channels: number;
}

export interface BuildOptions {
  now?: Date;
  /** Create new fixtures from the fixture type even when a fixture to copy exists (tests). */
  fromType?: boolean;
  /** Show name to write; made console-safe (see `showFileName`). Defaults to the loaded name. */
  name?: string;
}

export class BuildError extends Error {
  constructor(public problems: Problem[]) {
    super(`${problems.length} problem(s) must be fixed before writing`);
  }
}

export function buildShow(doc: ShowDoc, opts: BuildOptions = {}): BuildResult {
  const problems = newProblems(doc);
  if (problems.length) throw new BuildError(problems);
  const { show } = doc;

  let maxOld = -1;
  for (const l of show.root.children) for (const f of l.children) for (const c of f.children) {
    maxOld = Math.max(maxOld, channelOldIndex(c.head));
  }
  let nextOld = maxOld + 1;
  const nextChannel = () => (nextOld <= 0x7fff ? nextOld++ : -1);

  let fixtureIndex = 0;
  let channels = 0;
  const layerNodes = doc.layers.map((layer) => {
    const own = doc.fixtures.filter((f) => f.layerKey === layer.key);
    const ordered = [...own.filter((f) => f.node), ...own.filter((f) => !f.node)];
    const children = ordered.map((f) => {
      const node = f.node
        ? { ...f.node, head: encodeExisting(f) }
        : createFixture(show, f, fixtureIndex, nextChannel, !opts.fromType);
      fixtureIndex++;
      channels += node.children.length;
      return node;
    });
    const rec = layer.node ? decodeLayer(layer.node.head) : newLayerRecord(layer.name);
    const block = withLayerIdRange(rec.block, {
      chan: ordered.map((f) => f.chanId).filter((x) => x > 0),
      fix: ordered.map((f) => f.fixId).filter((x) => x > 0),
    });
    const head = encodeLayer({ ...rec, name: layer.name, block });
    return layer.node
      ? { ...layer.node, head, children }
      : { tag: TAG_LAYER, empty: false, head, coll: true, children, tail: EMPTY };
  });

  // The console never sets the empty bit (PICID bit 31) on an object with children, and an empty
  // template's showrow root carries it — drop it once there are layers.
  const rootHead = layerNodes.length ? show.root.head.slice() : show.root.head;
  if (layerNodes.length) rootHead[3] &= 0x7f;
  const showrow = serializeMember({ ...show.showrow, roots: [{ ...show.root, head: rootHead, children: layerNodes }] });
  parseMemberStrict(showrow, 'generated showrow');

  const baseName = showFileName(opts.name ?? show.baseName);
  const sho = renameSho(show.sho, baseName);
  const dv = view(sho);
  const o = parseSho(sho).countsOffset;
  const [seconds, days] = dateFields(opts.now ?? new Date());
  dv.setUint32(o, channels, true);
  dv.setUint32(o + 4, fixtureIndex, true);
  dv.setUint32(o + 12, seconds, true);
  dv.setUint32(o + 16, days, true);

  // The fixture-type pool is regenerated from its parsed form; this is byte-identical to the input
  // when no type was added (the codec round-trips) and carries added types otherwise.
  const fixtureTypes = serializeFixtureTypePool(show.fixtureTypePool);
  const infoMirrorsSho = show.entries.some((e) => e.name === 'info' && equalBytes(e.data, show.sho));
  const entries = show.entries.map((e) => {
    if (e.name === 'showrow') return { ...e, data: showrow };
    if (e.name === 'fixturetypes') return { ...e, data: fixtureTypes };
    if (e.name === 'info' && infoMirrorsSho) return { ...e, data: sho };
    return e;
  });
  return { baseName, sho, tgz: gzipLikeConsole(writeTar(entries)), fixtures: fixtureIndex, channels };
}
