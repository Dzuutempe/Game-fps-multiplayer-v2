'use strict';
// Generator v3: peta hasil voksel (mapcol.json) + tabel senjata -> map.js (klien), GameMap.java, WeaponDefs.java (server).
const fs = require('fs'), path = require('path');
const OUT = process.argv[2] || path.join(__dirname, '..', 'out');

// ---------- senjata (sumber tunggal) ----------
// slot: 0 utama, 1 sekunder, 2 jarak dekat. key = nama model 3D di models3d.js
const W = [
  { key: 'm16', name: 'Karabin M16', slot: 0, dmg: 22, head: 2.0, rate: 100, pellets: 1, spread: 0.012, ads: 0.4, range: 100, fall: 0.75, mag: 30, res: 120, reload: 2000, auto: 1, speed: 0.95, zoom: 1.25, kick: 0.006, snd: [190, 0.08, 'sawtooth', 0.15, 0.35] },
  { key: 'smg4', name: 'SMG', slot: 0, dmg: 15, head: 1.8, rate: 65, pellets: 1, spread: 0.028, ads: 0.55, range: 55, fall: 0.5, mag: 32, res: 128, reload: 1700, auto: 1, speed: 1.0, zoom: 1.15, kick: 0.004, snd: [260, 0.06, 'square', 0.1, 0.4] },
  { key: 'shotgun', name: 'Shotgun', slot: 0, dmg: 11, head: 1.5, rate: 850, pellets: 8, spread: 0.07, ads: 0.7, range: 30, fall: 0.25, mag: 6, res: 30, reload: 2300, auto: 0, speed: 0.95, zoom: 1.1, kick: 0.03, snd: [110, 0.2, 'sawtooth', 0.28, 0.3] },
  { key: 'sniper', name: 'Sniper', slot: 0, dmg: 90, head: 3.0, rate: 1400, pellets: 1, spread: 0.045, ads: 0.0, range: 220, fall: 1.0, mag: 5, res: 20, reload: 2800, auto: 0, speed: 0.85, zoom: 3.5, kick: 0.04, snd: [95, 0.3, 'sawtooth', 0.3, 0.25] },
  { key: 'lmg', name: 'LMG', slot: 0, dmg: 19, head: 1.6, rate: 85, pellets: 1, spread: 0.03, ads: 0.5, range: 80, fall: 0.7, mag: 100, res: 200, reload: 4200, auto: 1, speed: 0.8, zoom: 1.2, kick: 0.005, snd: [150, 0.09, 'sawtooth', 0.18, 0.35] },
  { key: 'pistol', name: 'Pistol', slot: 1, dmg: 20, head: 2.0, rate: 200, pellets: 1, spread: 0.01, ads: 0.5, range: 55, fall: 0.65, mag: 12, res: 60, reload: 1300, auto: 0, speed: 1.0, zoom: 1.15, kick: 0.01, snd: [300, 0.07, 'square', 0.13, 0.4] },
  { key: 'revolver', name: 'Revolver', slot: 1, dmg: 56, head: 2.0, rate: 650, pellets: 1, spread: 0.006, ads: 0.4, range: 75, fall: 0.8, mag: 6, res: 30, reload: 2200, auto: 0, speed: 1.0, zoom: 1.2, kick: 0.028, snd: [140, 0.16, 'sawtooth', 0.24, 0.3] },
  { key: 'uzi', name: 'Uzi', slot: 1, dmg: 11, head: 1.7, rate: 75, pellets: 1, spread: 0.035, ads: 0.6, range: 40, fall: 0.45, mag: 20, res: 100, reload: 1500, auto: 1, speed: 1.0, zoom: 1.1, kick: 0.004, snd: [330, 0.05, 'square', 0.09, 0.45] },
  { key: 'knife', name: 'Pisau', slot: 2, dmg: 45, head: 1.0, rate: 380, pellets: 1, spread: 0, ads: 0, range: 2.4, fall: 1, mag: 0, res: 0, reload: 0, auto: 1, speed: 1.15, zoom: 1, kick: 0, snd: [520, 0.07, 'triangle', 0.08, 0.5] },
  { key: 'bat', name: 'Pemukul', slot: 2, dmg: 70, head: 1.0, rate: 750, pellets: 1, spread: 0, ads: 0, range: 2.8, fall: 1, mag: 0, res: 0, reload: 0, auto: 1, speed: 1.0, zoom: 1, kick: 0, snd: [200, 0.1, 'triangle', 0.1, 0.5] },
  // ---- tambahan dari model baru (indeks 10+ supaya indeks lama tetap) ----
  { key: 'ak47', name: 'AK-47', slot: 0, dmg: 26, head: 2.0, rate: 110, pellets: 1, spread: 0.016, ads: 0.45, range: 90, fall: 0.7, mag: 30, res: 120, reload: 2200, auto: 1, speed: 0.93, zoom: 1.25, kick: 0.008, snd: [170, 0.09, 'sawtooth', 0.17, 0.35] },
  { key: 'dmr', name: 'DMR', slot: 0, dmg: 48, head: 2.5, rate: 280, pellets: 1, spread: 0.02, ads: 0.02, range: 160, fall: 0.9, mag: 10, res: 40, reload: 2600, auto: 0, speed: 0.9, zoom: 2.4, kick: 0.02, snd: [120, 0.2, 'sawtooth', 0.26, 0.3] },
  { key: 'l118', name: 'Sniper Berat', slot: 0, dmg: 110, head: 3.0, rate: 1700, pellets: 1, spread: 0.05, ads: 0.0, range: 300, fall: 1.0, mag: 5, res: 15, reload: 3200, auto: 0, speed: 0.8, zoom: 4.5, kick: 0.05, snd: [80, 0.36, 'sawtooth', 0.34, 0.22] },
  { key: 'golok', name: 'Golok', slot: 2, dmg: 62, head: 1.0, rate: 520, pellets: 1, spread: 0, ads: 0, range: 2.7, fall: 1, mag: 0, res: 0, reload: 0, auto: 1, speed: 1.05, zoom: 1, kick: 0, snd: [330, 0.09, 'triangle', 0.1, 0.5] }
];
const DEFAULT_LO = [0, 10, 7, 8];
// tangga kincir angin: titik dasar (x0,z0) di y=0, miring sx,sz per meter tinggi, puncak y=top. Pemain berdiri 0.45 m di sisi barat garis ini.
const LADDERS = [{ x0: -25.0, z0: 9.45, sx: 0.1375, sz: -0.05, top: 21.2 }];
const PAL = [[0.6, 0.6, 0.6]];

