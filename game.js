// Arena v2 - klien: renderer WebGL sendiri, lobi dengan 3 slot senjata, HUD minimalis, kontrol PC + sentuh.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MAP = window.MAP, WP = MAP.weapons;
  var glc = $('gl'), fxc = $('fx'), fx = fxc.getContext('2d');
  var isTouch = window.matchMedia && matchMedia('(pointer:coarse)').matches;
  var gl = glc.getContext('webgl', { antialias: !isTouch, alpha: false, powerPreference: 'high-performance' }) || glc.getContext('experimental-webgl');
  if (isTouch) document.body.classList.add('touch');

  var BODY = [[0.46, 0.5, 0.56], [0.55, 0.42, 0.4], [0.42, 0.52, 0.45], [0.5, 0.47, 0.38], [0.45, 0.43, 0.56], [0.55, 0.5, 0.45], [0.38, 0.5, 0.54], [0.54, 0.42, 0.5]];
  var FOG = [0.55, 0.76, 0.95];
  var EYE = 1.55, SLOT_NAMES = ['Utama', 'Sekunder', 'Jarak dekat'], DIFF = ['Mudah', 'Sedang', 'Sulit'];

  // ================= matematika =================
  function persp(f, a, n, fa) {
    var t = 1 / Math.tan(f / 2), nf = 1 / (n - fa);
    return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0];
  }
  function lookAt(ex, ey, ez, cx, cy, cz) {
    var fx_ = cx - ex, fy = cy - ey, fz = cz - ez, l = Math.hypot(fx_, fy, fz);
    fx_ /= l; fy /= l; fz /= l;
    var sx = -fz, sy = 0, sz = fx_;
    l = Math.hypot(sx, sy, sz); sx /= l; sz /= l;
    var ux = sy * fz - sz * fy, uy = sz * fx_ - sx * fz, uz = sx * fy - sy * fx_;
    return [sx, ux, -fx_, 0, sy, uy, -fy, 0, sz, uz, -fz, 0,
      -(sx * ex + sy * ey + sz * ez), -(ux * ex + uy * ey + uz * ez), (fx_ * ex + fy * ey + fz * ez), 1];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ================= geometri (10 float / vertex: pos, normal, warna, material) =================
  function V(arr, x, y, z, nx, ny, nz, c, m) { arr.push(x, y, z, nx, ny, nz, c[0], c[1], c[2], m); }
  function pushBox(arr, bx, by, bz, yaw, cx, cy, cz, hx, hy, hz, col, flat, mat) {
    var cs = Math.cos(yaw), sn = Math.sin(yaw), m = mat || 0;
    var ax = [[cs, 0, -sn], [0, 1, 0], [sn, 0, cs]];
    var h = [hx, hy, hz];
    var wx = bx + cx * cs + cz * sn, wy = by + cy, wz = bz - cx * sn + cz * cs;
    for (var a = 0; a < 3; a++) {
      var u = (a + 1) % 3, v = (a + 2) % 3;
      for (var s = -1; s <= 1; s += 2) {
        var nx = ax[a][0] * s, ny = ax[a][1] * s, nz = ax[a][2] * s;
        var px = wx + nx * h[a], py = wy + ny * h[a], pz = wz + nz * h[a];
        var q = [[-1, -1], [1, -1], [1, 1], [-1, 1]], P = [];
        for (var i = 0; i < 4; i++) {
          P.push([
            px + ax[u][0] * h[u] * q[i][0] + ax[v][0] * h[v] * q[i][1],
            py + ax[u][1] * h[u] * q[i][0] + ax[v][1] * h[v] * q[i][1],
            pz + ax[u][2] * h[u] * q[i][0] + ax[v][2] * h[v] * q[i][1]
          ]);
        }
        var order = [0, 1, 2, 0, 2, 3];
        for (var k = 0; k < 6; k++) {
          var p = P[order[k]];
          V(arr, p[0], p[1], p[2], flat ? 0 : nx, flat ? 0 : ny, flat ? 0 : nz, col, m);
        }
      }
    }
  }
  function pushRect(arr, x0, z0, x1, z1, y, col) {
    V(arr, x0, y, z0, 0, 1, 0, col, 0); V(arr, x0, y, z1, 0, 1, 0, col, 0); V(arr, x1, y, z1, 0, 1, 0, col, 0);
    V(arr, x0, y, z0, 0, 1, 0, col, 0); V(arr, x1, y, z1, 0, 1, 0, col, 0); V(arr, x1, y, z0, 0, 1, 0, col, 0);
  }
  function pushBeam(arr, a, b, cam, w, col) {
    var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    var tx = a[0] - cam[0], ty = a[1] - cam[1], tz = a[2] - cam[2];
    var px = dy * tz - dz * ty, py = dz * tx - dx * tz, pz = dx * ty - dy * tx;
    var l = Math.hypot(px, py, pz) || 1; px = px / l * w; py = py / l * w; pz = pz / l * w;
    var P = [[a[0] - px, a[1] - py, a[2] - pz], [a[0] + px, a[1] + py, a[2] + pz], [b[0] + px, b[1] + py, b[2] + pz], [b[0] - px, b[1] - py, b[2] - pz]];
    [0, 1, 2, 0, 2, 3].forEach(function (i) { V(arr, P[i][0], P[i][1], P[i][2], 0, 0, 0, col, 0); });
  }

  // ================= model senjata (kotak; depan = -z) =================
  var D = [0.2, 0.21, 0.24], K = [0.09, 0.09, 0.11], Wd = [0.4, 0.27, 0.17], Mt = [0.66, 0.68, 0.72], Bl = [0.78, 0.8, 0.84];
  var MODELS = {
    ar: [[0, 0, 0, .03, .04, .2, D], [0, .012, -.3, .012, .012, .12, K], [0, -.08, .03, .02, .05, .025, K], [0, -.01, .25, .025, .04, .07, Wd], [0, .052, -.02, .008, .012, .03, K]],
    smg: [[0, 0, 0, .03, .04, .15, D], [0, .01, -.22, .011, .011, .08, K], [0, -.09, .02, .016, .06, .02, K], [0, .05, 0, .008, .01, .03, K]],
    shotgun: [[0, 0, 0, .03, .035, .22, D], [0, .018, -.32, .014, .014, .16, K], [0, -.02, -.3, .018, .014, .14, K], [0, -.03, -.12, .03, .02, .06, Wd], [0, -.01, .27, .028, .045, .08, Wd]],
    sniper: [[0, 0, 0, .026, .036, .26, D], [0, .01, -.46, .01, .01, .2, K], [0, .062, -.03, .018, .018, .1, K], [0, .062, -.03, .026, .026, .015, K], [0, -.01, .3, .026, .045, .08, Wd], [0, -.07, .0, .015, .035, .02, K]],
    lmg: [[0, 0, 0, .04, .045, .22, D], [0, .014, -.34, .013, .013, .13, K], [0, -.1, .02, .06, .055, .05, K], [0, -.02, .26, .03, .04, .07, Wd], [0, -.04, -.3, .006, .05, .006, K]],
    pistol: [[0, 0, -.02, .016, .026, .09, D], [0, .004, -.12, .01, .01, .04, K], [0, -.065, .06, .015, .05, .02, Wd]],
    revolver: [[0, 0, 0, .016, .03, .08, D], [0, .008, -.16, .01, .01, .09, K], [0, .002, -.04, .026, .026, .035, Mt], [0, -.07, .08, .016, .05, .022, Wd]],
    mpistol: [[0, 0, -.02, .02, .03, .11, D], [0, .008, -.16, .009, .009, .05, K], [0, -.08, .0, .012, .06, .02, K], [0, -.06, .08, .015, .045, .02, Wd]],
    knife: [[0, 0, -.14, .006, .026, .15, Bl], [0, -.002, .02, .015, .016, .06, K]],
    bat: [[0, 0, -.3, .028, .028, .34, Wd], [0, 0, -.62, .036, .036, .1, Wd], [0, 0, .06, .02, .02, .06, K]]
  };
  // posisi moncong (z paling depan) untuk jejak peluru
  var MUZZLE = {};
  Object.keys(MODELS).forEach(function (k) {
    var z = 0, y = 0;
    MODELS[k].forEach(function (b) { if (b[2] - b[5] < z) { z = b[2] - b[5]; y = b[1]; } });
    MUZZLE[k] = [0, y, z];
  });

  // ================= WebGL =================
  var prog, loc = {}, staticBuf, staticCount = 0, floorBuf, floorCount = 0, dynBuf;
  function setupGL() {
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var vs = 'attribute vec3 aPos;attribute vec3 aNor;attribute vec3 aCol;attribute float aMat;uniform mat4 uMVP;uniform vec3 uLight;' +
      'varying vec3 vCol;varying float vD;varying vec3 vPos;varying vec3 vNor;varying float vMat;varying float vSh;' +
      'void main(){gl_Position=uMVP*vec4(aPos,1.0);vD=gl_Position.w;vPos=aPos;vNor=aNor;vMat=aMat;' +
      'float fl=length(aNor)>0.5?(0.5+0.5*max(dot(aNor,uLight),0.0)):1.0;vSh=fl;vCol=aCol*fl;}';
    var fs = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
      'varying vec3 vCol;varying float vD;varying vec3 vPos;varying vec3 vNor;varying float vMat;varying float vSh;uniform vec3 uFog;' +
      'void main(){vec3 c=vCol;' +
      'if(vMat>0.5&&abs(vNor.y)<0.5&&vPos.y>3.2){' +
      'float u=vPos.x*abs(vNor.z)+vPos.z*abs(vNor.x);vec2 g=vec2(u/2.5,vPos.y/3.3);vec2 f=fract(g);vec2 id=floor(g);' +
      'float w=step(0.2,f.x)*step(f.x,0.8)*step(0.26,f.y)*step(f.y,0.78);' +
      'float h=fract(sin(dot(id,vec2(12.9898,78.233)))*43758.5453);' +
      'vec3 gl=mix(vec3(0.17,0.2,0.26),vec3(0.95,0.82,0.52),step(0.86,h));c=mix(c,gl*(0.55+0.45*vSh),w);}' +
      'float fg=clamp((vD-35.0)/110.0,0.0,1.0);gl_FragColor=vec4(mix(c,uFog,fg),1.0);}';
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    loc.pos = gl.getAttribLocation(prog, 'aPos'); loc.nor = gl.getAttribLocation(prog, 'aNor');
    loc.col = gl.getAttribLocation(prog, 'aCol'); loc.mat = gl.getAttribLocation(prog, 'aMat');
    loc.mvp = gl.getUniformLocation(prog, 'uMVP'); loc.light = gl.getUniformLocation(prog, 'uLight'); loc.fog = gl.getUniformLocation(prog, 'uFog');
    gl.enableVertexAttribArray(loc.pos); gl.enableVertexAttribArray(loc.nor); gl.enableVertexAttribArray(loc.col); gl.enableVertexAttribArray(loc.mat);
    gl.uniform3f(loc.fog, FOG[0], FOG[1], FOG[2]);

    // lantai/jalan: urutan gambar = urutan lapisan (tanpa depth test)
    var fa = [];
    pushRect(fa, -260, -260, 260, 260, 0, [0.5, 0.52, 0.5]);
    MAP.floors.forEach(function (f) { pushRect(fa, f[0], f[1], f[2], f[3], 0, MAP.colors[f[4]]); });
    floorCount = fa.length / 10;
    floorBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, floorBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fa), gl.STATIC_DRAW);

    var arr = [];
    function addBox(b, def) {
      var col = b[6] === null || b[6] === undefined ? def : MAP.colors[b[6]];
      pushBox(arr, 0, 0, 0, 0, (b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2, (b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2, col, false, b[7] ? 1 : 0);
    }
    MAP.boxes.forEach(function (b) { addBox(b, [0.6, 0.6, 0.6]); });
    (MAP.decor || []).forEach(function (b) { addBox(b, [0.55, 0.58, 0.62]); });
    staticCount = arr.length / 10;
    staticBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    dynBuf = gl.createBuffer();
  }
  function drawBuf(buf, count) {
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 40, 0);
    gl.vertexAttribPointer(loc.nor, 3, gl.FLOAT, false, 40, 12);
    gl.vertexAttribPointer(loc.col, 3, gl.FLOAT, false, 40, 24);
    gl.vertexAttribPointer(loc.mat, 1, gl.FLOAT, false, 40, 36);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }
  function drawDyn(arr) {
    if (!arr.length) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW);
    drawBuf(dynBuf, arr.length / 10);
  }

  // ================= state =================
  var S = {
    ws: null, id: 0, playing: false, paused: false, alive: false, hp: 100, kills: 0, deaths: 0,
    killLimit: 15, matchOver: false, bots: 0, diff: 1, x: 0, y: 0, z: 0, vy: 0, onGround: true, yaw: 0, pitch: 0, ping: 30,
    lo: MAP.defaultLoadout.slice(), slot: 0, mag: [0, 0, 0], res: [0, 0, 0], reloading: false, reloadEnd: 0, reloadStart: 0,
    switchEnd: 0, ads: false, adsT: 0, latch: false, lastFire: [0, 0, 0], swingT: -999, deathAt: 0, killer: -1, killerW: 0
  };
  var pick = MAP.defaultLoadout.slice();    // pilihan di lobi
  var roster = {}, remotes = {};
  var keys = {}, fireHeld = false, jumpQueued = false, stick = { x: 0, y: 0 };
  var beams = [], sparks = [], dmgDirs = [];
  var recoil = 0, flashT = 0, flashA = 0, hitT = -999, hitKill = false, hitHead = false, muzzleT = 0, bobT = 0;
  var W = 0, H = 0, DPR = 1, VP = null, eyeNow = [0, 0, 0], fovNow = 1.2;
  var menuMode = 'join';   // 'join' | 'change'
  function menuOpen() { return $('menu').classList.contains('show') || $('wpanel').classList.contains('show') || $('hpanel').classList.contains('show'); }
  var rem = 11;
  var stats = { kills: 0, deaths: 0, wins: 0 };
  try { var st0 = JSON.parse(localStorage.getItem('arena_stats') || 'null'); if (st0) stats = st0; } catch (e) { /* abaikan */ }
  function saveStats() { try { localStorage.setItem('arena_stats', JSON.stringify(stats)); } catch (e) { /* abaikan */ } }
  function drawProfile() {
    var nm = ($('name').value || '').trim() || 'Pemain';
    $('pnm').textContent = nm; $('pav').textContent = nm.charAt(0).toUpperCase();
    $('pk').textContent = 'Kill ' + stats.kills; $('pd').textContent = 'Mati ' + stats.deaths; $('pw').textContent = 'Menang ' + stats.wins;
    $('pbar').firstElementChild.style.width = ((stats.kills % 10) * 10) + '%';
  }
  var LOBBY = { x: 16, z: 0, yaw: 0 };
  var lobbyChar = { buf: [], w: 0, fl: -999, col: [0.86, 0.2, 0.2] };

  function wdef() { return WP[S.lo[S.slot]]; }
  function slotOf(w) { return WP[w].slot; }
  try {
    var sv = JSON.parse(localStorage.getItem('arena_lo') || 'null');
    if (sv && sv.length === 3 && sv.every(function (w, i) { return WP[w] && WP[w].slot === i; })) pick = sv;
  } catch (e) { /* abaikan */ }

  // ================= audio =================
  var AC = null;
  function audio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = false; } }
    if (AC && AC.state === 'suspended') { try { AC.resume(); } catch (e) { /* abaikan */ } }
    return AC || null;
  }
  function beep(freq, dur, type, vol, slide) {
    var a = audio(); if (!a || vol <= 0.001) return;
    try {
      var o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur);
    } catch (e) { /* abaikan */ }
  }
  function gunSound(w, vol) { var s = WP[w].snd; beep(s[0], s[1], s[2], s[3] * vol, s[4]); }

  // ================= fisika pemain =================
  var R = 0.4, STEP = 0.55, HEIGHT = 1.8;
  function moveLocal(dt) {
    var fwd = 0, str = 0;
    if (keys.KeyW || keys.ArrowUp) fwd += 1;
    if (keys.KeyS || keys.ArrowDown) fwd -= 1;
    if (keys.KeyD || keys.ArrowRight) str += 1;
    if (keys.KeyA || keys.ArrowLeft) str -= 1;
    fwd += -stick.y; str += stick.x;
    var l = Math.hypot(fwd, str); if (l > 1) { fwd /= l; str /= l; }
    var run = keys.ShiftLeft || keys.ShiftRight || (isTouch && l > 0.9);
    var sp = (run ? 8.6 : 6.4) * wdef().speed * (1 - 0.4 * S.adsT);
    var sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
    var vx = (-sy * fwd + cy * str) * sp, vz = (-cy * fwd - sy * str) * sp;
    var nx = S.x + vx * dt;
    if (!MAP.blocked(nx, S.z, S.y)) S.x = nx;
    var nz = S.z + vz * dt;
    if (!MAP.blocked(S.x, nz, S.y)) S.z = nz;
    var lim = MAP.half - R;
    S.x = Math.max(-lim, Math.min(lim, S.x)); S.z = Math.max(-lim, Math.min(lim, S.z));
    S.moving = l > 0.1;
    if ((keys.Space || jumpQueued) && S.onGround) { S.vy = 7.6; S.onGround = false; }
    jumpQueued = false;
    S.vy -= 22 * dt;
    S.y += S.vy * dt;
    var g = MAP.groundAt(S.x, S.z, S.y);
    if (S.y <= g) { S.y = g; S.vy = 0; S.onGround = true; } else S.onGround = false;
  }

  // ================= jaringan =================
  function send(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); }
  function nameOf(id) { return (roster[id] && roster[id].name) || ('P' + id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function show(id, on) { $(id).classList[on ? 'add' : 'remove']('show'); }
  var pingTimer = 0;

  function connect(name) {
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var ws;
    try { ws = new WebSocket(proto + location.host + '/ws'); } catch (e) { $('err').textContent = 'Tidak bisa konek ke server.'; $('mPlay').disabled = false; return; }
    S.ws = ws;
    ws.onopen = function () {
      send({ t: 'join', name: name, lo: pick });
      pingTimer = setInterval(function () { send({ t: 'ping', c: performance.now() }); }, 2000);
    };
    ws.onerror = function () { if (!S.playing) { $('err').textContent = 'Gagal konek. Pastikan server jalan dan WiFi sama.'; $('mPlay').disabled = false; } };
    ws.onclose = function () { clearInterval(pingTimer); if (S.playing) show('disc', true); else $('mPlay').disabled = false; };
    ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMsg(m); };
  }

  function setLoadout(lo) {
    S.lo = lo.slice();
    S.slot = 0;
    for (var i = 0; i < 3; i++) { S.mag[i] = WP[lo[i]].mag; S.res[i] = WP[lo[i]].res; S.lastFire[i] = 0; }
    S.reloading = false; S.ads = false; S.adsT = 0; S.switchEnd = performance.now() + 300; S.latch = false;
    buildSlots();
  }

  function onMsg(m) {
    var now = performance.now(), i;
    switch (m.t) {
      case 'welcome':
        S.id = m.id; S.killLimit = m.killLimit; S.matchOver = m.matchOver; S.bots = m.bots || 0; S.diff = m.diff || 0;
        S.playing = true; document.body.classList.add('playing');
        show('menu', false); $('hud').classList.remove('hide');
        $('klim').textContent = S.killLimit;
        $('mode').textContent = S.bots > 0 ? 'Lawan bot · ' + DIFF[Math.max(0, Math.min(2, S.diff))] : 'Deathmatch';
        break;
      case 'full': $('err').textContent = 'Server penuh (maksimal 12 pemain).'; $('mPlay').disabled = false; break;
      case 'pong': S.ping = Math.round(now - m.c); break;
      case 'roster':
        roster = {};
        m.list.forEach(function (r) { roster[r[0]] = { name: r[1], color: r[2], bot: !!r[3] }; });
        Object.keys(remotes).forEach(function (k) { if (!roster[k]) delete remotes[k]; });
        break;
      case 's':
        for (i = 0; i < m.p.length; i++) {
          var p = m.p[i], id = p[0];
          if (id === S.id) {
            S.hp = p[6]; S.kills = p[8]; S.deaths = p[9];
            if (!p[7] && S.alive) S.alive = false;
            continue;
          }
          var r = remotes[id] || (remotes[id] = { buf: [], alive: true, hp: 100, kills: 0, deaths: 0, w: 0, fired: -99999, fl: -999 });
          r.buf.push({ t: now, x: p[1], y: p[2], z: p[3], yaw: p[4], pitch: p[5] });
          if (r.buf.length > 24) r.buf.shift();
          r.hp = p[6]; r.alive = !!p[7]; r.kills = p[8]; r.deaths = p[9]; r.w = p[10] >= 0 ? p[10] : r.w;
        }
        break;
      case 'respawn':
        S.x = m.x; S.y = m.y; S.z = m.z; S.yaw = m.yaw; S.pitch = 0; S.vy = 0; S.onGround = true;
        S.alive = true; S.hp = 100; fireHeld = false;
        if (m.lo) setLoadout(m.lo);
        dmgDirs.length = 0;
        show('dead', false);
        break;
      case 'shot': onShot(m, now); break;
      case 'hit':
        hitT = now; hitKill = !!m.k; hitHead = !!m.h;
        beep(m.k ? 1200 : (m.h ? 1500 : 900), m.k ? 0.15 : 0.05, 'square', 0.1);
        break;
      case 'hurt':
        flashA = Math.min(1, 0.45 + (100 - m.hp) / 130); flashT = now;
        dmgDirs.push({ ax: m.ax, az: m.az, t: now });
        beep(110, 0.16, 'sawtooth', 0.2, 0.5);
        if (m.hp <= 0) {
          S.alive = false; S.hp = 0; fireHeld = false; S.ads = false; S.deathAt = now; S.killer = m.a; S.killerW = m.w;
          $('dwho').textContent = 'Dikalahkan ' + nameOf(m.a);
          show('dead', true);
        }
        break;
      case 'kill':
        addFeed(m);
        if (m.k === S.id) { stats.kills++; saveStats(); }
        if (m.v === S.id) { stats.deaths++; saveStats(); }
        break;
      case 'win': onWin(m); break;
      case 'reset':
        S.matchOver = false; show('win', false); show('dead', false); $('feed').innerHTML = '';
        break;
    }
  }

  function onShot(m, now) {
    var o = m.o, e = m.e, w = WP[m.w], self = m.id === S.id, i;
    var r = remotes[m.id];
    if (r) { r.fired = now; r.fl = now; }
    var d = Math.hypot(o[0] - S.x, o[2] - S.z);
    if (!self) gunSound(m.w, Math.max(0, 1 - d / 60));
    var melee = w.slot === 2, life = w.key === 'sniper' ? 170 : 90;
    for (i = 0; i < e.length; i++) {
      var end = e[i], st;
      if (!melee) {
        if (self) {
          var dir = dirOf(S.yaw, S.pitch), rx = Math.cos(S.yaw), rz = -Math.sin(S.yaw), mz = MUZZLE[w.key];
          st = [S.x + dir[0] * (0.35 - mz[2]) + rx * 0.17, S.y + EYE - 0.17 + dir[1] * (0.35 - mz[2]), S.z + dir[2] * (0.35 - mz[2]) + rz * 0.17];
        } else {
          var vx = end[0] - o[0], vy = end[1] - o[1], vz = end[2] - o[2], l = Math.hypot(vx, vy, vz) || 1;
          st = [o[0] + vx / l * 0.8, o[1] - 0.22 + vy / l * 0.8, o[2] + vz / l * 0.8];
        }
        beams.push({ a: st, b: [end[0], end[1], end[2]], t: now, life: life });
      }
      if (end[3] === 1) addSparks(end, [0.85, 0.82, 0.74], melee ? 3 : 4);
      else if (end[3] === 2) addSparks(end, [0.78, 0.2, 0.2], 5);
    }
  }

  // ================= HUD (DOM) =================
  var feed = $('feed'), sb = $('sb'), sbFull = false, sbHold = 0, lastHud = '';
  function addFeed(m) {
    var d = document.createElement('div');
    if (m.k === S.id || m.v === S.id) d.className = 'me';
    d.innerHTML = '<span>' + esc(nameOf(m.k)) + '</span><em>' + esc(WP[m.w] ? WP[m.w].name : '') + (m.h ? ' · kepala' : '') + '</em><span>' + esc(nameOf(m.v)) + '</span>';
    feed.appendChild(d);
    while (feed.children.length > 5) feed.removeChild(feed.firstChild);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 5500);
  }
  function rows() {
    var rs = [{ id: S.id, name: nameOf(S.id), k: S.kills, d: S.deaths, me: true, bot: false }];
    Object.keys(remotes).forEach(function (id) { var r = remotes[id]; rs.push({ id: +id, name: nameOf(+id), k: r.kills, d: r.deaths, bot: !!(roster[id] && roster[id].bot) }); });
    rs.sort(function (a, b) { return b.k - a.k || a.d - b.d; });
    return rs;
  }
  function updateScoreboard() {
    var rs = rows(), list = sbFull ? rs : rs.slice(0, 4), h = '';
    if (sbFull) h += '<div class="hd"><span>Papan skor</span><span>Target ' + S.killLimit + '</span></div>';
    list.forEach(function (r) {
      h += '<div class="r' + (r.me ? ' me' : '') + '"><span class="n">' + esc(r.name) + (r.bot ? '<span class="bt">BOT</span>' : '') + '</span><span class="k">' + r.k + '</span>' +
        (sbFull ? '<span class="k">' + r.d + '</span>' : '') + '</div>';
    });
    if (!sbFull && rs.length > 4) {
      var mine = rs.findIndex(function (r) { return r.me; });
      if (mine >= 4) h += '<div class="r me"><span class="n">' + (mine + 1) + '. ' + esc(rs[mine].name) + '</span><span class="k">' + rs[mine].k + '</span></div>';
    }
    sb.className = sbFull ? 'full' : '';
    sb.innerHTML = h;
  }
  function buildSlots() {
    var h = '';
    for (var i = 0; i < 3; i++) h += '<div class="slot' + (i === S.slot ? ' on' : '') + '" data-s="' + i + '"><u>' + (i + 1) + '</u><b>' + esc(WP[S.lo[i]].name) + '</b><i></i></div>';
    $('slots').innerHTML = h;
  }
  $('slots').addEventListener('pointerdown', function (e) {
    var el = e.target.closest ? e.target.closest('.slot') : null;
    if (el) { e.preventDefault(); switchTo(+el.getAttribute('data-s')); }
  });
  function updateHud(now) {
    $('kcur').textContent = S.kills;
    var hp = Math.max(0, S.hp);
    $('hpn').textContent = hp; $('hpf').style.width = hp + '%';
    $('hp').className = hp <= 30 ? 'low' : '';
    var sl = $('slots').children;
    for (var i = 0; i < sl.length; i++) {
      sl[i].className = 'slot' + (i === S.slot ? ' on' : '');
      var wi = WP[S.lo[i]], ie = sl[i].lastElementChild;
      if (wi.slot === 2) ie.innerHTML = '&infin;';
      else ie.innerHTML = S.mag[i] + '<s>/' + S.res[i] + '</s>';
    }
    var rel = $('rel');
    if (S.reloading) { rel.style.visibility = 'visible'; $('relf').style.width = Math.min(100, (now - S.reloadStart) / (S.reloadEnd - S.reloadStart) * 100) + '%'; }
    else rel.style.visibility = 'hidden';
    if (sbHold && now > sbHold) { sbHold = 0; sbFull = false; }
    updateScoreboard();
    if (!S.alive) {
      var left = Math.max(0, 3 - (now - S.deathAt) / 1000);
      $('dsub').textContent = (WP[S.killerW] ? WP[S.killerW].name + ' · ' : '') + (S.matchOver ? 'ronde selesai' : 'hidup lagi ' + left.toFixed(1) + ' dtk');
    }
    $('stat').textContent = fps + ' fps · ' + S.ping + ' ms';
  }
  var toastT = 0;
  function toast(t) { var el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('on'); }, 1100); }

  function onWin(m) {
    S.matchOver = true;
    if (m.id === S.id) { stats.wins++; saveStats(); }
    $('wtitle').textContent = m.id === S.id ? 'Kamu menang' : esc(m.name) + ' menang';
    $('wsub').textContent = 'Ronde baru dimulai sebentar lagi';
    var h = '';
    rows().forEach(function (r, i) {
      h += '<div class="r' + (r.me ? ' me' : '') + '"><span class="n">' + (i + 1) + '. ' + esc(r.name) + (r.bot ? ' · bot' : '') + '</span><span class="k">' + r.k + '</span><span class="k">' + r.d + '</span></div>';
    });
    $('wtab').innerHTML = h;
    show('win', true);
  }

  // ================= efek =================
  function addSparks(p, col, n) {
    var t = performance.now();
    for (var i = 0; i < n; i++) sparks.push({ p: [p[0], p[1], p[2]], v: [(Math.random() - .5) * 3, Math.random() * 2.5, (Math.random() - .5) * 3], t: t, c: col });
    if (sparks.length > 120) sparks.splice(0, sparks.length - 120);
  }

  // ================= tembak / isi ulang / ganti =================
  function dirOf(yaw, pitch) {
    var cp = Math.cos(pitch);
    return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  }
  function switchTo(i) {
    if (!S.alive || S.matchOver || i === S.slot || i < 0 || i > 2) return;
    S.slot = i; S.reloading = false; S.ads = false; S.switchEnd = performance.now() + 260; S.latch = true;
    beep(420, 0.04, 'triangle', 0.05);
  }
  function startReload(now) {
    var w = wdef();
    if (w.slot === 2 || S.reloading || !S.alive || S.mag[S.slot] >= w.mag) return;
    if (S.res[S.slot] <= 0) { if (S.mag[S.slot] <= 0) toast('Peluru habis'); return; }
    S.reloading = true; S.reloadStart = now; S.reloadEnd = now + w.reload; S.ads = false;
    beep(240, 0.05, 'square', 0.05);
  }
  function tickWeapon(now) {
    if (S.reloading && now >= S.reloadEnd) {
      var w = wdef(), take = Math.min(w.mag - S.mag[S.slot], S.res[S.slot]);
      S.mag[S.slot] += take; S.res[S.slot] -= take; S.reloading = false;
      beep(360, 0.05, 'square', 0.06);
    }
    var cur = wdef();
    if (cur.slot !== 2 && S.mag[S.slot] <= 0 && !S.reloading && now - S.lastFire[S.slot] > 200) startReload(now);
    if (!fireHeld) S.latch = false;
    var scoped = cur.zoom >= 2;
    S.adsT = Math.max(0, Math.min(1, S.adsT + (S.ads && cur.slot !== 2 && !S.reloading ? 1 : -1) * (scoped ? 0.12 : 0.18)));
  }
  function tryFire(now) {
    if (!fireHeld || !S.alive || S.paused || S.matchOver || now < S.switchEnd || S.reloading) return;
    var w = wdef(), sl = S.slot;
    if (now - S.lastFire[sl] < w.rate) return;
    if (!w.auto && S.latch) return;
    if (w.slot !== 2 && S.mag[sl] <= 0) { if (S.res[sl] > 0) startReload(now); return; }
    S.lastFire[sl] = now; S.latch = true;
    var d = dirOf(S.yaw, S.pitch);
    send({ t: 'shoot', w: S.lo[sl], ads: S.adsT > 0.5 ? 1 : 0, dx: d[0], dy: d[1], dz: d[2], rw: Math.max(0, Math.min(300, Math.round(S.ping / 2 + 100))) });
    if (w.slot === 2) { S.swingT = now; beep(w.snd[0], w.snd[1], w.snd[2], w.snd[3], w.snd[4]); return; }
    S.mag[sl]--;
    recoil = Math.min(1.4, recoil + 1); muzzleT = now;
    var k = w.kick * (S.adsT > 0.5 ? 0.6 : 1);
    S.pitch = Math.min(1.5, S.pitch + k);
    S.yaw += (Math.random() - 0.5) * k * 0.8;
    gunSound(S.lo[sl], 1);
  }

  // ================= remote: interpolasi =================
  var INTERP = 100;
  function poseOf(r, now) {
    var b = r.buf; if (!b.length) return null;
    var T = now - INTERP, i;
    if (T <= b[0].t) return b[0];
    for (i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= T) {
        var a = b[i - 1], c = b[i], k = c.t === a.t ? 1 : Math.min(1, (T - a.t) / (c.t - a.t));
        var dy = ((c.yaw - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yaw: a.yaw + dy * k, pitch: a.pitch + (c.pitch - a.pitch) * k, mv: Math.hypot(c.x - a.x, c.z - a.z) > 0.03 };
      }
    }
    return b[b.length - 1];
  }

  // ================= render =================
  function resize() {
    rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 11;
    DPR = Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2);
    W = window.innerWidth; H = window.innerHeight;
    glc.width = fxc.width = Math.round(W * DPR); glc.height = fxc.height = Math.round(H * DPR);
    fx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);

  function drawPlayer(arr, id, p, r, now) {
    var col = r.col || BODY[((roster[id] && roster[id].color) || 0) % 8];
    var sw = p.mv ? Math.sin(now * 0.012) * 0.24 : 0;
    var pants = [0.17, 0.18, 0.21];
    pushBox(arr, p.x, p.y, p.z, p.yaw, -0.13, 0.4, sw, 0.1, 0.4, 0.12, pants, false);
    pushBox(arr, p.x, p.y, p.z, p.yaw, 0.13, 0.4, -sw, 0.1, 0.4, 0.12, pants, false);
    pushBox(arr, p.x, p.y, p.z, p.yaw, 0, 1.12, 0, 0.27, 0.36, 0.16, col, false);
    pushBox(arr, p.x, p.y, p.z, p.yaw, 0, 1.64, 0, 0.17, 0.17, 0.17, [0.9, 0.74, 0.62], false);
    pushBox(arr, p.x, p.y, p.z, p.yaw, 0, 1.71, -0.02, 0.18, 0.06, 0.17, [0.13, 0.14, 0.17], false);
    var wk = WP[r.w] ? WP[r.w].key : 'ar', mdl = MODELS[wk];
    if (mdl) {
      var melee = WP[r.w].slot === 2, gx = 0.3, gy = 1.08, gz = melee ? -0.15 : -0.3;
      mdl.forEach(function (b) { pushBox(arr, p.x, p.y, p.z, p.yaw, gx + b[0], gy + b[1], gz + b[2], b[3], b[4], b[5], b[6], false); });
      if (now - r.fl < 60 && !melee) pushBox(arr, p.x, p.y, p.z, p.yaw, gx, gy + MUZZLE[wk][1], gz + MUZZLE[wk][2] - 0.05, 0.035, 0.035, 0.05, [1, 0.88, 0.45], true);
    }
  }

  function render(now) {
    gl.viewport(0, 0, glc.width, glc.height);
    gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    var aspect = W / H, fov = aspect < 1.1 ? 1.55 : 1.22;
    var ex, ey, ez, tx, ty, tz;
    var cur = S.playing ? wdef() : null;
    if (!S.playing) {
      var ly = LOBBY.yaw, fwx = -Math.sin(ly), fwz = -Math.cos(ly), sdx = Math.cos(ly), sdz = -Math.sin(ly);
      ex = LOBBY.x + fwx * 3.5 + sdx * 0.1; ey = 1.2; ez = LOBBY.z + fwz * 3.5 + sdz * 0.1;
      tx = LOBBY.x; ty = 1.05; tz = LOBBY.z;
      fov = aspect < 1.1 ? 1.2 : 0.85;
    } else {
      var eyeY = S.y + (S.alive ? EYE : 0.45), d = dirOf(S.yaw, S.pitch);
      ex = S.x; ey = eyeY; ez = S.z; tx = ex + d[0]; ty = ey + d[1]; tz = ez + d[2];
      var zoom = 1 + (cur.zoom - 1) * S.adsT;
      fov = 2 * Math.atan(Math.tan(fov / 2) / zoom);
    }
    fovNow = fov;
    eyeNow = [ex, ey, ez];
    var P = persp(fov, aspect, 0.08, 260);
    VP = mul(P, lookAt(ex, ey, ez, tx, ty, tz));
    gl.useProgram(prog);
    gl.uniform3f(loc.light, 0.45, 0.82, 0.35);
    gl.uniformMatrix4fv(loc.mvp, false, new Float32Array(VP));
    gl.disable(gl.DEPTH_TEST);
    drawBuf(floorBuf, floorCount);
    gl.enable(gl.DEPTH_TEST);
    drawBuf(staticBuf, staticCount);
    if (!S.playing) {
      var la = [], lp = { x: LOBBY.x, y: 0, z: LOBBY.z, yaw: LOBBY.yaw + Math.sin(now * 0.0009) * 0.35, mv: false };
      lobbyChar.w = pick[0];
      drawPlayer(la, 'lobby', lp, lobbyChar, now);
      drawDyn(la);
      return;
    }

    var arr = [], id, i;
    for (id in remotes) {
      var r = remotes[id]; if (!r.alive) continue;
      var p = poseOf(r, now); if (p) drawPlayer(arr, id, p, r, now);
    }
    for (i = beams.length - 1; i >= 0; i--) {
      var bm = beams[i], age = now - bm.t;
      if (age > bm.life) { beams.splice(i, 1); continue; }
      var f = 1 - age / bm.life;
      pushBeam(arr, bm.a, bm.b, eyeNow, 0.012 + 0.014 * f, [0.95 * f + 0.1, 0.88 * f + 0.1, 0.62 * f + 0.1]);
    }
    for (i = sparks.length - 1; i >= 0; i--) {
      var sp = sparks[i], a2 = (now - sp.t) / 1000;
      if (a2 > 0.3) { sparks.splice(i, 1); continue; }
      pushBox(arr, sp.p[0] + sp.v[0] * a2, sp.p[1] + sp.v[1] * a2 - 4 * a2 * a2, sp.p[2] + sp.v[2] * a2, 0, 0, 0, 0, 0.03, 0.03, 0.03, sp.c, true);
    }
    drawDyn(arr);

    // senjata di tangan
    if (S.alive && !(cur.zoom >= 2 && S.adsT > 0.85)) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(loc.mvp, false, new Float32Array(persp(fov, aspect, 0.02, 10)));
      gl.uniform3f(loc.light, 0.3, 0.75, 0.6);
      var g = [], mdl = MODELS[cur.key], melee = cur.slot === 2;
      var bob = S.moving && S.onGround ? Math.sin(bobT) * 0.007 : 0, bobx = S.moving && S.onGround ? Math.cos(bobT * 0.5) * 0.005 : 0;
      var gx = lerp(0.17, 0.0, S.adsT) + bobx, gy = lerp(-0.17, -0.12, S.adsT) + bob + recoil * 0.01, gz = -0.56 + recoil * 0.05;
      var rel = 0, sw = 0, swYaw = 0;
      if (S.reloading) { var pr = (now - S.reloadStart) / (S.reloadEnd - S.reloadStart); rel = Math.sin(Math.min(1, pr) * Math.PI) * 0.16; }
      if (now < S.switchEnd) rel = Math.max(rel, (S.switchEnd - now) / 260 * 0.28);
      if (melee) {
        sw = Math.max(0, 1 - (now - S.swingT) / 260);
        if (sw > 0) { var s2 = Math.sin(sw * Math.PI); swYaw = (cur.key === 'bat' ? 1.1 : 0.7) * s2; gz -= 0.12 * s2; gx -= 0.12 * s2; gy += cur.key === 'bat' ? 0.05 * s2 : 0; }
        gx = 0.22 + (gx - 0.2); gy = -0.2 + (gy + 0.19); gz = gz + (cur.key === 'bat' ? 0.05 : 0.1);
      }
      gy -= rel;
      mdl.forEach(function (b) { pushBox(g, gx, gy, gz, swYaw, b[0], b[1], b[2], b[3], b[4], b[5], b[6], false); });
      if (now - muzzleT < 55 && !melee) pushBox(g, gx, gy, gz, 0, 0, MUZZLE[cur.key][1], MUZZLE[cur.key][2] - 0.04, 0.03, 0.03, 0.05, [1, 0.88, 0.45], true);
      drawDyn(g);
    }
  }

  function project(x, y, z) {
    var m = VP;
    var cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.05) return null;
    return [(cx / cw * 0.5 + 0.5) * W, (1 - (cy / cw * 0.5 + 0.5)) * H, cw];
  }

  // ================= minimap =================
  var mmLayer = null, MMK = 2.4;
  function buildMinimap() {
    var n = Math.round(MAP.half * 2 * MMK);
    mmLayer = document.createElement('canvas'); mmLayer.width = mmLayer.height = n;
    var c = mmLayer.getContext('2d');
    c.fillStyle = '#35604a'; c.fillRect(0, 0, n, n);
    c.fillStyle = '#9fb7c9';
    MAP.boxes.forEach(function (b) {
      if (b[4] - b[1] < 1.2 || b[1] > 1) return;
      c.fillRect((b[0] + MAP.half) * MMK, (b[2] + MAP.half) * MMK, (b[3] - b[0]) * MMK, (b[5] - b[2]) * MMK);
    });
  }
  function drawMinimap(now) {
    var Rr = rem * 4.6, cx = rem * 5.3, cy = rem * 5.3, range = 40, sc = Rr / range;
    fx.save();
    fx.beginPath(); fx.arc(cx, cy, Rr, 0, Math.PI * 2); fx.clip();
    fx.fillStyle = 'rgba(24,52,40,.82)'; fx.fillRect(cx - Rr, cy - Rr, Rr * 2, Rr * 2);
    var cs = Math.cos(S.yaw), sn = Math.sin(S.yaw);
    fx.save();
    fx.translate(cx, cy);
    fx.transform(sc * cs, sc * sn, -sc * sn, sc * cs, 0, 0);
    fx.translate(-S.x, -S.z);
    fx.globalAlpha = 0.9;
    fx.drawImage(mmLayer, -MAP.half, -MAP.half, MAP.half * 2, MAP.half * 2);
    fx.restore();
    // musuh
    for (var id in remotes) {
      var r = remotes[id]; if (!r.alive) continue;
      var p = poseOf(r, now); if (!p) continue;
      var dx = p.x - S.x, dz = p.z - S.z, dist = Math.hypot(dx, dz), fired = now - r.fired < 2500;
      if (dist > 35 && !fired) continue;
      var sx = (cs * dx - sn * dz) * sc, sy = (sn * dx + cs * dz) * sc, l = Math.hypot(sx, sy);
      if (l > Rr - 4) { sx *= (Rr - 4) / l; sy *= (Rr - 4) / l; }
      fx.fillStyle = '#ff5b5b'; fx.beginPath(); fx.arc(cx + sx, cy + sy, 2.6, 0, Math.PI * 2); fx.fill();
    }
    fx.restore();
    fx.strokeStyle = '#151515'; fx.lineWidth = 5;
    fx.beginPath(); fx.arc(cx, cy, Rr, 0, Math.PI * 2); fx.stroke();
    fx.strokeStyle = '#ffd23f'; fx.lineWidth = 2;
    fx.beginPath(); fx.arc(cx, cy, Rr - 1, 0, Math.PI * 2); fx.stroke();
    fx.fillStyle = '#fff'; fx.beginPath(); fx.moveTo(cx, cy - 5); fx.lineTo(cx + 3.6, cy + 4); fx.lineTo(cx, cy + 2); fx.lineTo(cx - 3.6, cy + 4); fx.closePath(); fx.fill();
  }

  // ================= overlay 2D (crosshair, nama, arah serangan, scope) =================
  function drawFx(now) {
    fx.clearRect(0, 0, W, H);
    if (!S.playing || menuOpen()) return;
    var cx = W / 2, cy = H / 2, i;
    // nama di atas kepala
    fx.textAlign = 'center'; fx.font = '600 11px system-ui,sans-serif';
    for (var id in remotes) {
      var r = remotes[id]; if (!r.alive) continue;
      var p = poseOf(r, now); if (!p) continue;
      var dx = p.x - eyeNow[0], dy = p.y + 2.0 - eyeNow[1], dz = p.z - eyeNow[2], dist = Math.hypot(dx, dy, dz);
      if (dist > 45) continue;
      if (MAP.rayWorld(eyeNow[0], eyeNow[1], eyeNow[2], dx / dist, dy / dist, dz / dist) < dist - 0.4) continue;
      var s = project(p.x, p.y + 2.0, p.z); if (!s) continue;
      var nm = nameOf(+id), al = Math.max(0.35, 1 - dist / 55);
      fx.lineWidth = 3; fx.strokeStyle = 'rgba(0,0,0,' + (al * 0.55) + ')'; fx.strokeText(nm, s[0], s[1]);
      fx.fillStyle = 'rgba(255,255,255,' + al + ')'; fx.fillText(nm, s[0], s[1]);
      if (r.hp < 100) { var bw = 26; fx.fillStyle = 'rgba(0,0,0,.5)'; fx.fillRect(s[0] - bw / 2, s[1] + 4, bw, 2); fx.fillStyle = '#fff'; fx.fillRect(s[0] - bw / 2, s[1] + 4, bw * Math.max(0, r.hp) / 100, 2); }
    }
    if (S.alive) {
      var cur = wdef(), scoped = cur.zoom >= 2 && S.adsT > 0.85;
      if (scoped) {
        var rad = Math.min(W, H) * 0.46;
        fx.fillStyle = '#000'; fx.beginPath(); fx.rect(0, 0, W, H); fx.arc(cx, cy, rad, 0, Math.PI * 2, true); fx.fill('evenodd');
        fx.strokeStyle = 'rgba(0,0,0,.9)'; fx.lineWidth = 1.5;
        fx.beginPath(); fx.moveTo(cx - rad, cy); fx.lineTo(cx + rad, cy); fx.moveTo(cx, cy - rad); fx.lineTo(cx, cy + rad); fx.stroke();
        fx.fillStyle = '#000'; fx.fillRect(cx - 1, cy - 1, 2, 2);
      } else if (cur.slot === 2) {
        fx.fillStyle = 'rgba(255,255,255,.9)'; fx.beginPath(); fx.arc(cx, cy, 1.8, 0, Math.PI * 2); fx.fill();
      } else {
        var spread = cur.spread * (S.adsT > 0.5 ? cur.ads : 1) + (S.moving ? 0.008 : 0) + recoil * 0.012;
        var gap = 3 + Math.tan(spread) * (H / 2) / Math.tan(fovNow / 2), len = 6;
        var line = function () { fx.beginPath(); fx.moveTo(cx - gap - len, cy); fx.lineTo(cx - gap, cy); fx.moveTo(cx + gap, cy); fx.lineTo(cx + gap + len, cy);
          fx.moveTo(cx, cy + gap); fx.lineTo(cx, cy + gap + len); fx.moveTo(cx, cy - gap); fx.lineTo(cx, cy - gap - len); fx.stroke(); };
        fx.lineWidth = 3; fx.strokeStyle = 'rgba(0,0,0,.4)'; line();
        fx.lineWidth = 1.4; fx.strokeStyle = 'rgba(255,255,255,.92)'; line();
      }
      // penanda kena
      var ha = 1 - (now - hitT) / 240;
      if (ha > 0) {
        var o = hitKill ? 8 : 6, e2 = hitKill ? 17 : (hitHead ? 15 : 12);
        fx.strokeStyle = hitKill ? 'rgba(255,91,91,' + ha + ')' : 'rgba(255,255,255,' + ha + ')'; fx.lineWidth = hitKill ? 2.6 : 2;
        fx.beginPath();
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) { fx.moveTo(cx + q[0] * o, cy + q[1] * o); fx.lineTo(cx + q[0] * e2, cy + q[1] * e2); });
        fx.stroke();
      }
    }
    // arah serangan
    for (i = dmgDirs.length - 1; i >= 0; i--) {
      var dd = dmgDirs[i], age = (now - dd.t) / 1200;
      if (age >= 1) { dmgDirs.splice(i, 1); continue; }
      var ddx = dd.ax - S.x, ddz = dd.az - S.z;
      var fw = -Math.sin(S.yaw) * ddx - Math.cos(S.yaw) * ddz, rt = Math.cos(S.yaw) * ddx - Math.sin(S.yaw) * ddz;
      var th = Math.atan2(rt, fw) - Math.PI / 2;
      fx.strokeStyle = 'rgba(255,91,91,' + (1 - age) * 0.9 + ')'; fx.lineWidth = 5;
      fx.beginPath(); fx.arc(cx, cy, Math.min(W, H) * 0.24, th - 0.22, th + 0.22); fx.stroke();
    }
    drawMinimap(now);
  }

  // ================= loop =================
  var last = performance.now(), fpsN = 0, fpsT = 0, fps = 0, uiT = 0, lastSend = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    fpsN++; if (now - fpsT > 1000) { fps = fpsN; fpsN = 0; fpsT = now; }
    if (S.playing) {
      if (S.alive && !S.paused) {
        moveLocal(dt);
        bobT += dt * (S.moving ? 10 : 0);
        S.yaw = ((S.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        tickWeapon(now);
        tryFire(now);
        if (now - lastSend > 50) {
          lastSend = now;
          send({ t: 'state', x: +S.x.toFixed(3), y: +S.y.toFixed(3), z: +S.z.toFixed(3), yaw: +S.yaw.toFixed(3), pitch: +S.pitch.toFixed(3), w: S.lo[S.slot] });
        }
      }
      recoil = Math.max(0, recoil - dt * 8);
      if (flashA > 0) { flashA = Math.max(0, 1 - (now - flashT) / 450); $('flash').style.opacity = flashA.toFixed(2); }
      if (now - uiT > 120) { uiT = now; updateHud(now); }
    }
    render(now);
    drawFx(now);
  }

  // ================= input PC =================
  document.addEventListener('keydown', function (e) {
    if (!S.playing || e.target.tagName === 'INPUT') return;
    if (e.code === 'Tab') { e.preventDefault(); if (!sbFull) { sbFull = true; updateScoreboard(); } return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
    if (e.code === 'KeyR') startReload(performance.now());
    if (e.code === 'Digit1') switchTo(0);
    if (e.code === 'Digit2') switchTo(1);
    if (e.code === 'Digit3') switchTo(2);
    keys[e.code] = true;
  });
  document.addEventListener('keyup', function (e) {
    if (e.code === 'Tab') { sbFull = false; updateScoreboard(); return; }
    keys[e.code] = false;
  });
  window.addEventListener('blur', function () { keys = {}; fireHeld = false; });
  document.addEventListener('wheel', function (e) {
    if (!S.playing || isTouch) return;
    switchTo((S.slot + (e.deltaY > 0 ? 1 : 2)) % 3);
  });

  function locked() { return document.pointerLockElement === glc || document.pointerLockElement === document.body; }
  function lockPointer() { try { var p = glc.requestPointerLock && glc.requestPointerLock(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* abaikan */ } }
  document.addEventListener('pointerlockchange', function () {
    if (isTouch || !S.playing) return;
    S.paused = !locked() && S.alive && !menuOpen();
    show('pause', S.paused && !$('disc').classList.contains('show'));
    if (!locked()) { fireHeld = false; keys = {}; }
  });
  document.addEventListener('mousemove', function (e) {
    if (isTouch || !S.playing || !locked() || !S.alive) return;
    var sens = 0.0022 / (1 + (wdef().zoom - 1) * S.adsT * 0.8);
    S.yaw -= e.movementX * sens;
    S.pitch = Math.max(-1.5, Math.min(1.5, S.pitch - e.movementY * sens));
  });
  document.addEventListener('mousedown', function (e) {
    if (isTouch || !S.playing || menuOpen()) return;
    audio();
    if (!locked()) { lockPointer(); return; }
    if (e.button === 0) fireHeld = true;
    if (e.button === 2) S.ads = true;
  });
  document.addEventListener('mouseup', function (e) { if (e.button === 0) fireHeld = false; if (e.button === 2) S.ads = false; });
  $('pause').addEventListener('click', lockPointer);
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ================= input sentuh =================
  var tz = $('tz'), lookT = null, stickT = null, stickO = null, STICK_MAX = 50;
  function setStickUI(on, x, y, kx, ky) {
    if (!on) { x = kx = rem * 5.8; y = ky = H - rem * 5.6; }
    var bs = rem * 3.7, ks = rem * 1.8;
    $('stickB').style.left = (x - bs) + 'px'; $('stickB').style.top = (y - bs) + 'px';
    $('stickK').style.left = (kx - ks) + 'px'; $('stickK').style.top = (ky - ks) + 'px';
  }
  tz.addEventListener('touchstart', function (e) {
    e.preventDefault(); audio();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.clientX < W * 0.42 && stickT === null) { stickT = t.identifier; stickO = { x: t.clientX, y: t.clientY }; setStickUI(true, t.clientX, t.clientY, t.clientX, t.clientY); }
      else if (t.clientX >= W * 0.42 && lookT === null) { lookT = { id: t.identifier, x: t.clientX, y: t.clientY }; }
    }
  }, { passive: false });
  tz.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === stickT) {
        var dx = t.clientX - stickO.x, dy = t.clientY - stickO.y, l = Math.hypot(dx, dy);
        if (l > STICK_MAX) { dx = dx / l * STICK_MAX; dy = dy / l * STICK_MAX; }
        stick.x = dx / STICK_MAX; stick.y = dy / STICK_MAX;
        setStickUI(true, stickO.x, stickO.y, stickO.x + dx, stickO.y + dy);
      } else if (lookT && t.identifier === lookT.id && S.alive && !S.paused) {
        var sens = 0.0065 / (1 + (wdef().zoom - 1) * S.adsT * 0.8);
        S.yaw -= (t.clientX - lookT.x) * sens;
        S.pitch = Math.max(-1.5, Math.min(1.5, S.pitch - (t.clientY - lookT.y) * sens));
        lookT.x = t.clientX; lookT.y = t.clientY;
      }
    }
  }, { passive: false });
  function touchEnd(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === stickT) { stickT = null; stick.x = stick.y = 0; setStickUI(false); }
      if (lookT && t.identifier === lookT.id) lookT = null;
    }
  }
  tz.addEventListener('touchend', touchEnd, { passive: false });
  tz.addEventListener('touchcancel', touchEnd, { passive: false });
  function bindBtn(id, down, up) {
    var el = $(id);
    el.addEventListener('touchstart', function (e) { e.preventDefault(); e.stopPropagation(); audio(); down(); }, { passive: false });
    var u = function (e) { e.preventDefault(); e.stopPropagation(); up(); };
    el.addEventListener('touchend', u, { passive: false }); el.addEventListener('touchcancel', u, { passive: false });
  }
  bindBtn('bFire', function () { fireHeld = true; $('bFire').classList.add('on'); }, function () { fireHeld = false; $('bFire').classList.remove('on'); });
  bindBtn('bJump', function () { jumpQueued = true; }, function () {});
  bindBtn('bRel', function () { startReload(performance.now()); }, function () {});
  bindBtn('bSwap', function () { switchTo((S.slot + 1) % 3); }, function () {});
  bindBtn('bAds', function () { S.ads = !S.ads; $('bAds').classList.toggle('on', S.ads); }, function () {});
  $('topc').style.pointerEvents = 'auto';
  $('topc').addEventListener('pointerdown', function () { if (isTouch) { sbFull = !sbFull; sbHold = sbFull ? performance.now() + 5000 : 0; updateScoreboard(); } });

  // ================= lobi =================
  function spec(w) {
    var d = WP[w];
    if (d.slot === 2) return d.dmg + ' · ' + (d.range).toFixed(1) + ' m';
    return d.dmg + (d.pellets > 1 ? '×' + d.pellets : '') + ' · ' + Math.round(60000 / d.rate) + '/mnt';
  }
  function buildMenu() {
    var h = '';
    for (var s = 0; s < 3; s++) {
      h += '<div class="col"><h3>' + SLOT_NAMES[s] + '</h3>';
      WP.forEach(function (d, i) {
        if (d.slot !== s) return;
        h += '<div class="row' + (pick[s] === i ? ' on' : '') + '" data-w="' + i + '"><b>' + esc(d.name) + '</b><small>' + spec(i) + '</small></div>';
      });
      h += '</div>';
    }
    $('cols').innerHTML = h;
  }
  $('cols').addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.row') : null; if (!el) return;
    var w = +el.getAttribute('data-w'); pick[WP[w].slot] = w;
    try { localStorage.setItem('arena_lo', JSON.stringify(pick)); } catch (er) { /* abaikan */ }
    buildMenu();
  });
  function openMenu(mode) {
    menuMode = mode;
    if (mode === 'join') { show('menu', true); show('wpanel', false); drawProfile(); }
    else { buildMenu(); show('wpanel', true); try { document.exitPointerLock(); } catch (e) { /* abaikan */ } }
  }
  function openWeapons() { buildMenu(); show('wpanel', true); }
  $('dchange').addEventListener('click', function () { openMenu('change'); });
  $('tw').addEventListener('click', openWeapons);
  $('th').addEventListener('click', function () { show('hpanel', true); });
  $('mHelp').addEventListener('click', function () { show('hpanel', true); });
  $('hOk').addEventListener('click', function () { show('hpanel', false); });
  $('wOk').addEventListener('click', function () {
    show('wpanel', false);
    if (menuMode === 'change') {
      send({ t: 'loadout', lo: pick });
      if (!isTouch && S.alive) lockPointer();
    }
  });
  if (window.Android && window.Android.back) {
    $('mBack').hidden = false;
    $('mBack').addEventListener('click', function () { window.Android.back(); });
  }
  $('mSrv').textContent = (location.host ? 'Server ' + location.host : '');
  $('name').addEventListener('input', drawProfile);

  function start() {
    var name = $('name').value.trim();
    try { localStorage.setItem('arena_name', name); } catch (e) { /* abaikan */ }
    $('err').textContent = ''; $('mPlay').disabled = true;
    audio();
    if (!isTouch) lockPointer();
    else {
      try { var el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el); } catch (e) { /* abaikan */ }
      try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) { /* abaikan */ }
    }
    connect(name);
  }
  $('mPlay').addEventListener('click', start);
  $('name').addEventListener('keydown', function (e) { if (e.key === 'Enter') start(); });
  try { $('name').value = localStorage.getItem('arena_name') || ''; } catch (e) { /* abaikan */ }

  if (!gl) { $('err').textContent = 'Browser ini tidak mendukung WebGL (grafik 3D).'; $('mPlay').disabled = true; return; }
  try { setupGL(); } catch (err) { $('err').textContent = 'Gagal menyiapkan grafik 3D: ' + err.message; $('mPlay').disabled = true; return; }
  buildMinimap();
  buildSlots();
  resize();
  openMenu('join');
  setStickUI(false);
  requestAnimationFrame(frame);
  window.__arena = { S: S, remotes: remotes, LOBBY: LOBBY };
})();
