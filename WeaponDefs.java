package com.arenafps;

// DIHASILKAN OTOMATIS dari tools/genmap.js. Jangan diedit langsung.

/** Tabel senjata. Indeks sama dengan MAP.weapons di map.js. */
final class WeaponDefs {
    private WeaponDefs() {}

    static final int COUNT = 10;
    static final String[] NAME = {"Karabin", "SMG", "Shotgun", "Sniper", "LMG", "Pistol", "Revolver", "Machine Pistol", "Pisau", "Pemukul"};
    static final int[] SLOT = {0, 0, 0, 0, 0, 1, 1, 1, 2, 2};
    static final double[] DMG = {22, 15, 11, 90, 19, 20, 56, 11, 45, 70};
    static final double[] HEAD = {2, 1.8, 1.5, 3, 1.6, 2, 2, 1.7, 1, 1};
    static final int[] RATE = {100, 65, 850, 1400, 85, 200, 650, 75, 380, 750};
    static final int[] PELLETS = {1, 1, 8, 1, 1, 1, 1, 1, 1, 1};
    static final double[] SPREAD = {0.012, 0.028, 0.07, 0.045, 0.03, 0.01, 0.006, 0.035, 0, 0};
    static final double[] ADS = {0.4, 0.55, 0.7, 0, 0.5, 0.5, 0.4, 0.6, 0, 0};
    static final double[] RANGE = {100, 55, 30, 220, 80, 55, 75, 40, 2.4, 2.8};
    static final double[] FALL = {0.75, 0.5, 0.25, 1, 0.7, 0.65, 0.8, 0.45, 1, 1};
    static final int[] MAG = {30, 32, 6, 5, 100, 12, 6, 20, 0, 0};
    static final int[] RES = {120, 128, 30, 20, 200, 60, 30, 100, 0, 0};
    static final int[] RELOAD = {2000, 1700, 2300, 2800, 4200, 1300, 2200, 1500, 0, 0};
    static final boolean[] AUTO = {true, true, false, false, true, false, false, true, true, true};
    static final double[] SPEED = {0.95, 1, 0.95, 0.85, 0.8, 1, 1, 1, 1.15, 1};
    static final int[] DEFAULT_LO = {0, 5, 8};

    /** Apakah id senjata valid untuk slot tertentu. */
    static boolean validFor(int slot, int w) { return w >= 0 && w < COUNT && SLOT[w] == slot; }
}