// ---------- konfigurasi peta (indeks 0 = bawaan) ----------
const MAPCFG = [
  { id: 'kota', name: 'Kota', col: 'mapcol.json', multi: false, bounds: [-31, 31, -66, 67], ladders: LADDERS, lobby: [-4, -6, 0, 0], ground: [0.4, 0.72, 0.28], sky: [0.55, 0.76, 0.95] },
  { id: 'desert', name: 'Kota Gurun', col: 'mapcol_desert.json', multi: false, ladders: [], lobby: [-8, -36, 0, 0], spawnBox: [-56, 44, -130, -28], ground: [0.573, 0.51, 0.412], sky: [0.82, 0.8, 0.72] }
];
const CS = 2.0;
function processMap(cfg) {
  const COL = JSON.parse(fs.readFileSync(path.join(__dirname, cfg.col)));
  const boxes = COL.boxes, BOUNDS = cfg.bounds || COL.bounds, [bx0, bx1, bz0, bz1] = BOUNDS;
  let gx0 = 1e9, gz0 = 1e9, gx1 = -1e9, gz1 = -1e9;
  boxes.forEach((b) => { gx0 = Math.min(gx0, b[0]); gz0 = Math.min(gz0, b[2]); gx1 = Math.max(gx1, b[3]); gz1 = Math.max(gz1, b[5]); });
  gx0 = Math.floor(gx0 - 2); gz0 = Math.floor(gz0 - 2);
  const GNX = Math.ceil((gx1 + 2 - gx0) / CS), GNZ = Math.ceil((gz1 + 2 - gz0) / CS);
  const cells = Array.from({ length: GNX * GNZ }, () => []);
  boxes.forEach((b, i) => {
    const a = Math.max(0, Math.floor((b[0] - gx0) / CS)), c = Math.min(GNX - 1, Math.floor((b[3] - gx0) / CS)), d = Math.max(0, Math.floor((b[2] - gz0) / CS)), e = Math.min(GNZ - 1, Math.floor((b[5] - gz0) / CS));
    for (let x = a; x <= c; x++) for (let z = d; z <= e; z++) cells[z * GNX + x].push(i);
  });
  function cellsAt(x0, z0, x1, z1, f) {
    const a = Math.max(0, Math.floor((x0 - gx0) / CS)), c = Math.min(GNX - 1, Math.floor((x1 - gx0) / CS)), d = Math.max(0, Math.floor((z0 - gz0) / CS)), e = Math.min(GNZ - 1, Math.floor((z1 - gz0) / CS));
    for (let x = a; x <= c; x++) for (let z = d; z <= e; z++) { const cl = cells[z * GNX + x]; for (let k = 0; k < cl.length; k++) if (f(boxes[cl[k]])) return true; }
    return false;
  }
  const blocked = (nx, nz, y, R) => cellsAt(nx - R, nz - R, nx + R, nz + R, (b) => b[4] > y + 0.8 && b[1] < y + 1.8 && nx + R > b[0] && nx - R < b[3] && nz + R > b[2] && nz - R < b[5]);
  const ground = (x, z, y) => { let g = 0; cellsAt(x - 0.3, z - 0.3, x + 0.3, z + 0.3, (b) => { if (b[4] <= y + 0.8 && b[4] > g && x + 0.3 > b[0] && x - 0.3 < b[3] && z + 0.3 > b[2] && z - 0.3 < b[5]) g = b[4]; return false; }); return g; };
  // jalan kaki dari a ke b dengan mengikuti tinggi lantai (naik maks 0.8 per langkah, tidak boleh jatuh)
  const walk = (a, b) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / 0.35)); let y = a[2];
    for (let i = 1; i <= n; i++) { const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, g = ground(x, z, y); if (Math.abs(g - y) > 0.8 || blocked(x, z, g, 0.4)) return false; y = g; }
    return Math.abs(y - b[2]) < 0.35;
  };
  // ---------- navigasi: kisi 3 m ----------
  const nodes0 = [];
  for (let x = Math.ceil(bx0); x <= bx1; x += 3) for (let z = Math.ceil(bz0); z <= bz1; z += 3) {
    if (!cfg.multi) { if (!blocked(x, z, 0, 0.7)) nodes0.push([x, z, 0]); continue; }
    const tops = new Set([0]);
    cellsAt(x - 0.3, z - 0.3, x + 0.3, z + 0.3, (b) => { if (x + 0.3 > b[0] && x - 0.3 < b[3] && z + 0.3 > b[2] && z - 0.3 < b[5]) tops.add(b[4]); return false; });
    const ys = [...tops].sort((p, q) => p - q), put = [];
    ys.forEach((y) => { if (put.length && y - put[put.length - 1] < 0.2) return; if (Math.abs(ground(x, z, y) - y) < 0.05 && !blocked(x, z, y, 0.7)) put.push(y); });
    put.forEach((y) => nodes0.push([x, z, +y.toFixed(3)]));
  }
  const adj = nodes0.map(() => []);
  for (let i = 0; i < nodes0.length; i++) for (let j = i + 1; j < nodes0.length; j++) {
    const d = Math.hypot(nodes0[i][0] - nodes0[j][0], nodes0[i][1] - nodes0[j][1]); if (d > 4.6 || Math.abs(nodes0[i][2] - nodes0[j][2]) > 1.6) continue;
    if (walk(nodes0[i], nodes0[j]) && walk(nodes0[j], nodes0[i])) { adj[i].push(j); adj[j].push(i); }
  }
  const comp = new Array(nodes0.length).fill(-1); let best = -1, bestN = 0;
  for (let s = 0; s < nodes0.length; s++) if (comp[s] < 0) { const st = [s]; comp[s] = s; let n = 0; while (st.length) { const u = st.pop(); n++; adj[u].forEach((v) => { if (comp[v] < 0) { comp[v] = s; st.push(v); } }); } if (n > bestN) { bestN = n; best = s; } }
  const keep = [], remap = new Array(nodes0.length).fill(-1);
  nodes0.forEach((p, i) => { if (comp[i] === best) { remap[i] = keep.length; keep.push(p); } });
  const adj2 = keep.map(() => []); adj.forEach((a, i) => { if (remap[i] >= 0) a.forEach((j) => { if (remap[j] >= 0) adj2[remap[i]].push(remap[j]); }); });
  const spacing = cfg.multi ? 8 : 12, spawns = [];
  keep.forEach((p) => { if (cfg.spawnBox && (p[0] < cfg.spawnBox[0] || p[0] > cfg.spawnBox[1] || p[1] < cfg.spawnBox[2] || p[1] > cfg.spawnBox[3])) return; if (!blocked(p[0], p[2] >= 0 ? p[1] : p[1], p[2], 1.3) && spawns.every((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) > spacing || Math.abs(s[2] - p[2]) > 2.5)) spawns.push(p); });
  const rayDist = (x, z, y, yaw) => { const dx = -Math.sin(yaw), dz = -Math.cos(yaw); for (let t = 0.5; t < 40; t += 0.5) if (blocked(x + dx * t, z + dz * t, y, 0.3)) return t; return 40; };
  let lobby = cfg.lobby, lscore = -1;
  if (!lobby) { lobby = [0, 0, 0, 0]; spawns.forEach((p) => { for (let k = 0; k < 16; k++) { const yaw = k * Math.PI / 8, sc = Math.min(rayDist(p[0], p[1], p[2], yaw), 6) * 3 + Math.min(rayDist(p[0], p[1], p[2], yaw + Math.PI), 12); if (sc > lscore) { lscore = sc; lobby = [p[0], p[1], +yaw.toFixed(3), p[2]]; } } }); }
  console.log(cfg.id, '| kotak', boxes.length, '| grid', GNX + 'x' + GNZ, '| nav', keep.length + '/' + nodes0.length, '| spawn', spawns.length, '| lobi', JSON.stringify(lobby), '| y nav', Math.min(...keep.map((p) => p[2])), '..', Math.max(...keep.map((p) => p[2])));
  return { cfg, boxes, BOUNDS, gx0, gz0, GNX, GNZ, cells, keep, adj2, spawns, lobby };
}
const MP = MAPCFG.map(processMap);

