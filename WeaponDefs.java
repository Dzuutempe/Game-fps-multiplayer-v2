package com.arenafps;

// DIHASILKAN OTOMATIS dari tools/genmap3.js. Jangan diedit langsung.

/** Tabel senjata. Indeks sama dengan MAP.weapons di map.js. */
final class WeaponDefs {
    private WeaponDefs() {}

    static final int COUNT = 14;
    static final String[] NAME = {"Karabin M16", "SMG", "Shotgun", "Sniper", "LMG", "Pistol", "Revolver", "Uzi", "Pisau", "Pemukul", "AK-47", "DMR", "Sniper Berat", "Golok"};
    static final int[] SLOT = {0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 0, 0, 0, 2};
    static final double[] DMG = {22, 15, 11, 90, 19, 20, 56, 11, 45, 70, 26, 48, 110, 62};
    static final double[] HEAD = {2, 1.8, 1.5, 3, 1.6, 2, 2, 1.7, 1, 1, 2, 2.5, 3, 1};
    static final int[] RATE = {100, 65, 850, 1400, 85, 200, 650, 75, 380, 750, 110, 280, 1700, 520};
    static final int[] PELLETS = {1, 1, 8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1};
    static final double[] SPREAD = {0.012, 0.028, 0.07, 0.045, 0.03, 0.01, 0.006, 0.035, 0, 0, 0.016, 0.02, 0.05, 0};
    static final double[] ADS = {0.4, 0.55, 0.7, 0, 0.5, 0.5, 0.4, 0.6, 0, 0, 0.45, 0.02, 0, 0};
    static final double[] RANGE = {100, 55, 30, 220, 80, 55, 75, 40, 2.4, 2.8, 90, 160, 300, 2.7};
    static final double[] FALL = {0.75, 0.5, 0.25, 1, 0.7, 0.65, 0.8, 0.45, 1, 1, 0.7, 0.9, 1, 1};
    static final int[] MAG = {30, 32, 6, 5, 100, 12, 6, 20, 0, 0, 30, 10, 5, 0};
    static final int[] RES = {120, 128, 30, 20, 200, 60, 30, 100, 0, 0, 120, 40, 15, 0};
    static final int[] RELOAD = {2000, 1700, 2300, 2800, 4200, 1300, 2200, 1500, 0, 0, 2200, 2600, 3200, 0};
    static final boolean[] AUTO = {true, true, false, false, true, false, false, true, true, true, true, false, false, true};
    static final double[] SPEED = {0.95, 1, 0.95, 0.85, 0.8, 1, 1, 1, 1.15, 1, 0.93, 0.9, 0.8, 1.05};
    static final int[] DEFAULT_LO = {0, 10, 7, 8};
    /** Jenis senjata tiap posisi slot: 2 senjata besar, 1 kecil, 1 jarak dekat. */
    static final int[] LOSLOT = {0, 0, 1, 2};

    /** Apakah id senjata valid untuk slot tertentu. */
    static boolean validFor(int pos, int w) { return pos >= 0 && pos < 4 && w >= 0 && w < COUNT && SLOT[w] == LOSLOT[pos]; }
}
