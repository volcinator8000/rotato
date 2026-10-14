/*
 * Slider / disk calculator - maths core (JavaScript port of slider_disk.py).
 * Pure functions, no DOM, no network. Used by index.html and by the tests.
 *
 * Lengths in cm, angles in degrees. Positions in the box are measured from the
 * bottom-left inside corner, x along the rail, y up.
 */
(function (root) {
'use strict';

const SETTINGS = [
  ['TRAVEL', 'cm   full carriage travel'],
  ['DISK_RADIUS', 'cm   disk radius'],
  ['OFFSET', 'cm   rail to disk-centre distance'],
  ['SLOT_LEN', 'cm   hollow section length'],
  ['SLOT_W', 'cm   hollow width (pin diameter)'],
  ['EDGE', 'cm   material around the hollow'],
  ['SLOT_ANGLE', 'deg  slot angle to the rail'],
  ['SWEEP', 'deg  disk turn over the used stroke (1..180)'],
  ['START', 'deg  sweep start phase (-90 .. 90-SWEEP)'],
  ['BOX', 'cm   inside size of the square box'],
  ['WALL', 'cm   clearance from box walls'],
  ['BLOCK', 'cm   carriage block size'],
];
const DEFAULTS = {
  TRAVEL: 28, DISK_RADIUS: 14, OFFSET: 13, SLOT_LEN: 20, SLOT_W: 0.5, EDGE: 1,
  SLOT_ANGLE: 90, SWEEP: 180, START: -90, BOX: 31, WALL: 0.5, BLOCK: 3,
};

// Same constants as Python's math.radians / math.degrees (multiply by a precomputed factor).
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const rad = d => d * RAD;
const deg = r => r * DEG;

// printf-style fixed formatting that also prints "-0.00" for negative zero, like Python.
function fx(v, n) {
  v = Number(v);
  if (Object.is(v, -0)) return '-' + (0).toFixed(n);
  return v.toFixed(n);
}
function rd(v, n) {
  n = n === undefined ? 5 : n;
  const m = Math.pow(10, n);
  return Math.round(Number(v) * m) / m;
}
// Greedy word wrap, like textwrap.wrap for plain sentences.
function wrap(text, width) {
  // like Python textwrap: whitespace-separated words, and words may also break after a hyphen
  const chunks = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const parts = word.split(/(?<=[A-Za-z]-)(?=[A-Za-z])/);
    parts.forEach((p, i) => chunks.push({ t: p, join: i > 0 }));
  }
  const lines = [];
  let cur = '';
  for (const c of chunks) {
    if (cur === '') cur = c.t;
    else if (cur.length + (c.join ? 0 : 1) + c.t.length <= width) cur += (c.join ? '' : ' ') + c.t;
    else { lines.push(cur); cur = c.t; }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

const LAYOUT_CACHE = new Map();
const MAXR_CACHE = new Map();

// ------------------------------------------------------------ settings ---
function parseSettings(S) {
  const vals = {};
  for (const item of SETTINGS) {
    const name = item[0];
    const raw = S[name];
    if (raw === undefined || raw === null || raw === '') { vals[name] = DEFAULTS[name]; continue; }
    const v = Number(raw);
    if (!isFinite(v)) throw new Error(name + ' must be a number');
    vals[name] = v;
  }
  const notes = [];
  for (const name in vals) {
    if (name === 'START') continue;
    const v = vals[name];
    let ok;
    if (name === 'WALL') ok = v >= 0;
    else if (name === 'SLOT_ANGLE') ok = v > 0 && v <= 90;
    else if (name === 'SWEEP') ok = v > 0 && v <= 180;
    else ok = v > 0;
    if (!ok) throw new Error(name + ' is out of range');
  }
  if (vals.START < -90 || vals.START > 90 - vals.SWEEP) {
    vals.START = -vals.SWEEP / 2.0;
    notes.push('Sweep start phase was out of range for this sweep, reset to ' + fx(vals.START, 1) + ' (centred).');
  }
  return { vals: vals, notes: notes };
}

// -------------------------------------------------------------- engine ---
function Engine(P) {
  const sa = Math.sin(rad(P.SLOT_ANGLE));
  const ca = Math.cos(rad(P.SLOT_ANGLE));
  const l1 = rad(P.START);
  const l2 = l1 + rad(P.SWEEP);
  const pinTravel = P.SLOT_LEN - P.SLOT_W;
  const settingsKey = SETTINGS.map(s => P[s[0]]).join('|');

  const strokeForRadius = r => r * (Math.sin(l2) - Math.sin(l1)) / sa;
  const radiusForStroke = s => s * sa / (Math.sin(l2) - Math.sin(l1));
  const tOfC = (r, c) => (P.OFFSET - c * ca) / sa + Math.sqrt(Math.max(0.0, r * r - c * c));
  const cRange = r => [r * Math.sin(l1), r * Math.sin(l2)];

  function slotRange(r, n) {
    n = n || 200;
    const cr = cRange(r), c1 = cr[0], c2 = cr[1];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= n; i++) {
      const t = tOfC(r, c1 + (c2 - c1) * i / n);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    return [lo, hi];
  }

  function geom(r) {
    const cr = cRange(r), c1 = cr[0], c2 = cr[1];
    const sr = slotRange(r), lo = sr[0], hi = sr[1];
    // hollow sits as close to the carriage as it can (shortest bar), but not inside the carriage block
    const floor = P.BLOCK / 2 + P.EDGE;
    let ss = hi + P.SLOT_W / 2 - P.SLOT_LEN;
    if (ss < floor) ss = Math.min(floor, lo - P.SLOT_W / 2);
    return {
      c1: c1, c2: c2,
      stroke: (c2 - c1) / sa,
      xr1: (c1 - P.OFFSET * ca) / sa,
      xr2: (c2 - P.OFFSET * ca) / sa,
      lo: lo, hi: hi, span: hi - lo,
      slot_start: ss,
      slot_end: ss + P.SLOT_LEN,
      bar_len: ss + P.SLOT_LEN + P.EDGE,
      floor: floor,
      bar_w: P.SLOT_W + 2 * P.EDGE,
    };
  }

  function clearances(g, cx, cy) {
    const innerLo = P.WALL, innerHi = P.BOX - P.WALL;
    const out = [
      ['disk left', cx - P.DISK_RADIUS - innerLo],
      ['disk right', innerHi - (cx + P.DISK_RADIUS)],
      ['disk bottom', cy - P.DISK_RADIUS - innerLo],
      ['disk top', innerHi - (cy + P.DISK_RADIUS)],
    ];
    const lo = innerLo + P.BLOCK / 2;
    const hi = innerHi - P.BLOCK / 2;
    for (const q of [['carriage at start', cx + g.xr1], ['carriage at end', cx + g.xr2]]) {
      out.push([q[0] + ' (left)', q[1] - lo]);
      out.push([q[0] + ' (right)', hi - q[1]]);
    }
    const ry = cy - P.OFFSET;
    for (const q of [['bar at start', cx + g.xr1], ['bar at end', cx + g.xr2]]) {
      const x = q[1];
      for (const t of [0.0, g.bar_len]) {
        for (const w of [-g.bar_w / 2, g.bar_w / 2]) {
          const px = x + t * ca - w * sa;
          const py = ry + t * sa + w * ca;
          out.push([q[0] + ' corner', Math.min(px - innerLo, innerHi - px, py - innerLo, innerHi - py)]);
        }
      }
    }
    return out;
  }

  function layoutUncached(r) {
    const g = geom(r);
    const cy = P.WALL + P.BLOCK / 2 + P.OFFSET;
    let best = null;
    const steps = Math.trunc(P.BOX / 0.05);
    for (let i = 0; i <= steps; i++) {
      const cx = i * 0.05;
      const cl = clearances(g, cx, cy);
      let worst = cl[0];
      for (const item of cl) if (item[1] < worst[1]) worst = item;
      if (best === null || worst[1] > best.margin) best = { cx: cx, cy: cy, margin: worst[1], worst: worst[0], g: g };
    }
    best.ok = best.margin >= -1e-6;
    return best;
  }
  function layout(r) {
    const key = settingsKey + '#' + (Math.round(r * 1e6) / 1e6);
    let hit = LAYOUT_CACHE.get(key);
    if (hit === undefined) {
      if (LAYOUT_CACHE.size > 3000) LAYOUT_CACHE.clear();
      hit = layoutUncached(r);
      LAYOUT_CACHE.set(key, hit);
    }
    return hit;
  }

  function railLeft(g, cx) {
    const blockRight = cx + Math.max(g.xr1, g.xr2) + P.BLOCK / 2;
    const left = Math.max(P.WALL, blockRight - P.TRAVEL);
    return Math.min(left, P.BOX - P.WALL - P.TRAVEL);
  }

  function warningsFor(r) {
    const out = [];
    const g = geom(r);
    if (g.stroke > P.TRAVEL + 1e-9) out.push('needs ' + fx(g.stroke, 2) + ' cm of carriage travel, only ' + fx(P.TRAVEL, 2) + ' cm available');
    if (g.span > pinTravel + 1e-9) out.push('pin needs ' + fx(g.span, 2) + ' cm of slot travel, slot only gives ' + fx(pinTravel, 2) + ' cm');
    if (r > P.DISK_RADIUS - P.SLOT_W + 1e-9) out.push('pin sits outside the disk (radius ' + fx(P.DISK_RADIUS, 2) + ' cm)');
    if (g.slot_start < g.floor - 1e-9) out.push('hollow runs into the carriage block (starts ' + fx(g.slot_start, 2) + ' cm from the carriage dot, needs at least ' + fx(g.floor, 2) + ')');
    const lay = layout(r);
    if (!lay.ok) out.push('does not fit the ' + fx(P.BOX, 0) + ' cm box: ' + lay.worst + ' is ' + fx(-lay.margin, 2) + ' cm too far out');
    return out;
  }

  function maxRadius() {
    if (MAXR_CACHE.has(settingsKey)) return MAXR_CACHE.get(settingsKey);
    let result = 0.0;
    let r = P.DISK_RADIUS - P.SLOT_W;
    while (r > 0.3) {
      if (warningsFor(r).length === 0) { result = Math.round(r * 100) / 100; break; }
      r -= 0.05;
    }
    MAXR_CACHE.set(settingsKey, result);
    return result;
  }

  // ---------------------------------------------------------- conversions ---
  function radiusToPercent(r) {
    if (r <= 0) throw new Error('Distance must be positive.');
    const stroke = strokeForRadius(r);
    return [stroke, stroke / P.TRAVEL * 100.0];
  }
  function percentToRadius(p) {
    if (p <= 0) throw new Error('Percent must be positive.');
    const stroke = p / 100.0 * P.TRAVEL;
    return [stroke, radiusForStroke(stroke)];
  }
  function sliderToTurns(r, pct) {
    if (r <= 0) throw new Error('Pin distance must be positive.');
    const c0 = cRange(r)[0];
    const stroke = pct / 100.0 * P.TRAVEL;
    const c = c0 + stroke * sa;
    if (c > r + 1e-9) {
      throw new Error('The pin leaves the slot line past ' + fx((r - c0) / sa / P.TRAVEL * 100.0, 1) +
        ' % of travel (max ' + fx((r - c0) / sa, 2) + ' cm stroke).');
    }
    const ang = Math.asin(Math.min(1.0, c / r)) - Math.asin(c0 / r);
    return [stroke, deg(ang) / 360.0];
  }
  function turnsToSlider(r, turns) {
    if (r <= 0) throw new Error('Pin distance must be positive.');
    if (turns < 0) throw new Error('Turns cannot be negative.');
    const c0 = cRange(r)[0];
    const a0 = Math.asin(c0 / r);
    const a1 = a0 + turns * 2 * Math.PI;
    if (a1 > Math.PI / 2 + 1e-9) {
      const maxTurns = (Math.PI / 2 - a0) / (2 * Math.PI);
      throw new Error('Disk can only turn ' + fx(maxTurns, 4) + ' turns from this start (' + fx(maxTurns * 360, 1) + ' deg).');
    }
    const c = r * Math.sin(a1);
    const stroke = (c - c0) / sa;
    return [stroke, stroke / P.TRAVEL * 100.0];
  }
  function angleTable(r, steps) {
    steps = steps || 10;
    const cr = cRange(r), c1 = cr[0], c2 = cr[1];
    const rows = [];
    for (let i = 0; i <= steps; i++) {
      const c = c1 + (c2 - c1) * i / steps;
      const stroke = (c - c1) / sa;
      const ang = P.SLOT_ANGLE - deg(Math.asin(Math.max(-1.0, Math.min(1.0, c / r))));
      rows.push([stroke, stroke / P.TRAVEL * 100.0, ang]);
    }
    return rows;
  }

  // ----------------------------------------------------------- build sheet ---
  function buildSheet(r) {
    const lay = layout(r);
    const g = lay.g, cx = lay.cx, cy = lay.cy;
    const railY = cy - P.OFFSET;
    const lines = [
      'BUILD SHEET  (pin at r = ' + fx(r, 2) + ' cm, disk sweep ' + fx(P.SWEEP, 0) + ' deg)',
      'All positions from the bottom-left inside corner of the ' + fx(P.BOX, 0) + ' x ' + fx(P.BOX, 0) + ' box.',
      '-'.repeat(64),
      'Disk: radius ' + fx(P.DISK_RADIUS, 2) + ' cm, centre at x = ' + fx(cx, 2) + ', y = ' + fx(cy, 2),
      'Pin: ' + fx(r, 2) + ' cm from the disk centre (diameter ' + fx(P.SLOT_W, 2) + ')',
      'Rail: centreline y = ' + fx(railY, 2) + ' (offset ' + fx(P.OFFSET, 1) + ' below the disk centre)',
      'Rail ends: x = ' + fx(railLeft(g, cx), 2) + ' to ' + fx(railLeft(g, cx) + P.TRAVEL, 2) + ' (' + fx(P.TRAVEL, 1) +
        ' cm long; carriage block ' + fx(P.BLOCK, 1) + ' cm)',
      'Carriage reference point (the dot on the carriage, on the rail line):',
      '  at sweep start ......... x = ' + fx(cx + g.xr1, 2),
      '  at sweep end ........... x = ' + fx(cx + g.xr2, 2),
      '  stroke used ............ ' + fx(g.stroke, 2) + ' cm = ' + fx(g.stroke / P.TRAVEL * 100, 1) + ' % of travel',
      '',
      'Slotted bar (fixed to the carriage at ' + fx(P.SLOT_ANGLE, 1) + ' deg to the rail):',
      '  hollow ................. ' + fx(P.SLOT_LEN, 2) + ' long x ' + fx(P.SLOT_W, 2) + ' wide',
      '  material around hollow . ' + fx(P.EDGE, 2) + ' cm all round',
      '  bar width .............. ' + fx(g.bar_w, 2) + ' cm',
      '  hollow starts .......... ' + fx(g.slot_start, 2) + ' cm from the reference point along the bar',
      '  hollow ends ............ ' + fx(g.slot_end, 2) + ' cm from the reference point',
      '  bar length ............. ' + fx(g.bar_len, 2) + ' cm from the reference point (end of bar)',
      '  pin slot travel used ... ' + fx(g.span, 2) + ' of ' + fx(pinTravel, 2) + ' cm',
      '  closest to a wall ...... ' + fx(lay.margin + P.WALL, 2) + ' cm (' + lay.worst + ')',
    ];
    const under = (railY + P.BLOCK / 2) - (cy - P.DISK_RADIUS);
    if (under > 1e-9) {
      lines.push('');
      lines.push('NOTE: the disk reaches ' + fx(under, 2) + ' cm under the rail / carriage strip.');
      lines.push('  Mount the rail on raised end supports so the carriage and bar ride above the disk.');
    }
    const w = warningsFor(r);
    if (w.length) {
      lines.push('');
      lines.push('WARNINGS:');
      for (const item of w) lines.push('  ! ' + item);
    }
    return [lines.join('\n'), lay];
  }

  // ------------------------------------------------------------- box SVG ---
  function exportBox(r) {
    const lay = buildSheet(r)[1];
    const g = lay.g, cx = lay.cx, cy = lay.cy;
    const a = rad(P.SLOT_ANGLE), s_a = Math.sin(a), c_a = Math.cos(a);
    const c1 = g.c1, c2 = g.c2;
    const cm = (c1 + c2) / 2.0;
    const xm = (g.xr1 + g.xr2) / 2.0;
    const stroke = g.stroke;
    let bw = g.bar_w, bl = g.bar_len, ss = g.slot_start;
    const legendSrc = [
      'Disk centre ' + fx(cx, 2) + ' from the left wall and ' + fx(cy, 2) + ' from the bottom wall. Disk R' + fx(P.DISK_RADIUS, 1) +
        ', rail offset ' + fx(P.OFFSET, 1) + ', slot angle ' + fx(P.SLOT_ANGLE, 0) + ' deg.',
      'Hollow ' + fx(P.SLOT_LEN, 1) + ' x ' + fx(P.SLOT_W, 2) + ' with ' + fx(P.EDGE, 1) + ' edge: bar ' + fx(bw, 1) +
        ' wide, ends ' + fx(bl, 2) + ' from the carriage dot, hollow starts ' + fx(ss, 2) + ' from the dot.',
      'Carriage dot x from the left wall: start ' + fx(cx + g.xr1, 2) + ', end ' + fx(cx + g.xr2, 2) + '. Drawn at mid-stroke.',
      'Red: pin circle and pin at start/end. Blue dashed: carriage at start/end. Dashed box: ' + fx(P.WALL, 1) + ' wall clearance.',
    ];
    let legend = [];
    for (const item of legendSrc) legend = legend.concat(wrap(item, 78));
    const pinAt = c => {
      const s = Math.sqrt(Math.max(0.0, r * r - c * c));
      return [c * s_a + s * c_a, -c * c_a + s * s_a];
    };
    const bx0 = -cx, bx1 = P.BOX - cx;
    const by0 = -cy, by1 = P.BOX - cy;
    const railY = -P.OFFSET;
    const pad = 3.0;
    const top = 3.2 + 1.2 * legend.length;
    const vx = bx0 - pad, vy = -(by1 + top);
    const vw = P.BOX + 2 * pad, vh = P.BOX + top + pad;
    const Y = y => -y;
    const o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + fx(vx, 2) + ' ' + fx(vy, 2) + ' ' + fx(vw, 2) + ' ' + fx(vh, 2) + '" ' +
      'width="' + fx(vw, 1) + 'cm" height="' + fx(vh, 1) + 'cm" font-family="Arial, sans-serif" font-size="0.9">');
    o.push('<rect x="' + fx(vx, 2) + '" y="' + fx(vy, 2) + '" width="' + fx(vw, 2) + '" height="' + fx(vh, 2) + '" fill="white"/>');
    o.push('<rect x="' + fx(bx0, 2) + '" y="' + fx(Y(by1), 2) + '" width="' + fx(P.BOX, 2) + '" height="' + fx(P.BOX, 2) +
      '" fill="#fafafa" stroke="#222" stroke-width="0.25"/>');
    o.push('<rect x="' + fx(bx0 + P.WALL, 2) + '" y="' + fx(Y(by1) + P.WALL, 2) + '" width="' + fx(P.BOX - 2 * P.WALL, 2) +
      '" height="' + fx(P.BOX - 2 * P.WALL, 2) + '" fill="none" stroke="#999" stroke-width="0.07" stroke-dasharray="0.5 0.4"/>');
    o.push('<g fill="none" stroke="#222" stroke-width="0.12">');
    o.push('<circle cx="0" cy="0" r="' + fx(P.DISK_RADIUS, 2) + '" stroke-width="0.2" fill="white"/>');
    o.push('<circle cx="0" cy="0" r="' + fx(r, 2) + '" stroke="#c0392b" stroke-dasharray="0.5 0.35"/>');
    o.push('<path d="M-0.8 0H0.8M0 -0.8V0.8"/>');
    const rx0 = railLeft(g, cx) - cx;
    o.push('<rect x="' + fx(rx0, 2) + '" y="' + fx(Y(railY) - 0.5, 2) + '" width="' + fx(P.TRAVEL, 2) + '" height="1.0" stroke-width="0.2" fill="white"/>');
    o.push('<line x1="' + fx(bx0, 2) + '" y1="' + fx(Y(railY), 2) + '" x2="' + fx(bx1, 2) + '" y2="' + fx(Y(railY), 2) +
      '" stroke="#888" stroke-dasharray="0.7 0.5"/>');
    for (const q of [[g.xr1, c1], [g.xr2, c2]]) {
      const x = q[0], c = q[1];
      o.push('<rect x="' + fx(x - P.BLOCK / 2, 2) + '" y="' + fx(Y(railY) - P.BLOCK / 2, 2) + '" width="' + fx(P.BLOCK, 2) +
        '" height="' + fx(P.BLOCK, 2) + '" stroke="#2980b9" stroke-dasharray="0.4 0.3"/>');
      const p = pinAt(c);
      o.push('<line x1="' + fx(x, 2) + '" y1="' + fx(Y(railY), 2) + '" x2="' + fx(p[0], 2) + '" y2="' + fx(Y(p[1]), 2) +
        '" stroke="#2980b9" stroke-dasharray="0.4 0.3"/>');
      o.push('<circle cx="' + fx(p[0], 2) + '" cy="' + fx(Y(p[1]), 2) + '" r="' + fx(P.SLOT_W / 2 + 0.1, 2) + '" stroke="#c0392b"/>');
    }
    o.push('<rect x="' + fx(xm - P.BLOCK / 2, 2) + '" y="' + fx(Y(railY) - P.BLOCK / 2, 2) + '" width="' + fx(P.BLOCK, 2) +
      '" height="' + fx(P.BLOCK, 2) + '" fill="#f4d03f" stroke-width="0.2"/>');
    bw = g.bar_w; bl = g.bar_len;
    ss = g.slot_start;
    const se = g.slot_end;
    o.push('<g transform="translate(' + fx(xm, 3) + ' ' + fx(Y(railY), 3) + ') rotate(' + fx(-P.SLOT_ANGLE, 3) + ')">');
    o.push('<path fill="#d5dbdb" fill-opacity="0.85" fill-rule="evenodd" stroke-width="0.2" d="' +
      'M0 ' + fx(-bw / 2, 3) + ' H' + fx(bl, 3) + ' V' + fx(bw / 2, 3) + ' H0 Z M' + fx(ss, 3) + ' ' + fx(-P.SLOT_W / 2, 3) +
      ' H' + fx(se, 3) + ' V' + fx(P.SLOT_W / 2, 3) + ' H' + fx(ss, 3) + ' Z"/>');
    o.push('<circle cx="0" cy="0" r="0.3" fill="#222"/>');
    o.push('<circle cx="' + fx(tOfC(r, cm), 3) + '" cy="0" r="' + fx(P.SLOT_W / 2, 2) + '" fill="#c0392b" stroke="none"/>');
    o.push('</g>');
    o.push('<g stroke="#555" stroke-width="0.07">');
    o.push('<line x1="10" y1="0" x2="10" y2="' + fx(Y(railY), 2) + '"/>');
    o.push('<line x1="9.4" y1="0" x2="10.6" y2="0"/>');
    o.push('<line x1="' + fx(g.xr1, 2) + '" y1="' + fx(Y(by0) + 1.2, 2) + '" x2="' + fx(g.xr2, 2) + '" y2="' + fx(Y(by0) + 1.2, 2) +
      '" stroke="#2980b9" stroke-width="0.2"/>');
    o.push('<line x1="0" y1="0" x2="' + fx(P.DISK_RADIUS * Math.cos(rad(20)), 2) + '" y2="' + fx(Y(P.DISK_RADIUS * Math.sin(rad(20))), 2) + '"/>');
    o.push('</g></g>');
    o.push('<g fill="#222">');
    o.push('<text x="9.6" y="' + fx(Y(-P.OFFSET * 0.5), 2) + '" text-anchor="end">offset ' + fx(P.OFFSET, 1) + '</text>');
    o.push('<text x="' + fx((g.xr1 + g.xr2) / 2, 2) + '" y="' + fx(Y(by0) + 2.6, 2) + '" text-anchor="middle" fill="#2980b9">stroke ' +
      fx(stroke, 2) + ' cm = ' + fx(stroke / P.TRAVEL * 100, 1) + ' % of ' + fx(P.TRAVEL, 0) + '</text>');
    o.push('<text x="' + fx(P.DISK_RADIUS * 0.5 * Math.cos(rad(20)), 2) + '" y="' + fx(Y(P.DISK_RADIUS * 0.5 * Math.sin(rad(20))) - 0.4, 2) +
      '">R' + fx(P.DISK_RADIUS, 1) + '</text>');
    o.push('<text x="' + fx(-(g.bar_w / 2 + 0.5), 2) + '" y="' + fx(-r - 0.4, 2) + '" fill="#c0392b" text-anchor="end">pin r = ' + fx(r, 2) + '</text>');
    o.push('<text x="' + fx(g.xr1, 2) + '" y="' + fx(Y(railY) - P.BLOCK / 2 - 0.4, 2) + '" fill="#2980b9" text-anchor="middle">start</text>');
    o.push('<text x="' + fx(g.xr2, 2) + '" y="' + fx(Y(railY) - P.BLOCK / 2 - 0.4, 2) + '" fill="#2980b9" text-anchor="middle">end</text>');
    o.push('<text x="' + fx(bx1, 2) + '" y="' + fx(Y(by0) + 2.6, 2) + '" font-size="0.8" fill="#555" text-anchor="end">box ' +
      fx(P.BOX, 0) + ' x ' + fx(P.BOX, 0) + ' cm</text>');
    const ly = -(by1 + top) + 1.6;
    o.push('<text x="' + fx(bx0, 2) + '" y="' + fx(ly, 2) + '" font-size="1.2" font-weight="bold">SLIDER / DISK SCHEMATIC  (top view, cm)</text>');
    legend.forEach(function (text, k) {
      o.push('<text x="' + fx(bx0, 2) + '" y="' + fx(ly + 1.3 + k * 1.15, 2) + '" font-size="0.85">' + text + '</text>');
    });
    o.push('</g></svg>');
    return o.join('\n');
  }

  // ------------------------------------------------------- drawing sheet ---
  function exportDetail(r) {
    const lay = buildSheet(r)[1];
    const g = lay.g, cx = lay.cx, cy = lay.cy;
    const a = rad(P.SLOT_ANGLE), s_a = Math.sin(a), c_a = Math.cos(a);
    const c1 = g.c1, c2 = g.c2;
    const cm = (c1 + c2) / 2.0;
    const railY = cy - P.OFFSET;
    const xs = cx + g.xr1, xe = cx + g.xr2;
    const xm = (xs + xe) / 2.0;
    const rl = railLeft(g, cx);
    const bw = g.bar_w, bl = g.bar_len, ss = g.slot_start, se = g.slot_end;
    const W = 93.0, H = 65.0;
    const OX = 9.0, OY = 50.0;
    const ax = x => OX + x;
    const ay = y => OY - y;
    const pinRel = c => {
      const sq = Math.sqrt(Math.max(0.0, r * r - c * c));
      return [c * s_a + sq * c_a, -c * c_a + sq * s_a];
    };
    const o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + fx(W, 1) + ' ' + fx(H, 1) + '" width="' + fx(W, 1) + 'cm" height="' + fx(H, 1) +
      'cm" font-family="Arial, sans-serif" font-size="0.8">');
    o.push('<defs>' +
      '<marker id="ae" markerUnits="userSpaceOnUse" markerWidth="0.5" markerHeight="0.5" viewBox="0 0 10 10" ' +
      'refX="10" refY="5" orient="auto"><path d="M0 1 L10 5 L0 9 z" fill="#444"/></marker>' +
      '<marker id="as" markerUnits="userSpaceOnUse" markerWidth="0.5" markerHeight="0.5" viewBox="0 0 10 10" ' +
      'refX="0" refY="5" orient="auto"><path d="M10 1 L0 5 L10 9 z" fill="#444"/></marker>' +
      '</defs>');
    o.push('<rect width="' + fx(W, 1) + '" height="' + fx(H, 1) + '" fill="white"/>');

    function line(x1, y1, x2, y2, opt) {
      opt = opt || {};
      const col = opt.col || '#444', w = opt.w === undefined ? 0.07 : opt.w;
      const d = opt.dash ? ' stroke-dasharray="' + opt.dash + '"' : '';
      const m = opt.arrows ? ' marker-start="url(#as)" marker-end="url(#ae)"' : '';
      o.push('<line x1="' + fx(x1, 3) + '" y1="' + fx(y1, 3) + '" x2="' + fx(x2, 3) + '" y2="' + fx(y2, 3) + '" stroke="' + col +
        '" stroke-width="' + fx(w, 2) + '"' + d + m + '/>');
    }
    function text(x, y, t, opt) {
      opt = opt || {};
      const size = opt.size === undefined ? 0.8 : opt.size, anchor = opt.anchor || 'start', col = opt.col || '#222';
      const wt = opt.bold ? ' font-weight="bold"' : '';
      o.push('<text x="' + fx(x, 3) + '" y="' + fx(y, 3) + '" font-size="' + fx(size, 2) + '" text-anchor="' + anchor +
        '" fill="white" stroke="white" stroke-width="0.3"' + wt + '>' + t + '</text>');
      o.push('<text x="' + fx(x, 3) + '" y="' + fx(y, 3) + '" font-size="' + fx(size, 2) + '" text-anchor="' + anchor +
        '" fill="' + col + '"' + wt + '>' + t + '</text>');
    }
    function dimH(x1, x2, y, label, up) {
      up = up === undefined ? true : up;
      line(x1, y, x2, y, { arrows: true });
      line(x1, y - 0.5, x1, y + 0.5, { w: 0.05 });
      line(x2, y - 0.5, x2, y + 0.5, { w: 0.05 });
      text((x1 + x2) / 2, up ? y - 0.3 : y + 1.0, label, { anchor: 'middle' });
    }
    function dimV(x, y1, y2, label, side) {
      side = side === undefined ? 1 : side;
      line(x, y1, x, y2, { arrows: true });
      line(x - 0.5, y1, x + 0.5, y1, { w: 0.05 });
      line(x - 0.5, y2, x + 0.5, y2, { w: 0.05 });
      text(x + 0.35 * side, (y1 + y2) / 2 + 0.3, label, { anchor: side > 0 ? 'start' : 'end' });
    }

    text(1.0, 1.8, 'SLIDER / DISK  -  DRAWING SHEET', { size: 1.5, bold: true });
    text(1.0, 3.2, 'All dimensions in cm, angles in degrees. Drawn 1 unit = 1 cm. Pin distance r = ' + fx(r, 2) + ' cm, disk sweep ' + fx(P.SWEEP, 0) + ' deg.', { size: 0.8 });

    // ===== VIEW A : assembly in the box =====
    text(OX, 7.0, 'A  ASSEMBLY IN THE BOX (top view, drawn with carriage mid-stroke)', { size: 0.95, bold: true });
    o.push('<rect x="' + fx(ax(0), 2) + '" y="' + fx(ay(P.BOX), 2) + '" width="' + fx(P.BOX, 2) + '" height="' + fx(P.BOX, 2) +
      '" fill="#fafafa" stroke="#222" stroke-width="0.25"/>');
    o.push('<rect x="' + fx(ax(P.WALL), 2) + '" y="' + fx(ay(P.BOX - P.WALL), 2) + '" width="' + fx(P.BOX - 2 * P.WALL, 2) +
      '" height="' + fx(P.BOX - 2 * P.WALL, 2) + '" fill="none" stroke="#aaa" stroke-width="0.06" stroke-dasharray="0.5 0.4"/>');
    o.push('<circle cx="' + fx(ax(cx), 2) + '" cy="' + fx(ay(cy), 2) + '" r="' + fx(P.DISK_RADIUS, 2) + '" fill="white" stroke="#222" stroke-width="0.2"/>');
    o.push('<circle cx="' + fx(ax(cx), 2) + '" cy="' + fx(ay(cy), 2) + '" r="' + fx(r, 2) +
      '" fill="none" stroke="#c0392b" stroke-width="0.1" stroke-dasharray="0.5 0.35"/>');
    o.push('<path d="M' + fx(ax(cx) - 0.8, 2) + ' ' + fx(ay(cy), 2) + 'H' + fx(ax(cx) + 0.8, 2) + 'M' + fx(ax(cx), 2) + ' ' +
      fx(ay(cy) - 0.8, 2) + 'V' + fx(ay(cy) + 0.8, 2) + '" stroke="#222" stroke-width="0.1"/>');
    o.push('<rect x="' + fx(ax(rl), 2) + '" y="' + fx(ay(railY) - 0.5, 2) + '" width="' + fx(P.TRAVEL, 2) +
      '" height="1.0" fill="white" stroke="#222" stroke-width="0.18"/>');
    for (const q of [[xs, c1], [xe, c2]]) {
      const x = q[0], c = q[1];
      o.push('<rect x="' + fx(ax(x) - P.BLOCK / 2, 2) + '" y="' + fx(ay(railY) - P.BLOCK / 2, 2) + '" width="' + fx(P.BLOCK, 2) +
        '" height="' + fx(P.BLOCK, 2) + '" fill="none" stroke="#2980b9" stroke-width="0.1" stroke-dasharray="0.4 0.3"/>');
      const p = pinRel(c);
      line(ax(x), ay(railY), ax(cx + p[0]), ay(cy + p[1]), { col: '#2980b9', w: 0.08, dash: '0.4 0.3' });
      o.push('<circle cx="' + fx(ax(cx + p[0]), 2) + '" cy="' + fx(ay(cy + p[1]), 2) + '" r="0.4" fill="none" stroke="#c0392b" stroke-width="0.12"/>');
    }
    o.push('<rect x="' + fx(ax(xm) - P.BLOCK / 2, 2) + '" y="' + fx(ay(railY) - P.BLOCK / 2, 2) + '" width="' + fx(P.BLOCK, 2) +
      '" height="' + fx(P.BLOCK, 2) + '" fill="#f4d03f" stroke="#222" stroke-width="0.18"/>');
    const d0 = [ax(xm), ay(railY)];
    const u = [c_a, -s_a];
    const n = [s_a, c_a];
    const bp = (t, w) => [d0[0] + t * u[0] + w * n[0], d0[1] + t * u[1] + w * n[1]];
    const outer = [bp(0, -bw / 2), bp(bl, -bw / 2), bp(bl, bw / 2), bp(0, bw / 2)];
    const inner = [bp(ss, -P.SLOT_W / 2), bp(se, -P.SLOT_W / 2), bp(se, P.SLOT_W / 2), bp(ss, P.SLOT_W / 2)];
    const pt = q => fx(q[0], 3) + ' ' + fx(q[1], 3);
    const path = 'M' + outer.map(pt).join(' L') + ' Z M' + inner.map(pt).join(' L') + ' Z';
    o.push('<path d="' + path + '" fill="#d5dbdb" fill-opacity="0.85" fill-rule="evenodd" stroke="#222" stroke-width="0.18"/>');
    o.push('<circle cx="' + fx(d0[0], 2) + '" cy="' + fx(d0[1], 2) + '" r="0.3" fill="#222"/>');
    let p = pinRel(cm);
    o.push('<circle cx="' + fx(ax(cx + p[0]), 2) + '" cy="' + fx(ay(cy + p[1]), 2) + '" r="' + fx(P.SLOT_W / 2, 2) + '" fill="#c0392b"/>');
    const ar = 5.0;
    o.push('<path d="M' + fx(d0[0] + ar, 2) + ' ' + fx(d0[1], 2) + ' A' + fx(ar, 2) + ' ' + fx(ar, 2) + ' 0 0 0 ' + fx(d0[0] + ar * c_a, 2) + ' ' +
      fx(d0[1] - ar * s_a, 2) + '" fill="none" stroke="#444" stroke-width="0.07"/>');
    text(d0[0] + ar + 0.3, d0[1] - 1.7, fx(P.SLOT_ANGLE, 1) + ' deg', { col: '#444' });
    dimH(ax(0), ax(P.BOX), ay(P.BOX) - 1.2, fx(P.BOX, 2));
    dimV(ax(P.BOX) + 1.4, ay(P.BOX), ay(0), fx(P.BOX, 2));
    dimV(ax(cx) + P.DISK_RADIUS * 0.72, ay(cy), ay(railY), 'offset ' + fx(P.OFFSET, 2));
    text(ax(cx) - P.DISK_RADIUS + 0.8, ay(cy) + 0.3, 'disk R' + fx(P.DISK_RADIUS, 2), { col: '#444' });
    const yb = OY + 3.6;
    const xsPts = [[0.0, '0'], [rl, fx(rl, 2)], [xs, fx(xs, 2)], [cx, fx(cx, 2)], [xe, fx(xe, 2)],
      [rl + P.TRAVEL, fx(rl + P.TRAVEL, 2)], [P.BOX, fx(P.BOX, 2)]];
    line(ax(0), yb, ax(P.BOX), yb, { w: 0.06 });
    xsPts.forEach(function (q, k) {
      line(ax(q[0]), ay(0) + 0.15, ax(q[0]), yb + 0.3, { w: 0.04, dash: '0.2 0.2', col: '#888' });
      text(ax(q[0]), yb + 1.1 + (k % 2) * 1.0, q[1], { anchor: 'middle', size: 0.75 });
    });
    text(ax(0), yb + 3.3, 'x positions from the left wall: rail start, carriage dot (start), disk centre, carriage dot (end), rail end', { size: 0.7, col: '#555' });
    const xl = OX - 2.2;
    line(xl, ay(0), xl, ay(P.BOX), { w: 0.06 });
    for (const q of [[0.0, '0'], [railY, fx(railY, 2)], [cy, fx(cy, 2)], [cy + P.DISK_RADIUS, fx(cy + P.DISK_RADIUS, 2)]]) {
      line(xl - 0.3, ay(q[0]), ax(0), ay(q[0]), { w: 0.04, dash: '0.2 0.2', col: '#888' });
      text(xl - 0.4, ay(q[0]) + 0.3, q[1], { anchor: 'end', size: 0.75 });
    }
    text(1.0, ay(P.BOX) - 0.6, 'y from the bottom wall', { size: 0.7, col: '#555' });
    dimH(ax(xs), ax(xe), OY + 1.3, 'carriage stroke ' + fx(g.stroke, 2) + ' cm  (' + fx(g.stroke / P.TRAVEL * 100, 1) + ' % of ' + fx(P.TRAVEL, 0) + ')', false);

    // ===== VIEW B : the bar =====
    const bx = 47.0, by = 12.0;
    text(bx, 5.2, 'B  SLOTTED BAR  (1 piece)', { size: 0.95, bold: true });
    o.push('<path d="M' + fx(bx, 2) + ' ' + fx(by - bw / 2, 2) + ' H' + fx(bx + bl, 2) + ' V' + fx(by + bw / 2, 2) + ' H' + fx(bx, 2) +
      ' Z M' + fx(bx + ss, 2) + ' ' + fx(by - P.SLOT_W / 2, 2) + ' H' + fx(bx + se, 2) + ' V' + fx(by + P.SLOT_W / 2, 2) + ' H' + fx(bx + ss, 2) +
      ' Z" fill="#d5dbdb" fill-rule="evenodd" stroke="#222" stroke-width="0.18"/>');
    o.push('<circle cx="' + fx(bx, 2) + '" cy="' + fx(by, 2) + '" r="0.3" fill="#222"/>');
    line(bx - 1.0, by, bx + bl + 1.0, by, { w: 0.04, dash: '0.6 0.3', col: '#999' });
    dimH(bx, bx + bl, by - bw / 2 - 1.6, fx(bl, 2) + ' total (from the dot)');
    dimH(bx, bx + ss, by + bw / 2 + 1.4, fx(ss, 2), false);
    dimH(bx + ss, bx + se, by + bw / 2 + 1.4, fx(P.SLOT_LEN, 2) + ' hollow', false);
    dimH(bx + se, bx + bl, by + bw / 2 + 1.4, fx(P.EDGE, 2), false);
    dimV(bx + bl + 1.4, by - bw / 2, by + bw / 2, fx(bw, 2) + ' wide');
    text(bx + ss, by - bw / 2 - 0.4, 'slot ' + fx(P.SLOT_W, 2) + ' wide, ' + fx(P.EDGE, 2) + ' from each long edge', { size: 0.7, col: '#444' });
    text(bx - 0.2, by + 1.0, 'dot', { size: 0.7, anchor: 'end', col: '#444' });

    // ===== VIEW C : the disk =====
    const dx = 62.0, dy = 37.0;
    text(48.0, 20.0, 'C  DISK (top view, rail direction = 0 deg)', { size: 0.95, bold: true });
    o.push('<circle cx="' + fx(dx, 2) + '" cy="' + fx(dy, 2) + '" r="' + fx(P.DISK_RADIUS, 2) + '" fill="#fcfcfc" stroke="#222" stroke-width="0.2"/>');
    o.push('<circle cx="' + fx(dx, 2) + '" cy="' + fx(dy, 2) + '" r="' + fx(r, 2) +
      '" fill="none" stroke="#c0392b" stroke-width="0.08" stroke-dasharray="0.4 0.3"/>');
    o.push('<path d="M' + fx(dx - 1.0, 2) + ' ' + fx(dy, 2) + 'H' + fx(dx + 1.0, 2) + 'M' + fx(dx, 2) + ' ' + fx(dy - 1.0, 2) + 'V' + fx(dy + 1.0, 2) +
      '" stroke="#222" stroke-width="0.1"/>');
    line(dx, dy, dx + P.DISK_RADIUS, dy, { w: 0.05, dash: '0.4 0.3', col: '#999' });
    const angS = P.SLOT_ANGLE - P.START;
    const angE = P.SLOT_ANGLE - (P.START + P.SWEEP);
    const angM = P.SLOT_ANGLE - deg(Math.asin(Math.max(-1.0, Math.min(1.0, cm / r))));
    const pts = {};
    for (const q of [['start', angS], ['mid', angM], ['end', angE]]) {
      const th = rad(q[1]);
      pts[q[0]] = [r * Math.cos(th), r * Math.sin(th), q[1]];
      o.push('<circle cx="' + fx(dx + pts[q[0]][0], 2) + '" cy="' + fx(dy - pts[q[0]][1], 2) + '" r="' + fx(P.SLOT_W / 2 + 0.05, 2) +
        '" fill="' + (q[0] === 'mid' ? '#c0392b' : 'white') + '" stroke="#c0392b" stroke-width="0.1"/>');
    }
    const sx_ = dx + pts.start[0], sy_ = dy - pts.start[1];
    const ex_ = dx + pts.end[0], ey_ = dy - pts.end[1];
    o.push('<path d="M' + fx(sx_, 2) + ' ' + fx(sy_, 2) + ' A' + fx(r, 2) + ' ' + fx(r, 2) + ' 0 ' + (P.SWEEP > 180 ? 1 : 0) + ' 1 ' + fx(ex_, 2) + ' ' + fx(ey_, 2) +
      '" fill="none" stroke="#c0392b" stroke-width="0.18" marker-end="url(#ae)"/>');
    for (const name of ['start', 'end', 'mid']) {
      // label just inside the pin circle, pointing at the pin
      const pp = pts[name], th = rad(pp[2]), ux = Math.cos(th), uy = Math.sin(th);
      const lx = dx + pp[0] - 1.0 * ux, ly = dy - pp[1] + 1.0 * uy + 0.25 + (uy < -0.5 ? 0.5 : 0);
      text(lx, ly, name + ' ' + fx(pp[2], 1) + ' deg', { size: 0.75, col: '#c0392b', anchor: ux > 0.3 ? 'end' : (ux < -0.3 ? 'start' : 'middle') });
    }
    dimH(dx - P.DISK_RADIUS, dx + P.DISK_RADIUS, dy + P.DISK_RADIUS + 1.4, 'disk diameter ' + fx(2 * P.DISK_RADIUS, 2) + ' (R' + fx(P.DISK_RADIUS, 2) + ')', false);
    line(dx, dy, dx + r * Math.cos(rad(-70)), dy - r * Math.sin(rad(-70)), { w: 0.07, arrows: true });
    text(dx + 0.6 + r * 0.5 * Math.cos(rad(-70)), dy - r * 0.5 * Math.sin(rad(-70)) + 0.3, 'r = ' + fx(r, 2), { col: '#444' });
    text(dx, dy - P.DISK_RADIUS - 0.5, 'slider moves right = disk turns clockwise', { anchor: 'middle', size: 0.75, col: '#444' });
    text(dx, dy - 2.2, 'pin dia ' + fx(P.SLOT_W, 2), { anchor: 'middle', size: 0.7, col: '#444' });

    // ===== VIEW D : carriage + rail =====
    const rx = 48.0, ry = 59.0;
    text(rx, 54.4, 'D  CARRIAGE + RAIL', { size: 0.95, bold: true });
    o.push('<rect x="' + fx(rx, 2) + '" y="' + fx(ry - 0.5, 2) + '" width="' + fx(P.TRAVEL, 2) + '" height="1.0" fill="white" stroke="#222" stroke-width="0.18"/>');
    o.push('<rect x="' + fx(rx + 2.0, 2) + '" y="' + fx(ry - P.BLOCK / 2, 2) + '" width="' + fx(P.BLOCK, 2) + '" height="' + fx(P.BLOCK, 2) +
      '" fill="#f4d03f" stroke="#222" stroke-width="0.18"/>');
    o.push('<circle cx="' + fx(rx + 2.0 + P.BLOCK / 2, 2) + '" cy="' + fx(ry, 2) + '" r="0.3" fill="#222"/>');
    dimH(rx, rx + P.TRAVEL, ry + P.BLOCK / 2 + 1.6, 'rail ' + fx(P.TRAVEL, 2) + ' long (full travel) x 1.00 wide (width is free)', false);
    dimH(rx + 2.0, rx + 2.0 + P.BLOCK, ry - P.BLOCK / 2 - 0.9, fx(P.BLOCK, 2));
    text(rx + 6.5, ry - 3.0, 'dot = centre of the block, on the rail centreline', { size: 0.7, col: '#444' });
    text(rx + 6.5, ry - 2.2, 'bar end centre sits on the dot,', { size: 0.7, col: '#444' });
    text(rx + 6.5, ry - 1.4, 'bar turned ' + fx(P.SLOT_ANGLE, 1) + ' deg CCW from the rail direction', { size: 0.7, col: '#444' });

    // ===== TABLE =====
    const tx = 76.5, ty = 21.0;
    const rows = [
      ['KEY NUMBERS', null],
      ['Box inside', fx(P.BOX, 0) + ' x ' + fx(P.BOX, 0)],
      ['Wall clearance', fx(P.WALL, 1)],
      ['Disk radius', fx(P.DISK_RADIUS, 2)],
      ['Disk centre x, y', fx(cx, 2) + ', ' + fx(cy, 2)],
      ['Rail y (centreline)', fx(railY, 2)],
      ['Rail x from - to', fx(rl, 2) + ' - ' + fx(rl + P.TRAVEL, 2)],
      ['Offset centre-rail', fx(P.OFFSET, 2)],
      ['Slot angle', fx(P.SLOT_ANGLE, 1)],
      ['Carriage dot x start', fx(xs, 2)],
      ['Carriage dot x end', fx(xe, 2)],
      ['Dot y (on rail)', fx(railY, 2)],
      ['Stroke', fx(g.stroke, 2) + ' (' + fx(g.stroke / P.TRAVEL * 100, 1) + '%)'],
      ['Pin distance r', fx(r, 2)],
      ['Pin dia / slot width', fx(P.SLOT_W, 2)],
      ['Pin angle start', fx(angS, 1)],
      ['Pin angle end', fx(angE, 1)],
      ['Pin x,y start (rel.)', fx(pts.start[0], 2) + ', ' + fx(pts.start[1], 2)],
      ['Pin x,y end (rel.)', fx(pts.end[0], 2) + ', ' + fx(pts.end[1], 2)],
      ['Bar length', fx(bl, 2)],
      ['Bar width', fx(bw, 2)],
      ['Hollow start from dot', fx(ss, 2)],
      ['Hollow length', fx(P.SLOT_LEN, 2)],
      ['Edge round hollow', fx(P.EDGE, 2)],
      ['Slot travel used', fx(g.span, 2) + ' / ' + fx(pinTravel, 2)],
    ];
    rows.forEach(function (row, i) {
      const yy = ty + i * 1.05;
      if (row[1] === null) text(tx, yy, row[0], { size: 0.9, bold: true });
      else {
        text(tx, yy, row[0], { size: 0.68, col: '#333' });
        text(tx + 15.8, yy, row[1], { size: 0.68, anchor: 'end', col: '#000', bold: true });
      }
    });
    text(tx, ty + rows.length * 1.05 + 0.6, 'Pin angles are measured CCW from the rail', { size: 0.62, col: '#555' });
    text(tx, ty + rows.length * 1.05 + 1.4, 'direction. Pin x,y are from the disk centre.', { size: 0.62, col: '#555' });
    o.push('</svg>');
    return o.join('\n');
  }

  return {
    sa: sa, ca: ca, pinTravel: pinTravel,
    strokeForRadius: strokeForRadius, radiusForStroke: radiusForStroke, tOfC: tOfC, cRange: cRange,
    slotRange: slotRange, geom: geom, layout: layout, railLeft: railLeft, warningsFor: warningsFor, maxRadius: maxRadius,
    radiusToPercent: radiusToPercent, percentToRadius: percentToRadius, sliderToTurns: sliderToTurns, turnsToSlider: turnsToSlider,
    angleTable: angleTable, buildSheet: buildSheet, exportBox: exportBox, exportDetail: exportDetail,
  };
}

// ----------------------------------------------------------- app-level API ---
function pinRelAt(P, r, c) {
  const sa = Math.sin(rad(P.SLOT_ANGLE)), ca = Math.cos(rad(P.SLOT_ANGLE));
  const sq = Math.sqrt(Math.max(0.0, r * r - c * c));
  return [c * sa + sq * ca, -c * ca + sq * sa];
}
const asinDeg = x => deg(Math.asin(Math.max(-1.0, Math.min(1.0, x))));

function context(S, rParam) {
  const parsed = parseSettings(S);
  const P = parsed.vals;
  const E = Engine(P);
  const mr = E.maxRadius();
  let r, auto;
  if (rParam !== undefined && rParam !== null && rParam !== '') {
    r = Number(rParam);
    if (!isFinite(r)) throw new Error('Pin distance must be a number');
    if (!(r > 0)) throw new Error('Pin distance must be positive');
    auto = false;
  } else if (mr > 0) {
    r = mr; auto = true;
  } else {
    r = Math.max(0.5, Math.min(5.0, P.DISK_RADIUS - P.SLOT_W)); auto = true;
  }
  return { P: P, E: E, notes: parsed.notes, mr: mr, r: r, auto: auto };
}

function apiState(S, rParam, posIn) {
  const ctx = context(S, rParam);
  const P = ctx.P, E = ctx.E, r = ctx.r;
  let pos = Number(posIn === undefined || posIn === null || posIn === '' ? 0.5 : posIn);
  if (!isFinite(pos)) throw new Error('pos must be a number');
  pos = Math.max(0.0, pos);
  const g = E.geom(r), lay = E.layout(r), warns = E.warningsFor(r);
  const cx = lay.cx, cy = lay.cy, sa = E.sa, ca = E.ca;
  const c1 = g.c1, c2 = g.c2;
  const strokeCm = pos * g.stroke;
  const c = c1 + strokeCm * sa;
  const cc = Math.max(-r, Math.min(r, c));
  const pr = pinRelAt(P, r, cc);
  const ang = P.SLOT_ANGLE - asinDeg(cc / r);
  const angStart = P.SLOT_ANGLE - asinDeg(c1 / r);
  const angEnd = P.SLOT_ANGLE - asinDeg(c2 / r);
  const t = E.tOfC(r, cc);
  const sp = pinRelAt(P, r, c1), ep = pinRelAt(P, r, c2);
  const settings = {};
  for (const item of SETTINGS) settings[item[0]] = rd(P[item[0]]);
  return {
    settings: settings,
    notes: ctx.notes,
    r: rd(r), auto_r: ctx.auto, max_r: rd(ctx.mr),
    fit: { ok: warns.length === 0, layout_ok: lay.ok, margin: rd(lay.margin), worst: lay.worst, warnings: warns },
    cx: rd(cx), cy: rd(cy), rail_y: rd(cy - P.OFFSET), rail_left: rd(E.railLeft(g, cx)),
    k: rd(E.strokeForRadius(1.0)),
    stroke: rd(g.stroke), sweep_pct: rd(g.stroke / P.TRAVEL * 100.0),
    xs: rd(cx + g.xr1), xe: rd(cx + g.xr2),
    bar: { len: rd(g.bar_len), w: rd(g.bar_w), slot_start: rd(g.slot_start), slot_end: rd(g.slot_end) },
    span: rd(g.span), span_avail: rd(E.pinTravel),
    pos: rd(pos), stroke_cm: rd(strokeCm), pct: rd(strokeCm / P.TRAVEL * 100.0),
    inside: Math.abs(c) <= r + 1e-9,
    in_slot: g.slot_start + P.SLOT_W / 2 - 1e-6 <= t && t <= g.slot_end - P.SLOT_W / 2 + 1e-6,
    x_car: rd(cx + (c - P.OFFSET * ca) / sa),
    ang: rd(ang, 4), ang_start: rd(angStart, 4), ang_end: rd(angEnd, 4),
    turns: rd((angStart - ang) / 360.0, 6),
    pin: { x: rd(cx + pr[0]), y: rd(cy + pr[1]) },
    pin_start: { x: rd(cx + sp[0]), y: rd(cy + sp[1]) },
    pin_end: { x: rd(cx + ep[0]), y: rd(cy + ep[1]) },
  };
}

function apiTables(S, rParam) {
  const ctx = context(S, rParam);
  const P = ctx.P, E = ctx.E, r = ctx.r;
  const rings = [];
  let rr = 1.0;
  while (rr <= P.DISK_RADIUS - P.SLOT_W + 1e-9) {
    const w = E.warningsFor(rr);
    const stroke = E.strokeForRadius(rr);
    rings.push({ r: rr, stroke: rd(stroke), pct: rd(stroke / P.TRAVEL * 100.0), ok: w.length === 0, why: w.length ? w[0] : '' });
    rr += 1.0;
  }
  const pcts = [];
  for (let p = 10; p <= 100; p += 10) {
    const pr = E.percentToRadius(p);
    const w = E.warningsFor(pr[1]);
    pcts.push({ pct: p, stroke: rd(pr[0]), r: rd(pr[1]), ok: w.length === 0, why: w.length ? w[0] : '' });
  }
  const angles = E.angleTable(r).map(x => ({ stroke: rd(x[0]), pct: rd(x[1]), ang: rd(x[2]) }));
  return { r: rd(r), rings: rings, pcts: pcts, angles: angles, build: E.buildSheet(r)[0] };
}

function apiConvert(S, kind, value, rParam) {
  const ctx = context(S, rParam);
  const E = ctx.E;
  const v = Number(value);
  if (value === '' || value === null || value === undefined || !isFinite(v)) throw new Error('Enter a number');
  if (kind === 'r2pct') {
    const x = E.radiusToPercent(v);
    return { stroke_cm: rd(x[0]), pct: rd(x[1]), warnings: E.warningsFor(v) };
  }
  if (kind === 'pct2r') {
    const x = E.percentToRadius(v);
    return { stroke_cm: rd(x[0]), r: rd(x[1]), warnings: E.warningsFor(x[1]) };
  }
  if (kind === 'pct2turns') {
    const x = E.sliderToTurns(ctx.r, v);
    return { stroke_cm: rd(x[0]), turns: rd(x[1], 6), deg: rd(x[1] * 360.0, 3) };
  }
  if (kind === 'turns2pct') {
    const x = E.turnsToSlider(ctx.r, v);
    return { stroke_cm: rd(x[0]), pct: rd(x[1]) };
  }
  throw new Error('Unknown conversion');
}

function exportSVG(kind, S, rParam) {
  const ctx = context(S, rParam);
  return kind === 'sheet' ? ctx.E.exportDetail(ctx.r) : ctx.E.exportBox(ctx.r);
}

const api = {
  SETTINGS: SETTINGS, DEFAULTS: DEFAULTS,
  parseSettings: parseSettings, apiState: apiState, apiTables: apiTables, apiConvert: apiConvert, exportSVG: exportSVG,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.SDCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