// ---------- fisika (klien), satu salinan per peta ----------
const physicsJS = (m) => `
  var CS = ${CS}, GX0 = ${m.gx0}, GZ0 = ${m.gz0}, GNX = ${m.GNX}, GNZ = ${m.GNZ}, CELLS = ${JSON.stringify(m.cells)};
  MAP.rayBox = function (ox, oy, oz, dx, dy, dz, b) {
    var tmin = 0, tmax = Infinity, o = [ox, oy, oz], d = [dx, dy, dz];
    for (var i = 0; i < 3; i++) {
      var lo = b[i], hi = b[i + 3];
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo || o[i] > hi) return Infinity; }
      else {
        var t1 = (lo - o[i]) / d[i], t2 = (hi - o[i]) / d[i];
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return Infinity;
      }
    }
    return tmin;
  };
  MAP.rayWorld = function (ox, oy, oz, dx, dy, dz) {
    var B = MAP.boxes, best = Infinity, W = GNX * CS, H = GNZ * CS, tmin = 0, tmax = Infinity;
    if (Math.abs(dx) < 1e-12) { if (ox < GX0 || ox > GX0 + W) return Infinity; }
    else { var a1 = (GX0 - ox) / dx, a2 = (GX0 + W - ox) / dx; if (a1 > a2) { var q = a1; a1 = a2; a2 = q; } if (a1 > tmin) tmin = a1; if (a2 < tmax) tmax = a2; }
    if (Math.abs(dz) < 1e-12) { if (oz < GZ0 || oz > GZ0 + H) return Infinity; }
    else { var b1 = (GZ0 - oz) / dz, b2 = (GZ0 + H - oz) / dz; if (b1 > b2) { var r = b1; b1 = b2; b2 = r; } if (b1 > tmin) tmin = b1; if (b2 < tmax) tmax = b2; }
    if (tmin > tmax) return Infinity;
    var px = ox + dx * tmin, pz = oz + dz * tmin;
    var ix = Math.max(0, Math.min(GNX - 1, Math.floor((px - GX0) / CS))), iz = Math.max(0, Math.min(GNZ - 1, Math.floor((pz - GZ0) / CS)));
    var sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    var tdx = Math.abs(dx) < 1e-12 ? Infinity : CS / Math.abs(dx), tdz = Math.abs(dz) < 1e-12 ? Infinity : CS / Math.abs(dz);
    var tmx = Math.abs(dx) < 1e-12 ? Infinity : (GX0 + (dx > 0 ? ix + 1 : ix) * CS - ox) / dx;
    var tmz = Math.abs(dz) < 1e-12 ? Infinity : (GZ0 + (dz > 0 ? iz + 1 : iz) * CS - oz) / dz;
    for (;;) {
      var cl = CELLS[iz * GNX + ix];
      for (var k = 0; k < cl.length; k++) { var t = MAP.rayBox(ox, oy, oz, dx, dy, dz, B[cl[k]]); if (t < best) best = t; }
      var tn = tmx < tmz ? tmx : tmz;
      if (best <= tn || tn > tmax) break;
      if (tmx < tmz) { ix += sx; tmx += tdx; } else { iz += sz; tmz += tdz; }
      if (ix < 0 || ix >= GNX || iz < 0 || iz >= GNZ) break;
    }
    return best;
  };
  function each(x0, z0, x1, z1, f) {
    var a = Math.max(0, Math.floor((x0 - GX0) / CS)), c = Math.min(GNX - 1, Math.floor((x1 - GX0) / CS)), d = Math.max(0, Math.floor((z0 - GZ0) / CS)), e = Math.min(GNZ - 1, Math.floor((z1 - GZ0) / CS));
    for (var x = a; x <= c; x++) for (var z = d; z <= e; z++) { var cl = CELLS[z * GNX + x]; for (var k = 0; k < cl.length; k++) if (f(MAP.boxes[cl[k]])) return true; }
    return false;
  }
  MAP.blocked = function (nx, nz, y) {
    var R = 0.4;
    return each(nx - R, nz - R, nx + R, nz + R, function (b) { return b[4] > y + 0.8 && b[1] < y + 1.8 && nx + R > b[0] && nx - R < b[3] && nz + R > b[2] && nz - R < b[5]; });
  };
  MAP.groundAt = function (x, z, y) {
    var g = 0, r = 0.3;
    each(x - r, z - r, x + r, z + r, function (b) { if (b[4] <= y + 0.8 && b[4] > g && x + r > b[0] && x - r < b[3] && z + r > b[2] && z - r < b[5]) g = b[4]; return false; });
    return g;
  };`;
