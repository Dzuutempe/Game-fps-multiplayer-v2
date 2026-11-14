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
      'varying vec3 vCol;varying vec2 vUV;varying float vD;varying float vMat;varying float vSh;uniform vec3 uFog;uniform vec4 uSk;uniform sampler2D uTex;' +
      'void main(){vec3 c=vCol;if(vMat>0.5){c=texture2D(uTex,vUV).rgb*vCol;}if(uSk.a>0.0){float lm=dot(c,vec3(0.3,0.59,0.11));c=mix(c,uSk.rgb*(0.7+lm*1.5),uSk.a);}c*=vSh;' +
      'float fg=clamp((vD-60.0)/120.0,0.0,1.0);gl_FragColor=vec4(mix(c,uFog,fg),1.0);}';
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    ['pos:aPos', 'nor:aNor', 'uv:aUV', 'col:aCol', 'mat:aMat'].forEach(function (s) { var a = s.split(':'); loc[a[0]] = gl.getAttribLocation(prog, a[1]); gl.enableVertexAttribArray(loc[a[0]]); });
    loc.vp = gl.getUniformLocation(prog, 'uVP'); loc.model = gl.getUniformLocation(prog, 'uModel'); loc.light = gl.getUniformLocation(prog, 'uLight');
    loc.fog = gl.getUniformLocation(prog, 'uFog'); loc.tex = gl.getUniformLocation(prog, 'uTex'); loc.sk = gl.getUniformLocation(prog, 'uSk');
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
  var WSK = [null, [0.95, 0.12, 0.12], [0.15, 0.4, 1], [0.2, 0.85, 0.3], [1, 0.78, 0.15], [0.62, 0.3, 0.95], [1, 0.45, 0.72], [0.96, 0.96, 0.98]];
  var WSKN = ['Standar', 'Merah', 'Biru', 'Hijau', 'Emas', 'Ungu', 'Pink', 'Putih'];
  function drawModel(key, mat, sk) {
    var m = WM[key]; if (!m) return;
    setModel(mat);
    var c = sk > 0 ? WSK[sk] : null;
    if (c) gl.uniform4f(loc.sk, c[0], c[1], c[2], 0.85);
    for (var i = 0; i < m.parts.length; i++) drawIdx(m.parts[i]);
    if (c) gl.uniform4f(loc.sk, 0, 0, 0, 0);
  }

  // ================= karakter berkerangka (skinning CPU) =================
  var FACE = [], FACEB = [], FACEN = [];
  var SKIN = [0.95, 0.76, 0.6], SKIN2 = [0.95, 0.76, 0.6], SHIRT = [0.86, 0.86, 0.88], PANTS = [0.17, 0.27, 0.46], SHOE = [0.16, 0.16, 0.18];
  // ---- kustom karakter ----
  var PAL_S = [[0.95, 0.76, 0.6], [0.99, 0.86, 0.74], [0.88, 0.67, 0.49], [0.74, 0.52, 0.36], [0.53, 0.35, 0.23], [0.33, 0.21, 0.15]];
  var PAL_C = [[0.86, 0.86, 0.88], [0.17, 0.27, 0.46], [0.16, 0.16, 0.18], [0.75, 0.12, 0.12], [0.95, 0.5, 0.12], [0.96, 0.8, 0.15], [0.3, 0.7, 0.25], [0.5, 0.33, 0.2], [0.1, 0.6, 0.62], [0.25, 0.5, 0.9], [0.5, 0.3, 0.75], [0.92, 0.45, 0.65]];
  var HATS = ['Tanpa', 'Topi', 'Kupluk', 'Helm', 'Koboi', 'Tinggi'], ACCS = ['Tanpa', 'Ikat', 'Kacamata', 'Tanduk', 'Halo', 'Mahkota'];
  var LKEYS = ['s', 'sh', 'p', 'so', 'hc', 'h', 'a', 'k'], LLEN = [6, 12, 12, 12, 12, 6, 6, 8], LDEF = { s: 0, sh: 0, p: 1, so: 2, hc: 3, h: 1, a: 0, k: 0 };
  function lookStr(L) { return LKEYS.map(function (k) { return L[k]; }).join(','); }
  function parseLook(str) {
    var o = {}, a = String(str || '').split(',');
    LKEYS.forEach(function (k, i) { var v = parseInt(a[i], 10); o[k] = v >= 0 ? v % LLEN[i] : LDEF[k]; });
    return o;
  }
  function botLook(id) { return { s: (id * 7) % 6, sh: (id * 5) % 12, p: (id * 3 + 4) % 12, so: (id * 11) % 12, hc: (id * 9 + 2) % 12, h: id % 6, a: id % 3 === 0 ? (id % 5) : 0, k: 0 }; }
  function lookCols(L) {
    if (L._c) return L._c;
    var hc = PAL_C[L.hc];
    return (L._c = { c: [PAL_S[L.s], PAL_C[L.sh], PAL_C[L.p], PAL_C[L.so]], hat: [hc, [Math.min(1, hc[0] * 1.25 + 0.04), Math.min(1, hc[1] * 1.25 + 0.04), Math.min(1, hc[2] * 1.25 + 0.04)], [hc[0] * 0.6, hc[1] * 0.6, hc[2] * 0.6]] });
  }
  // ---- level & xp ----
  var xpTot = 0;
  try { xpTot = parseInt(localStorage.getItem('arena_xp'), 10) || 0; } catch (e) { /* abaikan */ }
  function needFor(L) { return 250 + 50 * L; }
  function levelInfo(xp) { var L = 1, r = xp; while (r >= needFor(L)) { r -= needFor(L); L++; } return { L: L, cur: r, need: needFor(L) }; }
  var SKIN_LV = 10;
  function myLevel() { return levelInfo(xpTot).L; }
  function effK() { return 0; }
  // ---- slot tampilan ----
  var slots = [parseLook(null), parseLook(null), parseLook(null)], slotI = 0;
  try {
    var sl0 = JSON.parse(localStorage.getItem('arena_slots') || 'null');
    if (sl0 && sl0.length === 3) slots = sl0.map(parseLook);
    else { var lk0 = localStorage.getItem('arena_look'); if (lk0) slots[0] = parseLook(lk0); }
    slotI = Math.max(0, Math.min(2, parseInt(localStorage.getItem('arena_slot'), 10) || 0));
  } catch (e) { /* abaikan */ }
  var myLook = slots[slotI];
  function saveSlots() { try { localStorage.setItem('arena_slots', JSON.stringify(slots.map(lookStr))); localStorage.setItem('arena_slot', String(slotI)); } catch (e) { /* abaikan */ } }
  function lookOf(id) {
    if (id === 'lobby') return (S.podium && S.podium.id !== S.id) ? lookOf(S.podium.id) : myLook;
    var ro = roster[id];
    if (!ro) return LOOKDEF;
    if (!ro._l) ro._l = ro.look ? parseLook(ro.look) : (ro.bot ? botLook(+id) : LOOKDEF);
    return ro._l;
  }
  var LOOKDEF = parseLook(null);
  function setupChar() {
    var c = A3D.character, d = decodePart(c.part), nb = d.n, i, k, q;
    NBONE = c.bones.length;
    c.bones.forEach(function (b, k) { BONE[b.n] = k; });
    var dom = [];
    for (i = 0; i < nb; i++) { var bw0 = 0, bi0 = 0; for (k = 0; k < 4; k++) if (d.BW[i * 4 + k] > bw0) { bw0 = d.BW[i * 4 + k]; bi0 = d.BI[i * 4 + k]; } dom.push(c.bones[bi0].n); }
    // titik-titik: badan asli dulu, lalu pakaian 3D
    var P = [], NR = [], BI = [], BW = [], COL = [], MAT = [], UV = [], idx = [], CLS = [], G = [];
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
      COL.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1); MAT.push(col === SKIN2 ? 1 : (col ? 0 : 1)); UV.push(d.uv[i * 2], d.uv[i * 2 + 1]); CLS.push(col === SHIRT ? 1 : col === PANTS ? 2 : col === SHOE ? 3 : 0); G.push(1);
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
        CLS.push(cid); G.push(g); COL.push(Math.min(1, pc[0] * g), Math.min(1, pc[1] * g), Math.min(1, pc[2] * g)); MAT.push(0); UV.push(0, 0); idx.push(id);
      });
    }
    // --- detail wajah dude asli ---
    FACE = []; FACEB = []; FACEN = [];
    var GI = {}, curG = '';
    var nclo = P.length / 3, nf = 0;
    function poly(bone, pts, col, nrm) {
      var base = nclo + nf;
      pts.forEach(function (p) { FACE.push(p[0], p[1], p[2], col); FACEB.push(bone); FACEN.push(nrm || [0, 0, -1]); });
      var tg = curG ? (GI[curG] || (GI[curG] = [])) : idx;
      for (var k3 = 1; k3 + 1 < pts.length; k3++) tg.push(base, base + k3, base + k3 + 1);
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
    var HC = 100, HL = 101, HD = 102, GOLD = [1, 0.82, 0.2], HATTOP = [1.73, 1.82, 1.87, 1.84, 1.81, 1.88];
    function grp(g, f) { curG = g; f(); curG = ''; }
    grp('h1', function () { box(H, -0.098, 1.728, -0.108, 0.098, 1.80, 0.108, HC); box(H, -0.082, 1.80, -0.09, 0.082, 1.82, 0.09, HL); box(H, -0.085, 1.728, -0.205, 0.085, 1.738, -0.105, HD); });
    grp('h2', function () { box(H, -0.1, 1.715, -0.11, 0.1, 1.79, 0.11, HC); box(H, -0.103, 1.715, -0.113, 0.103, 1.742, 0.113, HD); box(H, -0.07, 1.79, -0.08, 0.07, 1.84, 0.08, HC); box(H, -0.028, 1.84, -0.028, 0.028, 1.87, 0.028, HL); });
    grp('h3', function () { box(H, -0.108, 1.72, -0.118, 0.108, 1.83, 0.118, HC); box(H, -0.02, 1.83, -0.118, 0.02, 1.84, 0.118, HD); box(H, -0.1, 1.6, 0.098, 0.1, 1.72, 0.125, HD); box(H, -0.112, 1.72, -0.06, -0.106, 1.78, 0.06, HL); box(H, 0.106, 1.72, -0.06, 0.112, 1.78, 0.06, HL); });
    grp('h4', function () { box(H, -0.19, 1.728, -0.2, 0.19, 1.742, 0.19, HD); box(H, -0.09, 1.742, -0.09, 0.09, 1.81, 0.09, HC); box(H, -0.093, 1.742, -0.093, 0.093, 1.762, 0.093, HL); });
    grp('h5', function () { box(H, -0.15, 1.728, -0.15, 0.15, 1.74, 0.15, HD); box(H, -0.096, 1.74, -0.096, 0.096, 1.88, 0.096, HC); box(H, -0.098, 1.74, -0.098, 0.098, 1.768, 0.098, HL); });
    var RED = [0.85, 0.15, 0.15], LENS = [0.06, 0.1, 0.2], HORN = [0.92, 0.88, 0.72];
    grp('a1', function () { box(H, -0.102, 1.688, -0.112, 0.102, 1.716, 0.112, RED); box(H, 0.09, 1.688, 0.112, 0.17, 1.708, 0.128, RED); box(H, -0.17, 1.688, 0.112, -0.09, 1.708, 0.128, RED); });
    grp('a2', function () {
      box(H, -0.078, 1.648, -0.118, -0.012, 1.702, -0.106, LENS); box(H, 0.012, 1.648, -0.118, 0.078, 1.702, -0.106, LENS);
      box(H, -0.014, 1.672, -0.118, 0.014, 1.688, -0.106, LENS); box(H, -0.084, 1.676, -0.1, -0.078, 1.69, -0.0, LENS); box(H, 0.078, 1.676, -0.1, 0.084, 1.69, -0.0, LENS);
    });
    grp('a3', function () {
      [-1, 1].forEach(function (sg) {
        var a = sg * 0.075, b = sg * 0.105, c = sg * 0.125, d2 = sg * 0.145, e = sg * 0.16;
        box(H, Math.min(a, b), 1.74, -0.025, Math.max(a, b), 1.78, 0.025, HORN); box(H, Math.min(b, c) - 0.002, 1.78, -0.02, Math.max(b, c) + 0.002, 1.83, 0.02, HORN); box(H, Math.min(c, d2), 1.83, -0.015, Math.max(c, d2), 1.88, 0.015, HORN); box(H, Math.min(d2, e), 1.88, -0.01, Math.max(d2, e), 1.91, 0.01, HORN);
      });
    });
    for (var hh = 0; hh < 6; hh++) (function (hh) {
      var tp = HATTOP[hh];
      grp('a4_' + hh, function () {
        var y0 = tp + 0.1, y1 = y0 + 0.016;
        box(H, -0.11, y0, -0.11, 0.11, y1, -0.09, GOLD); box(H, -0.11, y0, 0.09, 0.11, y1, 0.11, GOLD); box(H, -0.11, y0, -0.09, -0.09, y1, 0.09, GOLD); box(H, 0.09, y0, -0.09, 0.11, y1, 0.09, GOLD);
      });
      grp('a5_' + hh, function () {
        var y0 = tp - 0.002, y1 = y0 + 0.035;
        box(H, -0.1, y0, -0.1, 0.1, y1, 0.1, GOLD);
        [[-0.09, -0.09], [0.06, -0.09], [-0.09, 0.06], [0.06, 0.06], [-0.015, -0.015]].forEach(function (q) { box(H, q[0], y1, q[1], q[0] + 0.03, y1 + (q[0] === -0.015 ? 0.06 : 0.04), q[1] + 0.03, GOLD); });
      });
    })(hh);
    var n = nclo, out = new Float32Array((n + nf) * 12);
    for (i = 0; i < n; i++) { out[i * 12 + 6] = UV[i * 2]; out[i * 12 + 7] = UV[i * 2 + 1]; out[i * 12 + 11] = MAT[i]; }
    for (i = 0; i < nf; i++) out[(n + i) * 12 + 11] = 0;
    CH = { n: n, nf: nf, pos: new Float32Array(P), nor: new Float32Array(NR), BI: new Uint8Array(BI), BW: new Uint8Array(BW), out: out, col: new Float32Array(COL), bones: c.bones, M: new Float32Array(NBONE * 16), rot: [], head: BONE.Head, base: idx.slice(), gi: GI };
    for (i = 0; i < NBONE; i++) CH.rot.push([0, 0, 0]);
    CH.cls = new Uint8Array(CLS); CH.g = new Float32Array(G); CH.nv = n + nf;
 CH.tex = getTex(c.part.tex, A3D.tex);
  }
  function setRot(name, rx, ry, rz) { var r = CH.rot[BONE[name]]; if (r) { r[0] = rx || 0; r[1] = ry || 0; r[2] = rz || 0; } }
  // pose: ph = fase langkah, mv = 0..1, pitch = arah bidik, sw = fraksi ayunan melee (0..1, <0 = tidak ada), melee
  var EM = null;
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
    if (EM) poseEmote(EM);
    var M = c.M, tmp, k, b, par, R, p;
    for (k = 0; k < NBONE; k++) {
      b = c.bones[k]; p = b;
      R = mul(mRx(c.rot[k][0]), mul(mRy(c.rot[k][1]), mRz(c.rot[k][2])));
      tmp = mul(mT(p.x, p.y, p.z), mul(R, mT(-p.x, -p.y, -p.z)));
      if (b.p >= 0) { var pm = new Array(16), j; for (j = 0; j < 16; j++) pm[j] = M[b.p * 16 + j]; tmp = mul(pm, tmp); }
      for (var q = 0; q < 16; q++) M[k * 16 + q] = tmp[q];
    }
  }
  var PAS = {"fps":24,"bones":["Hips","Spine","Spine1","Spine2","Neck","Head","LeftArm","LeftForeArm","LeftHand","LeftUpLeg","LeftLeg","LeftFoot","RightArm","RightForeArm","RightHand","RightUpLeg","RightLeg","RightFoot"],"f":[[[18,-72,13],[-8,72,11],[6,0,0],[0,0,0],[1,0,-18],[-27,0,0],[8,-14,119],[-42,-27,12],[-20,-11,-34],[56,59,-36],[-41,3,-15],[-7,-28,26],[-18,-7,-127],[-28,18,10],[-11,7,20],[0,76,19],[-21,3,-21],[11,-79,45]],[[17,-51,14],[-3,51,7],[1,0,-3],[0,0,0],[-1,0,-17],[-27,0,0],[2,-6,118],[-60,-49,-3],[-16,-7,-31],[59,36,-31],[-50,4,-6],[-12,-14,10],[-17,-8,-119],[-38,38,25],[-11,15,22],[6,56,18],[-31,6,-34],[24,-74,54]],[[17,-28,15],[1,27,5],[-4,1,-4],[0,0,0],[-4,1,-16],[-27,0,0],[-5,0,121],[-87,-63,-34],[-9,-4,-27],[62,11,-25],[-54,5,8],[-27,2,-9],[-15,-5,-109],[-52,58,42],[-10,24,20],[10,34,19],[-40,8,-42],[33,-67,58]],[[15,-10,15],[4,10,3],[-9,1,-4],[0,0,0],[-5,1,-15],[-27,0,0],[-10,7,125],[-113,-68,-66],[-5,-2,-23],[73,-10,-21],[-68,6,26],[-27,20,-29],[-13,-6,-102],[-70,74,65],[-6,28,16],[12,16,20],[-46,11,-48],[38,-62,61]],[[11,4,16],[6,-5,2],[-13,1,-5],[0,0,0],[-4,2,-12],[-27,0,0],[-13,13,127],[-129,-67,-87],[-3,-2,-22],[82,-26,-19],[-82,2,47],[-13,33,-50],[-11,-8,-100],[-92,81,94],[-3,21,21],[14,2,21],[-50,13,-50],[39,-59,60]],[[10,7,17],[8,-9,2],[-15,2,-6],[0,0,0],[2,2,-7],[-27,-1,0],[-12,13,125],[-130,-70,-86],[-8,-6,-29],[81,-30,-18],[-88,0,53],[-20,37,-50],[-16,-13,-111],[-98,68,122],[-1,-12,36],[14,-2,20],[-49,12,-49],[39,-58,59]],[[9,3,18],[10,-5,1],[-16,2,-7],[0,0,0],[11,3,-3],[-27,-1,0],[-8,10,120],[-116,-77,-66],[-18,-14,-39],[80,-27,-21],[-95,-2,49],[-36,33,-40],[-21,-16,-128],[-81,47,139],[3,-62,30],[15,1,17],[-45,10,-48],[39,-59,60]],[[8,-2,19],[12,0,-1],[-17,2,-9],[0,0,0],[19,3,0],[-27,-1,0],[-3,5,116],[-100,-79,-44],[-29,-22,-48],[77,-21,-23],[-97,-2,42],[-45,28,-32],[-18,-13,-140],[-54,29,149],[-29,-97,-21],[17,6,15],[-44,10,-48],[36,-60,60]],[[9,-4,18],[13,2,0],[-18,2,-8],[0,0,0],[18,3,1],[-27,-2,0],[0,0,112],[-94,-78,-41],[-23,-23,-38],[66,-14,-20],[-92,-1,34],[-27,28,-34],[-8,-5,-132],[-53,23,157],[-52,-90,-53],[21,9,19],[-50,12,-51],[27,-59,55]],[[10,-8,14],[13,7,1],[-20,2,-4],[0,0,0],[19,4,1],[-27,-2,0],[1,-1,106],[-94,-80,-45],[-16,-17,-34],[49,-2,-13],[-75,2,21],[8,26,-37],[26,27,-112],[-85,12,161],[-16,-58,-24],[25,16,27],[-61,18,-58],[14,-59,49]],[[11,-14,8],[14,13,4],[-22,2,-1],[0,0,0],[22,5,3],[-27,-2,0],[3,-1,99],[-93,-83,-48],[-11,-11,-32],[41,8,-6],[-67,3,14],[16,24,-34],[62,71,-93],[-112,15,162],[-17,-42,12],[32,25,35],[-72,24,-62],[2,-56,42]],[[10,-17,3],[14,17,6],[-25,1,2],[0,0,0],[28,5,4],[-27,-3,0],[4,1,94],[-93,-86,-50],[-7,-6,-30],[40,15,-1],[-66,4,11],[20,24,-34],[80,108,-71],[-115,35,155],[-68,-49,27],[39,32,40],[-82,29,-63],[2,-55,40]],[[9,-19,-1],[14,19,7],[-25,1,4],[0,0,0],[33,6,7],[-27,-3,0],[2,6,91],[-95,-89,-54],[-5,-3,-28],[41,18,3],[-69,4,12],[21,24,-35],[110,136,-77],[-109,27,146],[-173,-57,-8],[46,36,41],[-92,31,-58],[14,-56,41]],[[8,-19,-2],[13,19,8],[-25,0,4],[0,0,0],[36,6,8],[-27,-3,0],[-1,11,92],[-100,-90,-61],[-3,-3,-24],[41,18,5],[-69,4,12],[20,24,-37],[176,143,-137],[-112,-11,148],[-200,-37,-26],[51,37,40],[-96,30,-53],[29,-57,44]],[[6,-17,-1],[13,17,7],[-24,0,4],[0,0,0],[37,7,9],[-27,-3,0],[-5,18,94],[-106,-91,-68],[-3,-4,-20],[40,17,5],[-65,4,12],[19,25,-38],[180,139,-144],[-112,-43,152],[-185,-31,-28],[55,36,40],[-91,27,-53],[43,-57,49]],[[5,-16,0],[13,15,6],[-23,1,3],[0,0,0],[37,7,9],[-27,-3,0],[-10,24,97],[-113,-92,-75],[-2,-7,-16],[38,15,5],[-60,4,12],[18,25,-38],[146,132,-117],[-109,-43,157],[-145,-47,-8],[57,34,38],[-82,21,-52],[48,-55,52]],[[5,-15,2],[12,14,5],[-21,1,1],[0,0,0],[34,6,9],[-27,-3,0],[-15,29,100],[-119,-92,-83],[-1,-9,-11],[37,13,3],[-57,4,12],[16,26,-39],[117,123,-98],[-109,-28,160],[-41,-34,27],[56,30,33],[-73,15,-47],[44,-58,53]],[[5,-15,5],[11,14,3],[-19,1,-1],[0,0,0],[31,5,8],[-27,-2,0],[-17,30,103],[-124,-93,-88],[1,-10,-5],[37,13,1],[-56,4,11],[16,27,-39],[105,120,-90],[-109,-16,158],[6,-17,22],[53,27,26],[-64,10,-41],[33,-62,53]],[[5,-18,6],[11,17,2],[-18,1,-4],[0,0,0],[27,5,7],[-27,-2,0],[-17,29,102],[-128,-95,-90],[4,-10,4],[38,15,0],[-56,4,10],[16,28,-39],[99,122,-83],[-108,-2,150],[27,-11,15],[48,28,25],[-52,6,-44],[25,-65,58]],[[5,-21,5],[10,20,3],[-16,1,-4],[0,0,0],[24,4,6],[-27,-2,0],[-15,25,98],[-126,-98,-90],[7,-11,10],[38,19,0],[-58,5,9],[16,28,-38],[94,128,-75],[-105,9,141],[28,-8,16],[50,34,31],[-51,7,-56],[13,-71,63]],[[5,-24,0],[8,24,4],[-14,1,-2],[0,0,0],[21,3,5],[-27,-1,0],[-9,17,91],[-116,-99,-85],[-5,-22,-20],[38,23,3],[-59,5,8],[17,29,-38],[82,133,-59],[-102,14,140],[6,-12,28],[56,42,38],[-63,13,-69],[11,-71,65]],[[5,-30,-6],[7,30,6],[-14,0,2],[0,0,0],[20,3,4],[-27,-1,0],[-2,6,93],[-108,-84,-94],[-4,-9,-36],[37,30,7],[-62,5,7],[20,29,-38],[57,129,-32],[-100,19,146],[-43,-32,38],[64,55,45],[-76,22,-82],[7,-67,62]],[[5,-40,-10],[6,40,8],[-16,0,4],[0,0,0],[19,2,1],[-27,-1,0],[6,-2,101],[-110,-60,-121],[2,17,-39],[38,42,8],[-68,6,5],[24,29,-36],[38,111,-15],[-96,24,159],[-86,-54,33],[69,70,49],[-80,30,-96],[-2,-63,59]],[[5,-50,-13],[4,51,10],[-17,0,4],[0,0,0],[16,0,-4],[-27,0,0],[10,-6,111],[-106,-36,-145],[3,42,-27],[39,52,6],[-73,7,2],[28,30,-34],[32,83,-23],[-90,23,175],[-86,-64,33],[66,80,49],[-80,33,-100],[-4,-64,58]],[[6,-58,-12],[4,58,11],[-18,0,4],[0,0,0],[12,-1,-10],[-27,1,0],[10,-5,118],[-109,-21,-167],[-4,60,-8],[41,59,1],[-76,7,0],[30,30,-31],[27,51,-43],[-80,24,184],[-44,-55,45],[57,82,43],[-77,32,-92],[2,-68,60]],[[9,-61,-6],[5,61,9],[-17,0,2],[0,0,0],[8,-2,-17],[-27,1,0],[14,-10,120],[-133,-10,-180],[-2,60,0],[44,59,-8],[-79,7,0],[30,30,-29],[18,25,-66],[-68,29,175],[-15,-42,50],[48,77,32],[-72,26,-79],[8,-71,62]],[[11,-58,3],[8,58,5],[-15,1,-1],[0,0,0],[7,-3,-21],[-27,1,0],[32,-28,129],[-161,-4,-166],[6,54,-6],[49,51,-20],[-82,6,2],[29,29,-27],[9,10,-90],[-55,27,160],[-3,-37,45],[43,67,16],[-63,17,-65],[24,-71,71]],[[11,-51,12],[10,50,0],[-13,2,-5],[0,0,0],[9,-3,-19],[-27,1,0],[66,-53,149],[-182,-7,-144],[4,44,-18],[61,37,-29],[-97,6,6],[31,25,-26],[5,5,-108],[-45,21,149],[1,-38,38],[41,55,5],[-57,12,-59],[28,-70,74]],[[9,-42,18],[11,40,-4],[-12,2,-8],[0,0,0],[14,-2,-14],[-27,1,0],[118,-71,181],[-182,-16,-121],[-17,31,-33],[85,17,-29],[-127,11,7],[28,18,-24],[6,4,-120],[-40,14,143],[0,-41,28],[41,43,-1],[-55,11,-58],[32,-69,78]],[[6,-33,20],[11,30,-6],[-11,2,-8],[0,0,0],[20,-1,-8],[-27,0,0],[167,-77,211],[-186,9,-117],[-39,31,-36],[106,3,-21],[-147,13,12],[9,13,-23],[11,6,-126],[-38,8,143],[-2,-46,19],[40,33,0],[-54,11,-59],[39,-68,83]],[[3,-25,20],[11,23,-7],[-12,2,-7],[0,0,0],[22,1,-3],[-27,-1,0],[202,-76,231],[-220,87,-111],[-79,36,-12],[116,-5,-16],[-151,11,20],[6,14,-31],[16,9,-128],[-36,3,146],[-6,-52,9],[39,26,3],[-53,11,-61],[44,-67,87]],[[2,-22,17],[12,20,-6],[-15,2,-5],[0,0,0],[22,2,0],[-27,-1,0],[211,-76,235],[171,122,97],[-127,6,6],[118,-5,-13],[-146,10,24],[5,16,-36],[22,12,-129],[-34,-2,154],[-12,-55,1],[37,24,8],[-51,11,-63],[43,-67,89]],[[2,-24,13],[13,22,-4],[-18,1,-3],[0,0,0],[19,3,2],[-27,-1,0],[189,-78,222],[102,51,148],[-107,-16,7],[115,2,-11],[-134,12,21],[0,15,-35],[20,9,-131],[-32,-1,166],[-17,-58,-3],[35,27,13],[-47,10,-65],[39,-68,88]],[[3,-29,9],[14,27,-1],[-19,1,-2],[0,0,0],[15,3,2],[-27,-2,0],[151,-78,195],[85,26,175],[-62,-10,15],[107,11,-12],[-117,13,14],[-4,12,-30],[11,1,-132],[-36,8,182],[-19,-59,0],[31,34,17],[-41,8,-66],[34,-69,88]],[[3,-35,7],[13,33,1],[-19,2,-3],[0,0,0],[12,3,1],[-27,-1,0],[114,-73,168],[51,72,211],[-86,7,20],[99,20,-13],[-100,13,7],[-9,10,-26],[0,-7,-133],[-46,19,194],[-18,-59,7],[29,40,19],[-35,6,-67],[33,-70,89]],[[4,-39,7],[12,37,3],[-17,2,-3],[0,0,0],[10,3,-2],[-27,-1,0],[87,-63,153],[-34,105,289],[-112,31,20],[94,24,-14],[-85,12,3],[-15,7,-23],[-9,-13,-132],[-58,29,196],[-14,-58,15],[28,44,19],[-32,5,-67],[33,-70,91]],[[3,-38,8],[11,36,2],[-14,1,-3],[0,0,0],[10,2,-4],[-27,-1,0],[80,-59,151],[-69,108,-307],[-110,38,19],[93,22,-15],[-84,12,5],[-10,7,-24],[-14,-16,-131],[-63,34,190],[-9,-56,23],[30,42,17],[-32,4,-67],[36,-71,94]],[[2,-32,12],[9,30,-1],[-8,1,-3],[0,0,0],[11,2,-6],[-27,-1,0],[88,-61,162],[-42,114,295],[-94,32,27],[97,12,-16],[-89,11,12],[-13,6,-27],[-16,-16,-131],[-59,34,181],[-5,-54,28],[33,35,13],[-37,6,-65],[41,-71,95]],[[0,-23,16],[7,21,-5],[-2,0,-3],[0,0,0],[13,1,-5],[-27,-1,0],[105,-65,177],[6,118,256],[-89,25,31],[99,0,-15],[-90,10,20],[-13,6,-31],[-16,-14,-134],[-51,30,174],[-2,-51,31],[37,25,9],[-43,8,-62],[45,-71,94]],[[-2,-16,20],[5,14,-9],[2,0,-4],[0,0,0],[16,1,-4],[-27,-1,0],[122,-67,189],[40,119,233],[-89,22,33],[102,-11,-16],[-97,8,30],[-14,17,-40],[-13,-11,-139],[-44,23,168],[1,-50,33],[40,16,6],[-48,9,-59],[47,-71,92]],[[-3,-12,23],[4,10,-11],[3,0,-6],[0,0,0],[18,1,-2],[-27,-1,0],[131,-67,194],[53,119,231],[-90,23,37],[105,-19,-18],[-109,4,37],[-16,35,-47],[-7,-7,-145],[-42,15,163],[3,-48,35],[41,10,3],[-51,9,-57],[48,-71,91]],[[-2,-13,25],[4,11,-10],[1,1,-9],[0,0,0],[18,1,-1],[-27,-1,0],[115,-64,183],[26,114,251],[-72,28,27],[99,-20,-24],[-113,1,38],[-4,42,-51],[0,-3,-145],[-43,10,159],[4,-48,37],[41,11,3],[-52,10,-58],[48,-71,91]],[[0,-17,22],[6,15,-6],[-2,1,-10],[0,0,0],[16,2,0],[-27,-1,0],[90,-60,163],[-91,112,-269],[-80,45,7],[83,-11,-29],[-107,-1,33],[21,29,-46],[8,3,-136],[-52,8,157],[2,-47,39],[40,18,7],[-51,11,-63],[47,-71,91]],[[3,-23,15],[7,21,-1],[-7,1,-7],[0,0,0],[16,3,1],[-27,-1,0],[67,-54,141],[-181,31,-179],[-102,68,-43],[67,3,-29],[-97,-2,25],[29,12,-28],[22,17,-121],[-73,8,159],[-6,-48,40],[37,27,15],[-49,12,-68],[44,-69,91]],[[4,-28,7],[7,27,4],[-10,1,-2],[0,0,0],[18,4,2],[-27,-2,0],[43,-40,123],[-176,-62,-130],[-67,11,-89],[61,15,-23],[-91,0,19],[30,9,-22],[41,38,-107],[-90,10,157],[-17,-51,40],[33,36,26],[-47,12,-75],[39,-68,89]],[[5,-32,1],[5,32,7],[-11,0,1],[0,0,0],[22,5,4],[-27,-2,0],[26,-26,107],[-108,-91,-52],[-46,-25,-65],[58,24,-15],[-88,3,13],[28,11,-21],[62,77,-79],[-87,29,124],[-29,-46,51],[36,44,38],[-52,17,-94],[46,-55,93]],[[5,-35,-2],[4,34,9],[-10,0,3],[0,0,0],[24,5,6],[-27,-2,0],[13,-14,93],[-53,-71,2],[-35,-28,-54],[53,30,-8],[-83,5,8],[28,11,-20],[73,102,-70],[-84,41,110],[-43,-43,59],[45,55,53],[-61,29,-123],[29,-39,85]],[[5,-34,-5],[3,34,10],[-9,0,4],[0,0,0],[25,6,7],[-27,-3,0],[4,-5,83],[-33,-44,17],[-30,-29,-56],[48,33,-2],[-78,5,5],[28,10,-19],[89,120,-75],[-96,28,127],[-81,-59,46],[52,62,65],[-67,38,-142],[10,-27,75]],[[6,-32,-6],[3,32,10],[-8,0,4],[0,0,0],[24,6,9],[-27,-3,0],[0,-1,79],[-27,-31,18],[-27,-29,-65],[43,31,2],[-74,5,4],[29,9,-19],[118,131,-99],[-101,-57,169],[-165,-42,-17],[51,63,75],[-66,39,-150],[0,-30,73]],[[6,-26,-5],[4,26,10],[-8,0,3],[0,0,0],[23,7,11],[-27,-3,0],[4,-6,86],[-31,-35,15],[-30,-26,-72],[40,26,3],[-72,5,6],[30,8,-19],[125,120,-117],[-30,-115,252],[-135,-25,-18],[49,58,78],[-64,35,-145],[-5,-44,72]],[[5,-19,-2],[5,19,10],[-10,0,1],[0,0,0],[21,8,13],[-27,-3,0],[14,-16,98],[-43,-50,7],[-35,-20,-71],[40,17,1],[-70,3,8],[29,8,-18],[120,99,-134],[-53,-103,236],[-87,-47,7],[53,47,67],[-71,34,-120],[8,-44,67]],[[4,-10,2],[7,10,9],[-12,1,-2],[0,0,0],[20,8,13],[-27,-3,0],[29,-28,114],[-81,-73,-28],[-38,-10,-69],[40,6,-4],[-67,2,11],[26,9,-19],[97,73,-138],[-91,-74,211],[-27,-34,45],[56,29,45],[-75,23,-73],[27,-32,44]],[[2,-1,8],[9,-1,8],[-15,2,-5],[0,0,0],[20,7,11],[-27,-3,0],[52,-42,133],[-153,-55,-107],[-37,9,-67],[41,-6,-10],[-63,0,15],[20,11,-19],[56,39,-132],[-117,-28,199],[6,4,44],[55,12,29],[-71,12,-42],[17,-27,22]],[[-1,7,13],[11,-10,7],[-17,3,-6],[0,0,0],[22,7,9],[-27,-3,0],[85,-59,156],[-173,25,-151],[-42,40,-53],[53,-19,-18],[-83,-6,31],[30,16,-31],[8,-1,-130],[-134,21,196],[13,21,23],[58,0,21],[-76,10,-31],[23,-25,18]],[[-3,13,17],[12,-16,7],[-19,3,-7],[0,0,0],[23,7,8],[-27,-3,0],[131,-75,185],[-156,108,-170],[-58,50,-11],[72,-35,-27],[-110,-21,57],[27,26,-50],[-24,-24,-142],[-134,46,189],[8,20,16],[62,-9,16],[-84,8,-24],[29,-24,17]],[[-4,17,19],[12,-20,8],[-20,3,-7],[0,0,0],[24,7,6],[-27,-3,0],[184,-84,219],[227,155,85],[-57,35,16],[88,-50,-36],[-126,-39,81],[6,37,-58],[-33,-28,-151],[-114,53,170],[3,13,20],[66,-14,13],[-93,7,-18],[35,-23,16]],[[-4,19,19],[12,-22,8],[-20,3,-6],[0,0,0],[25,7,5],[-27,-3,0],[222,-87,242],[194,127,126],[-48,21,28],[93,-56,-39],[-132,-48,92],[7,44,-65],[-34,-26,-154],[-90,52,160],[3,5,24],[68,-17,11],[-100,6,-14],[39,-23,14]],[[-3,18,20],[12,-22,8],[-18,3,-6],[0,0,0],[22,7,5],[-27,-3,0],[221,-94,240],[169,117,155],[-41,15,32],[89,-54,-39],[-132,-47,88],[17,44,-67],[-29,-22,-152],[-69,46,158],[5,-7,24],[67,-18,8],[-99,4,-11],[39,-22,12]],[[-2,16,21],[11,-19,8],[-16,3,-6],[0,0,0],[18,8,5],[-27,-4,0],[188,-99,215],[123,120,201],[-36,17,32],[80,-48,-38],[-128,-38,73],[16,39,-56],[-20,-16,-151],[-55,36,154],[4,-21,23],[65,-17,4],[-96,3,-9],[37,-22,10]],[[-1,11,20],[10,-14,8],[-15,3,-5],[0,0,0],[13,9,5],[-27,-4,0],[144,-96,184],[39,128,281],[-37,28,26],[70,-39,-37],[-120,-27,54],[15,33,-43],[-8,-8,-149],[-61,28,151],[2,-29,19],[65,-12,3],[-97,4,-10],[35,-23,10]],[[1,6,18],[9,-9,9],[-15,2,-1],[0,0,0],[8,10,4],[-27,-4,0],[105,-85,158],[-108,104,-203],[-37,46,5],[59,-26,-31],[-108,-16,39],[15,28,-33],[9,2,-142],[-89,29,148],[2,-28,18],[67,-5,5],[-100,6,-11],[34,-23,9]],[[1,3,11],[9,-5,11],[-15,1,5],[0,0,0],[5,10,3],[-27,-4,0],[72,-68,136],[-141,31,-148],[-19,45,-36],[47,-13,-17],[-89,-7,28],[25,32,-36],[35,21,-124],[-125,44,152],[3,-22,17],[70,3,12],[-103,8,-12],[29,-24,6]],[[0,1,3],[8,-2,13],[-14,-1,12],[0,0,0],[5,11,3],[-27,-4,0],[49,-51,119],[-110,-16,-103],[-7,22,-51],[43,-5,-6],[-80,-3,24],[30,34,-41],[69,52,-110],[-149,64,157],[5,-15,18],[75,12,20],[-108,10,-12],[27,-24,3]],[[0,0,-3],[7,0,13],[-13,-2,16],[0,0,0],[7,10,3],[-27,-4,0],[31,-28,112],[-84,-25,-81],[-3,11,-48],[44,-1,2],[-79,-2,24],[33,34,-44],[102,79,-114],[-152,67,159],[6,-10,21],[83,21,28],[-119,15,-13],[29,-24,0]],[[0,-1,-6],[6,0,13],[-11,-2,18],[0,0,0],[9,10,3],[-27,-4,0],[16,-9,112],[-70,-28,-74],[-2,6,-44],[45,1,8],[-80,-1,25],[35,33,-49],[140,95,-135],[-145,20,163],[-4,-16,26],[94,29,34],[-133,21,-14],[20,-23,-4]],[[1,1,-6],[5,-1,13],[-10,-2,18],[0,0,0],[9,9,3],[-27,-4,0],[4,5,111],[-80,-38,-89],[-1,3,-42],[44,1,11],[-78,0,26],[35,31,-51],[162,99,-155],[-134,-50,167],[-40,-31,19],[103,34,38],[-140,24,-15],[3,-25,-6]],[[1,4,-5],[5,-4,11],[-7,-2,15],[0,0,0],[7,8,2],[-27,-3,0],[-5,16,107],[-107,-51,-119],[-1,0,-41],[42,-2,12],[-74,0,27],[35,30,-53],[167,98,-163],[-127,-77,167],[-63,-37,9],[103,31,39],[-139,24,-14],[2,-26,-6]],[[0,8,-3],[4,-8,10],[-4,-1,12],[0,0,0],[4,8,3],[-27,-3,0],[-12,23,101],[-144,-54,-164],[0,2,-41],[40,-7,11],[-70,0,28],[35,30,-55],[158,98,-161],[-123,-76,166],[-76,-43,5],[98,24,39],[-131,20,-12],[12,-27,-5]],[[0,11,0],[4,-12,9],[-2,-1,9],[0,0,0],[1,8,3],[-27,-3,0],[-15,26,95],[-167,-41,-205],[0,9,-41],[37,-11,10],[-66,-1,29],[35,29,-56],[143,97,-152],[-120,-65,167],[-74,-46,8],[91,16,39],[-118,16,-13],[23,-31,-1]],[[0,12,1],[4,-13,8],[-2,-1,7],[0,0,0],[0,7,4],[-27,-3,0],[-15,24,97],[-168,-32,-216],[0,18,-39],[35,-13,9],[-64,-1,29],[36,28,-56],[125,94,-140],[-117,-53,169],[-45,-40,19],[83,10,36],[-103,12,-16],[26,-35,7]],[[0,10,2],[5,-10,8],[-4,0,4],[0,0,0],[0,7,5],[-27,-3,0],[-12,20,104],[-164,-21,-221],[-1,29,-33],[33,-10,8],[-64,0,27],[36,28,-54],[115,90,-133],[-115,-48,171],[-12,-28,20],[77,9,31],[-83,7,-17],[12,-43,17]],[[0,4,2],[5,-5,9],[-6,0,2],[0,0,0],[1,7,6],[-27,-3,0],[-8,16,110],[-159,-9,-227],[-3,39,-26],[33,-4,9],[-63,1,23],[37,27,-52],[120,93,-135],[-113,-55,172],[4,-21,16],[75,13,28],[-71,5,-23],[-4,-51,24]],[[1,-4,0],[5,3,10],[-8,0,2],[0,0,0],[3,6,6],[-27,-3,0],[-3,11,112],[-160,-4,-225],[-4,43,-21],[32,4,11],[-63,3,18],[36,26,-49],[138,101,-144],[-108,-72,170],[6,-22,14],[76,24,32],[-67,6,-35],[-19,-49,25]],[[1,-11,-3],[5,11,12],[-10,0,2],[0,0,0],[5,6,7],[-27,-3,0],[3,6,105],[-168,-12,-217],[-3,43,-24],[31,13,14],[-62,4,13],[35,26,-46],[154,109,-150],[-105,-84,168],[-4,-27,5],[84,39,42],[-84,16,-64],[0,-57,48]],[[1,-17,-7],[4,17,14],[-11,0,4],[0,0,0],[7,6,6],[-27,-3,0],[9,-2,96],[-179,-34,-198],[-3,38,-31],[30,20,18],[-61,5,10],[32,26,-43],[161,113,-151],[-103,-90,169],[-16,-30,-8],[87,58,59],[-92,30,-100],[-3,-61,60]],[[1,-22,-11],[3,22,16],[-13,0,6],[0,0,0],[7,6,5],[-27,-2,0],[17,-13,92],[-173,-64,-162],[-3,29,-38],[29,25,20],[-58,5,7],[29,26,-40],[149,110,-142],[-101,-86,178],[-26,-32,-17],[79,69,75],[-86,37,-124],[-2,-65,71]],[[2,-24,-14],[2,25,18],[-14,-1,9],[0,0,0],[7,6,3],[-27,-2,0],[25,-24,95],[-144,-77,-116],[-4,22,-41],[27,29,22],[-56,5,5],[26,26,-37],[124,99,-126],[-107,-63,185],[-36,-38,-13],[71,71,80],[-80,36,-128],[2,-67,75]],[[2,-24,-13],[2,25,18],[-13,-1,10],[0,0,0],[6,6,0],[-27,-2,0],[34,-34,104],[-119,-70,-86],[-4,23,-43],[26,28,20],[-54,5,4],[24,26,-35],[94,82,-112],[-112,-26,177],[-19,-36,12],[66,63,70],[-78,30,-108],[20,-70,80]],[[3,-22,-9],[3,21,16],[-11,-1,8],[0,0,0],[4,5,-2],[-27,-2,0],[44,-45,115],[-109,-57,-75],[-4,28,-45],[28,24,14],[-54,4,5],[22,26,-33],[67,60,-106],[-102,2,160],[9,-12,19],[61,49,53],[-74,21,-78],[29,-71,73]],[[3,-17,0],[4,16,12],[-8,0,2],[0,0,0],[3,4,-4],[-27,-1,0],[62,-58,130],[-113,-45,-80],[-7,35,-46],[29,16,3],[-53,3,7],[20,26,-31],[47,42,-109],[-75,4,143],[19,3,5],[54,33,37],[-63,12,-52],[13,-71,54]],[[1,-11,8],[5,9,7],[-6,1,-6],[0,0,0],[6,2,-4],[-27,-1,0],[90,-68,153],[-133,-26,-98],[-16,42,-44],[36,6,-9],[-60,1,12],[16,28,-30],[33,28,-115],[-58,2,139],[16,4,-6],[48,20,27],[-52,7,-44],[12,-72,55]],[[-2,-7,14],[5,5,3],[-4,2,-12],[0,0,0],[12,1,-1],[-27,-1,0],[124,-65,187],[-173,22,-124],[-46,47,-42],[52,-4,-16],[-82,-1,19],[11,33,-33],[23,16,-121],[-47,2,141],[6,-9,-13],[48,13,22],[-48,6,-46],[14,-72,59]],[[-4,-6,17],[4,3,1],[-1,2,-15],[0,0,0],[17,1,2],[-27,-1,0],[137,-52,211],[-224,101,-129],[-165,56,6],[67,-11,-19],[-101,-2,24],[9,33,-34],[14,7,-127],[-39,4,144],[-5,-28,-19],[51,10,19],[-53,8,-47],[19,-72,62]],[[-4,-7,17],[4,4,0],[1,2,-16],[0,0,0],[19,2,4],[-27,-1,0],[139,-43,222],[136,131,103],[-217,7,22],[80,-13,-18],[-118,-3,27],[4,26,-32],[5,1,-130],[-35,7,151],[-16,-45,-28],[51,11,18],[-55,9,-49],[24,-72,66]],[[-1,-10,15],[3,8,1],[3,1,-16],[0,0,0],[16,2,5],[-27,-1,0],[134,-43,221],[95,107,142],[-207,0,22],[86,-9,-15],[-125,0,25],[-1,18,-28],[-4,-4,-132],[-35,11,168],[-25,-53,-33],[49,14,17],[-55,8,-49],[26,-72,68]],[[2,-15,12],[3,13,2],[4,1,-13],[0,0,0],[11,2,3],[-27,-1,0],[118,-52,204],[-34,150,290],[-219,26,27],[76,2,-11],[-111,5,17],[11,17,-29],[-13,-7,-133],[-40,16,183],[-23,-50,-28],[44,20,17],[-51,7,-48],[22,-73,67]],[[5,-21,10],[4,20,3],[4,0,-11],[0,0,0],[6,1,1],[-27,-1,0],[90,-59,175],[-178,85,-180],[-203,68,9],[60,13,-6],[-87,8,9],[18,17,-30],[-18,-9,-131],[-50,21,188],[-15,-43,-19],[40,27,17],[-49,7,-50],[14,-72,64]],[[8,-27,8],[4,26,4],[2,0,-9],[0,0,0],[2,1,-2],[-27,0,0],[63,-57,148],[-180,35,-176],[-127,74,-50],[46,23,-2],[-65,8,3],[17,19,-32],[-20,-9,-128],[-61,23,185],[-7,-37,-10],[37,33,17],[-48,7,-52],[7,-71,62]],[[10,-30,9],[5,29,4],[1,0,-9],[0,0,0],[1,0,-4],[-27,0,0],[49,-52,135],[-183,12,-177],[-99,63,-66],[41,27,0],[-55,7,1],[17,22,-35],[-18,-7,-127],[-71,24,177],[-3,-35,-2],[36,36,17],[-48,7,-54],[7,-71,64]],[[9,-27,10],[5,26,3],[0,1,-11],[0,0,0],[3,0,-4],[-27,0,0],[58,-55,141],[-181,25,-179],[-116,72,-42],[55,21,-6],[-79,9,7],[21,27,-39],[-13,-5,-129],[-77,22,169],[-3,-40,3],[38,34,15],[-49,7,-54],[16,-73,70]],[[6,-22,13],[5,21,1],[0,1,-13],[0,0,0],[6,0,-3],[-27,0,0],[81,-60,160],[-175,63,-183],[-139,67,-2],[69,10,-11],[-103,7,18],[29,39,-51],[-9,-4,-131],[-77,20,166],[-4,-48,8],[43,27,12],[-53,8,-54],[28,-73,77]],[[2,-17,16],[5,15,-1],[-1,1,-15],[0,0,0],[10,0,-1],[-27,0,0],[114,-62,184],[-162,114,-195],[-136,44,26],[85,-5,-19],[-128,-1,31],[16,48,-52],[-5,-4,-132],[-76,18,167],[-6,-55,13],[49,20,11],[-58,9,-56],[34,-73,81]],[[-1,-12,19],[5,10,-3],[-3,2,-16],[0,0,0],[15,0,0],[-27,0,0],[144,-60,205],[25,149,247],[-113,23,38],[95,-18,-26],[-139,-10,41],[-6,47,-44],[-1,-5,-128],[-80,23,162],[-3,-57,23],[56,14,12],[-63,11,-58],[34,-74,82]],[[-4,-8,21],[5,6,-6],[-3,2,-16],[0,0,0],[17,0,1],[-27,0,0],[159,-59,213],[104,139,180],[-98,24,37],[93,-24,-29],[-134,-14,44],[-10,45,-42],[1,-6,-125],[-82,29,150],[1,-56,36],[58,9,11],[-61,9,-55],[31,-75,80]],[[-5,-6,22],[4,3,-7],[-3,2,-15],[0,0,0],[17,1,2],[-27,0,0],[143,-57,204],[31,140,253],[-94,35,29],[85,-24,-30],[-123,-12,41],[-12,37,-36],[2,-7,-124],[-83,33,139],[5,-56,50],[58,6,10],[-57,7,-50],[24,-76,77]],[[-5,-5,20],[4,3,-7],[-3,2,-12],[0,0,0],[14,1,2],[-27,0,0],[104,-50,184],[-117,120,-238],[-89,52,10],[75,-19,-28],[-109,-8,33],[-7,30,-31],[3,-5,-120],[-87,39,131],[6,-56,61],[58,6,13],[-55,6,-49],[13,-76,70]],[[-4,-6,15],[5,4,-5],[-6,1,-7],[0,0,0],[12,2,2],[-27,-1,0],[71,-40,164],[-167,76,-200],[-69,60,-21],[63,-10,-22],[-93,-4,25],[0,26,-27],[21,13,-106],[-92,42,126],[-3,-53,50],[58,12,21],[-55,7,-53],[4,-74,63]],[[-4,-8,7],[6,7,-1],[-10,0,0],[0,0,0],[12,3,3],[-27,-1,0],[50,-32,143],[-188,15,-174],[-43,46,-54],[46,2,-7],[-62,2,13],[10,28,-30],[44,40,-95],[-95,42,122],[-9,-44,32],[59,20,32],[-58,10,-58],[-3,-71,55]],[[-4,-8,0],[7,8,2],[-13,-1,7],[0,0,0],[15,4,3],[-27,-2,0],[37,-23,128],[-168,-50,-130],[-28,26,-67],[35,8,6],[-43,3,7],[10,29,-33],[68,68,-89],[-97,44,119],[-4,-32,19],[63,27,42],[-69,16,-65],[12,-68,60]],[[-4,-8,-5],[7,8,5],[-15,-2,11],[0,0,0],[20,5,5],[-27,-2,0],[26,-14,114],[-123,-68,-88],[-17,23,-72],[34,10,14],[-44,3,7],[14,28,-37],[90,92,-89],[-101,47,119],[10,-22,10],[74,35,48],[-92,27,-69],[17,-59,55]],[[-3,-6,-7],[8,6,6],[-16,-2,13],[0,0,0],[24,6,6],[-27,-3,0],[15,-2,107],[-103,-69,-75],[-6,28,-78],[35,9,17],[-51,4,11],[19,27,-41],[111,102,-104],[-118,24,143],[7,-11,24],[91,39,46],[-121,36,-61],[5,-48,39]],[[-2,-4,-5],[8,4,6],[-16,-2,12],[0,0,0],[26,6,6],[-27,-3,0],[7,7,100],[-111,-76,-88],[-2,34,-78],[35,6,16],[-53,4,13],[21,26,-43],[110,99,-108],[-121,-23,176],[-70,-45,30],[102,35,36],[-141,33,-45],[6,-40,29]],[[0,-1,-3],[8,1,6],[-14,-1,11],[0,0,0],[24,6,5],[-27,-3,0],[1,12,94],[-139,-82,-117],[-3,40,-74],[32,3,16],[-49,4,13],[18,26,-44],[97,95,-99],[-116,-33,193],[-88,-47,8],[104,27,28],[-146,25,-33],[7,-35,21]],[[1,2,-1],[7,-2,6],[-11,-1,10],[0,0,0],[22,6,5],[-27,-3,0],[-2,13,92],[-173,-77,-152],[-5,48,-65],[27,0,16],[-40,3,11],[13,27,-43],[92,83,-111],[-104,-54,213],[-99,-47,-5],[94,19,25],[-131,17,-24],[19,-35,19]],[[2,4,1],[6,-5,6],[-8,-1,10],[0,0,0],[19,7,4],[-27,-3,0],[-4,11,95],[-189,-62,-172],[-6,54,-54],[22,-3,16],[-32,3,8],[6,28,-41],[89,74,-122],[-96,-65,227],[-102,-48,-9],[77,11,23],[-101,9,-16],[28,-38,18]],[[3,4,1],[6,-5,7],[-8,-1,9],[0,0,0],[17,7,4],[-27,-3,0],[-3,7,99],[-186,-55,-171],[-5,57,-50],[19,-3,16],[-28,3,6],[1,29,-39],[86,69,-128],[-104,-60,217],[-83,-53,11],[66,9,23],[-74,4,-12],[9,-39,13]],[[4,1,1],[7,-1,8],[-10,0,7],[0,0,0],[17,7,4],[-27,-3,0],[0,4,101],[-173,-59,-158],[-3,57,-52],[17,0,15],[-28,3,6],[2,29,-38],[82,65,-129],[-111,-48,203],[-57,-49,38],[54,9,20],[-48,1,-9],[-3,-40,13]],[[5,-4,0],[8,4,9],[-12,0,6],[0,0,0],[18,7,5],[-27,-3,0],[3,0,100],[-155,-68,-136],[0,56,-58],[17,5,15],[-32,3,6],[6,29,-39],[90,75,-124],[-116,-36,185],[-54,-45,51],[56,16,20],[-54,2,-14],[-5,-44,18]],[[7,-9,-3],[8,9,11],[-15,0,6],[0,0,0],[21,7,6],[-27,-3,0],[7,-6,95],[-120,-77,-95],[2,51,-69],[18,11,17],[-37,3,6],[11,29,-40],[109,95,-121],[-114,-25,161],[-71,-53,49],[70,27,26],[-79,8,-31],[10,-49,31]],[[8,-13,-7],[9,14,14],[-18,0,8],[0,0,0],[24,7,6],[-27,-3,0],[13,-14,90],[-79,-71,-49],[4,43,-79],[18,16,20],[-41,4,6],[15,30,-40],[137,111,-130],[-112,-27,147],[-110,-64,23],[82,42,36],[-102,20,-51],[17,-54,43]],[[9,-16,-11],[9,17,16],[-22,0,9],[0,0,0],[26,7,7],[-27,-3,0],[19,-24,86],[-54,-57,-22],[4,36,-86],[17,19,23],[-44,4,6],[17,30,-40],[154,119,-137],[-111,-36,145],[-145,-61,-8],[85,53,45],[-111,31,-64],[4,-54,42]],[[9,-17,-13],[10,18,18],[-24,0,9],[0,0,0],[27,7,7],[-27,-3,0],[26,-35,86],[-43,-44,-11],[4,35,-90],[17,20,23],[-46,4,7],[17,31,-40],[145,119,-128],[-110,-45,156],[-168,-50,-26],[80,54,48],[-113,34,-65],[-1,-55,39]],[[9,-15,-11],[10,16,18],[-22,0,7],[0,0,0],[26,6,5],[-27,-3,0],[34,-47,90],[-42,-39,-10],[3,40,-92],[19,18,20],[-48,3,8],[17,32,-41],[112,104,-112],[-105,-40,169],[-158,-61,-25],[73,47,45],[-111,32,-59],[0,-54,37]],[[8,-10,-5],[10,10,16],[-19,1,3],[0,0,0],[24,5,2],[-27,-2,0],[49,-61,105],[-55,-46,-20],[-1,53,-88],[25,11,11],[-54,3,13],[17,33,-41],[85,78,-115],[-109,-3,148],[-73,-76,46],[63,33,39],[-103,25,-49],[23,-52,41]],[[6,-3,1],[10,3,12],[-14,1,-3],[0,0,0],[23,3,0],[-27,-2,0],[75,-75,128],[-81,-57,-44],[-14,70,-74],[33,1,0],[-61,1,20],[18,33,-42],[66,58,-123],[-96,14,117],[-28,-43,80],[52,17,30],[-89,17,-38],[36,-48,39]],[[4,3,9],[9,-4,9],[-12,2,-10],[0,0,0],[23,2,-1],[-27,-1,0],[105,-87,146],[-112,-61,-77],[-40,82,-48],[42,-9,-9],[-72,-2,29],[23,34,-48],[48,43,-123],[-64,0,104],[-7,-25,81],[45,5,21],[-77,12,-31],[37,-45,35]],[[1,7,14],[8,-9,5],[-10,3,-17],[0,0,0],[26,1,1],[-27,0,0],[145,-101,165],[-139,-49,-113],[-81,80,-8],[55,-20,-15],[-90,-7,43],[28,34,-56],[32,28,-119],[-23,-19,110],[11,-18,76],[45,-3,14],[-75,10,-28],[41,-43,36]],[[-2,9,18],[7,-12,2],[-9,4,-22],[0,0,0],[28,1,4],[-27,0,0],[194,-102,198],[-163,48,-147],[-70,46,36],[72,-28,-19],[-111,-14,55],[14,35,-57],[22,17,-118],[-7,-18,115],[17,-15,72],[48,-7,11],[-79,10,-29],[47,-43,39]],[[-3,8,20],[7,-11,1],[-9,4,-24],[0,0,0],[29,0,4],[-27,0,0],[228,-95,222],[172,136,131],[-6,11,49],[87,-33,-21],[-125,-19,61],[1,32,-53],[17,9,-121],[-5,-11,120],[19,-20,71],[51,-7,11],[-82,12,-30],[51,-44,42]],[[-4,5,20],[7,-8,0],[-9,4,-25],[0,0,0],[30,0,3],[-27,1,0],[239,-88,230],[162,91,142],[-1,-3,43],[94,-32,-20],[-133,-18,55],[6,28,-49],[14,4,-127],[-14,-4,126],[19,-27,73],[53,-4,11],[-83,13,-34],[50,-45,45]],[[-4,-1,18],[7,-2,0],[-9,4,-25],[0,0,0],[29,-2,0],[-27,1,0],[225,-83,224],[155,89,153],[-19,-5,39],[94,-23,-17],[-134,-9,39],[16,20,-38],[13,3,-131],[-34,2,137],[15,-35,72],[55,3,11],[-81,14,-39],[46,-47,49]],[[-3,-10,15],[8,8,1],[-7,4,-23],[0,0,0],[26,-2,-2],[-27,1,0],[180,-77,203],[107,117,194],[-42,9,40],[87,-8,-13],[-125,3,15],[23,9,-20],[13,4,-130],[-60,6,155],[5,-40,59],[59,14,14],[-80,16,-48],[35,-51,54]],[[-2,-23,10],[8,21,4],[-7,3,-21],[0,0,0],[23,-3,-4],[-27,1,0],[122,-65,175],[-106,116,-239],[-63,38,31],[77,11,-9],[-108,12,-8],[24,-1,0],[18,11,-119],[-85,5,176],[-4,-35,39],[65,30,19],[-78,19,-64],[15,-55,56]],[[-1,-35,4],[7,34,8],[-8,3,-19],[0,0,0],[19,-3,-5],[-27,1,0],[75,-47,153],[-176,44,-189],[-61,63,-2],[61,30,-6],[-81,12,-19],[29,-16,17],[28,28,-99],[-100,1,193],[-1,-24,24],[68,48,26],[-72,21,-82],[-9,-57,54]],[[0,-46,-2],[6,45,13],[-10,3,-18],[0,0,0],[16,-4,-6],[-27,2,0],[44,-30,138],[-201,-23,-171],[-40,60,-43],[55,45,0],[-74,13,-26],[32,-20,22],[40,54,-76],[-104,-6,200],[11,-16,15],[68,65,35],[-65,20,-98],[-24,-60,54]],[[0,-53,-10],[4,53,17],[-12,3,-16],[0,0,0],[14,-4,-5],[-27,2,0],[26,-17,126],[-201,-78,-147],[-28,39,-61],[53,56,7],[-75,16,-32],[35,-19,25],[50,86,-59],[-105,-10,188],[10,-18,16],[65,77,46],[-60,18,-112],[-26,-67,62]],[[0,-58,-16],[1,58,21],[-14,2,-14],[0,0,0],[12,-3,-4],[-27,1,0],[17,-11,118],[-156,-109,-89],[-22,22,-60],[50,65,16],[-77,19,-37],[38,-19,26],[63,116,-54],[-105,-18,169],[-11,-26,23],[58,87,60],[-56,17,-124],[-37,-72,61]],[[1,-61,-20],[-2,62,24],[-14,2,-11],[0,0,0],[11,-2,-2],[-27,1,0],[15,-11,112],[-87,-106,-17],[-17,13,-54],[47,70,23],[-78,21,-40],[39,-19,26],[86,134,-69],[-103,-31,151],[-44,-39,23],[48,93,72],[-52,16,-129],[-42,-76,61]],[[2,-62,-21],[-3,63,24],[-12,1,-9],[0,0,0],[8,-2,-2],[-27,1,0],[18,-16,113],[-62,-91,7],[-13,10,-48],[44,72,26],[-77,22,-41],[39,-19,25],[90,133,-76],[-99,-35,147],[-64,-50,19],[42,92,74],[-50,16,-127],[-34,-81,66]],[[4,-61,-17],[-3,61,22],[-7,1,-9],[0,0,0],[5,-2,-4],[-27,1,0],[22,-23,122],[-64,-84,6],[-12,8,-41],[42,69,24],[-74,20,-38],[36,-19,22],[77,116,-80],[-98,-28,152],[-70,-58,20],[40,86,63],[-50,15,-114],[-7,-84,82]],[[6,-57,-11],[-2,56,18],[-2,1,-10],[0,0,0],[1,-3,-6],[-27,1,0],[31,-31,135],[-71,-85,3],[-14,3,-34],[41,63,18],[-71,17,-33],[33,-18,18],[59,92,-85],[-91,-20,153],[-56,-66,32],[36,75,48],[-48,13,-95],[23,-80,94]],[[8,-49,-5],[0,49,14],[2,0,-12],[0,0,0],[-2,-4,-8],[-27,1,0],[45,-39,150],[-107,-92,-33],[-10,-1,-29],[42,52,12],[-71,15,-27],[28,-18,15],[30,55,-88],[-83,6,144],[-24,-58,66],[33,62,35],[-47,11,-76],[30,-73,87]],[[9,-41,2],[2,40,10],[3,0,-16],[0,0,0],[-3,-4,-8],[-27,2,0],[68,-48,165],[-171,-61,-107],[0,-2,-30],[46,41,5],[-74,14,-22],[24,-18,11],[3,18,-95],[-75,29,131],[-5,-34,81],[31,50,25],[-47,9,-62],[33,-70,80]],[[8,-35,7],[4,34,7],[1,1,-19],[0,0,0],[0,-4,-7],[-27,2,0],[91,-51,181],[-193,6,-139],[-3,5,-40],[53,32,0],[-83,14,-17],[26,-17,9],[-2,6,-102],[-70,29,135],[1,-32,71],[33,41,17],[-48,8,-54],[37,-69,77]],[[6,-31,9],[6,30,5],[-2,2,-21],[0,0,0],[4,-4,-5],[-27,2,0],[108,-48,196],[-202,85,-157],[-51,34,-44],[65,26,-1],[-102,19,-16],[37,-14,6],[-1,2,-110],[-62,21,144],[3,-37,55],[35,36,13],[-49,8,-51],[39,-69,77]],[[4,-31,10],[8,30,3],[-4,2,-21],[0,0,0],[7,-3,-3],[-27,1,0],[116,-43,206],[-85,149,-293],[-129,46,-8],[83,25,2],[-128,27,-15],[34,-9,1],[0,0,-121],[-51,13,153],[3,-41,38],[37,36,12],[-49,8,-51],[38,-69,77]],[[4,-33,9],[8,32,3],[-5,2,-19],[0,0,0],[5,-3,-3],[-27,1,0],[116,-45,204],[1,143,251],[-168,42,8],[97,28,4],[-145,34,-16],[19,-6,-2],[0,-1,-133],[-38,6,160],[0,-42,23],[37,38,12],[-48,8,-51],[35,-69,76]],[[4,-36,7],[7,35,4],[-5,2,-15],[0,0,0],[1,-2,-5],[-27,1,0],[107,-51,191],[-170,121,-198],[-206,52,15],[96,32,3],[-138,33,-16],[14,-5,-4],[-8,-7,-135],[-34,13,158],[2,-29,22],[35,41,11],[-44,6,-49],[30,-70,75]],[[5,-40,5],[7,39,4],[-3,1,-11],[0,0,0],[-4,-2,-8],[-27,1,0],[93,-56,175],[-198,64,-169],[-259,60,25],[89,36,2],[-120,28,-16],[11,-4,-8],[-15,-11,-133],[-31,19,151],[4,-16,21],[32,45,11],[-38,4,-45],[25,-71,72]],[[6,-44,4],[6,43,4],[-3,1,-7],[0,0,0],[-8,-2,-12],[-27,1,0],[81,-59,160],[-206,-36,-145],[272,63,48],[81,41,2],[-99,22,-15],[4,-3,-13],[-19,-14,-128],[-28,24,140],[5,-10,21],[29,48,10],[-33,2,-40],[20,-72,69]],[[6,-45,4],[6,45,4],[-4,1,-5],[0,0,0],[-11,-2,-16],[-27,2,0],[74,-60,151],[-171,-97,-100],[280,100,27],[74,43,1],[-78,16,-11],[-11,-2,-17],[-20,-15,-122],[-26,27,129],[6,-13,25],[28,49,9],[-31,2,-36],[17,-73,67]],[[6,-43,5],[7,42,3],[-4,1,-5],[0,0,0],[-12,-2,-17],[-27,2,0],[74,-59,152],[-184,-90,-113],[-303,101,-3],[69,40,1],[-65,13,-7],[-26,-2,-20],[-18,-13,-126],[-21,22,132],[6,-17,29],[28,46,7],[-33,2,-35],[17,-73,66]],[[5,-37,7],[8,36,1],[-5,1,-6],[0,0,0],[-10,-2,-16],[-27,2,0],[80,-59,158],[-213,-41,-149],[312,75,19],[71,32,1],[-68,13,-2],[-24,-2,-23],[-15,-11,-130],[-18,17,135],[7,-21,32],[30,40,5],[-36,2,-35],[20,-73,67]],[[3,-29,10],[8,28,-1],[-5,1,-7],[0,0,0],[-6,-2,-15],[-27,2,0],[95,-61,168],[-206,73,-183],[-276,38,13],[79,22,0],[-78,14,-2],[-18,-3,-21],[-11,-10,-133],[-18,15,138],[8,-25,35],[34,31,4],[-39,3,-38],[25,-73,71]],[[0,-22,14],[7,20,-2],[-5,1,-9],[0,0,0],[-2,-2,-13],[-27,1,0],[116,-65,180],[28,114,213],[-192,15,0],[88,13,2],[-89,16,-8],[-10,-5,-13],[-7,-10,-133],[-21,15,140],[9,-27,39],[37,23,4],[-40,4,-41],[29,-72,74]],[[-2,-16,17],[7,13,-4],[-5,2,-11],[0,0,0],[1,-2,-12],[-27,1,0],[132,-71,186],[62,86,190],[-166,10,-1],[94,5,5],[-97,18,-16],[-10,-7,-4],[-5,-10,-130],[-31,19,140],[9,-27,43],[35,16,3],[-37,4,-42],[31,-72,77]],[[-2,-11,19],[6,9,-5],[-4,2,-13],[0,0,0],[3,-3,-10],[-27,1,0],[127,-75,174],[-75,130,-292],[-170,32,-3],[97,0,6],[-103,18,-19],[-12,-7,1],[-4,-9,-124],[-42,23,138],[8,-27,48],[32,11,4],[-36,4,-44],[33,-72,79]],[[-1,-14,18],[5,12,-4],[-2,2,-14],[0,0,0],[4,-3,-11],[-27,2,0],[99,-71,152],[-187,21,-173],[-86,41,-51],[98,1,3],[-105,18,-21],[-7,-6,4],[-7,-11,-119],[-49,28,136],[8,-26,52],[33,15,7],[-40,5,-47],[37,-73,81]],[[2,-21,16],[4,19,-2],[2,1,-14],[0,0,0],[4,-4,-12],[-27,2,0],[67,-61,130],[-188,-65,-148],[-46,4,-62],[94,6,-4],[-104,17,-23],[-1,-5,8],[-14,-14,-118],[-56,36,132],[7,-23,57],[37,23,7],[-48,8,-47],[40,-73,79]],[[3,-28,14],[2,27,1],[5,1,-14],[0,0,0],[4,-4,-14],[-27,2,0],[42,-50,114],[-160,-102,-110],[-39,-11,-58],[88,12,-12],[-92,13,-26],[-13,-12,15],[-21,-18,-116],[-63,44,126],[6,-19,62],[36,31,8],[-49,8,-47],[41,-73,78]],[[5,-36,12],[1,35,3],[8,0,-12],[0,0,0],[4,-4,-15],[-27,2,0],[25,-39,103],[-114,-110,-59],[-33,-16,-52],[81,19,-19],[-81,10,-26],[-15,-18,21],[-27,-21,-114],[-69,52,119],[4,-14,66],[34,39,8],[-48,8,-46],[40,-74,76]],[[7,-44,12],[-1,43,6],[11,0,-11],[0,0,0],[4,-4,-17],[-27,2,0],[13,-30,97],[-82,-101,-27],[-24,-13,-46],[76,27,-25],[-75,8,-26],[-7,-21,26],[-32,-23,-113],[-72,59,111],[2,-11,69],[32,47,7],[-45,8,-44],[37,-75,74]],[[9,-53,12],[-2,52,8],[12,-1,-9],[0,0,0],[5,-4,-18],[-27,2,0],[5,-22,94],[-66,-88,-13],[-15,-5,-42],[71,36,-29],[-70,8,-24],[-2,-24,27],[-36,-23,-112],[-71,63,101],[1,-8,70],[30,56,8],[-42,7,-41],[32,-76,70]],[[12,-61,13],[-3,60,9],[12,-1,-8],[0,0,0],[5,-4,-20],[-27,1,0],[0,-16,94],[-57,-73,-6],[-8,4,-39],[67,46,-32],[-65,7,-23],[3,-25,28],[-34,-19,-117],[-57,55,78],[3,-11,61],[27,65,8],[-37,6,-39],[25,-77,64]],[[16,-70,15],[-3,69,9],[11,-1,-7],[0,0,0],[6,-4,-21],[-27,1,0],[-3,-12,96],[-51,-59,-1],[-2,12,-37],[63,55,-36],[-60,7,-23],[8,-26,29],[-31,-15,-121],[-46,44,61],[5,-13,50],[24,75,10],[-35,6,-40],[17,-77,57]],[[20,-77,18],[-2,77,9],[9,-1,-6],[0,0,0],[6,-4,-22],[-27,1,0],[-4,-10,100],[-47,-48,3],[1,17,-37],[61,63,-38],[-56,7,-24],[10,-26,30],[-30,-13,-124],[-40,37,52],[4,-12,44],[19,83,18],[-34,8,-47],[10,-73,49]],[[22,-81,19],[-2,81,9],[7,-1,-6],[0,0,0],[6,-3,-22],[-27,1,0],[-3,-8,104],[-44,-40,6],[2,17,-36],[60,68,-40],[-53,6,-24],[10,-27,30],[-28,-12,-126],[-36,33,44],[3,-10,39],[11,88,27],[-33,10,-52],[6,-69,44]],[[22,-81,18],[-2,81,9],[6,0,-5],[0,0,0],[5,-3,-22],[-27,1,0],[-2,-9,108],[-42,-35,8],[-2,12,-35],[59,68,-40],[-51,6,-22],[7,-27,30],[-26,-11,-126],[-34,29,35],[0,-6,34],[5,86,28],[-30,8,-44],[10,-72,44]],[[21,-78,17],[-4,78,9],[6,0,-3],[0,0,0],[4,-2,-20],[-27,1,0],[1,-11,112],[-42,-32,10],[-7,4,-34],[58,65,-39],[-48,5,-20],[3,-27,28],[-23,-9,-126],[-32,26,27],[-3,-2,30],[2,83,25],[-26,5,-34],[12,-75,45]],[[19,-75,15],[-5,75,10],[6,0,-2],[0,0,0],[2,-1,-19],[-27,1,0],[5,-13,116],[-42,-30,11],[-14,-4,-33],[57,62,-37],[-45,4,-18],[-2,-27,27],[-20,-8,-126],[-30,23,18],[-7,3,25],[-2,79,21],[-21,3,-22],[11,-79,43]],[[18,-72,13],[-8,72,11],[6,0,0],[0,0,0],[1,0,-18],[-27,0,0],[8,-14,119],[-42,-27,12],[-20,-11,-34],[56,59,-36],[-41,3,-15],[-7,-28,26],[-18,-7,-127],[-28,18,10],[-11,7,20],[0,76,19],[-21,3,-21],[11,-79,44]]],"h":[[-67,24,-33],[-49,15,-10],[-31,5,13],[-15,-4,35],[-3,-9,50],[-3,-9,56],[-5,-8,60],[-7,-6,64],[-12,-3,65],[-21,-3,59],[-28,-5,51],[-35,-9,43],[-42,-12,34],[-47,-11,24],[-51,-6,18],[-51,0,15],[-50,5,15],[-49,8,16],[-48,8,18],[-48,7,18],[-49,3,17],[-48,-5,16],[-45,-15,15],[-39,-23,16],[-31,-26,18],[-19,-25,21],[-6,-22,25],[7,-20,29],[18,-22,32],[26,-28,33],[31,-31,34],[32,-29,36],[29,-22,37],[25,-15,40],[21,-13,44],[18,-14,47],[16,-18,48],[15,-24,48],[14,-30,51],[15,-33,51],[14,-35,51],[12,-38,50],[10,-39,50],[7,-38,48],[1,-34,44],[-8,-30,38],[-17,-25,31],[-24,-21,23],[-26,-19,13],[-22,-16,5],[-12,-11,-3],[4,-2,-8],[25,9,-11],[48,13,-15],[71,8,-20],[90,-1,-25],[97,-8,-29],[93,-8,-32],[88,-5,-35],[81,-5,-37],[67,-8,-35],[49,-9,-30],[29,-11,-25],[7,-19,-18],[-17,-28,-11],[-34,-28,-7],[-46,-24,-9],[-54,-20,-16],[-58,-17,-24],[-60,-14,-29],[-62,-13,-30],[-65,-12,-28],[-69,-12,-23],[-71,-12,-14],[-69,-12,-6],[-64,-11,3],[-52,-9,9],[-38,-5,14],[-22,1,18],[-2,12,16],[19,24,11],[31,25,3],[43,22,-6],[54,20,-14],[62,24,-20],[70,35,-28],[78,47,-37],[86,53,-45],[91,53,-47],[93,45,-43],[94,32,-36],[93,18,-28],[92,8,-17],[89,8,-5],[84,16,8],[77,21,17],[63,23,21],[40,25,20],[15,21,16],[-9,11,9],[-28,2,2],[-40,0,-1],[-46,6,-3],[-47,15,-3],[-46,25,-3],[-43,30,-3],[-39,30,-3],[-35,27,-4],[-31,20,-5],[-28,13,-6],[-24,8,-7],[-19,6,-6],[-10,7,-4],[3,8,-2],[18,8,1],[32,5,3],[46,0,5],[56,-8,5],[60,-14,4],[61,-16,4],[59,-14,4],[54,-7,4],[47,0,3],[37,1,1],[24,-4,-3],[10,-16,-9],[-4,-28,-14],[-15,-36,-19],[-23,-36,-21],[-21,-27,-19],[-18,-15,-17],[-13,-3,-14],[-6,4,-11],[0,4,-11],[3,3,-11],[6,3,-11],[7,6,-11],[7,13,-11],[7,22,-10],[6,29,-9],[6,35,-8],[7,35,-7],[9,31,-5],[11,24,-3],[14,17,-2],[15,14,-2],[14,12,-5],[7,6,-11],[-2,1,-20],[-10,1,-33],[-16,3,-46],[-24,8,-55],[-34,13,-61],[-46,17,-65],[-59,20,-68],[-71,22,-70],[-78,23,-70],[-77,23,-62],[-74,24,-53],[-70,24,-43],[-67,24,-33]]};
  var EMOFF = [0, 0, 0], EMDUR = [3000, 3000, 3000, 3000, 6700];
  function poseEmote(e) {
    var t = e.t, sn = Math.sin, k = e.k;
    setRot('Head', 0, 0, 0); setRot('Spine', 0, 0, 0); setRot('Spine2', 0, 0, 0);
    setRot('LeftArm', 0, 0, 1.3); setRot('RightArm', 0, 0, -1.3);
    setRot('LeftForeArm', 0, 0, 0); setRot('RightForeArm', 0, 0, 0);
    setRot('LeftHand', 0, 0, 0); setRot('RightHand', 0, 0, 0);
    setRot('LeftUpLeg', 0, 0, 0); setRot('RightUpLeg', 0, 0, 0); setRot('LeftLeg', 0, 0, 0); setRot('RightLeg', 0, 0, 0);
    if (k === 0) { // joget
      var b = sn(t * 9);
      setRot('LeftArm', 0, 0, -1.2 + 0.45 * b); setRot('RightArm', 0, 0, 1.2 + 0.45 * b);
      setRot('LeftForeArm', 0, 0, -0.4 * b); setRot('RightForeArm', 0, 0, -0.4 * b);
      setRot('Spine', 0, 0.25 * b, 0.18 * b); setRot('Head', 0, -0.3 * b, 0);
      setRot('LeftUpLeg', 0.5 * sn(t * 9), 0, 0); setRot('RightUpLeg', -0.5 * sn(t * 9), 0, 0);
      setRot('LeftLeg', -0.4 * Math.max(0, sn(t * 9)), 0, 0); setRot('RightLeg', -0.4 * Math.max(0, -sn(t * 9)), 0, 0);
    } else if (k === 1) { // salam
      setRot('RightArm', 0, 0, 2.5); setRot('RightForeArm', 0, 0, 0.6 * sn(t * 11));
      setRot('Head', 0, 0.15 * sn(t * 3), 0);
    } else if (k === 2) { // tunjuk
      setRot('RightArm', 0, 1.45, -0.1); setRot('RightForeArm', 0, 0, 0); setRot('Spine', 0, -0.15, 0); setRot('Head', 0, -0.2, 0);
      setRot('LeftArm', 0, 0, 1.0); setRot('LeftForeArm', 0, -1.4, 0);
    } else if (k === 4) { // passinho (animasi asli)
      var P = PAS, fr = Math.min(t * P.fps, P.f.length - 1.001), i0 = Math.floor(fr), fa = fr - i0;
      var w = Math.min(1, t / 0.35, Math.max(0, (6.7 - t) / 0.35)), bn, j, A, B;
      for (j = 0; j < P.bones.length; j++) {
        A = P.f[i0][j]; B = P.f[i0 + 1][j];
        setRot(P.bones[j], w * (A[0] + (B[0] - A[0]) * fa) / 100, w * (A[1] + (B[1] - A[1]) * fa) / 100, w * (A[2] + (B[2] - A[2]) * fa) / 100);
      }
      A = P.h[i0]; B = P.h[i0 + 1];
      EMOFF = [w * (A[0] + (B[0] - A[0]) * fa) / 1000, w * (A[1] + (B[1] - A[1]) * fa) / 1000, w * (A[2] + (B[2] - A[2]) * fa) / 1000];
    } else { // tepuk tangan
      var c2 = 0.5 + 0.5 * sn(t * 14);
      setRot('LeftArm', 0, -1.15, 0.2); setRot('RightArm', 0, 1.15, -0.2);
      setRot('LeftForeArm', 0, -0.2 - 0.9 * c2, 0); setRot('RightForeArm', 0, 0.2 + 0.9 * c2, 0);
      setRot('Head', 0.1, 0, 0);
    }
  }
  var IBC = {};
  function ibFor(h, a) {
    var key = h + '_' + a, e = IBC[key]; if (e) return e;
    var ids = CH.base.slice(), g = CH.gi;
    if (h > 0 && g['h' + h]) ids = ids.concat(g['h' + h]);
    var ak = a >= 4 ? 'a' + a + '_' + h : (a > 0 ? 'a' + a : '');
    if (ak && g[ak]) ids = ids.concat(g[ak]);
    var b = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ids), gl.STATIC_DRAW);
    return (IBC[key] = { b: b, n: ids.length });
  }
  function skinChar(tint, ice, L) {
    L = L || LOOKDEF; var lk = lookCols(L), LC = lk.c, CLSa = CH.cls, Ga = CH.g;
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
      var cc = LC[CLSa[i]], gg = Ga[i];
      out[o + 8] = Math.min(1, cc[0] * gg) * ik + 0.55 * iw; out[o + 9] = Math.min(1, cc[1] * gg) * ik + 0.85 * iw; out[o + 10] = Math.min(1, cc[2] * gg) * ik + 1 * iw;
    }
    for (i = 0; i < c.nf; i++) {
      var fx0 = FACE[i * 4], fy0 = FACE[i * 4 + 1], fz0 = FACE[i * 4 + 2], fc = FACE[i * 4 + 3], o2 = (n + i) * 12, h = FACEB[i] * 16, fn = FACEN[i];
      if (fc === SKIN) fc = LC[0]; else if (typeof fc === 'number') fc = lk.hat[fc - 100];
      out[o2] = M[h] * fx0 + M[h + 4] * fy0 + M[h + 8] * fz0 + M[h + 12];
      out[o2 + 1] = M[h + 1] * fx0 + M[h + 5] * fy0 + M[h + 9] * fz0 + M[h + 13];
      out[o2 + 2] = M[h + 2] * fx0 + M[h + 6] * fy0 + M[h + 10] * fz0 + M[h + 14];
      out[o2 + 3] = M[h] * fn[0] + M[h + 4] * fn[1] + M[h + 8] * fn[2]; out[o2 + 4] = M[h + 1] * fn[0] + M[h + 5] * fn[1] + M[h + 9] * fn[2]; out[o2 + 5] = M[h + 2] * fn[0] + M[h + 6] * fn[1] + M[h + 10] * fn[2];
      out[o2 + 8] = fc[0] * ik + 0.55 * iw; out[o2 + 9] = fc[1] * ik + 0.85 * iw; out[o2 + 10] = fc[2] * ik + iw;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, chBuf);
    gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
    bindVB(chBuf); var ib = ibFor(L.h, L.a); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib.b);
    gl.bindTexture(gl.TEXTURE_2D, c.tex);
    gl.drawElements(gl.TRIANGLES, ib.n, gl.UNSIGNED_SHORT, 0);
  }

  // ================= state =================
  var S = {
    ws: null, id: 0, playing: false, paused: false, alive: false, hp: 100, kills: 0, deaths: 0,
    killLimit: 15, matchOver: false, bots: 0, diff: 1, x: 0, y: 0, z: 0, vy: 0, onGround: true, yaw: 0, pitch: 0, ping: 30,
    lo: DEF_LO.slice(), slot: 0, mag: [0, 0, 0, 0], res: [0, 0, 0, 0], gren: [2, 2, 2], med: 5, held: -1, throwT: 0, frozenUntil: 0, lastNade: 0, reloading: false, reloadEnd: 0, reloadStart: 0,
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
  var xpT = 0;
  function xpToast(msg, big) {
    var e = $('xpt'); if (!e) return;
    e.textContent = msg; e.className = big ? 'big on' : 'on'; clearTimeout(xpT);
    xpT = setTimeout(function () { e.className = ''; }, big ? 2600 : 1400);
  }
  function lvlUI() {
    var li = levelInfo(xpTot), e = $('lvl'); if (!e) return;
    $('lvT').textContent = 'LV ' + li.L; $('lvX').textContent = li.cur + ' / ' + li.need + ' XP';
    $('lvB').firstElementChild.style.width = Math.round(li.cur / li.need * 100) + '%';
  }
  function addXP(n, why) {
    var b = levelInfo(xpTot).L; xpTot += n;
    try { localStorage.setItem('arena_xp', String(xpTot)); } catch (e) { /* abaikan */ }
    var a = levelInfo(xpTot).L; lvlUI();
    if (a > b) { xpToast('LEVEL NAIK! LV ' + a, true); beep(880, 0.25, 'square', 0.12); } else xpToast((why ? why + '  ' : '') + '+' + n + ' XP');
  }
  var lastShotId = 0, lastHitShot = 0;
  var stats = { kills: 0, deaths: 0, wins: 0, shots: 0, hits: 0, heads: 0, wk: {}, sh: {}, ach: {} };
  try { var st0 = JSON.parse(localStorage.getItem('arena_stats') || 'null'); if (st0) for (var sk in st0) stats[sk] = st0[sk]; } catch (e) { /* abaikan */ }
  function saveStats() { try { localStorage.setItem('arena_stats', JSON.stringify(stats)); } catch (e) { /* abaikan */ } }
  function drawProfile() {
    var nm = ($('name').value || '').trim() || 'Pemain';
    $('pnm').textContent = nm; $('pav').textContent = nm.charAt(0).toUpperCase();
    $('pk').textContent = 'Kill ' + stats.kills; $('pd').textContent = 'Mati ' + stats.deaths; $('pw').textContent = 'Menang ' + stats.wins;
    $('pbar').firstElementChild.style.width = ((stats.kills % 10) * 10) + '%';
  }
  var LOBBY = { x: MAP.lobby[0], z: MAP.lobby[1], yaw: MAP.lobby[2] };
  var lobbyChar = { w: 0, fl: -999, sc: 0, sp: 0, col: [0.86, 0.5, 0.45] }; window.__arena = window.__arena || {}; window.__arena.lobbyChar = lobbyChar;

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
  // ---- sintesis suara (noise + dentuman + ekor) ----
  var NB = null, MGN = null;
  function mg(a) {
    if (!MGN) { var c = a.createDynamicsCompressor(); c.threshold.value = -14; c.ratio.value = 6; var g = a.createGain(); g.gain.value = 0.8; g.connect(c); c.connect(a.destination); MGN = g; }
    return MGN;
  }
  function snz(a, t0, dur, type, f0, f1, vol, q) {
    if (!NB) { NB = a.createBuffer(1, a.sampleRate * 1.5, a.sampleRate); var d = NB.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    var s = a.createBufferSource(); s.buffer = NB;
    var f = a.createBiquadFilter(); f.type = type; f.Q.value = q || 0.7; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    var g = a.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(mg(a)); s.start(t0, Math.random() * 0.8); s.stop(t0 + dur + 0.03);
  }
  function sth(a, t0, f0, f1, dur, vol, type) {
    var o = a.createOscillator(), g = a.createGain(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(mg(a)); o.start(t0); o.stop(t0 + dur + 0.03);
  }
  // profil: [crackDur, crackF0, crackF1, crackVol, thumpF0, thumpF1, thumpDur, thumpVol, tailDur, tailVol]
  var GUNP = {
    pistol: [0.07, 4200, 900, 0.8, 190, 70, 0.09, 0.55, 0.16, 0.12],
    revolver: [0.14, 3600, 500, 1.0, 140, 45, 0.2, 0.8, 0.4, 0.2],
    uzi: [0.05, 5200, 1400, 0.7, 210, 90, 0.06, 0.45, 0.1, 0.08],
    smg4: [0.055, 5000, 1300, 0.75, 200, 85, 0.07, 0.5, 0.1, 0.08],
    m16: [0.09, 4600, 800, 0.9, 150, 55, 0.12, 0.65, 0.2, 0.14],
    ak47: [0.1, 4200, 650, 1.0, 120, 45, 0.15, 0.75, 0.24, 0.16],
    lmg: [0.11, 4000, 600, 1.0, 110, 42, 0.16, 0.8, 0.28, 0.18],
    shotgun: [0.26, 3200, 280, 1.2, 95, 32, 0.28, 1.0, 0.55, 0.3],
    dmr: [0.12, 4200, 500, 1.0, 105, 38, 0.2, 0.8, 0.45, 0.22],
    sniper: [0.16, 4400, 380, 1.2, 90, 30, 0.3, 1.0, 0.7, 0.28],
    l118: [0.18, 4400, 320, 1.3, 80, 28, 0.35, 1.1, 0.85, 0.32]
  };
  function gunSound(w, vol) {
    var wd = WP[w], a = audio(); if (!wd) return;
    var p = GUNP[wd.key];
    if (!a || !p || vol <= 0.01) { var s = wd.snd; beep(s[0], s[1], s[2], s[3] * vol, s[4]); return; }
    try {
      var t = a.currentTime, v = vol * 0.9, k = 0.93 + Math.random() * 0.14;
      snz(a, t, p[0], 'lowpass', p[1] * k, p[2], p[3] * v, 0.9);
      snz(a, t, p[0] * 0.5, 'highpass', 1800, 1800, p[3] * v * 0.35);
      sth(a, t, p[4] * k, p[5], p[6], p[7] * v);
      snz(a, t + 0.02, p[8], 'lowpass', 1400, 200, p[9] * v, 0.6);
    } catch (e) { /* abaikan */ }
  }
  function swishSound(vol) { var a = audio(); if (!a) return; try { var t = a.currentTime; snz(a, t, 0.16, 'bandpass', 700, 2600, 0.45 * vol, 1.2); } catch (e) { /* abaikan */ } }
  function stepSound(vol) {
    var a = audio(); if (!a || vol <= 0.01) return;
    try { var t = a.currentTime, k = 0.85 + Math.random() * 0.3; snz(a, t, 0.07, 'lowpass', 900 * k, 220, 0.5 * vol, 0.8); sth(a, t, 95 * k, 50, 0.06, 0.35 * vol); } catch (e) { /* abaikan */ }
  }
  function clickSound(f, vol) { var a = audio(); if (!a) return; try { var t = a.currentTime; snz(a, t, 0.035, 'highpass', f, f, 0.5 * vol, 1); sth(a, t, f * 0.4, f * 0.2, 0.04, 0.3 * vol, 'square'); } catch (e) { /* abaikan */ } }
  function clackSound(vol) { var a = audio(); if (!a) return; try { var t = a.currentTime; snz(a, t, 0.06, 'bandpass', 1500, 700, 0.7 * vol, 1.4); sth(a, t, 260, 110, 0.08, 0.45 * vol, 'triangle'); } catch (e) { /* abaikan */ } }
  function hurtSound() { var a = audio(); if (!a) return; try { var t = a.currentTime; snz(a, t, 0.12, 'lowpass', 1100, 200, 0.9, 0.8); sth(a, t, 170, 60, 0.14, 0.7); } catch (e) { /* abaikan */ } }
  function deathSound() { var a = audio(); if (!a) return; try { var t = a.currentTime; sth(a, t, 160, 45, 0.7, 0.6, 'sawtooth'); snz(a, t, 0.5, 'lowpass', 700, 120, 0.6, 0.7); } catch (e) { /* abaikan */ } }
  function boomSound(vol) { var a = audio(); if (!a || vol <= 0.01) return; try { var t = a.currentTime; snz(a, t, 0.9, 'lowpass', 2200, 110, 1.3 * vol, 0.8); sth(a, t, 80, 26, 0.9, 1.2 * vol); snz(a, t + 0.05, 1.4, 'lowpass', 600, 80, 0.5 * vol, 0.6); } catch (e) { /* abaikan */ } }
  function landSound(vol) { var a = audio(); if (!a) return; try { var t = a.currentTime; sth(a, t, 110, 45, 0.1, 0.6 * vol); snz(a, t, 0.08, 'lowpass', 700, 200, 0.5 * vol, 0.8); } catch (e) { /* abaikan */ } }

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
    var ox = S.x, oz = S.z, wasAir = !S.onGround;
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
    var vy0 = S.vy;
    if (S.y <= g) { S.y = g; S.vy = 0; S.onGround = true; } else S.onGround = false;
    if (S.onGround && wasAir && vy0 < -6) landSound(Math.min(1, -vy0 / 14));
    if (S.onGround && S.playing && S.alive) {
      S.stepAcc = (S.stepAcc || 0) + Math.hypot(S.x - ox, S.z - oz);
      var stride = S.stance === 0 ? 1.15 : (S.stance === 1 ? 0.8 : 0.6);
      if (S.stepAcc > stride) { S.stepAcc = 0; stepSound(S.stance === 0 ? 0.5 : (S.stance === 1 ? 0.22 : 0.1)); }
    }
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
      send({ t: 'join', name: name, lo: pick, look: lookStr(Object.assign({}, myLook, { k: effK(myLook) })) });
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
        S.mode = m.mode || 0; S.id = m.id; S.killLimit = m.killLimit; S.matchOver = m.matchOver; S.bots = m.bots || 0; S.diff = m.diff || 0;
        S.playing = true; document.body.classList.add('playing');
        show('menu', false); $('hud').classList.remove('hide');
        $('klim').textContent = S.killLimit;
        modeUI();
        if (modeSet && modeSel !== S.mode) send({ t: 'mode', m: modeSel });
        break;
      case 'full': $('err').textContent = 'Server penuh (maksimal 12 pemain).'; $('mPlay').disabled = false; break;
      case 'pong': S.ping = Math.round(now - m.c); break;
      case 'roster':
        roster = {};
        m.list.forEach(function (r) { roster[r[0]] = { name: r[1], color: r[2], bot: !!r[3], look: r[4] || '', team: r[5] | 0 }; });
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
        if (m.g) { S.gren = m.g.slice(); }
        updateNadeBtns();
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
        if (m.id !== S.id) swishSound(0.4);
        break;
      case 'boom': addBoom(m, now); break;
      case 'freeze':
        if (m.id === S.id) { S.frozenUntil = now + m.ms; fireHeld = false; S.ads = false; beep(1500, 0.25, 'sine', 0.15, 0.4); }
        else froz[m.id] = now + m.ms;
        break;
      case 'mode': S.mode = m.m | 0; modeUI(); break;
      case 'shot': onShot(m, now); break;
      case 'emote': if (m.id !== S.id && remotes[m.id]) remotes[m.id].em = { k: m.k, t0: now }; break;
      case 'hit':
        hitT = now; hitKill = !!m.k; hitHead = !!m.h;
        if (lastShotId !== lastHitShot) { lastHitShot = lastShotId; stats.hits++; }
        beep(m.k ? 1200 : (m.h ? 1500 : 900), m.k ? 0.15 : 0.05, 'square', 0.1);
        break;
      case 'hurt':
        flashA = Math.min(1, 0.45 + (100 - m.hp) / 130); flashT = now;
        dmgDirs.push({ ax: m.ax, az: m.az, t: now });
        hurtSound(); if (m.hp <= 0) setTimeout(deathSound, 120);
        if (m.hp <= 0) {
          S.alive = false; S.climb = false; S.stance = 0; S.hp = 0; S.held = -1; updateNadeBtns(); fireHeld = false; S.ads = false; S.deathAt = now; S.killer = m.a; S.killerW = m.w; S.spec = m.a;
          $('dwho').textContent = 'Dikalahkan ' + nameOf(m.a);
          show('dead', true);
        }
        break;
      case 'kill':
        addFeed(m);
        if (m.k === S.id) { stats.kills++; if (m.h) stats.heads++; stats.wk[m.w] = (stats.wk[m.w] || 0) + 1; saveStats(); checkAch(); addXP(100 + (m.h ? 50 : 0), (m.h ? 'HEADSHOT · ' : 'KILL · ') + nameOf(m.v)); }
        if (m.v === S.id) { stats.deaths++; saveStats(); }
        break;
      case 'win': onWin(m); break;
      case 'reset':
        S.matchOver = false; endPodium(); show('win', false); show('dead', false); $('feed').innerHTML = ''; nadeSt = {}; booms = []; smokeZ = [];
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
    $('bFire').setAttribute('data-h', S.held);
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
    swishSound(0.5);
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
      boomSound(vol);
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
    if (self && w.slot !== 2) { stats.shots++; stats.sh[m.w] = (stats.sh[m.w] || 0) + 1; lastShotId = stats.shots; if (stats.shots % 10 === 0) saveStats(); }
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
    var wd = WP[m.w], ic = wd && wd.key ? '<i class="fi wk_' + wd.key + '"></i>' : '<em>' + esc(wd ? wd.name : '') + '</em>';
    d.innerHTML = '<span class="fk">' + esc(nameOf(m.k)) + '</span>' + ic + (m.h ? '<i class="fi hs"></i>' : '') + '<span class="fv">' + esc(nameOf(m.v)) + '</span>';
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
      if (S.mode === 1) {
        var ts = [0, 0]; rs.forEach(function (r) { ts[teamOf(r.id)] += r.k; });
        hr.unshift('<div class="tl">TIM MERAH ' + ts[0] + ' : ' + ts[1] + ' TIM BIRU · target ' + S.killLimit * 2 + '</div>');
      } else hr.unshift('<div class="tl">' + (S.mode === 2 ? 'Last Man Standing · tersisa satu orang' : 'Target ' + S.killLimit + ' kill') + '</div>');
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
  var WLEN = { m16: .86, ak47: .88, smg4: .6, shotgun: .95, uzi: .42, sniper: 1.2, dmr: 1.1, l118: 1.25, knife: .34, golok: .62, lmg: 1.164, pistol: .256, revolver: .352, bat: .85 };
  var lastSb = '';
  var MODES = ['DEATHMATCH', 'TEAM DEATHMATCH', 'LAST MAN STANDING'];
  var modeSel = 0, modeSet = false;
  try { modeSel = +localStorage.getItem('arena_mode') || 0; modeSet = false; } catch (e) {}
  function teamOf(id) { return id === S.id ? (roster[S.id] ? roster[S.id].team : 0) : (roster[id] ? roster[id].team : 0); }
  function modeUI() {
    var m = S.playing ? (S.mode || 0) : modeSel;
    if ($('mMode')) $('mMode').lastChild.textContent = MODES[m];
    if (S.playing) $('mode').textContent = (S.bots > 0 ? 'Bot · ' + DIFF[Math.max(0, Math.min(2, S.diff))] + ' · ' : '') + MODES[m];
  }
  function buildSlots() {
    var h = '';
    for (var i = 0; i < 4; i++) h += '<div class="slot' + (i === S.slot ? ' on' : '') + '" data-s="' + i + '"><u>' + (i + 1) + '</u><em class="wi wk_' + WP[S.lo[i]].key + '" style="width:' + Math.round(40 + 52 * Math.min(1, (WLEN[WP[S.lo[i]].key] || 0.6) / 1.25)) + '%"></em><i></i></div>';
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
      var left = Math.max(0, 3 - (now - S.deathAt) / 1000), rdy = !S.matchOver && S.mode !== 2 && left <= 0;
      $('dsub').textContent = S.matchOver ? 'Ronde selesai' : (S.mode === 2 ? 'Kamu gugur · tunggu ronde berikutnya' : null) ||  (rdy ? 'Siap hidup kembali' : 'Hidup dalam ' + Math.ceil(left) + ' detik lagi');
      $('dhidup').classList[rdy ? 'add' : 'remove']('rdy');
    }
    $('stat').textContent = fps + ' fps · ' + S.ping + ' ms';
  }
  var toastT = 0;
  function toast(t) { var el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('on'); }, 1100); }

  var podSave = null;
  function endPodium() {
    if (!S.podium) return;
    S.podium = null; document.body.classList.remove('podium');
    if (podSave) { LOBBY.dist = podSave.d; LOBBY.ty = podSave.t; LOBBY.sh = podSave.s; podSave = null; }
  }
  function onWin(m) {
    S.matchOver = true;
    if (m.id === S.id) { stats.wins++; saveStats(); addXP(300); checkAch(); }
    $('wtitle').textContent = m.id === S.id ? 'Kamu menang' : esc(m.name) + ' menang';
    $('wsub').textContent = 'Ronde baru dimulai sebentar lagi';
    var h = '';
    rows().forEach(function (r, i) {
      h += '<div class="r' + (r.me ? ' me' : '') + (i === 0 ? ' first' : '') + '"><span class="n"><b class="rk">' + (i + 1) + '</b>' + esc(r.name) + (r.bot ? ' · bot' : '') + '</span><span class="k">' + r.k + '</span><span class="k">' + r.d + '</span></div>';
    });
    $('wtab').innerHTML = h;
    var wr = remotes[m.id], ww = m.id === S.id ? S.lo[0] : (wr && wr.w !== undefined ? wr.w : pick[0]);
    S.podium = { id: m.id, w: WP[ww] && WP[ww].slot < 2 ? ww : pick[0] };
    podSave = { d: LOBBY.dist, t: LOBBY.ty, s: LOBBY.sh };
    LOBBY.dist = 3.1; LOBBY.ty = 1.0; LOBBY.sh = -1.92;
    document.body.classList.add('podium');
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
    clickSound(1500, 0.6);
  }
  function startReload(now) {
    var w = wdef();
    if (S.held >= 0) return;
    if (w.slot === 2 || S.reloading || !S.alive || S.mag[S.slot] >= w.mag) return;
    if (S.res[S.slot] <= 0) { if (S.mag[S.slot] <= 0) toast('Peluru habis'); return; }
    S.reloading = true; S.reloadStart = now; S.reloadEnd = now + w.reload; S.ads = false;
    clickSound(1800, 0.8);
    var rl = w.reload, rk = S.reloadEnd;
    setTimeout(function () { if (S.reloading && S.reloadEnd === rk) clickSound(1100, 0.9); }, rl * 0.45);
  }
  function tickWeapon(now) {
    if (S.reloading && now >= S.reloadEnd) {
      var w = wdef(), take = Math.min(w.mag - S.mag[S.slot], S.res[S.slot]);
      S.mag[S.slot] += take; S.res[S.slot] -= take; S.reloading = false;
      clackSound(0.9);
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
    if (w.slot === 2) { S.swingT = now; swishSound(0.8); return; }
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
    if (S.mode === 1 && S.playing && id !== 'lobby' && roster[id]) tint = roster[id].team ? [0.6, 0.85, 1.35] : [1.35, 0.6, 0.6];
    var w = WP[r.w] || WP[0], melee = w.slot === 2;
    var dt = r.lt ? Math.min(100, now - r.lt) : 16; r.lt = now;
    r.mva = (r.mva || 0) + ((p.mv ? 1 : 0) - (r.mva || 0)) * Math.min(1, dt / 90);
    r.ph = (r.ph || 0) + dt * 0.0105 * r.mva;
    var sw = melee ? (now - r.fl) / 320 : -1;
    var tc = p.st === 1 ? 1 : 0, tp = p.st === 2 ? 1 : 0, kk = Math.min(1, dt / 110);
    r.sc = (r.sc || 0) + (tc - (r.sc || 0)) * kk; r.sp = (r.sp || 0) + (tp - (r.sp || 0)) * kk;
    EM = null; EMOFF = [0, 0, 0];
    if (r.em && now - r.em.t0 < EMDUR[r.em.k] && !(p.mv && id !== 'lobby') && now - r.fl > 400 && r.sc < 0.2 && r.sp < 0.2) EM = { k: r.em.k, t: (now - r.em.t0) / 1000 };
    poseChar(r.ph, r.mva, p.pitch || 0, sw, melee, r.sc, r.sp);
    var base = mul(mul(mT(p.x, p.y - 0.4 * r.sc + 0.14 * r.sp + (EM && EM.k === 0 ? Math.abs(Math.sin(EM.t * 9)) * 0.07 : 0), p.z), mRy(p.yaw)), mT(EMOFF[0], EMOFF[1], EMOFF[2]));
    if (r.sp > 0.01) base = mul(base, mul(mT(0, 0, 0.85 * r.sp), mRx(-1.5708 * r.sp)));
    setModel(base);
    skinChar(tint, (froz[id] || 0) > now, lookOf(id));
    var mdl = EM ? null : WM[w.key];
    if (mdl) {
      var len = mdl.size[2], pit = (p.pitch || 0) * 0.95;
      var wm;
      if (melee) wm = mul(base, mul(mT(0.14, 1.2, -0.46), mul(mRx(0.75), mRy(0))));
      else wm = mul(base, mul(mT(0, 1.38, 0), mul(mRx(pit), mT(0.1, -0.27, -0.45))));
      drawModel(w.key, wm, 0);
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
    if (S.playing && !S.podium) gl.clearColor(FOG[0], FOG[1], FOG[2], 1); else gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    var aspect = W / H, fov = aspect < 1.1 ? 1.55 : 1.22;
    var ex, ey, ez, tx, ty, tz;
    var cur = S.playing ? wdef() : null;
    if (!S.playing || S.podium) {
      var ly = LOBBY.yaw, fwx = -Math.sin(ly), fwz = -Math.cos(ly), sdx = Math.cos(ly), sdz = -Math.sin(ly);
      var dist = LOBBY.dist || 3.6, tgy = LOBBY.ty || 1.0;
      var lsh = 0.1 + (LOBBY.sh || 0); ex = LOBBY.x + fwx * dist + sdx * lsh; ey = LOBBY.dist ? tgy : 1.25; ez = LOBBY.z + fwz * dist + sdz * 0.1;
      tx = LOBBY.x + sdx * (LOBBY.sh || 0); ty = tgy; tz = LOBBY.z + sdz * (LOBBY.sh || 0);
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
    if (S.playing && !S.podium) {
      gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf); bindVB(groundBuf); gl.bindTexture(gl.TEXTURE_2D, whiteTex); gl.drawArrays(gl.TRIANGLES, 0, groundCount);
      for (var mi = 0; mi < mapParts.length; mi++) drawIdx(mapParts[mi]);
    }
    if (!S.playing || S.podium) {
      var hop = S.podium ? Math.abs(Math.sin(now * 0.0055)) * 0.1 : 0;
      var lp = { x: LOBBY.x, y: hop, z: LOBBY.z, yaw: LOBBY.yaw + (LOBBY.twist !== undefined ? LOBBY.twist : Math.sin(now * 0.0009) * 0.35), pitch: 0, mv: false };
      lobbyChar.w = LOBBY.w !== undefined ? LOBBY.w : pick[0];
      if (S.podium && S.podium.w !== undefined) lobbyChar.w = S.podium.w;
      drawPlayer('lobby', lp, lobbyChar, now);
      return;
    }

    var arr = [], id, i;
    for (id in remotes) {
      var r = remotes[id]; if (!r.alive) continue;
      var p = poseOf(r, now); if (!p) continue;
      var pdx = p.x - S.x, pdz = p.z - S.z, pd2 = pdx * pdx + pdz * pdz;
      if (S.playing && (pd2 > 8100 || (pd2 > 16 && -Math.sin(S.yaw) * pdx - Math.cos(S.yaw) * pdz < -2))) continue;
      if (S.playing && r._lx !== undefined && pd2 < 900 && Math.abs(p.y - r._ly) < 0.15) {
        r._sa = (r._sa || 0) + Math.hypot(p.x - r._lx, p.z - r._lz);
        if (r._sa > 1.2) { r._sa = 0; stepSound(Math.max(0, 0.45 * (1 - Math.sqrt(pd2) / 30))); }
      }
      r._lx = p.x; r._ly = p.y; r._lz = p.z;
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
        drawModel(cur.key, vm, effK(myLook));
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
  var emoOpen = false;
  function emoShow(v) { emoOpen = v; $('emoP').style.display = v ? 'flex' : 'none'; $('bEmo').classList.toggle('on', v); }
  bindBtn('bEmo', function () { emoShow(!emoOpen); }, function () {});
  [0, 1, 2, 3, 4].forEach(function (k) {
    bindBtn('em' + k, function () { emoShow(false); if (S.playing && S.alive !== false) { send({ t: 'emote', k: k }); xpToast(['JOGET', 'SALAM', 'TUNJUK', 'TEPUK TANGAN', 'PASSINHO'][k]); } }, function () {});
  });
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
  var cRowsBuilt = false, lobbySave = null;
  var CROWS = [['s', PAL_S, 35, 146.6], ['sh', PAL_C, 35, 262.7], ['p', PAL_C, 35, 378.8], ['so', PAL_C, 35, 493.7], ['hc', PAL_C, 35, 609.8], ['h', HATS, 818.7, 157.6], ['a', ACCS, 818.7, 360.9], ['slot', ['Slot 1', 'Slot 2', 'Slot 3'], 35, 698]];
  function rgb(c) { return 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')'; }
  function drawCust() {
    var h = '', u = 'calc(var(--u)*', lv = myLevel();
    CROWS.forEach(function (r) {
      var chips = typeof r[1][0] === 'string';
      h += '<div class="' + (chips ? 'cg' : 'cv') + '" style="left:' + u + r[2] + ');top:' + u + r[3] + ')">';
      r[1].forEach(function (it, i) {
        var on = (r[0] === 'slot' ? slotI : myLook[r[0]]) === i ? ' on' : '', lock = r[0] === 'k' && i > 0 && lv < SKIN_LV;
        if (chips) h += '<button class="cb2' + on + (lock ? ' lock' : '') + '" data-k="' + r[0] + '" data-v="' + i + '">' + (lock ? 'LV ' + SKIN_LV : it) + '</button>';
        else h += '<button class="sw' + on + '" data-k="' + r[0] + '" data-v="' + i + '" style="background:' + rgb(it) + '"></button>';
      });
      h += '</div>';
    });
    $('cRows').innerHTML = h;
  }
  function setLook(k, v) {
    if (k === 'slot') { slotI = v; myLook = slots[v]; saveSlots(); drawCust(); return; }
    if (k === 'k' && v > 0 && myLevel() < SKIN_LV) { toast('Skin senjata kebuka di level ' + SKIN_LV); return; }
    myLook[k] = v; delete myLook._c; saveSlots(); drawCust();
  }
  $('cRows').addEventListener('click', function (e) { var b = e.target.closest('[data-k]'); if (b) setLook(b.getAttribute('data-k'), +b.getAttribute('data-v')); });
  $('cRand').addEventListener('click', function () {
    LKEYS.forEach(function (k, i) { myLook[k] = k === 'k' ? 0 : Math.floor(Math.random() * LLEN[i]); }); delete myLook._c; saveSlots(); drawCust();
  });
  lvlUI();
  var ACH = [
    ['Pemula', 'Kill pertama', function () { return stats.kills; }, 1],
    ['Penembak', '50 kill', function () { return stats.kills; }, 50],
    ['Jagoan', '200 kill', function () { return stats.kills; }, 200],
    ['Pemburu Kepala', '25 headshot', function () { return stats.heads; }, 25],
    ['Juara', 'Menang 5 ronde', function () { return stats.wins; }, 5],
    ['Veteran', 'Capai level 10', function () { return myLevel(); }, 10],
    ['Ahli Granat', '20 kill dengan granat', function () { return stats.wk[14] || 0; }, 20],
    ['Tembakan Jitu', 'Akurasi 40% (min. 200 tembakan)', function () { return stats.shots >= 200 ? Math.round(stats.hits / stats.shots * 100) : 0; }, 40]
  ];
  function checkAch() {
    ACH.forEach(function (a, i) {
      if (!stats.ach[i] && a[2]() >= a[3]) { stats.ach[i] = 1; saveStats(); setTimeout(function () { xpToast('ACHIEVEMENT · ' + a[0], true); }, 900); }
    });
  }
  function favWeapon() {
    var best = -1, bn = 0, k;
    for (k in stats.wk) if (stats.wk[k] > bn) { bn = stats.wk[k]; best = k; }
    if (best < 0) for (k in stats.sh) if (stats.sh[k] > bn) { bn = stats.sh[k]; best = k; }
    return best >= 0 && WP[best] ? WP[best].name : '-';
  }
  function drawStats() {
    var li = levelInfo(xpTot), acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
    var kd = stats.deaths ? (stats.kills / stats.deaths).toFixed(2) : String(stats.kills);
    var items = [['Level', li.L], ['Total XP', xpTot], ['Kill', stats.kills], ['Mati', stats.deaths], ['K/D', kd], ['Menang', stats.wins], ['Akurasi', acc + '%'], ['Headshot', stats.heads], ['Tembakan', stats.shots], ['Senjata favorit', favWeapon()]];
    $('stGrid').innerHTML = items.map(function (it) { return '<div class="sc"><b>' + it[1] + '</b><span>' + it[0] + '</span></div>'; }).join('');
    $('stAch').innerHTML = ACH.map(function (a, i) {
      var v = Math.min(a[3], a[2]()), done = v >= a[3];
      return '<div class="ar' + (done ? ' ok' : '') + '"><div class="at"><b>' + a[0] + '</b><span>' + a[1] + '</span></div><div class="ab"><i style="width:' + Math.round(v / a[3] * 100) + '%"></i></div><em>' + (done ? 'SELESAI' : v + '/' + a[3]) + '</em></div>';
    }).join('');
  }
  $('mMode').addEventListener('click', function () { modeSel = (modeSel + 1) % 3; modeSet = true; try { localStorage.setItem('arena_mode', modeSel); } catch (e) {} modeUI(); });
  modeUI();
  $('mStat').addEventListener('click', function () { drawStats(); show('apanel', true); });
  $('aOk').addEventListener('click', function () { show('apanel', false); });
  checkAch();
  function openCust() {
    drawCust(); document.body.classList.add('cust'); show('cpanel', true);
    lobbySave = { d: LOBBY.dist, t: LOBBY.ty, s: LOBBY.sh, w: LOBBY.w };
    LOBBY.dist = 3.1; LOBBY.ty = 1.0; LOBBY.sh = -1.92; LOBBY.w = pick[0];
  }
  function closeCust() {
    show('cpanel', false); document.body.classList.remove('cust');
    if (lobbySave) { LOBBY.dist = lobbySave.d; LOBBY.ty = lobbySave.t; LOBBY.sh = lobbySave.s; LOBBY.w = lobbySave.w; lobbySave = null; }
  }
  $('cOk').addEventListener('click', closeCust);
  $('th').addEventListener('click', openCust);
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
  window.__arena = { lobbyChar: lobbyChar, joints: function (k, t) {
      EM = { k: k, t: t }; poseChar(0, 0, 0, -1, false, 0, 0); EM = null;
      var o = {}; CH.bones.forEach(function (b, i) { var M = CH.M.slice(i * 16, i * 16 + 16); o[b.n] = xf(M, [b.x, b.y, b.z]); }); return o;
    }, snd: { gun: gunSound, step: stepSound, boom: boomSound, hurt: hurtSound, death: deathSound, clack: clackSound, swish: swishSound }, S: S, remotes: remotes, LOBBY: LOBBY, mapParts: mapParts };
})();
