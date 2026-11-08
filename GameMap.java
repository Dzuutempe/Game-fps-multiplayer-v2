package com.arenafps;

// DIHASILKAN OTOMATIS dari tools/genmap3.js. Jangan diedit langsung.

/** Fasad statis peta aktif. Indeks 0 = bawaan. Ganti peta dengan use(id). */
final class GameMap {
    private GameMap() {}

    static final String[] IDS = {"kota", "desert"};
    static final String[] NAMES = {"Kota", "Kota Gurun"};
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
                case 0: CACHE[id] = MapData0.build(); break;
                case 1: CACHE[id] = MapData1.build(); break;
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