const mapJS = (m) => `
  (function () {
    var MAP = {
      id: ${JSON.stringify(m.cfg.id)}, name: ${JSON.stringify(m.cfg.name)},
      bounds: ${JSON.stringify(m.BOUNDS)},
      half: ${Math.max(...m.BOUNDS.map(Math.abs))},
      boxes: ${JSON.stringify(m.boxes)},
      spawns: ${JSON.stringify(m.spawns)},
      ladders: ${JSON.stringify(m.cfg.ladders)},
      lobby: ${JSON.stringify(m.lobby)},
      ground: ${JSON.stringify(m.cfg.ground)}, sky: ${JSON.stringify(m.cfg.sky)},
      weapons: WEAPONS, defaultLoadout: ${JSON.stringify(DEFAULT_LO)}
    };${physicsJS(m)}
    MAPS[MAP.id] = MAP; MAPS.list.push(MAP.id);
  })();`;
const js = `// DIHASILKAN OTOMATIS dari tools/genmap3.js. Jangan diedit langsung.
// Tabel senjata + kotak tabrakan tiap peta + fisika, dipakai klien (browser) dan sebagai acuan server.
(function (root) {
  'use strict';
  var WEAPONS = ${JSON.stringify(W)};
  var MAPS = { list: [] };${MP.map(mapJS).join('\n')}
  var sel = null; try { sel = /[?&]map=([a-z]+)/.exec(root.location.search)[1]; } catch (e) {}
  var MAP = MAPS[sel] || MAPS[MAPS.list[0]];
  if (typeof module !== 'undefined' && module.exports) module.exports = MAP; else { root.MAPS = MAPS; root.MAP = MAP; }
})(typeof self !== 'undefined' ? self : this);
`;
fs.writeFileSync(path.join(OUT, 'map.js'), js);

