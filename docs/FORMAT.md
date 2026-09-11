# gma1 (v6.x) show file format

Notes on the gma1 (v6.x) show file format, for interoperability — reading and writing the patch
of an existing show. Checked against a set of factory demo shows.

All integers are little-endian. "Verified" = confirmed against the demo files.

## 1. Container

A show is two files with the same base name:

- `<name>.sho` — header, 90–110 bytes
- `<name>.tar.gz` — gzip → old-style (v7, no ustar magic) tar, one member per object pool

Tar conventions (console-written): first entry `.` (dir, mode 40777), files mode 100666, uid/gid 0,
no user names, archive zero-padded to a multiple of 10240 bytes. gzip header: no name, mtime 0,
XFL 0, OS 0x0B. Some factory shows were packed with `./`-prefixed names.

A v6.801 desk save differs slightly: every name `./`-prefixed (first entry `./`), files mode
100777, real mtimes, gzip with a file name and OS Unix. Directories (`./`, `./DEFAULT.USER/`) are
written as mode ` 40777 ` with typeflag `0`, never `5`. Every header carries a valid checksum
(`%6o\0 `) — a single header with a blank checksum makes the desk refuse the show with "error".

### `.sho` header — verified

| offset | type | meaning |
|---|---|---|
| 0 | char[2] | `AM` |
| 2 | u16 | file version (6500 = v6.500, 6600, 6801 …) |
| 4 | u32 + bytes | show title (upper case) |
| … | u32 + bytes | file name incl. `.sho` |
| … | u32 + bytes | user (`Administrator`) |
| … | u32 ×4 | 0x18, 0x1000, 0x1000, 0 (constant in all demos) |
| … | u32 | **number of channels** (control channels, i.e. `showrow` channel objects) |
| … | u32 | **number of fixtures** |
| … | u32 | 0 |
| … | u32 | save time, seconds since midnight |
| … | u32 | save date, proleptic ordinal (Python `date.fromordinal`) |

No checksum of the archive. The `info` member repeats the first part of the header.

## 2. Object stream (every pool member) — verified

```
member  := "AM" u16 version  object*
object  := PICID PICSTATUS payload  [children]  u32 size
PICID   := u32 = 'P' 'I' u16 class_tag      (bit 31 = object is empty)
PICSTATUS := 8 bytes (flags, 0)
size    := byte count from PICID to this trailer  (checked on load)
children (COLLECTBASE, when stream has_endpos):
           u32 end_pos  u32 count  object*count
           end_pos = absolute member offset where the children end (checked on load)
```

Collections (layers, pools) additionally close with their own `size` after their last child.

