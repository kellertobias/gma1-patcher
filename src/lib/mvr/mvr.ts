import { strFromU8, unzipSync } from 'fflate';
import { list, text, xml } from './xml';

export interface MvrFixture {
  uuid: string;
  name: string;
  layer: string;
  gdtfSpec: string;
  gdtfMode: string;
  /** Numeric fixture ID (FixtureIDNumeric, else FixtureID when numeric), 0 if none. */
  fixtureId: number;
  unitNumber: number;
  /** 0-based absolute DMX address per break (break 0 = first). */
  addresses: { dmxBreak: number; address: number }[];
  /** World position in metres. */
  position: [number, number, number];
}

export interface MvrFile {
  fixtures: MvrFixture[];
  /** GDTF files embedded in the MVR, by file name. */
  gdtf: Record<string, Uint8Array>;
}

type Node = Record<string, unknown>;

/** 3×3 rotation (rows u, v, w) + offset o, as in MVR "{u}{v}{w}{o}", millimetres. */
interface Matrix {
  r: number[][];
  o: number[];
}

const IDENTITY: Matrix = { r: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], o: [0, 0, 0] };

function parseMatrix(s: string): Matrix {
  const rows = [...s.matchAll(/\{([^}]*)\}/g)].map((m) => m[1].split(',').map(Number));
  if (rows.length !== 4 || rows.some((r) => r.length !== 3 || r.some(Number.isNaN))) return IDENTITY;
  return { r: rows.slice(0, 3), o: rows[3] };
}

/** child expressed in the parent's space -> world. */
function compose(parent: Matrix, child: Matrix): Matrix {
  const apply = (v: number[]) => [0, 1, 2].map((j) => v[0] * parent.r[0][j] + v[1] * parent.r[1][j] + v[2] * parent.r[2][j]);
  const o = apply(child.o).map((x, j) => x + parent.o[j]);
  return { r: child.r.map(apply), o };
}

/** "1025" (1-based absolute) or "3.1" (universe.address) -> 0-based absolute. */
export function parseMvrAddress(s: string): number | null {
  const t = s.trim();
  const m = /^(\d+)\.(\d+)$/.exec(t);
  if (m) return (Number(m[1]) - 1) * 512 + Number(m[2]) - 1;
  return /^\d+$/.test(t) && Number(t) >= 1 ? Number(t) - 1 : null;
}

function collect(children: Node | undefined, layer: string, parent: Matrix, out: MvrFixture[]) {
  if (!children) return;
  for (const g of list<Node>(children.GroupObject)) {
    collect(g.ChildList as Node, layer, compose(parent, parseMatrix(text(g.Matrix))), out);
  }
  for (const f of list<Node>(children.Fixture)) {
    const m = compose(parent, parseMatrix(text(f.Matrix)));
    const numeric = Number(text(f.FixtureIDNumeric));
    const fid = Number(text(f.FixtureID));
    out.push({
      uuid: String(f['@uuid'] ?? ''),
      name: String(f['@name'] ?? ''),
      layer,
      gdtfSpec: text(f.GDTFSpec),
      gdtfMode: text(f.GDTFMode),
      fixtureId: numeric > 0 ? numeric : Number.isInteger(fid) && fid > 0 ? fid : 0,
      unitNumber: Number(text(f.UnitNumber)) || 0,
      addresses: list((f.Addresses as Node | undefined)?.Address).flatMap((a) => {
        const address = parseMvrAddress(text(a));
        const brk = typeof a === 'object' ? Number((a as Node)['@break'] ?? 0) : 0;
        return address === null ? [] : [{ dmxBreak: brk || 0, address }];
      }),
      position: m.o.map((x) => x / 1000) as [number, number, number],
    });
  }
}

/** Parse an MVR file (zip with GeneralSceneDescription.xml and GDTF files). */
export function parseMvr(bytes: Uint8Array): MvrFile {
  const files = unzipSync(bytes);
  const scene = files['GeneralSceneDescription.xml'];
  if (!scene) throw new Error('not an MVR file (no GeneralSceneDescription.xml)');
  const root = (xml.parse(strFromU8(scene)) as Node).GeneralSceneDescription as Node | undefined;
  const layers = list<Node>(((root?.Scene as Node | undefined)?.Layers as Node | undefined)?.Layer);
  const fixtures: MvrFixture[] = [];
  for (const layer of layers) {
    collect(layer.ChildList as Node, String(layer['@name'] ?? ''), parseMatrix(text(layer.Matrix)), fixtures);
  }
  const gdtf: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(files)) if (name.toLowerCase().endsWith('.gdtf')) gdtf[name] = data;
  return { fixtures, gdtf };
}

/** The embedded GDTF a fixture refers to (GDTFSpec may omit the extension). */
export function gdtfFileFor(mvr: MvrFile, spec: string): Uint8Array | undefined {
  return mvr.gdtf[spec] ?? mvr.gdtf[`${spec}.gdtf`];
}