// ---------- Java: GameMapImpl (generik), MapDataN (data per peta), GameMap (fasad statis) ----------
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
MP.forEach((m, i) => {
  const boxChunks = chunk(m.boxes.map((b) => b.slice(0, 6).join(',')), 1200).map((c) => '"' + c.join(';') + '"');
  const cellChunks = chunk(m.cells.map((c) => c.join(',')), 3000).map((c) => '"' + c.join(';') + '"');
  const nodeStr = m.keep.map((p) => p.join(',')).join(';'), adjStr = m.adj2.map((a) => a.join(',')).join(';'), spStr = m.spawns.map((p) => p.join(',')).join(';');
  fs.writeFileSync(path.join(OUT, 'MapData' + i + '.java'), `package com.arenafps;

// DIHASILKAN OTOMATIS dari tools/genmap3.js. Jangan diedit langsung.

/** Data peta "${m.cfg.name}". */
final class MapData${i} {
    private MapData${i}() {}

    private static final String[] BOX_DATA = {${boxChunks.join(',\n        ')}};
    private static final String[] CELL_DATA = {${cellChunks.join(',\n        ')}};
    private static final String NODE_DATA = "${nodeStr}";
    private static final String ADJ_DATA = "${adjStr}";
    private static final String SPAWN_DATA = "${spStr}";

    static GameMapImpl build() {
        return new GameMapImpl(${m.BOUNDS[0]}, ${m.BOUNDS[1]}, ${m.BOUNDS[2]}, ${m.BOUNDS[3]}, ${CS}, ${m.gx0}, ${m.gz0}, ${m.GNX}, ${m.GNZ}, BOX_DATA, CELL_DATA, NODE_DATA, ADJ_DATA, SPAWN_DATA);
    }
}
`);
});
const java = fs.readFileSync(path.join(__dirname, 'GameMapImpl.tpl.java'), 'utf8');
fs.writeFileSync(path.join(OUT, 'GameMapImpl.java'), java);
fs.writeFileSync(path.join(OUT, 'GameMap.java'), `package com.arenafps;

// DIHASILKAN OTOMATIS dari tools/genmap3.js. Jangan diedit langsung.

/** Fasad statis peta aktif. Indeks 0 = bawaan. Ganti peta dengan use(id). */
final class GameMap {
    private GameMap() {}

    static final String[] IDS = {${MP.map((m) => '"' + m.cfg.id + '"').join(', ')}};
    static final String[] NAMES = {${MP.map((m) => '"' + m.cfg.name + '"').join(', ')}};
    private static final GameMapImpl[] CACHE = new GameMapImpl[IDS.length];

    static volatile GameMapImpl cur;
    static volatile int curId = -1;
    static volatile double MINX, MAXX, MINZ, MAXZ;
    static volatile double[][] SPAWNS, NODES;
    static volatile int[][] ADJ;

    static {
        use(0);
    }

    static synchronized void use(int id) {
        if (id < 0 || id >= IDS.length) return;
        if (CACHE[id] == null) {
            switch (id) {
${MP.map((m, i) => '                case ' + i + ': CACHE[id] = MapData' + i + '.build(); break;').join('\n')}
                default: return;
            }
        }
        GameMapImpl g = CACHE[id];
        MINX = g.minX; MAXX = g.maxX; MINZ = g.minZ; MAXZ = g.maxZ;
        SPAWNS = g.spawns; NODES = g.nodes; ADJ = g.adj;
        cur = g; curId = id;
    }

    static double clampX(double x) { return Math.max(MINX, Math.min(MAXX, x)); }
    static double clampZ(double z) { return Math.max(MINZ, Math.min(MAXZ, z)); }
    static double rayWorld(double ox, double oy, double oz, double dx, double dy, double dz) { return cur.rayWorld(ox, oy, oz, dx, dy, dz); }
    static boolean blocked(double nx, double nz, double y) { return cur.blocked(nx, nz, y); }
    static double groundAt(double x, double z, double y) { return cur.groundAt(x, z, y); }
    static boolean segClear(double ax, double az, double bx, double bz, double y) { return cur.segClear(ax, az, bx, bz, y); }
    static boolean segClear(double ax, double az, double bx, double bz) { return cur.segClear(ax, az, bx, bz, 0); }
}
`);