**Empty bit** (PICID bit 31) — checked against a v6.801 desk save: it is never set on an object
that has children. An empty pool root is written with it set (`agenda`: tag 0x8057, end_pos 24,
count 0, 28 bytes), a filled one without (`showrow` 0x0029, `fixturetypes` 0x0019, `world` 0x002F).
Channel types (0x15) without channel functions carry it, channels (0x23) always. A filled pool
that still has the bit (e.g. a filled empty-template pool) makes the desk reject the show ("no valid
show found"). An empty root must also carry the pool's own class tag — root classes seen on the desk:
agenda 0x57, bmpeffect 0x7E, engines 0x69, executor 0x43, fadepath 0xA1, forms 0x65, group 0x6D,
layout 0x8E, macros 0x53, master 0x49, matrix 0x33, ncuelist 0x3F, pages 0x47, preset0–9 0x37,
profile 0x1D, remote 0x4D, timecode 0x59, world 0x2F; user files chatmsg 0x09, tools 0x81,
userpresets 0x72, userset 0x88, viewpics 0x5D, views 0x61. Some of these roots carry a payload before
their collection (executor, pages, remote, timecode), so a bare empty root for them is still a guess.
Primitive encodings (gmaLib): `int` = 4 bytes; `STRING` = i32 length (−1 = null) + bytes;
`FIXSTRING<n>` = u32 length + bytes; `MEMBLOCK2` = u32 size + raw struct bytes;
`ARRAY_ANZ<int,4>` = u32 count + MEMBLOCK2(count × 4).

Parsing by size trailers alone rebuilds the full tree of `showrow` and `dmx` in every demo show
(179/192 members overall; `remote`, `timecode` and a few `fixturetypes`/`preset` members contain
byte runs that look like `PI` and need class-aware parsing).

## 3. Patch data

### `showrow` — layers, fixtures, channels

Class tags: 0x29 root (stage definition), 0x27 layer ("Front Truss", …), 0x25 fixture, 0x8023 channel.

Fixture record:

| field | encoding |
|---|---|
| name | FIXSTRING<19> |
| data | MEMBLOCK2 0x5C bytes from `id_fixture`: i16 **Fixture ID**, i16 **Channel ID**, old index, position (VECT3D), rotation (quaternion), flags, static colour, body scale, GUID |
| colour / gobo string | STRING, STRING |
| stage calibration | 80 bytes |
| fixture type | i32 index into the `fixturetypes` pool (−1 none) |
| **patch** | ARRAY_ANZ<int,4>: one absolute address per DMX break, **−1 = unpatched** |
| 3D data | DATABLOCK, DATABLOCK (version > 0x170C) |
| video ids | STRING, STRING (version > 0x12B5) |
| children | channels (one per coarse/logical channel) |

**Address** = `(line − 1) × 512 + (slot − 1)` (0-based, absolute). 64 lines → < 0x8000.

Channel: MEMBLOCK2 0x18 (default/highlight/stage/fade/flags/old index), i32
channel-type index, i32 DMX-profile index. **No DMX address** — the console rebuilds the
DMX ↔ channel links from the fixture's patch on load.

### `dmx` — DMX lines

Root 0x21 (collection of 64 lines). Line 0x8B: name, i32 first and i32 last used slot (511/0 when
empty), then one slot object (0x1F, 26 bytes: parked value, parked flag, profile index) for every
slot in first..last. Slots do not reference fixtures; they only carry parked values and profiles.

### `fixturetypes` — embedded fixture types (full codec: `src/lib/gma1/fixtureTypes.ts`)

Object tree: 0x19 root → 0x17 fixture type → 0x15 channel type → 0xA3 channel function → 0x13
channel set.

- **Fixture type 0x17**: name (FIXSTRING), manufacturer/comment/short-name (STRING), MEMBLOCK2 0x54
  (version, W min/max, flag bits at +12: headmover/dimmer/pan-tilt/rgb/led/conventional, MIB, angles,
  body/light vectors), body-style/model/dummy (STRING), preset collection, channel-type collection.
- **Channel type 0x15**: i32 attribute index (into `pretyp`), i32 DMX-profile index (−1), MEMBLOCK2
  0x1C = default, highlight, stage, MIB-fade, flags (bits 0–3 `chantyp` 0 coarse/1 fine/2 virtual,
  bit 4 `dmx_break_start`, bit 6 invert, bit 9 `is_16bit`), mode index, effect time (float).
- **Channel function 0xA3**: name, MEMBLOCK2 0x2C (DMX from/to and mode from/to as 16-bit, phys
  from/to floats, valid flag, visualizer-effect id), path (STRING), channel-set collection.
- **Channel set 0x13**: name, MEMBLOCK2 0x14 (from/to 16-bit, flags, RGB, float), `csdata` (STRING),
  three MEMBLOCK2 gel tables, and (file version > 0x1964) a media-properties STRING.

DMX values store percent as `round(pct · 655.36)`. Percentages, effect ids and the attribute/feature
vocabulary come from the software's built-in tables. The codec round-trips all demo `fixturetypes`
members byte for byte.

**Footprint** (slots per break) is not stored; the console derives it on load: one slot per coarse or
fine channel type, `dmx_break_start` opening a new break. Verified against observed spacing for all
demo types (VL3000 16-bit 28, VL1000AS 27, MAC 600 15, Cyber 20, VPU Layer 99, Video Layer 62, …).

The same content exists as a text library (`_FIXTURETYPE { … }`, 611 types in
a text fixture library shipped with the software); the keyword→field mapping matches that text form.

### `pretyp` — attribute vocabulary

Object tree: 0x11 root → 0x0F preset type → 0x0D feature → 0x0B attribute. Preset type: name +
PrettyName. Feature: name + PrettyName + MEMBLOCK2 8 (group id). Attribute: name + PrettyName + i32
index + MEMBLOCK2 0x14 (special, old index, position, group, old position). Every object carries
PICSTATUS `40 00…`. Attribute indices are per-show (assigned as attributes are created/merged), so
new channel types must resolve attributes **by name**, not by a fixed index. 9 preset types, ~25
features, ~112 attributes (the standard set). Read from the loaded show at run time.

## 4. Rules for a valid patch

- address ≥ 0 and < 0x8000
- the break's full footprint lies inside one DMX line
- no slot is used by another fixture (or another break of the same fixture)

## 5. What changing a patch requires

- **Re-address / unpatch** (same number of breaks): overwrite the i32 values in the fixture's
  patch array. No size changes, tar headers stay valid. `dmx` can stay as is. → implemented in
  the app, verified by re-reading and byte-diffing.
- **Add fixtures**: append fixture objects (with their channel objects) to the last layer or a new
  layer, recompute every enclosing `size`/`end_pos`, and update the channel/fixture counts in the
  `.sho`. Implemented in `src/lib/gma1/doc.ts`; the object tree is re-parsed after writing to verify.
  Existing fixtures are never reordered (cues/presets reference channels by position).
- **New fixture types**: append a 0x17 object built from a GDTF mode to the `fixturetypes` pool
  (`src/lib/gma1/buildType.ts`). One coarse channel type per GDTF channel plus a fine one per extra
  offset, linked by attribute name.
- **Empty show**: a console-saved empty show (v6.801, `public/blank/blank.*`) with the other users'
  `.USER` folders and their entries in `data.txt` (a text dump the console writes with every save)
  removed. A synthesized empty show (28-byte stub pools) crashed the console with "Wrong Stream
  Position": the console's empty pools are full size — preset0–9, group, ncuelist, engines 24012 bytes
  (999 slots), forms/macros 20016, world 20036, pages 13088, timecode 50064, remote 24076, bmpeffect
  379656. A patch (showrow + fixturetypes) written onto the console's own empty show loads.

## 6. Open points

- Not yet tested by loading an edited show in gma1 onPC / on a console.
- Only file versions ≥ 5.901 (0x170D) are handled.
