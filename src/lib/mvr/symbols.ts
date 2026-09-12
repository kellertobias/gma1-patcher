/**
 * Fixture appearance for the exported GDTFs: a rough kind guessed from the fixture's name and
 * channels, the physical size that goes with it, and a 2D plan symbol.
 *
 * MVR consumers draw a fixture from its GDTF: the CAD/2D view uses the `models/svg/<file>.svg`
 * resource of the top-level model (falling back to the primitive's bounding box, which is why
 * everything used to look like a box), the 3D view uses the geometry tree and the beam.
 */

/** What the fixture roughly is; decides size, beam and plan symbol. */
export type FixtureKind =
  | 'movingSpot' | 'movingWash' | 'profile' | 'fresnel' | 'par' | 'ledPar' | 'bar' | 'strobe' | 'generic';

export interface FixtureLook {
  kind: FixtureKind;
  /** Body size in metres: X (length, pointing where the beam goes in plan), Y (width), Z (height). */
  size: [number, number, number];
  /** Beam and field angle in degrees. */
  beamAngle: number;
  fieldAngle: number;
  beamType: 'Wash' | 'Spot';
  /** True for pan/tilt fixtures, which get a Base → Yoke → Head geometry tree. */
  moving: boolean;
}

const LOOKS: Record<FixtureKind, Omit<FixtureLook, 'kind'>> = {
  movingSpot: { size: [0.4, 0.4, 0.62], beamAngle: 15, fieldAngle: 20, beamType: 'Spot', moving: true },
  movingWash: { size: [0.38, 0.38, 0.52], beamAngle: 25, fieldAngle: 40, beamType: 'Wash', moving: true },
  profile: { size: [0.62, 0.3, 0.36], beamAngle: 26, fieldAngle: 36, beamType: 'Spot', moving: false },
  fresnel: { size: [0.4, 0.3, 0.36], beamAngle: 30, fieldAngle: 50, beamType: 'Wash', moving: false },
  par: { size: [0.4, 0.25, 0.25], beamAngle: 12, fieldAngle: 24, beamType: 'Wash', moving: false },
  ledPar: { size: [0.28, 0.26, 0.28], beamAngle: 20, fieldAngle: 30, beamType: 'Wash', moving: false },
  bar: { size: [0.12, 1.0, 0.12], beamAngle: 25, fieldAngle: 40, beamType: 'Wash', moving: false },
  strobe: { size: [0.32, 0.26, 0.3], beamAngle: 60, fieldAngle: 90, beamType: 'Wash', moving: false },
  generic: { size: [0.3, 0.3, 0.3], beamAngle: 20, fieldAngle: 30, beamType: 'Wash', moving: false },
};

/** Kind from the fixture type name, when it says what it is. Names win over the channel guess. */
function kindFromName(name: string): FixtureKind | undefined {
  const n = name.toLowerCase();
  if (/\b(bar|batten|strip|pixel|blinder|cyc|flood)\b|batten|blinder/.test(n)) return 'bar';
  if (/strob|atomic/.test(n)) return 'strobe';
  if (/fresnel|pc\b/.test(n)) return 'fresnel';
  if (/profile|ellips|source ?four|s4\b|zoom ?profile|leko/.test(n)) return 'profile';
  if (/\bpar\b|parcan|par ?64|par ?56/.test(n)) return 'par';
  return undefined;
}

/**
 * Guess what a fixture looks like from its GDTF attribute names and its type name, so the export
 * can give it a plausible body, beam and plan symbol instead of one generic cube.
 */
export function fixtureLook(name: string, attributes: readonly string[]): FixtureLook {
  const has = (re: RegExp) => attributes.some((a) => re.test(a));
  const moving = has(/^Pan$/) && has(/^Tilt$/);
  const gobo = has(/^Gobo/);
  const led = has(/^ColorAdd_|^ColorRGB_/);

  // Pan/tilt wins over the name: a moving fixture is always drawn as one.
  const kind: FixtureKind = moving
    ? (gobo || has(/^Iris$|^Prism/) ? 'movingSpot' : 'movingWash')
    : kindFromName(name) ?? (gobo ? 'profile' : led ? 'ledPar' : has(/^Dimmer$/) ? 'par' : 'generic');
  return { kind, ...LOOKS[kind] };
}

// --- 2D plan symbols -----------------------------------------------------------------------------

/**
 * Plan symbol for a kind, as an SVG in millimetres over the body's X/Y footprint. The beam points
 * towards +X (to the right), which is where the geometry's front is, and the origin is the centre
 * of the view box, matching the model's default SVGOffsetX/Y of 0.
 */