// ---------- WeaponDefs.java ----------
const arr = (k, f) => '{' + W.map((w) => (f ? f(w[k]) : w[k])).join(', ') + '}';
const wj = `package com.arenafps;

// DIHASILKAN OTOMATIS dari tools/genmap3.js. Jangan diedit langsung.

/** Tabel senjata. Indeks sama dengan MAP.weapons di map.js. */
final class WeaponDefs {
    private WeaponDefs() {}

    static final int COUNT = ${W.length};
    static final String[] NAME = {${W.map((w) => '"' + w.name + '"').join(', ')}};
    static final int[] SLOT = ${arr('slot')};
    static final double[] DMG = ${arr('dmg')};
    static final double[] HEAD = ${arr('head')};
    static final int[] RATE = ${arr('rate')};
    static final int[] PELLETS = ${arr('pellets')};
    static final double[] SPREAD = ${arr('spread')};
    static final double[] ADS = ${arr('ads')};
    static final double[] RANGE = ${arr('range')};
    static final double[] FALL = ${arr('fall')};
    static final int[] MAG = ${arr('mag')};
    static final int[] RES = ${arr('res')};
    static final int[] RELOAD = ${arr('reload')};
    static final boolean[] AUTO = ${arr('auto', (v) => (v ? 'true' : 'false'))};
    static final double[] SPEED = ${arr('speed')};
    static final int[] DEFAULT_LO = {${DEFAULT_LO.join(', ')}};
    /** Jenis senjata tiap posisi slot: 2 senjata besar, 1 kecil, 1 jarak dekat. */
    static final int[] LOSLOT = {0, 0, 1, 2};

    /** Apakah id senjata valid untuk slot tertentu. */
    static boolean validFor(int pos, int w) { return pos >= 0 && pos < 4 && w >= 0 && w < COUNT && SLOT[w] == LOSLOT[pos]; }
}
`;
fs.writeFileSync(path.join(OUT, 'WeaponDefs.java'), wj);
console.log('ditulis ke', OUT);
