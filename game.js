// Arena v3 - klien: renderer WebGL sendiri, lobi dengan 3 slot senjata, HUD minimalis, kontrol PC + sentuh.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MAP = window.MAP, WP = MAP.weapons;
  var glc = $('gl'), fxc = $('fx'), fx = fxc.getContext('2d');
  var isTouch = window.matchMedia && matchMedia('(pointer:coarse)').matches;
  var G = { q: 1, res: 0.8, aa: false };
  try { var gs = JSON.parse(localStorage.getItem('arena_gfx') || 'null'); if (gs) { G.q = gs.q | 0; G.res = +gs.res || 1; G.aa = gs.aa !== false; } } catch (e) { /* abaikan */ }
  var gl = glc.getContext('webgl', { antialias: G.aa, alpha: true, powerPreference: 'high-performance' }) || glc.getContext('experimental-webgl');
  if (isTouch) document.body.classList.add('touch');

  var BODY = [[0.46, 0.5, 0.56], [0.55, 0.42, 0.4], [0.42, 0.52, 0.45], [0.5, 0.47, 0.38], [0.45, 0.43, 0.56], [0.55, 0.5, 0.45], [0.38, 0.5, 0.54], [0.54, 0.42, 0.5]];
  var FOG = MAP.sky || [0.55, 0.76, 0.95];
  var MMC = MAP.id === 'kota' ? [0.6, 0.82, 0.48] : (MAP.ground || [0.4, 0.72, 0.28]).map(function (v) { return Math.min(1, v * 0.8 + 0.2); });
  var MMCSS = 'rgb(' + MMC.map(function (v) { return Math.round(v * 255); }).join(',') + ')';
  var EYE = 1.55, EYE_ST = [1.55, 1.05, 0.5], SPD_ST = [1, 0.55, 0.3], SLOT_NAMES = ['Utama 1', 'Utama 2', 'Sekunder', 'Jarak dekat'], LOSLOT = [0, 0, 1, 2], DEF_LO = [0, 10, 7, 8], DIFF = ['Mudah', 'Sedang', 'Sulit'];

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

  // ================= geometri (12 float / vertex: pos3 normal3 uv2 warna3 material1) =================
  var STRIDE = 48;
  function V(arr, x, y, z, nx, ny, nz, c, m) { arr.push(x, y, z, nx, ny, nz, 0, 0, c[0], c[1], c[2], m); }
  function pushBox(arr, bx, by, bz, yaw, cx, cy, cz, hx, hy, hz, col, flat) {
    var cs = Math.cos(yaw), sn = Math.sin(yaw);
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
          V(arr, p[0], p[1], p[2], flat ? 0 : nx, flat ? 0 : ny, flat ? 0 : nz, col, 0);
        }
      }
    }
  }
  function pushBeam(arr, a, b, cam, w, col) {
    var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    var tx = a[0] - cam[0], ty = a[1] - cam[1], tz = a[2] - cam[2];
    var px = dy * tz - dz * ty, py = dz * tx - dx * tz, pz = dx * ty - dy * tx;
    var l = Math.hypot(px, py, pz) || 1; px = px / l * w; py = py / l * w; pz = pz / l * w;
    var P = [[a[0] - px, a[1] - py, a[2] - pz], [a[0] + px, a[1] + py, a[2] + pz], [b[0] + px, b[1] + py, b[2] + pz], [b[0] - px, b[1] - py, b[2] - pz]];
    [0, 1, 2, 0, 2, 3].forEach(function (i) { V(arr, P[i][0], P[i][1], P[i][2], 0, 0, 0, col, 0); });
  }
  // matriks 4x4 kolom-utama
  var IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function mT(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }
  function mRy(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
  function mRx(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
  function mRz(a) { var c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  function xf(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; }

  // ================= aset 3D (dari models3d.js dan mapdata.js) =================
  var A3D = window.A3D, A3DMAP = (window.A3DMAPS && window.A3DMAPS[MAP.id]) || window.A3DMAP;
  function b64(s, T) {
    var bin = atob(s), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return new T(u.buffer);
  }
  function decodePart(p) {
    var n = p.n, P = b64(p.P, Int16Array), N = b64(p.N, Int8Array), I = b64(p.I, Uint16Array);
    var U = p.U ? b64(p.U, Uint16Array) : null, C = p.C ? b64(p.C, Uint8Array) : null;
    var pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), i;
    for (i = 0; i < n; i++) {
      pos[i * 3] = p.o[0] + P[i * 3] * p.s; pos[i * 3 + 1] = p.o[1] + P[i * 3 + 1] * p.s; pos[i * 3 + 2] = p.o[2] + P[i * 3 + 2] * p.s;
      nor[i * 3] = N[i * 3] / 127; nor[i * 3 + 1] = N[i * 3 + 1] / 127; nor[i * 3 + 2] = N[i * 3 + 2] / 127;
      if (U) { uv[i * 2] = U[i * 2] / 65535; uv[i * 2 + 1] = U[i * 2 + 1] / 65535; }
    }
    return { n: n, pos: pos, nor: nor, uv: uv, I: I, C: C, tex: p.tex || null, color: p.color || null, BI: p.BI ? b64(p.BI, Uint8Array) : null, BW: p.BW ? b64(p.BW, Uint8Array) : null };
  }
  function ispot(v) { return (v & (v - 1)) === 0; }
  var texCache = {}, whiteTex = null;
  function getTex(name, defs) {
    if (!name) return whiteTex;
    if (texCache[name]) return texCache[name];
    var def = defs[name]; if (!def) return whiteTex;
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([170, 170, 170, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var img = new Image();
    img.onload = function () {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      if (def.nearest) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); }
      else if (ispot(img.width) && ispot(img.height)) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); }
      else { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); }
    };
    img.src = def.src;
    texCache[name] = t;
    return t;
  }
  // mesh statis -> {vbo, ibo, n, tex}
  function uploadPart(d, defs) {
    var n = d.n, f = new Float32Array(n * 12), i, textured = !!d.tex;
    for (i = 0; i < n; i++) {
      var o = i * 12;
      f[o] = d.pos[i * 3]; f[o + 1] = d.pos[i * 3 + 1]; f[o + 2] = d.pos[i * 3 + 2];
      f[o + 3] = d.nor[i * 3]; f[o + 4] = d.nor[i * 3 + 1]; f[o + 5] = d.nor[i * 3 + 2];
      f[o + 6] = d.uv[i * 2]; f[o + 7] = d.uv[i * 2 + 1];
      if (d.C) { f[o + 8] = d.C[i * 3] / 255; f[o + 9] = d.C[i * 3 + 1] / 255; f[o + 10] = d.C[i * 3 + 2] / 255; }
      else if (d.color) { f[o + 8] = d.color[0]; f[o + 9] = d.color[1]; f[o + 10] = d.color[2]; }
      else { f[o + 8] = 1; f[o + 9] = 1; f[o + 10] = 1; }
      f[o + 11] = textured ? 1 : 0;
    }
    var vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, f, gl.STATIC_DRAW);
    var ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.I, gl.STATIC_DRAW);
    return { vbo: vbo, ibo: ibo, n: d.I.length, tex: textured ? getTex(d.tex, defs) : null };
  }
  var WM = {};        // key -> {parts, muzzle, top, size}
  var mapParts = [];  // potongan peta
  var CH = null;      // karakter berkerangka
  var NBONE = 0, BONE = {};

  // ================= WebGL =================
  var prog, loc = {}, groundBuf, groundCount = 0, dynBuf, chBuf, chIbo;
  function setupGL() {
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var vs = 'attribute vec3 aPos;attribute vec3 aNor;attribute vec2 aUV;attribute vec3 aCol;attribute float aMat;uniform mat4 uVP;uniform mat4 uModel;uniform vec3 uLight;' +
      'varying vec3 vCol;varying vec2 vUV;varying float vD;varying float vMat;varying float vSh;' +
      'void main(){gl_Position=uVP*(uModel*vec4(aPos,1.0));vD=gl_Position.w;vec3 n=(uModel*vec4(aNor,0.0)).xyz;' +
      'float l=length(n);float fl=l>0.5?(0.7+0.38*max(dot(n/l,uLight),0.0)):1.0;vSh=fl;vCol=aCol;vUV=aUV;vMat=aMat;}';
    var fs = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
      'varying vec3 vCol;varying vec2 vUV;varying float vD;varying float vMat;varying float vSh;uniform vec3 uFog;uniform sampler2D uTex;' +
      'void main(){vec3 c=vCol;if(vMat>0.5){c=texture2D(uTex,vUV).rgb*vCol;}c*=vSh;' +
      'float fg=clamp((vD-60.0)/120.0,0.0,1.0);gl_FragColor=vec4(mix(c,uFog,fg),1.0);}';
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    ['pos:aPos', 'nor:aNor', 'uv:aUV', 'col:aCol', 'mat:aMat'].forEach(function (s) { var a = s.split(':'); loc[a[0]] = gl.getAttribLocation(prog, a[1]); gl.enableVertexAttribArray(loc[a[0]]); });
    loc.vp = gl.getUniformLocation(prog, 'uVP'); loc.model = gl.getUniformLocation(prog, 'uModel'); loc.light = gl.getUniformLocation(prog, 'uLight');
    loc.fog = gl.getUniformLocation(prog, 'uFog'); loc.tex = gl.getUniformLocation(prog, 'uTex');
    gl.uniform3f(loc.fog, FOG[0], FOG[1], FOG[2]); gl.uniform1i(loc.tex, 0);
    gl.enable(gl.DEPTH_TEST);

    whiteTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, whiteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // tanah dasar (hijau, di bawah mesh peta)
    var ga = [], g = MAP.ground || [0.4, 0.72, 0.28];
    var B = MAP.bounds, ex = 300;
    V(ga, -ex, -0.03, -ex, 0, 1, 0, g, 0); V(ga, -ex, -0.03, ex, 0, 1, 0, g, 0); V(ga, ex, -0.03, ex, 0, 1, 0, g, 0);
    V(ga, -ex, -0.03, -ex, 0, 1, 0, g, 0); V(ga, ex, -0.03, ex, 0, 1, 0, g, 0); V(ga, ex, -0.03, -ex, 0, 1, 0, g, 0);
    groundCount = ga.length / 12;
    groundBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ga), gl.STATIC_DRAW);
    dynBuf = gl.createBuffer(); chBuf = gl.createBuffer();

    // senjata
    Object.keys(A3D.models).forEach(function (k) {
      var m = A3D.models[k];
      WM[k] = { parts: m.parts.map(function (p) { return uploadPart(decodePart(p), A3D.tex); }), muzzle: m.muzzle, top: m.top, size: m.size };
    });
    // peta
    A3DMAP.chunks.forEach(function (c) { var d = decodePart(c); mapParts.push(uploadPart(d, A3DMAP.tex)); });
    setupChar();
  }
  function bindVB(vbo) {
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, STRIDE, 0);
    gl.vertexAttribPointer(loc.nor, 3, gl.FLOAT, false, STRIDE, 12);
    gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, STRIDE, 24);
    gl.vertexAttribPointer(loc.col, 3, gl.FLOAT, false, STRIDE, 32);
    gl.vertexAttribPointer(loc.mat, 1, gl.FLOAT, false, STRIDE, 44);
  }
  var mScratch = new Float32Array(16);
  function setModel(m) { mScratch.set(m); gl.uniformMatrix4fv(loc.model, false, mScratch); }
  function drawIdx(g) {
    bindVB(g.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ibo);
    gl.bindTexture(gl.TEXTURE_2D, g.tex || whiteTex);
    gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
  }
  function drawDyn(arr) {
    if (!arr.length) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW);
    bindVB(dynBuf);
    gl.bindTexture(gl.TEXTURE_2D, whiteTex);
    gl.drawArrays(gl.TRIANGLES, 0, arr.length / 12);
  }
  function drawModel(key, mat) {
    var m = WM[key]; if (!m) return;
    setModel(mat);
    for (var i = 0; i < m.parts.length; i++) drawIdx(m.parts[i]);
  }

  // ================= karakter berkerangka (skinning CPU) =================
  var FACE = [], FACEB = [], FACEN = [];
  var SKIN = [0.95, 0.76, 0.6], SKIN2 = [0.95, 0.76, 0.6], SHIRT = [0.86, 0.86, 0.88], PANTS = [0.17, 0.27, 0.46], SHOE = [0.16, 0.16, 0.18];
  function setupChar() {
    var c = A3D.character, d = decodePart(c.part), nb = d.n, i, k, q;
    NBONE = c.bones.length;
    c.bones.forEach(function (b, k) { BONE[b.n] = k; });
    var dom = [];
    for (i = 0; i < nb; i++) { var bw0 = 0, bi0 = 0; for (k = 0; k < 4; k++) if (d.BW[i * 4 + k] > bw0) { bw0 = d.BW[i * 4 + k]; bi0 = d.BI[i * 4 + k]; } dom.push(c.bones[bi0].n); }
    // titik-titik: badan asli dulu, lalu pakaian 3D
    var P = [], NR = [], BI = [], BW = [], COL = [], MAT = [], UV = [], idx = [];
    for (i = 0; i < nb; i++) {
      var bx = d.pos[i * 3], by = d.pos[i * 3 + 1], dn = dom[i], col = null;
      if (dn.indexOf('Head') >= 0) col = SKIN;                                            // kepala: tekstur dude asli
      else if (/Hand|ForeArm|Thumb|Index/.test(dn)) col = SKIN;
      else if (/UpLeg|Leg$/.test(dn)) col = by < 0.1 ? SHOE : PANTS;
      else if (/Foot|Toe/.test(dn)) col = SHOE;
      else if (/Arm$/.test(dn)) col = Math.abs(bx) > 0.30 ? SKIN : SHIRT;
      else if (dn === 'Hips') col = by > 0.95 ? SHIRT : PANTS;
      else if (/Spine|Shoulder|Neck/.test(dn)) col = by > 1.488 ? SKIN : SHIRT;
      else col = SKIN;
      P.push(bx, by, d.pos[i * 3 + 2]); NR.push(d.nor[i * 3], d.nor[i * 3 + 1], d.nor[i * 3 + 2]);
      for (k = 0; k < 4; k++) { BI.push(d.BI[i * 4 + k]); BW.push(d.BW[i * 4 + k]); }
      COL.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1); MAT.push(col === SKIN2 ? 1 : (col ? 0 : 1)); UV.push(d.uv[i * 2], d.uv[i * 2 + 1]);
    }
    // tiap segitiga satu warna rata (tanpa gradasi): titik digandakan per segitiga, warna = suara terbanyak
    var dupMap = {};
    for (i = 0; i < d.I.length; i += 3) {
      var tv = [d.I[i], d.I[i + 1], d.I[i + 2]], cx = 0, cy = 0, pc, dn2 = null, anyHead = false;
      tv.forEach(function (v) { cx += d.pos[v * 3] / 3; cy += d.pos[v * 3 + 1] / 3; if (/Head/.test(dom[v])) anyHead = true; else if (!dn2) dn2 = dom[v]; });
      if (anyHead && (cy > 1.5 || !dn2)) dn2 = 'Head'; else if (!dn2) dn2 = 'Head';
      if (dn2 === 'Head') pc = SKIN;
      else if (/Hand|ForeArm|Thumb|Index/.test(dn2)) pc = SKIN;
      else if (/UpLeg|Leg$/.test(dn2)) pc = cy < 0.1 ? SHOE : PANTS;
      else if (/Foot|Toe/.test(dn2)) pc = SHOE;
      else if (/Arm$/.test(dn2)) pc = Math.abs(cx) > 0.34 ? SKIN : SHIRT;
      else if (dn2 === 'Hips' || (/^Spine$/.test(dn2) && cy < 1.0)) pc = cy > 0.98 ? SHIRT : PANTS;
      else if (/Spine|Shoulder|Neck/.test(dn2)) pc = (cy > 1.488 && Math.abs(cx) < 0.075) ? SKIN : SHIRT;
      else pc = SKIN;
      var cid = pc === SKIN ? 0 : pc === SHIRT ? 1 : pc === PANTS ? 2 : 3;
      tv.forEach(function (v) {
        var dk = v * 4 + cid;
        if (dupMap[dk] !== undefined) { idx.push(dupMap[dk]); return; }
        var id = P.length / 3; dupMap[dk] = id; P.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); NR.push(NR[v * 3], NR[v * 3 + 1], NR[v * 3 + 2]);
        for (var k2 = 0; k2 < 4; k2++) { BI.push(BI[v * 4 + k2]); BW.push(BW[v * 4 + k2]); }
        var vy = P[v * 3 + 1], g = 1;
        if (pc === SHIRT) g = 0.74 + 0.4 * Math.min(1, Math.max(0, (vy - 0.98) / 0.52));
        else if (pc === PANTS) g = 0.7 + 0.45 * Math.min(1, Math.max(0, (vy - 0.1) / 0.85));
        else if (pc === SKIN) g = 0.88 + 0.12 * Math.min(1, Math.max(0, (vy - 0.9) / 0.8));
        else if (pc === SHOE) g = 0.8 + 0.4 * Math.min(1, Math.max(0, vy / 0.1));
        COL.push(Math.min(1, pc[0] * g), Math.min(1, pc[1] * g), Math.min(1, pc[2] * g)); MAT.push(0); UV.push(0, 0); idx.push(id);
      });
    }
    // --- detail wajah dude asli ---
    FACE = []; FACEB = []; FACEN = [];
    var nclo = P.length / 3, nf = 0;
    function poly(bone, pts, col, nrm) {
      var base = nclo + nf;
      pts.forEach(function (p) { FACE.push(p[0], p[1], p[2], col); FACEB.push(bone); FACEN.push(nrm || [0, 0, -1]); });
      for (var k3 = 1; k3 + 1 < pts.length; k3++) idx.push(base, base + k3, base + k3 + 1);
      nf += pts.length;
    }
    var rect = function (bone, x0, y0, x1, y1, z, col) { poly(bone, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], col); };
    var H = BONE.Head, S2 = BONE.Spine2, fz = -0.1;
    rect(H, -0.08, 1.545, 0.08, 1.735, fz + 0.004, SKIN);
    rect(H, -0.062, 1.655, -0.022, 1.7, fz - 0.002, [1, 1, 1]); rect(H, 0.022, 1.655, 0.062, 1.7, fz - 0.002, [1, 1, 1]);
    rect(H, -0.05, 1.66, -0.03, 1.69, fz - 0.004, [0.1, 0.1, 0.14]); rect(H, 0.03, 1.66, 0.05, 1.69, fz - 0.004, [0.1, 0.1, 0.14]);
    rect(H, -0.032, 1.585, 0.032, 1.6, fz - 0.002, [0.45, 0.12, 0.12]);
    rect(H, -0.07, 1.708, -0.016, 1.718, fz - 0.003, [0.25, 0.15, 0.08]); rect(H, 0.016, 1.708, 0.07, 1.718, fz - 0.003, [0.25, 0.15, 0.08]);
    function box(bone, x0, y0, z0, x1, y1, z1, col) {
      poly(bone, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], col, [0, 0, -1]);
      poly(bone, [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], col, [0, 0, 1]);
      poly(bone, [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], col, [-1, 0, 0]);
      poly(bone, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], col, [1, 0, 0]);
      poly(bone, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], col, [0, 1, 0]);
      poly(bone, [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], col, [0, -1, 0]);
    }
    var CAP = [0.75, 0.12, 0.12];
    box(H, -0.098, 1.728, -0.108, 0.098, 1.80, 0.108, CAP);
    box(H, -0.082, 1.80, -0.09, 0.082, 1.82, 0.09, [0.88, 0.2, 0.2]);
    box(H, -0.085, 1.728, -0.205, 0.085, 1.738, -0.105, [0.55, 0.08, 0.08]);
    var n = nclo, out = new Float32Array((n + nf) * 12);
    for (i = 0; i < n; i++) { out[i * 12 + 6] = UV[i * 2]; out[i * 12 + 7] = UV[i * 2 + 1]; out[i * 12 + 11] = MAT[i]; }
    for (i = 0; i < nf; i++) out[(n + i) * 12 + 11] = 0;
    CH = { n: n, nf: nf, pos: new Float32Array(P), nor: new Float32Array(NR), BI: new Uint8Array(BI), BW: new Uint8Array(BW), out: out, col: new Float32Array(COL), bones: c.bones, M: new Float32Array(NBONE * 16), rot: [], head: BONE.Head };
    for (i = 0; i < NBONE; i++) CH.rot.push([0, 0, 0]);
    chIbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chIbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    CH.ni = idx.length; CH.tex = getTex(c.part.tex, A3D.tex);
  }
  function setRot(name, rx, ry, rz) { var r = CH.rot[BONE[name]]; if (r) { r[0] = rx || 0; r[1] = ry || 0; r[2] = rz || 0; } }
  // pose: ph = fase langkah, mv = 0..1, pitch = arah bidik, sw = fraksi ayunan melee (0..1, <0 = tidak ada), melee
  function poseChar(ph, mv, pitch, sw, melee, sc, sp) {
    var i, c = CH, a = mv * 0.7 * Math.sin(ph), arc = sw >= 0 && sw <= 1 ? sw : -1;
    for (i = 0; i < NBONE; i++) { c.rot[i][0] = c.rot[i][1] = c.rot[i][2] = 0; }
    setRot('LeftUpLeg', a, 0, 0); setRot('RightUpLeg', -a, 0, 0);
    setRot('LeftLeg', -mv * 0.85 * Math.max(0, Math.cos(ph)), 0, 0); setRot('RightLeg', -mv * 0.85 * Math.max(0, -Math.cos(ph)), 0, 0);
    setRot('LeftFoot', mv * 0.25 * Math.max(0, Math.cos(ph)), 0, 0); setRot('RightFoot', mv * 0.25 * Math.max(0, -Math.cos(ph)), 0, 0);
    setRot('Spine', pitch * 0.12, mv * 0.08 * Math.sin(ph), 0); setRot('Spine2', pitch * 0.18, 0, 0);
    setRot('Head', pitch * 0.5, 0, 0);
    var up = pitch * 0.75 - 0.55, chop = 0;
    if (arc >= 0) chop = (1 - 2 * arc) * 1.1 * Math.sin(Math.PI * Math.min(1, arc * 1.05));
    if (melee) up += 0.25;
    setRot('LeftArm', up + chop, melee ? -1.3 : -1.25, 0); setRot('RightArm', up + chop, melee ? 1.3 : 1.12, 0);
    setRot('LeftForeArm', 0, melee ? -0.5 : -1.0, 0); setRot('RightForeArm', 0, melee ? 0.5 : 0.7, 0);
    setRot('LeftHand', 0, 0, 0.15); setRot('RightHand', 0, 0, -0.15);
    if (melee) {
      setRot('RightArm', 0.0 + chop * 0.6, 1.2, -0.3); setRot('RightForeArm', 0, 0.15, 0); setRot('RightHand', 0, 0, 0);
      setRot('LeftArm', 0, 0, 1.2); setRot('LeftForeArm', 0, -0.35, 0); setRot('LeftHand', 0, 0, 0);
      setRot('Spine', pitch * 0.12, 0.25 + mv * 0.08 * Math.sin(ph), 0);
    }
    if (sc > 0.01 || sp > 0.01) {
      var lg = Math.max(sc, sp), wk = 1 - lg;
      setRot('LeftUpLeg', a * wk * 0.5 + sc * 1.35, 0, 0); setRot('RightUpLeg', -a * wk * 0.5 + sc * 1.35, 0, 0);
      setRot('LeftLeg', -sc * 1.9 - sp * 0.1, 0, 0); setRot('RightLeg', -sc * 1.9 - sp * 0.1, 0, 0);
      setRot('LeftFoot', sc * 0.5, 0, 0); setRot('RightFoot', sc * 0.5, 0, 0);
      if (sp > 0.01) { setRot('LeftUpLeg', a * 0.4, 0, 0.12 * sp); setRot('RightUpLeg', -a * 0.4, 0, -0.12 * sp); }
      setRot('Spine', pitch * 0.12 + sc * 0.35, 0, 0);
    }
    var M = c.M, tmp, k, b, par, R, p;
    for (k = 0; k < NBONE; k++) {
      b = c.bones[k]; p = b;
      R = mul(mRx(c.rot[k][0]), mul(mRy(c.rot[k][1]), mRz(c.rot[k][2])));
      tmp = mul(mT(p.x, p.y, p.z), mul(R, mT(-p.x, -p.y, -p.z)));
      if (b.p >= 0) { var pm = new Array(16), j; for (j = 0; j < 16; j++) pm[j] = M[b.p * 16 + j]; tmp = mul(pm, tmp); }
      for (var q = 0; q < 16; q++) M[k * 16 + q] = tmp[q];
    }
  }
  function skinChar(tint, ice) {
    var iw = ice ? 0.62 : 0, ik = 1 - iw;
    var c = CH, M = c.M, P = c.pos, N = c.nor, BI = c.BI, BW = c.BW, out = c.out, n = c.n, i, k;
    for (i = 0; i < n; i++) {
      var x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      var px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
      for (k = 0; k < 4; k++) {
        var w = BW[i * 4 + k]; if (!w) continue; w /= 255;
        var m = BI[i * 4 + k] * 16;
        px += w * (M[m] * x + M[m + 4] * y + M[m + 8] * z + M[m + 12]);
        py += w * (M[m + 1] * x + M[m + 5] * y + M[m + 9] * z + M[m + 13]);
        pz += w * (M[m + 2] * x + M[m + 6] * y + M[m + 10] * z + M[m + 14]);
        qx += w * (M[m] * nx + M[m + 4] * ny + M[m + 8] * nz);
        qy += w * (M[m + 1] * nx + M[m + 5] * ny + M[m + 9] * nz);
        qz += w * (M[m + 2] * nx + M[m + 6] * ny + M[m + 10] * nz);
      }
      var o = i * 12;
      out[o] = px; out[o + 1] = py; out[o + 2] = pz; out[o + 3] = qx; out[o + 4] = qy; out[o + 5] = qz;
      out[o + 8] = c.col[i * 3] * ik + 0.55 * iw; out[o + 9] = c.col[i * 3 + 1] * ik + 0.85 * iw; out[o + 10] = c.col[i * 3 + 2] * ik + 1 * iw;
    }
    for (i = 0; i < c.nf; i++) {
      var fx0 = FACE[i * 4], fy0 = FACE[i * 4 + 1], fz0 = FACE[i * 4 + 2], fc = FACE[i * 4 + 3], o2 = (n + i) * 12, h = FACEB[i] * 16, fn = FACEN[i];
      out[o2] = M[h] * fx0 + M[h + 4] * fy0 + M[h + 8] * fz0 + M[h + 12];
      out[o2 + 1] = M[h + 1] * fx0 + M[h + 5] * fy0 + M[h + 9] * fz0 + M[h + 13];
      out[o2 + 2] = M[h + 2] * fx0 + M[h + 6] * fy0 + M[h + 10] * fz0 + M[h + 14];
      out[o2 + 3] = M[h] * fn[0] + M[h + 4] * fn[1] + M[h + 8] * fn[2]; out[o2 + 4] = M[h + 1] * fn[0] + M[h + 5] * fn[1] + M[h + 9] * fn[2]; out[o2 + 5] = M[h + 2] * fn[0] + M[h + 6] * fn[1] + M[h + 10] * fn[2];
      out[o2 + 8] = fc[0] * ik + 0.55 * iw; out[o2 + 9] = fc[1] * ik + 0.85 * iw; out[o2 + 10] = fc[2] * ik + iw;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, chBuf);
    gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
    bindVB(chBuf); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chIbo);
    gl.bindTexture(gl.TEXTURE_2D, c.tex);
    gl.drawElements(gl.TRIANGLES, c.ni, gl.UNSIGNED_SHORT, 0);
  }

  // ================= state =================
  var S = {
    ws: null, id: 0, playing: false, paused: false, alive: false, hp: 100, kills: 0, deaths: 0,
    killLimit: 15, matchOver: false, bots: 0, diff: 1, x: 0, y: 0, z: 0, vy: 0, onGround: true, yaw: 0, pitch: 0, ping: 30,
    lo: DEF_LO.slice(), slot: 0, mag: [0, 0, 0, 0], res: [0, 0, 0, 0], gren: [2, 2, 2], held: -1, throwT: 0, frozenUntil: 0, lastNade: 0, reloading: false, reloadEnd: 0, reloadStart: 0,
    climb: false, stance: 0, eyeH: 1.55, switchEnd: 0, ads: false, adsT: 0, latch: false, lastFire: [0, 0, 0, 0], swingT: -999, deathAt: 0, killer: -1, killerW: 0
  };
  var pick = DEF_LO.slice();    // pilihan di lobi
  var roster = {}, remotes = {};
  var keys = {}, fireHeld = false, jumpQueued = false, stick = { x: 0, y: 0 };
  var beams = [], sparks = [], dmgDirs = [];
  var mmCan = null, mmCtx = null, mmN = 0;
  var nadeSt = {}, booms = [], smokeZ = [], froz = {};
  var recoil = 0, flashT = 0, flashA = 0, hitT = -999, hitKill = false, hitHead = false, muzzleT = 0, bobT = 0;
  var W = 0, H = 0, DPR = 1, VP = null, eyeNow = [0, 0, 0], fovNow = 1.2;
  var menuMode = 'join';   // 'join' | 'change'
  function menuOpen() { return $('menu').classList.contains('show') || $('wpanel').classList.contains('show') || $('hpanel').classList.contains('show') || $('gpanel').classList.contains('show'); }
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
  var LOBBY = { x: MAP.lobby[0], z: MAP.lobby[1], yaw: MAP.lobby[2] };
  var lobbyChar = { w: 0, fl: -999, col: [0.86, 0.5, 0.45] };

  WP[14] = { name: 'Granat', slot: 3, key: '', snd: [200, 0.2, 'sawtooth', 0.2, 0.5] };
  function wdef() { return WP[S.lo[S.slot]]; }
  function slotOf(w) { return WP[w].slot; }
  try {
    var sv = JSON.parse(localStorage.getItem('arena_lo') || 'null');
    if (sv && sv.length === 3 && WP[sv[0]] && WP[sv[0]].slot === 0 && WP[sv[1]] && WP[sv[1]].slot === 1 && WP[sv[2]] && WP[sv[2]].slot === 2) sv = [sv[0], sv[0] === 10 ? 0 : 10, sv[1], sv[2]];
    if (sv && sv.length === 4 && sv.every(function (w, i) { return WP[w] && WP[w].slot === LOSLOT[i]; }) && sv[0] !== sv[1]) pick = sv;
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
  var R = 0.4, STEP = 0.8, HEIGHT = 1.8;
  function moveLocal(dt) {
    var fwd = 0, str = 0;
    if (keys.KeyW || keys.ArrowUp) fwd += 1;
    if (keys.KeyS || keys.ArrowDown) fwd -= 1;
    if (keys.KeyD || keys.ArrowRight) str += 1;
    if (keys.KeyA || keys.ArrowLeft) str -= 1;
    fwd += -stick.y; str += stick.x;
    var fz = performance.now() < S.frozenUntil;
    if (fz) { fwd = 0; str = 0; jumpQueued = false; }
    var l = Math.hypot(fwd, str); if (l > 1) { fwd /= l; str /= l; }
    var run = keys.ShiftLeft || keys.ShiftRight || (isTouch && l > 0.9);
    S.eyeH += (EYE_ST[S.stance] - S.eyeH) * Math.min(1, dt * 12);
    if (S.climb) S.stance = 0;
    var sp = (run && S.stance === 0 ? 8.6 : 6.4) * SPD_ST[S.stance] * wdef().speed * (1 - 0.4 * S.adsT);
    var sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
    var vx = (-sy * fwd + cy * str) * sp, vz = (-cy * fwd - sy * str) * sp;
    // ---- tangga (kincir angin): maju = naik, mundur = turun, lompat = lepas ----
    var LD = MAP.ladders && MAP.ladders[0];
    if (LD) {
      var lxf = function (y) { return LD.x0 + LD.sx * y - 0.45; }, lzf = function (y) { return LD.z0 + LD.sz * y; };
      if (!S.climb) {
        var near = S.y <= LD.top && Math.hypot(S.x - lxf(S.y), S.z - lzf(S.y)) < 1.1;
        if (near && !S.laddHint && S.playing) { S.laddHint = true; toast('Hadap tangga + maju untuk memanjat'); }
        if (!near) S.laddHint = false;
        if (near && fwd > 0.3 && -sy > 0.25) { S.climb = true; S.vy = 0; S.onGround = false; }
      }
      if (S.climb) {
        if (keys.Space || jumpQueued) { S.stance = 0; S.climb = false; S.vy = 6; S.x -= 0.6; jumpQueued = false; S.onGround = false; }
        else {
          S.y += fwd * 3.2 * dt;
          if (S.y >= LD.top) S.y = LD.top;
          if (S.y <= 0) { S.y = 0; if (fwd < 0) S.climb = false; }
          if (S.climb) { S.x = lxf(S.y); S.z = lzf(S.y); S.vy = 0; S.moving = Math.abs(fwd) > 0.1; return; }
        }
      }
    }
    var nx = S.x + vx * dt;
    if (!MAP.blocked(nx, S.z, S.y)) S.x = nx;
    var nz = S.z + vz * dt;
    if (!MAP.blocked(S.x, nz, S.y)) S.z = nz;
    var BD = MAP.bounds;
    S.x = Math.max(BD[0] + R, Math.min(BD[1] - R, S.x)); S.z = Math.max(BD[2] + R, Math.min(BD[3] - R, S.z));
    S.moving = l > 0.1;
    if ((keys.Space || jumpQueued) && S.onGround && !fz) { S.vy = 7.6; S.onGround = false; }
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
    for (var i = 0; i < 4; i++) { S.mag[i] = WP[lo[i]].mag; S.res[i] = WP[lo[i]].res; S.lastFire[i] = 0; }
    S.gren = [2, 2, 2]; S.held = -1; S.frozenUntil = 0; updateNadeBtns();
    S.reloading = false; S.ads = false; S.adsT = 0; S.switchEnd = performance.now() + 300; S.latch = false;
    buildSlots();
  }

  function onMsg(m) {
    var now = performance.now(), i;
    switch (m.t) {
      case 'welcome':
        if (m.map && m.map !== MAP.id && window.MAPS && window.MAPS[m.map]) { location.replace(location.pathname + '?map=' + m.map); return; }
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
          var lb = r.buf[r.buf.length - 1], st = p[11] | 0;
          if (!lb || lb.x !== p[1] || lb.y !== p[2] || lb.z !== p[3] || lb.yaw !== p[4] || lb.pitch !== p[5] || lb.st !== st) {
            if (!r.tl || now - r.tl > 250) { r.tt = now; r.avg = 40; }
            else { r.avg += (Math.min(now - r.tl, 100) - r.avg) * 0.15; r.tt += r.avg; r.tt += (now - r.tt) * 0.05; if (r.tt > now) r.tt = now; if (r.tt < now - 120) r.tt = now - 120; }
            r.tl = now;
            r.buf.push({ t: r.tt, x: p[1], y: p[2], z: p[3], yaw: p[4], pitch: p[5], st: st });
            if (r.buf.length > 24) r.buf.shift();
          }
          r.hp = p[6]; r.alive = !!p[7]; r.kills = p[8]; r.deaths = p[9]; r.w = p[10] >= 0 ? p[10] : r.w;
        }
        break;
      case 'respawn':
        S.climb = false; S.stance = 0; S.eyeH = EYE;
        S.x = m.x; S.y = m.y; S.z = m.z; S.yaw = m.yaw; S.pitch = 0; S.vy = 0; S.onGround = true;
        S.alive = true; S.hp = 100; fireHeld = false; S.frozenUntil = 0; S.held = -1; updateNadeBtns(); froz = {};
        if (m.lo) setLoadout(m.lo);
        if (m.g) { S.gren = m.g.slice(); updateNadeBtns(); }
        dmgDirs.length = 0;
        show('dead', false);
        break;
      case 'n':
        m.l.forEach(function (a) {
          var g = nadeSt[a[0]] || (nadeSt[a[0]] = { k: a[1], x: a[2], y: a[3], z: a[4] });
          g.tx = a[2]; g.ty = a[3]; g.tz = a[4]; g.seen = now;
        });
        Object.keys(nadeSt).forEach(function (k2) { if (nadeSt[k2].seen !== now) delete nadeSt[k2]; });
        break;
      case 'throw':
        if (m.id !== S.id) beep(260, 0.06, 'triangle', 0.08, 0.6);
        break;
      case 'boom': addBoom(m, now); break;
      case 'freeze':
        if (m.id === S.id) { S.frozenUntil = now + m.ms; fireHeld = false; S.ads = false; beep(1500, 0.25, 'sine', 0.15, 0.4); }
        else froz[m.id] = now + m.ms;
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
          S.alive = false; S.climb = false; S.stance = 0; S.hp = 0; S.held = -1; updateNadeBtns(); fireHeld = false; S.ads = false; S.deathAt = now; S.killer = m.a; S.killerW = m.w; S.spec = m.a;
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
        S.matchOver = false; show('win', false); show('dead', false); $('feed').innerHTML = ''; nadeSt = {}; booms = []; smokeZ = [];
        break;
    }
  }

  // ================= granat =================
  function updateNadeBtns() {
    for (var k = 0; k < 3; k++) {
      var b = $('bN' + k); if (!b) continue;
      b.lastElementChild.textContent = S.gren[k];
      b.classList.toggle('empty', S.gren[k] <= 0);
      b.classList.toggle('held', S.held === k);
    }
  }
  // tekan tombol granat = pegang dulu; tekan lagi = batal; tembak = lempar
  function equipNade(k) {
    var now = performance.now();
    if (!S.playing || !S.alive || S.paused || S.matchOver || now < S.frozenUntil) return;
    if (S.held === k) { S.held = -1; updateNadeBtns(); return; }
    if (S.gren[k] <= 0) { toast('Granat habis'); return; }
    S.held = k; S.reloading = false; S.ads = false; S.switchEnd = now + 220; S.latch = true; updateNadeBtns();
    beep(380, 0.05, 'triangle', 0.06, 0.6);
  }
  function throwNade(k) {
    var now = performance.now();
    if (!S.playing || !S.alive || S.paused || S.matchOver || now < S.frozenUntil || S.gren[k] <= 0 || now - S.lastNade < 650) return;
    S.lastNade = now; S.gren[k]--; S.throwT = now; S.held = -1; S.noFire = true;
    var d = dirOf(S.yaw, S.pitch);
    send({ t: 'nade', k: k, dx: d[0], dy: d[1], dz: d[2] });
    updateNadeBtns();
    beep(220, 0.08, 'triangle', 0.1, 0.6);
  }
  // model granat (detail): k 0 = ledak, 1 = asap, 2 = beku
  function nadeParts(k, arr) {
    function o(cx, cy, cz, hx, hy, hz, col, yaw) { pushBox(arr, 0, 0, 0, yaw || 0, cx, cy, cz, hx, hy, hz, col, false); }
    var i, steel = [0.62, 0.64, 0.68], dark = [0.16, 0.17, 0.19], brass = [0.85, 0.7, 0.25];
    if (k === 0) {
      var g1 = [0.30, 0.42, 0.20], g2 = [0.22, 0.32, 0.15];
      o(0, 0, 0, 0.034, 0.05, 0.034, g1); o(0, 0, 0, 0.034, 0.05, 0.034, g1, 0.785);
      o(0, 0.03, 0, 0.026, 0.03, 0.026, g1); o(0, 0.03, 0, 0.026, 0.03, 0.026, g1, 0.785);
      o(0, -0.03, 0, 0.028, 0.03, 0.028, g1); o(0, -0.03, 0, 0.028, 0.03, 0.028, g1, 0.785);
      for (i = -2; i <= 2; i++) { o(0, i * 0.022, 0, 0.0365, 0.004, 0.0365, g2); o(0, i * 0.022, 0, 0.0365, 0.004, 0.0365, g2, 0.785); }
      for (i = -1; i <= 1; i += 2) { o(i * 0.0185, 0, 0, 0.003, 0.06, 0.0365, g2, 0.2 * i); o(0, 0, i * 0.0185, 0.0365, 0.06, 0.003, g2); }
      o(0, 0.064, 0, 0.016, 0.014, 0.016, steel); o(0, 0.078, 0, 0.011, 0.008, 0.011, dark);
      o(0.03, 0.01, 0, 0.005, 0.07, 0.013, steel);                 // tuas pengaman
      o(0.02, 0.078, 0, 0.018, 0.005, 0.012, steel);
      o(-0.022, 0.07, 0.0, 0.012, 0.003, 0.012, brass); o(-0.034, 0.07, 0, 0.003, 0.003, 0.009, brass); o(-0.022, 0.07, 0.009, 0.012, 0.003, 0.003, brass); o(-0.022, 0.07, -0.009, 0.012, 0.003, 0.003, brass); // cincin pin
    } else if (k === 1) {
      var gr = [0.55, 0.57, 0.6], wh = [0.92, 0.92, 0.94];
      o(0, 0, 0, 0.03, 0.07, 0.03, gr); o(0, 0, 0, 0.03, 0.07, 0.03, gr, 0.785);
      o(0, 0.02, 0, 0.0325, 0.012, 0.0325, wh); o(0, 0.02, 0, 0.0325, 0.012, 0.0325, wh, 0.785);
      o(0, -0.02, 0, 0.0325, 0.006, 0.0325, [0.8, 0.25, 0.2]); o(0, -0.02, 0, 0.0325, 0.006, 0.0325, [0.8, 0.25, 0.2], 0.785);
      o(0, 0.076, 0, 0.024, 0.008, 0.024, dark); o(0, 0.076, 0, 0.024, 0.008, 0.024, dark, 0.785);
      o(0, 0.09, 0, 0.012, 0.01, 0.012, steel);
      for (i = 0; i < 4; i++) o(Math.cos(i * 1.571) * 0.014, 0.085, Math.sin(i * 1.571) * 0.014, 0.005, 0.004, 0.005, dark);
      o(0.034, 0.02, 0, 0.004, 0.065, 0.012, steel); o(0.02, 0.092, 0, 0.016, 0.004, 0.011, steel);
      o(-0.02, 0.095, 0, 0.011, 0.003, 0.011, brass); o(-0.03, 0.095, 0, 0.003, 0.003, 0.008, brass);
    } else {
      var ic = [0.45, 0.78, 0.95], ic2 = [0.8, 0.95, 1];
      o(0, 0, 0, 0.036, 0.05, 0.036, ic); o(0, 0, 0, 0.036, 0.05, 0.036, ic, 0.785);
      o(0, 0.03, 0, 0.026, 0.03, 0.026, ic2); o(0, 0.03, 0, 0.026, 0.03, 0.026, ic2, 0.785);
      o(0, -0.03, 0, 0.026, 0.03, 0.026, ic2); o(0, -0.03, 0, 0.026, 0.03, 0.026, ic2, 0.785);
      o(0, 0, 0, 0.0385, 0.008, 0.0385, [1, 1, 1]); o(0, 0, 0, 0.0385, 0.008, 0.0385, [1, 1, 1], 0.785);
      for (i = 0; i < 6; i++) { var an = i * 1.047; o(Math.cos(an) * 0.038, (i % 2 ? 0.02 : -0.018), Math.sin(an) * 0.038, 0.007, 0.018, 0.007, ic2, an); }
      o(0, 0.066, 0, 0.016, 0.014, 0.016, steel); o(0, 0.08, 0, 0.011, 0.008, 0.011, dark);
      o(0.036, 0.01, 0, 0.005, 0.07, 0.013, steel); o(0.022, 0.08, 0, 0.018, 0.005, 0.012, steel);
      o(-0.022, 0.072, 0, 0.012, 0.003, 0.012, brass); o(-0.034, 0.072, 0, 0.003, 0.003, 0.009, brass);
    }
  }
  function addBoom(m, now) {
    var k = m.k, i, dist = Math.hypot(m.x - S.x, m.z - S.z), vol = Math.max(0, 1 - dist / 70);
    if (k === 0) {
      var cols = [[1, 0.62, 0.1], [1, 0.85, 0.2], [0.95, 0.35, 0.08], [0.3, 0.28, 0.26]];
      for (i = 0; i < 34; i++) {
        var a = Math.random() * 6.283, b = Math.random() * 2 - 0.6, sp = 3 + Math.random() * 8, cs = Math.sqrt(Math.max(0, 1 - b * b));
        booms.push({ p: [m.x, m.y + 0.3, m.z], v: [Math.cos(a) * cs * sp, b * sp + 2, Math.sin(a) * cs * sp], c: cols[(Math.random() * 4) | 0], t: now, life: 650 + Math.random() * 350, sz: 0.12 + Math.random() * 0.16 });
      }
      for (i = 0; i < 6; i++) booms.push({ p: [m.x, m.y + 0.5, m.z], v: [(Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2], c: [1, 0.95, 0.7], t: now, life: 160, sz: 0.9 });
      beep(70, 0.55, 'sawtooth', 0.35 * vol, 0.25);
      if (dist < 12) { flashA = Math.min(1, 0.5 * (1 - dist / 12)); flashT = now; }
    } else if (k === 1) {
      var offs = [];
      for (i = 0; i < 26; i++) {
        var r2 = 4.2 * Math.cbrt(Math.random()), a2 = Math.random() * 6.283, b2 = Math.random() * 2 - 1, c2 = Math.sqrt(1 - b2 * b2);
        offs.push([Math.cos(a2) * c2 * r2, Math.max(-0.4, b2 * r2 * 0.6) + 1.2, Math.sin(a2) * c2 * r2, 0.85 + Math.random() * 0.7, 0.72 + Math.random() * 0.2]);
      }
      smokeZ.push({ x: m.x, y: m.y, z: m.z, t: now, ms: m.ms || 12000, offs: offs });
      beep(500, 0.3, 'sawtooth', 0.12 * vol, 0.4);
    } else {
      for (i = 0; i < 36; i++) {
        var a3 = Math.random() * 6.283, sp3 = 2 + Math.random() * 6;
        booms.push({ p: [m.x, m.y + 0.3, m.z], v: [Math.cos(a3) * sp3, 1 + Math.random() * 4, Math.sin(a3) * sp3], c: Math.random() < 0.5 ? [0.7, 0.92, 1] : [1, 1, 1], t: now, life: 700 + Math.random() * 500, sz: 0.1 + Math.random() * 0.14 });
      }
      beep(1800, 0.35, 'sine', 0.2 * vol, 0.3);
    }
  }
  function onShot(m, now) {
    var o = m.o, e = m.e, w = WP[m.w], self = m.id === S.id, i;
    var r = remotes[m.id];
    if (r) { r.fired = now; r.fl = now; }
    var d = Math.hypot(o[0] - S.x, o[2] - S.z);
    if (!self) gunSound(m.w, Math.max(0, 1 - d / 60));
    var melee = w.slot === 2, life = (w.key === 'sniper' || w.key === 'l118' || w.key === 'dmr') ? 170 : 90;
    for (i = 0; i < e.length; i++) {
      var end = e[i], st;
      if (!melee) {
        if (self) {
          var dir = dirOf(S.yaw, S.pitch), rx = Math.cos(S.yaw), rz = -Math.sin(S.yaw);
          var upx = -rz * dir[1], upy = rz * dir[0] - rx * dir[2], upz = rx * dir[1], mq = vmMuz;
          st = [S.x + rx * mq[0] + upx * mq[1] - dir[0] * mq[2], S.y + S.eyeH + upy * mq[1] - dir[1] * mq[2], S.z + rz * mq[0] + upz * mq[1] - dir[2] * mq[2]];
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
  var PAPAN = $('papanImg') ? $('papanImg').src : '';
  function updateScoreboard() {
    var rs = rows(), hr = [], i;
    if (sbFull) {
      rs.forEach(function (r, i) {
        hr.push('<div class="r' + (r.me ? ' me' : '') + '"><span class="p">' + (i + 1) + '</span><span class="n">' + esc(r.name) + (r.bot ? '<span class="tg">BOT</span>' : '') + '</span><span class="k">' + r.k + '</span><span class="d">' + r.d + '</span></div>');
      });
      hr.unshift('<div class="tl">Target ' + S.killLimit + ' kill</div>');
    } else {
      var pick = rs.slice(0, 3), mine = rs.findIndex(function (r) { return r.me; });
      var idx = [0, 1, 2].filter(function (k) { return k < rs.length; });
      if (mine >= 3) idx[2] = mine;
      idx.forEach(function (k) {
        var r = rs[k];
        hr.push('<div class="r' + (r.me ? ' me' : '') + '"><span class="p">' + (k + 1) + '</span><span class="n">' + esc(r.name) + '</span><span class="k">' + r.k + '</span></div>');
      });
      for (i = idx.length; i < 3; i++) hr.push('<div class="r e"></div>');
    }
    var h = hr.join('');
    var key = (sbFull ? 'F' : 'S') + h;
    sb.className = sbFull ? 'full' : '';
    if (key !== lastSb) { lastSb = key; sb.innerHTML = h; }
  }
  var lastSb = '';
  function buildSlots() {
    var h = '';
    for (var i = 0; i < 4; i++) h += '<div class="slot' + (i === S.slot ? ' on' : '') + '" data-s="' + i + '"><u>' + (i + 1) + '</u><b>' + esc(WP[S.lo[i]].name) + '</b><i></i></div>';
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
    var frEl = $('frost');
    if (frEl) { var fl = S.frozenUntil - now; if (fl > 0) { frEl.style.opacity = Math.min(1, fl / 400).toFixed(2); $('frostT').textContent = (fl / 1000).toFixed(1); } else frEl.style.opacity = 0; }
    var rel = $('rel');
    if (S.reloading) { rel.style.visibility = 'visible'; $('relf').style.width = Math.min(100, (now - S.reloadStart) / (S.reloadEnd - S.reloadStart) * 100) + '%'; }
    else rel.style.visibility = 'hidden';
    if (sbHold && now > sbHold) { sbHold = 0; sbFull = false; }
    updateScoreboard();
    document.body.classList[S.alive ? 'remove' : 'add']('isdead');
    if (!S.alive) {
      var left = Math.max(0, 3 - (now - S.deathAt) / 1000), rdy = !S.matchOver && left <= 0;
      $('dsub').textContent = S.matchOver ? 'Ronde selesai' : (rdy ? 'Siap hidup kembali' : 'Hidup dalam ' + Math.ceil(left) + ' detik lagi');
      $('dhidup').classList[rdy ? 'add' : 'remove']('rdy');
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
      h += '<div class="r' + (r.me ? ' me' : '') + (i === 0 ? ' first' : '') + '"><span class="n"><b class="rk">' + (i + 1) + '</b>' + esc(r.name) + (r.bot ? ' · bot' : '') + '</span><span class="k">' + r.k + '</span><span class="k">' + r.d + '</span></div>';
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
    if (!S.alive || S.matchOver || i === S.slot || i < 0 || i > 3) return;
    S.held = -1; updateNadeBtns();
    S.slot = i; S.reloading = false; S.ads = false; S.switchEnd = performance.now() + 260; S.latch = true;
    beep(420, 0.04, 'triangle', 0.05);
  }
  function startReload(now) {
    var w = wdef();
    if (S.held >= 0) return;
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
    if (!fireHeld) S.noFire = false;
    if (!fireHeld || !S.alive || S.paused || S.matchOver || now < S.switchEnd || S.reloading || now < S.frozenUntil) return;
    if (S.noFire) return;
    if (S.held >= 0) { if (!S.latch) { S.latch = true; throwNade(S.held); } return; }
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
  var INTERP = 110;
  function poseOf(r, now) {
    var b = r.buf; if (!b.length) return null;
    var T = now - INTERP, i;
    if (T <= b[0].t) return b[0];
    for (i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= T) {
        var a = b[i - 1], c = b[i], k = c.t === a.t ? 1 : Math.min(1, (T - a.t) / (c.t - a.t));
        var dy = ((c.yaw - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yaw: a.yaw + dy * k, pitch: a.pitch + (c.pitch - a.pitch) * k, mv: Math.hypot(c.x - a.x, c.z - a.z) / Math.max(1, c.t - a.t) > 0.0006, st: c.st | 0 };
      }
    }
    return b[b.length - 1];
  }

  // ================= render =================
  function resize() {
    rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 11;
    DPR = Math.min(window.devicePixelRatio || 1, isTouch ? 1.25 : 2);
    W = window.innerWidth; H = window.innerHeight;
    var gd = isTouch ? Math.max(0.5, Math.min(window.devicePixelRatio || 1, 1.5) * G.res) : Math.max(0.5, Math.min((window.devicePixelRatio || 1) * G.res, G.res > 1 ? 3 : 2.5));
    fxc.width = Math.round(W * DPR); fxc.height = Math.round(H * DPR);
    glc.width = Math.round(W * gd); glc.height = Math.round(H * gd);
    fx.setTransform(DPR, 0, 0, DPR, 0, 0);
    try { if (stickT == null) setStickUI(false); } catch (e) { /* abaikan */ }
  }
  window.addEventListener('resize', resize);

  // pose + gambar satu pemain (kerangka + senjata di tangan)
  function drawPlayer(id, p, r, now) {
    var tintBase = r.col || BODY[((roster[id] && roster[id].color) || 0) % 8];
    var tint = [0.62 + 0.45 * tintBase[0], 0.62 + 0.45 * tintBase[1], 0.62 + 0.45 * tintBase[2]];
    var w = WP[r.w] || WP[0], melee = w.slot === 2;
    var dt = r.lt ? Math.min(100, now - r.lt) : 16; r.lt = now;
    r.mva = (r.mva || 0) + ((p.mv ? 1 : 0) - (r.mva || 0)) * Math.min(1, dt / 90);
    r.ph = (r.ph || 0) + dt * 0.0105 * r.mva;
    var sw = melee ? (now - r.fl) / 320 : -1;
    var tc = p.st === 1 ? 1 : 0, tp = p.st === 2 ? 1 : 0, kk = Math.min(1, dt / 110);
    r.sc = (r.sc || 0) + (tc - (r.sc || 0)) * kk; r.sp = (r.sp || 0) + (tp - (r.sp || 0)) * kk;
    poseChar(r.ph, r.mva, p.pitch || 0, sw, melee, r.sc, r.sp);
    var base = mul(mT(p.x, p.y - 0.4 * r.sc + 0.14 * r.sp, p.z), mRy(p.yaw));
    if (r.sp > 0.01) base = mul(base, mul(mT(0, 0, 0.85 * r.sp), mRx(-1.5708 * r.sp)));
    setModel(base);
    skinChar(tint, (froz[id] || 0) > now);
    var mdl = WM[w.key];
    if (mdl) {
      var len = mdl.size[2], pit = (p.pitch || 0) * 0.95;
      var wm;
      if (melee) wm = mul(base, mul(mT(0.14, 1.2, -0.46), mul(mRx(0.75), mRy(0))));
      else wm = mul(base, mul(mT(0, 1.38, 0), mul(mRx(pit), mT(0.1, -0.27, -0.45))));
      drawModel(w.key, wm);
      if (!melee && now - r.fl < 60) {
        var fa = [], mz = mdl.muzzle;
        pushBox(fa, 0, 0, 0, 0, mz[0], mz[1], mz[2] - 0.04, 0.03, 0.03, 0.05, [1, 0.88, 0.45], true);
        setModel(wm); drawDyn(fa);
      }
    }
  }

  var vmMuz = [0.17, -0.15, -0.9];
  function render(now) {
    gl.viewport(0, 0, glc.width, glc.height);
    if (S.playing) gl.clearColor(FOG[0], FOG[1], FOG[2], 1); else gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    var aspect = W / H, fov = aspect < 1.1 ? 1.55 : 1.22;
    var ex, ey, ez, tx, ty, tz;
    var cur = S.playing ? wdef() : null;
    if (!S.playing) {
      var ly = LOBBY.yaw, fwx = -Math.sin(ly), fwz = -Math.cos(ly), sdx = Math.cos(ly), sdz = -Math.sin(ly);
      var dist = LOBBY.dist || 3.6, tgy = LOBBY.ty || 1.0;
      ex = LOBBY.x + fwx * dist + sdx * 0.1; ey = LOBBY.dist ? tgy : 1.25; ez = LOBBY.z + fwz * dist + sdz * 0.1;
      tx = LOBBY.x; ty = tgy; tz = LOBBY.z;
      fov = aspect < 1.1 ? 1.2 : 0.85;
    } else {
      var eyeY = S.y + (S.alive ? S.eyeH : 0.45), d = dirOf(S.yaw, S.pitch), sp = null;
      if (!S.alive) {
        var sr = remotes[S.spec];
        if (!sr || !sr.alive) { sr = null; for (var sk in remotes) if (remotes[sk].alive) { S.spec = +sk; sr = remotes[sk]; break; } }
        sp = sr ? poseOf(sr, now) : null;
      }
      if (sp) {
        var cdx = Math.sin(sp.yaw), cdz = Math.cos(sp.yaw);
        ex = sp.x + cdx * 3.2; ey = sp.y + 2.1; ez = sp.z + cdz * 3.2; tx = sp.x; ty = sp.y + 1.2; tz = sp.z;
      } else {
        ex = S.x; ey = eyeY; ez = S.z; tx = ex + d[0]; ty = ey + d[1]; tz = ez + d[2];
      }
      var zoom = 1 + (cur.zoom - 1) * S.adsT;
      fov = 2 * Math.atan(Math.tan(fov / 2) / zoom);
    }
    fovNow = fov;
    eyeNow = [ex, ey, ez];
    var P = persp(fov, aspect, 0.08, 300);
    VP = mul(P, lookAt(ex, ey, ez, tx, ty, tz));
    gl.useProgram(prog);
    gl.uniform3f(loc.light, 0.45, 0.82, 0.35);
    gl.uniformMatrix4fv(loc.vp, false, new Float32Array(VP));
    setModel(IDENT);
    if (S.playing) {
      gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf); bindVB(groundBuf); gl.bindTexture(gl.TEXTURE_2D, whiteTex); gl.drawArrays(gl.TRIANGLES, 0, groundCount);
      for (var mi = 0; mi < mapParts.length; mi++) drawIdx(mapParts[mi]);
    }
    if (!S.playing) {
      var lp = { x: LOBBY.x, y: 0, z: LOBBY.z, yaw: LOBBY.yaw + (LOBBY.twist !== undefined ? LOBBY.twist : Math.sin(now * 0.0009) * 0.35), pitch: 0, mv: false };
      lobbyChar.w = LOBBY.w !== undefined ? LOBBY.w : pick[0];
      drawPlayer('lobby', lp, lobbyChar, now);
      return;
    }

    var arr = [], id, i;
    for (id in remotes) {
      var r = remotes[id]; if (!r.alive) continue;
      var p = poseOf(r, now); if (!p) continue;
      var pdx = p.x - S.x, pdz = p.z - S.z, pd2 = pdx * pdx + pdz * pdz;
      if (S.playing && (pd2 > 8100 || (pd2 > 16 && -Math.sin(S.yaw) * pdx - Math.cos(S.yaw) * pdz < -2))) continue;
      drawPlayer(id, p, r, now);
    }
    setModel(IDENT);
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
    var gcol = [[0.28, 0.4, 0.22], [0.72, 0.72, 0.75], [0.4, 0.82, 1]];
    for (id in nadeSt) {
      var ng = nadeSt[id];
      ng.x += (ng.tx - ng.x) * 0.55; ng.y += (ng.ty - ng.y) * 0.55; ng.z += (ng.tz - ng.z) * 0.55;
      var na = []; nadeParts(ng.k, na);
      setModel(mul(mT(ng.x, ng.y, ng.z), mul(mRy(now * 0.006), mul(mRx(now * 0.011), [1.5, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 1]))));
      drawDyn(na); setModel(IDENT);
    }
    for (i = booms.length - 1; i >= 0; i--) {
      var bo = booms[i], ba = (now - bo.t) / 1000;
      if (ba * 1000 > bo.life) { booms.splice(i, 1); continue; }
      var bf = 1 - ba * 1000 / bo.life, bs = bo.sz * (0.35 + 0.65 * bf);
      pushBox(arr, bo.p[0] + bo.v[0] * ba, bo.p[1] + bo.v[1] * ba - 5 * ba * ba, bo.p[2] + bo.v[2] * ba, 0, 0, 0, 0, bs, bs, bs, bo.c, true);
    }
    for (i = smokeZ.length - 1; i >= 0; i--) {
      var sz = smokeZ[i], sa = now - sz.t;
      if (sa > sz.ms) { smokeZ.splice(i, 1); continue; }
      var grow = Math.min(1, sa / 800), fade = Math.min(1, (sz.ms - sa) / 2000), sc = grow * (0.35 + 0.65 * fade);
      for (var q = 0; q < sz.offs.length; q++) {
        var of = sz.offs[q], hs = of[3] * sc, sh = of[4] * (0.94 + 0.06 * Math.sin(now * 0.001 + q));
        pushBox(arr, sz.x + of[0] * grow, sz.y + of[1] * grow + sa * 0.00004, sz.z + of[2] * grow, q * 0.7 + now * 0.00005, 0, 0, 0, hs, hs, hs, [sh, sh, sh + 0.02], true);
      }
    }
    drawDyn(arr);

    // senjata di tangan (first person)
    var mdl = WM[cur.key], melee = cur.slot === 2;
    if (S.held >= 0 && S.alive) {
      var hb = S.moving && S.onGround ? Math.sin(bobT) * 0.007 : 0, sw2 = Math.max(0, 1 - (now - S.switchEnd + 220) / 220), tt = S.throwT ? Math.max(0, 1 - (now - S.throwT) / 250) : 0;
      var hm = mul(mT(0.11, -0.13 + hb - sw2 * 0.25, -0.5), mul(mRy(-0.5), mul(mRx(0.15), [0.95, 0, 0, 0, 0, 0.95, 0, 0, 0, 0, 0.95, 0, 0, 0, 0, 1])));
      var ha = []; nadeParts(S.held, ha);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(loc.vp, false, new Float32Array(persp(fov, aspect, 0.02, 10)));
      gl.uniform3f(loc.light, 0.3, 0.75, 0.6);
      setModel(hm); drawDyn(ha);
      var fh = []; // tangan (kepalan)
      pushBox(fh, 0, 0, 0, 0, 0, 0, 0, 0.02, 0.018, 0.024, [0.93, 0.74, 0.58], false);
      setModel(mul(mT(0.11, -0.165 + hb - sw2 * 0.25, -0.47), mRy(-0.5))); drawDyn(fh);
      setModel(IDENT);
    } else if (mdl) {
      var sz = mdl.size, len = sz[2], t = S.adsT, vm;
      var bob = S.moving && S.onGround ? Math.sin(bobT) * 0.007 : 0, bobx = S.moving && S.onGround ? Math.cos(bobT * 0.5) * 0.005 : 0;
      var rel = 0;
      if (S.reloading) { var pr = (now - S.reloadStart) / (S.reloadEnd - S.reloadStart); rel = Math.sin(Math.min(1, pr) * Math.PI); }
      if (now < S.switchEnd) rel = Math.max(rel, (S.switchEnd - now) / 260);
      if (melee) {
        var s = Math.max(0, Math.min(1, (now - S.swingT) / 280)), arc = S.swingT > 0 && s < 1 ? Math.sin(s * Math.PI) : 0, e = s < 1 ? s : 0;
        vm = mul(mT(0.24 - 0.3 * arc + bobx, -0.26 + bob - rel * 0.3, -0.5 - 0.1 * arc), mul(mRy(0.15 - 0.9 * arc), mul(mRx(0.75 - (e > 0 ? 1.7 * e : 0)), mRz(-0.12 + 0.5 * arc))));
      } else {
        var cy = lerp(-0.17 - mdl.muzzle[1], -0.012 - mdl.top, t) + bob + recoil * 0.008 - rel * 0.2;
        var cz = lerp(-0.36, -0.24, t) - len / 2 + recoil * 0.05 + rel * 0.04;
        vm = mul(mT(lerp(0.16, 0, t) + bobx, cy, cz), mul(mRx(rel * 0.45 + recoil * 0.02), mRz(rel * 0.25)));
      }
      var mzp = xf(vm, mdl.muzzle); vmMuz = mzp;
      if (S.alive && !(cur.zoom >= 2 && S.adsT > 0.85)) {
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.uniformMatrix4fv(loc.vp, false, new Float32Array(persp(fov, aspect, 0.02, 10)));
        gl.uniform3f(loc.light, 0.3, 0.75, 0.6);
        drawModel(cur.key, vm);
        if (now - muzzleT < 55 && !melee) {
          var fa = [], mz = mdl.muzzle;
          pushBox(fa, 0, 0, 0, 0, mz[0], mz[1], mz[2] - 0.035, 0.028, 0.028, 0.045, [1, 0.88, 0.45], true);
          setModel(vm); drawDyn(fa);
        }
        setModel(IDENT);
      }
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
    var BD = MAP.bounds, w = BD[1] - BD[0], h = BD[3] - BD[2];
    var k = Math.min(MMK, 1024 / Math.max(w, h));
    var tw = Math.round(w * k), th = Math.round(h * k);
    mmLayer = document.createElement('canvas'); mmLayer.width = tw; mmLayer.height = th;
    var c = mmLayer.getContext('2d');
    c.fillStyle = MMCSS; c.fillRect(0, 0, tw, th);
    try {
      var fbo = gl.createFramebuffer(), tex = gl.createTexture(), rb = gl.createRenderbuffer();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, tw, th);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo');
      gl.viewport(0, 0, tw, th);
      gl.clearColor(MMC[0], MMC[1], MMC[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var cx = (BD[0] + BD[1]) / 2, cz = (BD[2] + BD[3]) / 2, ax = 2 / w, az = 2 / h, ay = -1 / 32.5;
      var O = [ax, 0, 0, 0, 0, 0, ay, 0, 0, az, 0, 0, -ax * cx, -az * cz, 27.5 / 32.5, 1];
      gl.useProgram(prog);
      gl.uniform3f(loc.light, 0.45, 0.82, 0.35);
      gl.uniformMatrix4fv(loc.vp, false, new Float32Array(O));
      setModel(IDENT);
      gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf); bindVB(groundBuf); gl.bindTexture(gl.TEXTURE_2D, whiteTex); gl.drawArrays(gl.TRIANGLES, 0, groundCount);
      for (var mi = 0; mi < mapParts.length; mi++) drawIdx(mapParts[mi]);
      var px = new Uint8Array(tw * th * 4);
      gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (var pi = 0; pi < px.length; pi += 4) {
        var pr = px[pi], pg = px[pi + 1], pb = px[pi + 2], mx2 = Math.max(pr, pg, pb), mn2 = Math.min(pr, pg, pb);
        if (MAP.id === 'kota' && mx2 - mn2 < 20 && mx2 > 70) { var l = (pr + pg + pb) / 3; px[pi] = Math.min(255, l * 1.2 + 6); px[pi + 1] = l * 0.72; px[pi + 2] = l * 0.55; }
      }
      var img = c.createImageData(tw, th); img.data.set(px); c.putImageData(img, 0, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteRenderbuffer(rb);
      return;
    } catch (e) {
      try { gl.bindFramebuffer(gl.FRAMEBUFFER, null); } catch (e2) { }
    }
    c.fillStyle = MMCSS; c.fillRect(0, 0, tw, th);
    MAP.boxes.forEach(function (b) {
      if (b[4] - b[1] < 1.2 || b[1] > 1) return;
      c.fillStyle = (b[4] - b[1] > 3) ? '#d9a05f' : '#5fae52';
      c.fillRect((b[0] - BD[0]) * k, (b[2] - BD[2]) * k, Math.max(1, (b[3] - b[0]) * k), Math.max(1, (b[5] - b[2]) * k));
    });
  }
  function rrect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r); c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x, y + h); c.closePath();
  }
  function drawMinimap(now) {
    var u = H / 896, bx = 0, by = 8.6 * u, bw = 312 * u, bh = 226 * u, cx = bx + bw / 2, cy = by + bh / 2, range = 34, sc = (bh / 2) / range * 1.0;
    fx.save();
    rrect(fx, bx, by, bw, bh, 0); fx.clip();
    fx.fillStyle = MMCSS; fx.fillRect(bx, by, bw, bh);
    var cs = Math.cos(S.yaw), sn = Math.sin(S.yaw);
    fx.save();
    fx.translate(cx, cy);
    fx.transform(sc * cs, sc * sn, -sc * sn, sc * cs, 0, 0);
    fx.translate(-S.x, -S.z);
    fx.globalAlpha = 1;
    fx.drawImage(mmLayer, MAP.bounds[0], MAP.bounds[2], MAP.bounds[1] - MAP.bounds[0], MAP.bounds[3] - MAP.bounds[2]);
    fx.restore();
    for (var id in remotes) {
      var r = remotes[id]; if (!r.alive) continue;
      var p = poseOf(r, now); if (!p) continue;
      var dx = p.x - S.x, dz = p.z - S.z, dist = Math.hypot(dx, dz), fired = now - r.fired < 2500;
      if (dist > 40 && !fired) continue;
      var sx = (cs * dx - sn * dz) * sc, sy = (sn * dx + cs * dz) * sc;
      var mx = bw / 2 - 8 * u, my = bh / 2 - 8 * u, k = Math.max(Math.abs(sx) / mx, Math.abs(sy) / my, 1);
      sx /= k; sy /= k;
      fx.fillStyle = '#e8403f'; fx.beginPath(); fx.arc(cx + sx, cy + sy, 5 * u, 0, Math.PI * 2); fx.fill();
    }
    var a = 9 * u;
    fx.fillStyle = '#fff'; fx.beginPath(); fx.moveTo(cx, cy - a * 1.3); fx.lineTo(cx + a, cy + a); fx.lineTo(cx, cy + a * 0.45); fx.lineTo(cx - a, cy + a); fx.closePath(); fx.fill();
    fx.restore();
    // bingkai & kilau minimap (posisi tetap)
    fx.save(); rrect(fx, bx, by, bw, bh, 0);
    fx.lineWidth = 2 * u; fx.strokeStyle = 'rgba(255,255,255,.55)'; fx.stroke();
    fx.lineWidth = 1 * u; fx.strokeStyle = 'rgba(0,0,0,.35)'; rrect(fx, bx + 2 * u, by + 2 * u, bw - 4 * u, bh - 4 * u, 0); fx.stroke();
    fx.restore();
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
      var s = project(p.x, p.y + 2.0 - (p.st === 1 ? 0.4 : p.st === 2 ? 1.5 : 0), p.z); if (!s) continue;
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
    mmN++;
    var u = H / 896, mw = Math.ceil(312 * u + 4), mh = Math.ceil(240 * u);
    if (!mmCan || mmCan.width !== Math.round(mw * DPR) || mmCan.height !== Math.round(mh * DPR)) {
      mmCan = document.createElement('canvas'); mmCan.width = Math.round(mw * DPR); mmCan.height = Math.round(mh * DPR); mmCtx = mmCan.getContext('2d'); mmN = 0;
    }
    if (mmN % 3 === 1) {
      var realFx = fx; fx = mmCtx; fx.setTransform(DPR, 0, 0, DPR, 0, 0); fx.clearRect(0, 0, mw, mh);
      try { drawMinimap(now); } finally { fx = realFx; }
    }
    fx.drawImage(mmCan, 0, 0, mw, mh);
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
        if (now - lastSend > 30) {
          lastSend = now;
          send({ t: 'state', x: +S.x.toFixed(3), y: +S.y.toFixed(3), z: +S.z.toFixed(3), yaw: +S.yaw.toFixed(3), pitch: +S.pitch.toFixed(3), w: S.lo[S.slot], st: S.stance });
        }
      }
      recoil = Math.max(0, recoil - dt * 8);
      if (flashA > 0) { flashA = Math.max(0, 1 - (now - flashT) / 450); $('flash').style.opacity = flashA.toFixed(2); }
      if (now - uiT > 120) { uiT = now; updateHud(now); }
    }
    render(now);
    drawFx(now);
  }

  function toggleStance(n) { if (!S.alive || S.climb) return; S.stance = S.stance === n ? 0 : n; syncStanceBtns(); }
  function syncStanceBtns() { $('bCrouch').classList.toggle('on', S.stance === 1); $('bProne').classList.toggle('on', S.stance === 2); }
  // ================= input PC =================
  document.addEventListener('keydown', function (e) {
    if (!S.playing || e.target.tagName === 'INPUT') return;
    if (e.code === 'Tab') { e.preventDefault(); if (!sbFull) { sbFull = true; updateScoreboard(); } return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
    if (e.code === 'KeyR') startReload(performance.now());
    if (e.code === 'KeyC') toggleStance(1);
    if (e.code === 'KeyZ') toggleStance(2);
    if (e.code === 'Digit1') switchTo(0);
    if (e.code === 'Digit2') switchTo(1);
    if (e.code === 'Digit3') switchTo(2);
    if (e.code === 'Digit4') switchTo(3);
    if (e.code === 'KeyG') equipNade(0);
    if (e.code === 'KeyV') equipNade(1);
    if (e.code === 'KeyB') equipNade(2);
    keys[e.code] = true;
  });
  document.addEventListener('keyup', function (e) {
    if (e.code === 'Tab') { sbFull = false; updateScoreboard(); return; }
    keys[e.code] = false;
  });
  window.addEventListener('blur', function () { keys = {}; fireHeld = false; });
  document.addEventListener('wheel', function (e) {
    if (!S.playing || isTouch) return;
    switchTo((S.slot + (e.deltaY > 0 ? 1 : 3)) % 4);
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
  var tz = $('tz'), lookT = null, stickT = null, stickO = null, STICK_MAX = 50, uu = 1;
  function setStickUI(on, x, y, kx, ky) {
    uu = H / 896; STICK_MAX = 64 * uu;
    if (!on) { x = kx = 242.4 * uu + (window.safeL || 0); y = ky = 665.2 * uu; }
    var bs = 122.6 * uu, ks = 69 * uu;
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
  // geser jari di tombol tembak = tetap bisa membidik sambil menembak
  var fireT = null;
  $('bFire').addEventListener('touchstart', function (e) { var t = e.changedTouches[0]; fireT = { id: t.identifier, x: t.clientX, y: t.clientY }; }, { passive: false });
  $('bFire').addEventListener('touchmove', function (e) {
    e.preventDefault(); e.stopPropagation();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (fireT && t.identifier === fireT.id && S.alive && !S.paused) {
        var sens = 0.0065 / (1 + (wdef().zoom - 1) * S.adsT * 0.8);
        S.yaw -= (t.clientX - fireT.x) * sens;
        S.pitch = Math.max(-1.5, Math.min(1.5, S.pitch - (t.clientY - fireT.y) * sens));
        fireT.x = t.clientX; fireT.y = t.clientY;
      }
    }
  }, { passive: false });
  bindBtn('bN0', function () { equipNade(0); }, function () {});
  bindBtn('bN1', function () { equipNade(1); }, function () {});
  bindBtn('bN2', function () { equipNade(2); }, function () {});
  bindBtn('bJump', function () { jumpQueued = true; S.stance = 0; syncStanceBtns(); }, function () {});
  bindBtn('bRel', function () { startReload(performance.now()); }, function () {});
  bindBtn('bCrouch', function () { toggleStance(1); }, function () {});
  bindBtn('bProne', function () { toggleStance(2); }, function () {});
  bindBtn('bAds', function () { S.ads = !S.ads; $('bAds').classList.toggle('on', S.ads); }, function () {});
  $('sb').addEventListener('pointerdown', function () { if (isTouch) { sbFull = !sbFull; sbHold = sbFull ? performance.now() + 5000 : 0; updateScoreboard(); } });

  // ================= lobi =================
  function spec(w) {
    var d = WP[w];
    if (d.slot === 2) return d.dmg + ' · ' + (d.range).toFixed(1) + ' m';
    return d.dmg + (d.pellets > 1 ? '×' + d.pellets : '') + ' · ' + Math.round(60000 / d.rate) + '/mnt';
  }
  function buildMenu() {
    var h = '';
    for (var s = 0; s < 4; s++) {
      h += '<div class="col"><h3>' + SLOT_NAMES[s] + '</h3>';
      WP.forEach(function (d, i) {
        if (d.slot !== LOSLOT[s]) return;
        h += '<div class="row' + (pick[s] === i ? ' on' : '') + '" data-s="' + s + '" data-w="' + i + '"><b>' + esc(d.name) + '</b><small>' + spec(i) + '</small></div>';
      });
      h += '</div>';
    }
    $('cols').innerHTML = h;
  }
  $('cols').addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.row') : null; if (!el) return;
    var w = +el.getAttribute('data-w'), sp = +el.getAttribute('data-s');
    if (sp < 2) { var other = 1 - sp; if (pick[other] === w) pick[other] = pick[sp]; }
    pick[sp] = w;
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
  $('dhidup').addEventListener('click', function () { if (!S.alive && !S.matchOver && $('dhidup').classList.contains('rdy')) send({ t: 'respawn' }); });
  $('tw').addEventListener('click', openWeapons);
  $('th').addEventListener('click', function () { show('hpanel', true); });
  $('mHelp').addEventListener('click', function () { show('hpanel', true); });
  $('hOk').addEventListener('click', function () { show('hpanel', false); });
  // ---- pengaturan grafik ----
  var GQ = [{ res: 0.6, aa: 0 }, { res: 0.8, aa: 0 }, { res: 1, aa: 1 }, { res: 1.25, aa: 1 }];
  function gSave() { try { localStorage.setItem('arena_gfx', JSON.stringify(G)); } catch (e) { /* abaikan */ } }
  function gMark(id, val) { var b = $(id).children; for (var i = 0; i < b.length; i++) b[i].classList.toggle('on', Math.abs(parseFloat(b[i].getAttribute('data-v')) - val) < 0.001); }
  function gRefresh() {
    gMark('gQ', G.q); gMark('gR', G.res); gMark('gA', G.aa ? 1 : 0);
    $('gRn').textContent = 'Render ' + Math.round(glc.width) + 'x' + Math.round(glc.height) + ' piksel';
  }
  $('mGfx').addEventListener('click', function () { gRefresh(); show('gpanel', true); });
  $('gOk').addEventListener('click', function () { show('gpanel', false); });
  $('gQ').addEventListener('click', function (e) { var v = e.target.getAttribute && e.target.getAttribute('data-v'); if (v == null) return; G.q = +v; G.res = GQ[G.q].res; G.aa = !!GQ[G.q].aa; gSave(); resize(); gRefresh(); });
  $('gR').addEventListener('click', function (e) { var v = e.target.getAttribute && e.target.getAttribute('data-v'); if (v == null) return; G.res = +v; gSave(); resize(); gRefresh(); });
  $('gA').addEventListener('click', function (e) { var v = e.target.getAttribute && e.target.getAttribute('data-v'); if (v == null) return; G.aa = v === '1'; gSave(); gRefresh(); });

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
  $('mSrv').textContent = (location.host || '');
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
  window.__arena = { S: S, remotes: remotes, LOBBY: LOBBY, mapParts: mapParts };
})();
