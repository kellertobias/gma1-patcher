import { LINE_SIZE, MAX_LINES, UNPATCHED, formatAddress } from './address';
import { NAME_MAX } from './records';
import type { FixtureModel, ShowDoc } from './doc';

export interface Problem {
  /** Fixture the problem belongs to. */
  key: string;
  message: string;
}

/** Fixture and channel IDs are stored as i16 and looked up in 20000-entry tables. */
export const MAX_ID = 19999;

/**
 * Checks mirroring the console (SHARED_FIXTURE::PatchPossible and the ID tables): each DMX break
 * needs its whole footprint inside one line, no slot may be shared, IDs must be unique.
 */
export function findProblems(doc: ShowDoc): Problem[] {
  const out: Problem[] = [];
  const owner = new Map<number, FixtureModel>();
  const ids = { fixture: new Map<number, FixtureModel>(), channel: new Map<number, FixtureModel>() };

  for (const f of doc.fixtures) {
    const add = (message: string) => out.push({ key: f.key, message: `"${f.name}": ${message}` });
    if (!f.name.trim()) add('name is empty');
    if (f.name.length > NAME_MAX) add(`name is longer than ${NAME_MAX} characters`);
    if (f.fixId <= 0 && f.chanId <= 0) add('needs a fixture ID or a channel ID');
    for (const [kind, id] of [['fixture', f.fixId], ['channel', f.chanId]] as const) {
      if (!Number.isInteger(id) || id < 0 || id > MAX_ID) {
        add(`${kind} ID ${id} is out of range (1–${MAX_ID})`);
      } else if (id > 0) {
        const other = ids[kind].get(id);
        if (other) add(`${kind} ID ${id} is also used by "${other.name}"`);
        else ids[kind].set(id, f);
      }
    }

    const type = doc.show.types[f.typeIndex];
    if (!type) {
      add(`unknown fixture type #${f.typeIndex}`);
      continue;
    }
    if (type.unknown) continue; // footprint unknown, addresses cannot be checked
    if (f.patch.length !== type.breaks.length) {
      add(`${f.patch.length} address(es) for ${type.breaks.length} DMX break(s)`);
    }
    f.patch.forEach((a, i) => {
      if (a === UNPATCHED) return;
      const size = type.breaks[i] ?? 1;
      const line = Math.floor(a / LINE_SIZE);
      let last = a + size - 1;
      if (a < 0 || last >= MAX_LINES * LINE_SIZE) {
        add(`${formatAddress(a)} + ${size} slots goes beyond DMX line ${MAX_LINES}`);
        return;
      }
      if (Math.floor(last / LINE_SIZE) !== line) {
        add(`${formatAddress(a)} + ${size} slots crosses the end of line ${line + 1}`);
        last = (line + 1) * LINE_SIZE - 1;
      }
      for (let s = a; s <= last; s++) {
        const other = owner.get(s);
        if (other && other !== f) {
          add(`overlaps "${other.name}" at ${formatAddress(s)}`);
          break;
        }
        owner.set(s, f);
      }
    });
  }
  return out;
}

/** Slot -> fixture key for everything currently patched (used to find free addresses). */
export function occupiedSlots(doc: ShowDoc): Set<number> {
  const used = new Set<number>();
  for (const f of doc.fixtures) {
    const type = doc.show.types[f.typeIndex];
    f.patch.forEach((a, i) => {
      if (a < 0) return;
      const size = type && !type.unknown ? type.breaks[i] ?? 1 : 1;
      for (let s = a; s < a + size; s++) used.add(s);
    });
  }
  return used;
}

/** First address at or after `from` where `size` slots are free inside one line. */
export function firstFreeAddress(used: Set<number>, size: number, from = 0): number | null {
  for (let a = Math.max(0, from); a + size <= MAX_LINES * LINE_SIZE; a++) {
    if (Math.floor(a / LINE_SIZE) !== Math.floor((a + size - 1) / LINE_SIZE)) {
      a = (Math.floor(a / LINE_SIZE) + 1) * LINE_SIZE - 1;
      continue;
    }
    let free = true;
    for (let s = a; s < a + size; s++) {
      if (used.has(s)) {
        free = false;
        a = s;
        break;
      }
    }
    if (free) return a;
  }
  return null;
}