export function symbolSvg(look: FixtureLook): string {
  const w = Math.round(look.size[0] * 1000);
  const h = Math.round(look.size[1] * 1000);
  const body = shapes(look.kind, w, h);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n` +
    `  <g fill="none" stroke="#000000" stroke-width="${Math.max(3, Math.round(Math.min(w, h) / 40))}" ` +
    `stroke-linejoin="round" stroke-linecap="round">\n${body}\n  </g>\n` +
    `</svg>\n`
  );
}

function shapes(kind: FixtureKind, w: number, h: number): string {
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2;
  const n = (v: number) => Number(v.toFixed(1));
  const circle = (x: number, y: number, rad: number, extra = '') =>
    `    <circle cx="${n(x)}" cy="${n(y)}" r="${n(rad)}"${extra}/>`;
  const rect = (x: number, y: number, rw: number, rh: number, extra = '') =>
    `    <rect x="${n(x)}" y="${n(y)}" width="${n(rw)}" height="${n(rh)}"${extra}/>`;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `    <line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`;
  const path = (d: string) => `    <path d="${d}"/>`;

  switch (kind) {
    // Base circle, the yoke arms across it and the head between them, lens towards +X.
    case 'movingSpot':
    case 'movingWash': {
      const arm = r * 0.14, headW = r * 0.5, headL = r * 0.62;
      return [
        circle(cx, cy, r * 0.96),
        rect(cx - headL * 0.7, cy - r * 0.8, headL * 1.4, arm, ' rx="' + n(arm / 2) + '"'),
        rect(cx - headL * 0.7, cy + r * 0.8 - arm, headL * 1.4, arm, ' rx="' + n(arm / 2) + '"'),
        rect(cx - headL, cy - headW, headL * 2, headW * 2, ' rx="' + n(headW * 0.3) + '"'),
        circle(cx, cy, headW * 0.62),
        kind === 'movingSpot' ? circle(cx, cy, headW * 0.28) : '',
      ].filter(Boolean).join('\n');
    }
    // Ellipsoidal: lamp housing at the back, barrel narrowing to the lens at the front.
    case 'profile': {
      return [
        rect(cx - w * 0.47, cy - h * 0.44, w * 0.4, h * 0.88, ' rx="' + n(h * 0.12) + '"'),
        path(`M ${n(cx - w * 0.07)} ${n(cy - h * 0.4)} L ${n(cx + w * 0.4)} ${n(cy - h * 0.26)} ` +
          `L ${n(cx + w * 0.4)} ${n(cy + h * 0.26)} L ${n(cx - w * 0.07)} ${n(cy + h * 0.4)} Z`),
        line(cx + w * 0.46, cy - h * 0.26, cx + w * 0.46, cy + h * 0.26),
        line(cx + w * 0.4, cy - h * 0.26, cx + w * 0.46, cy - h * 0.26),
        line(cx + w * 0.4, cy + h * 0.26, cx + w * 0.46, cy + h * 0.26),
      ].join('\n');
    }
    // Fresnel / PC: square body, round lens, lens cross.
    case 'fresnel': {
      const lens = Math.min(w, h) * 0.3;
      return [
        rect(cx - w * 0.46, cy - h * 0.42, w * 0.5, h * 0.84, ' rx="' + n(h * 0.08) + '"'),
        circle(cx + w * 0.2, cy, lens),
        line(cx + w * 0.2 - lens, cy, cx + w * 0.2 + lens, cy),
        line(cx + w * 0.2, cy - lens, cx + w * 0.2, cy + lens),
      ].join('\n');
    }
    // PAR can: barrel seen from the top, lens at the front.
    case 'par': {
      return [
        rect(cx - w * 0.46, cy - h * 0.4, w * 0.92, h * 0.8, ' rx="' + n(h * 0.4) + '"'),
        line(cx + w * 0.2, cy - h * 0.38, cx + w * 0.2, cy + h * 0.38),
        line(cx - w * 0.2, cy - h * 0.38, cx - w * 0.2, cy + h * 0.38),
      ].join('\n');
    }
    // LED par: round body with the emitter ring.
    case 'ledPar': {
      return [
        circle(cx, cy, r * 0.94),
        circle(cx, cy, r * 0.55),
        line(cx + r * 0.94, cy, cx + r * 0.55, cy),
      ].join('\n');
    }
    // Bar / batten / blinder: long body with its cells.
    case 'bar': {
      const cells = 6;
      const step = h * 0.9 / cells;
      const dots = Array.from({ length: cells }, (_, i) =>
        circle(cx, cy - h * 0.45 + step * (i + 0.5), Math.min(step, w) * 0.3)).join('\n');
      return [rect(cx - w * 0.45, cy - h * 0.47, w * 0.9, h * 0.94, ' rx="' + n(w * 0.2) + '"'), dots].join('\n');
    }
    // Strobe: body with the flash bolt.
    case 'strobe': {
      return [
        rect(cx - w * 0.45, cy - h * 0.42, w * 0.9, h * 0.84, ' rx="' + n(h * 0.1) + '"'),
        path(`M ${n(cx + w * 0.12)} ${n(cy - h * 0.28)} L ${n(cx - w * 0.1)} ${n(cy + h * 0.02)} ` +
          `L ${n(cx + w * 0.06)} ${n(cy - h * 0.02)} L ${n(cx - w * 0.14)} ${n(cy + h * 0.28)}`),
      ].join('\n');
    }
    default:
      return [
        rect(cx - w * 0.45, cy - h * 0.42, w * 0.9, h * 0.84, ' rx="' + n(Math.min(w, h) * 0.1) + '"'),
        line(cx + w * 0.2, cy - h * 0.42, cx + w * 0.2, cy + h * 0.42),
      ].join('\n');
  }
}
