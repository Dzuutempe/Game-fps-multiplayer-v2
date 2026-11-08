package com.arenafps;

// DIHASILKAN OTOMATIS dari tools/GameMapImpl.tpl.java (lewat genmap3.js). Jangan diedit langsung.

/** Satu peta: kotak tabrakan (grid spasial), spawn, graf navigasi bot, dan ray cast. */
final class GameMapImpl {
    final double minX, maxX, minZ, maxZ;
    final double[][] boxes, spawns, nodes;
    final int[][] adj;
    private final double cs, gx0, gz0;
    private final int gnx, gnz;
    private final int[][] cells;

    private static String[] rows(String[] chunks) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < chunks.length; i++) { if (i > 0) sb.append(';'); sb.append(chunks[i]); }
        return sb.toString().split(";", -1);
    }

    private static double[][] pts(String data) {
        String[] r = data.split(";");
        double[][] o = new double[r.length][];
        for (int i = 0; i < r.length; i++) {
            String[] p = r[i].split(",");
            o[i] = new double[]{Double.parseDouble(p[0]), Double.parseDouble(p[1]), p.length > 2 ? Double.parseDouble(p[2]) : 0};
        }
        return o;
    }

    GameMapImpl(double minX, double maxX, double minZ, double maxZ, double cs, double gx0, double gz0, int gnx, int gnz,
                String[] boxData, String[] cellData, String nodeData, String adjData, String spawnData) {
        this.minX = minX; this.maxX = maxX; this.minZ = minZ; this.maxZ = maxZ;
        this.cs = cs; this.gx0 = gx0; this.gz0 = gz0; this.gnx = gnx; this.gnz = gnz;
        String[] br = rows(boxData);
        boxes = new double[br.length][];
        for (int i = 0; i < br.length; i++) {
            String[] p = br[i].split(",");
            double[] b = new double[6];
            for (int k = 0; k < 6; k++) b[k] = Double.parseDouble(p[k]);
            boxes[i] = b;
        }
        String[] cr = rows(cellData);
        cells = new int[cr.length][];
        for (int i = 0; i < cr.length; i++) {
            if (cr[i].isEmpty()) { cells[i] = new int[0]; continue; }
            String[] p = cr[i].split(",");
            cells[i] = new int[p.length];
            for (int k = 0; k < p.length; k++) cells[i][k] = Integer.parseInt(p[k]);
        }
        nodes = pts(nodeData);
        String[] ar = adjData.split(";", -1);
        adj = new int[ar.length][];
        for (int i = 0; i < ar.length; i++) {
            if (ar[i].isEmpty()) { adj[i] = new int[0]; continue; }
            String[] p = ar[i].split(",");
            adj[i] = new int[p.length];
            for (int j = 0; j < p.length; j++) adj[i][j] = Integer.parseInt(p[j]);
        }
        spawns = pts(spawnData);
    }

    /** Ray vs kotak (slab). Jarak t, atau +Infinity jika meleset. */
    static double rayBox(double ox, double oy, double oz, double dx, double dy, double dz, double[] b) {
        double tmin = 0, tmax = Double.POSITIVE_INFINITY;
        double[] o = {ox, oy, oz}, d = {dx, dy, dz};
        for (int i = 0; i < 3; i++) {
            double lo = b[i], hi = b[i + 3];
            if (Math.abs(d[i]) < 1e-9) {
                if (o[i] < lo || o[i] > hi) return Double.POSITIVE_INFINITY;
            } else {
                double t1 = (lo - o[i]) / d[i], t2 = (hi - o[i]) / d[i];
                if (t1 > t2) { double tmp = t1; t1 = t2; t2 = tmp; }
                if (t1 > tmin) tmin = t1;
                if (t2 < tmax) tmax = t2;
                if (tmin > tmax) return Double.POSITIVE_INFINITY;
            }
        }
        return tmin;
    }

    /** Ray melewati grid 2D (DDA); kotak yang dilewati diuji. */
    double rayWorld(double ox, double oy, double oz, double dx, double dy, double dz) {
        double best = Double.POSITIVE_INFINITY, W = gnx * cs, H = gnz * cs, tmin = 0, tmax = Double.POSITIVE_INFINITY;
        if (Math.abs(dx) < 1e-12) { if (ox < gx0 || ox > gx0 + W) return best; }
        else { double a1 = (gx0 - ox) / dx, a2 = (gx0 + W - ox) / dx; if (a1 > a2) { double q = a1; a1 = a2; a2 = q; } if (a1 > tmin) tmin = a1; if (a2 < tmax) tmax = a2; }
        if (Math.abs(dz) < 1e-12) { if (oz < gz0 || oz > gz0 + H) return best; }
        else { double b1 = (gz0 - oz) / dz, b2 = (gz0 + H - oz) / dz; if (b1 > b2) { double r = b1; b1 = b2; b2 = r; } if (b1 > tmin) tmin = b1; if (b2 < tmax) tmax = b2; }
        if (tmin > tmax) return best;
        double px = ox + dx * tmin, pz = oz + dz * tmin;
        int ix = Math.max(0, Math.min(gnx - 1, (int) Math.floor((px - gx0) / cs))), iz = Math.max(0, Math.min(gnz - 1, (int) Math.floor((pz - gz0) / cs)));
        int sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
        double tdx = Math.abs(dx) < 1e-12 ? Double.POSITIVE_INFINITY : cs / Math.abs(dx), tdz = Math.abs(dz) < 1e-12 ? Double.POSITIVE_INFINITY : cs / Math.abs(dz);
        double tmx = Math.abs(dx) < 1e-12 ? Double.POSITIVE_INFINITY : (gx0 + (dx > 0 ? ix + 1 : ix) * cs - ox) / dx;
        double tmz = Math.abs(dz) < 1e-12 ? Double.POSITIVE_INFINITY : (gz0 + (dz > 0 ? iz + 1 : iz) * cs - oz) / dz;
        for (;;) {
            int[] cl = cells[iz * gnx + ix];
            for (int k = 0; k < cl.length; k++) { double t = rayBox(ox, oy, oz, dx, dy, dz, boxes[cl[k]]); if (t < best) best = t; }
            double tn = tmx < tmz ? tmx : tmz;
            if (best <= tn || tn > tmax) break;
            if (tmx < tmz) { ix += sx; tmx += tdx; } else { iz += sz; tmz += tdz; }
            if (ix < 0 || ix >= gnx || iz < 0 || iz >= gnz) break;
        }
        return best;
    }

    /** Apakah badan pemain (radius 0.4) di (nx,nz) menabrak sesuatu saat kaki di ketinggian y. */
    boolean blocked(double nx, double nz, double y) {
        double R = 0.4;
        int a = Math.max(0, (int) Math.floor((nx - R - gx0) / cs)), c = Math.min(gnx - 1, (int) Math.floor((nx + R - gx0) / cs));
        int d = Math.max(0, (int) Math.floor((nz - R - gz0) / cs)), e = Math.min(gnz - 1, (int) Math.floor((nz + R - gz0) / cs));
        for (int x = a; x <= c; x++) for (int z = d; z <= e; z++) {
            int[] cl = cells[z * gnx + x];
            for (int k = 0; k < cl.length; k++) {
                double[] b = boxes[cl[k]];
                if (b[4] > y + 0.8 && b[1] < y + 1.8 && nx + R > b[0] && nx - R < b[3] && nz + R > b[2] && nz - R < b[5]) return true;
            }
        }
        return false;
    }

    /** Tinggi lantai di (x,z) bagi pemain yang kakinya di y (bisa naik maksimal 0.8 m). */
    double groundAt(double x, double z, double y) {
        double g = 0, r = 0.3;
        int a = Math.max(0, (int) Math.floor((x - r - gx0) / cs)), c = Math.min(gnx - 1, (int) Math.floor((x + r - gx0) / cs));
        int d = Math.max(0, (int) Math.floor((z - r - gz0) / cs)), e = Math.min(gnz - 1, (int) Math.floor((z + r - gz0) / cs));
        for (int ix = a; ix <= c; ix++) for (int iz = d; iz <= e; iz++) {
            int[] cl = cells[iz * gnx + ix];
            for (int k = 0; k < cl.length; k++) {
                double[] b = boxes[cl[k]];
                if (b[4] <= y + 0.8 && b[4] > g && x + r > b[0] && x - r < b[3] && z + r > b[2] && z - r < b[5]) g = b[4];
            }
        }
        return g;
    }

    /** Ada garis lurus bebas hambatan (untuk badan pemain, kaki di y mengikuti lantai) dari a ke b? */
    boolean segClear(double ax, double az, double bx, double bz, double y0) {
        double d = Math.hypot(bx - ax, bz - az);
        int n = (int) Math.ceil(d / 0.35);
        double y = y0;
        for (int i = 0; i <= n; i++) {
            double t = n == 0 ? 0 : (double) i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
            double g = groundAt(x, z, y);
            if (Math.abs(g - y) > 0.8 || blocked(x, z, g)) return false;
            y = g;
        }
        return true;
    }
}
