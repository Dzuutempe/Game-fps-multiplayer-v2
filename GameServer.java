package com.arenafps;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

/**
 * Server game FPS (HTTP + WebSocket) dalam Java murni: senjata per slot, loadout, bot.
 * Tidak bergantung pada Android, jadi bisa dites di JVM biasa.
 */
public final class GameServer {

    /** Penyedia file statis (index.html, game.js, map.js). */
    public interface Assets { byte[] get(String name) throws IOException; }

    private static final int MAX_PLAYERS = 12;
    private static final int RESPAWN_MS = 3000;
    private static final int PROTECT_MS = 1200;
    private static final int RESET_MS = 9000;
    private static final int TICK_MS = 33;
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final String[] BOT_NAMES = {"Budi", "Rina", "Joko", "Sari", "Dimas", "Putri", "Agus", "Wati", "Bayu", "Lina", "Tono", "Maya"};

    // tingkat kesulitan bot: 0 mudah, 1 normal, 2 sulit
    private static final long[] BOT_REACT_MS = {700, 400, 200};
    private static final double[] BOT_TURN = {3.0, 5.0, 8.0};
    private static final double[] BOT_SIGMA = {0.05, 0.028, 0.012};
    private static final double[] BOT_SPEED = {0.85, 1.0, 1.1};
    private static final double[] BOT_HEAD = {0.05, 0.15, 0.35};

    private final Assets assets;
    private final int port;
    private final int killLimit;
    private final int botsWanted;
    private final int difficulty;

    private final Object lock = new Object();
    private final LinkedHashMap<Integer, Player> players = new LinkedHashMap<>();
    private final Random rnd = new Random();
    private final Map<String, byte[]> cache = new HashMap<>();
    private final List<Conn> allConns = new ArrayList<>();

    private int nextId = 1;
    private boolean matchOver = false;
    private ScheduledFuture<?> resetFuture;

    private volatile boolean running = false;
    private ServerSocket serverSocket;
    private ExecutorService pool;
    private ScheduledExecutorService sched;

    public GameServer(Assets assets, int port, int killLimit, int bots, int difficulty) {
        this.assets = assets;
        this.port = port;
        this.killLimit = Math.max(1, killLimit);
        this.botsWanted = Math.max(0, Math.min(MAX_PLAYERS - 1, bots));
        this.difficulty = Math.max(0, Math.min(2, difficulty));
    }

    public boolean isRunning() { return running; }
    public int getPort() { return port; }

    // ------------------------------------------------------------ siklus hidup
    public synchronized void start() throws IOException {
        if (running) return;
        cache.put("/", assets.get("index.html"));
        cache.put("/index.html", cache.get("/"));
        cache.put("/game.js", assets.get("game.js"));
        cache.put("/map.js", assets.get("map.js"));
        try { cache.put("/mapdata.js", assets.get("mapdata.js")); } catch (IOException e) { /* data peta tambahan tidak ada */ }

        ServerSocket ss = new ServerSocket();
        ss.setReuseAddress(true);
        ss.bind(new InetSocketAddress(port));
        serverSocket = ss;
        running = true;

        pool = Executors.newCachedThreadPool(daemonFactory("arena-conn"));
        sched = Executors.newSingleThreadScheduledExecutor(daemonFactory("arena-tick"));
        sched.scheduleAtFixedRate(new Runnable() {
            @Override public void run() {
                try { tick(); } catch (RuntimeException e) { /* jangan sampai loop berhenti */ }
            }
        }, TICK_MS, TICK_MS, TimeUnit.MILLISECONDS);

        Thread acceptor = new Thread(new Runnable() {
            @Override public void run() { acceptLoop(); }
        }, "arena-accept");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    public synchronized void stop() {
        if (!running) return;
        running = false;
        try { serverSocket.close(); } catch (IOException e) { /* abaikan */ }
        sched.shutdownNow();
        List<Conn> copy;
        synchronized (lock) { copy = new ArrayList<>(allConns); players.clear(); }
        for (Conn c : copy) c.close();
        pool.shutdownNow();
    }

    private static ThreadFactory daemonFactory(final String name) {
        return new ThreadFactory() {
            int n = 0;
            @Override public synchronized Thread newThread(Runnable r) {
                Thread t = new Thread(r, name + "-" + (n++));
                t.setDaemon(true);
                return t;
            }
        };
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = serverSocket.accept();
                pool.execute(new Runnable() {
                    @Override public void run() { handle(s); }
                });
            } catch (IOException e) {
                if (!running) return;
            } catch (RuntimeException e) {
                if (!running) return;
            }
        }
    }

    // ------------------------------------------------------------ HTTP + upgrade
    private void handle(Socket s) {
        try {
            s.setTcpNoDelay(true);
            s.setSoTimeout(10000);
            InputStream in = s.getInputStream();
            String head = readHead(in);
            if (head == null) { s.close(); return; }
            String[] lines = head.split("\r\n");
            String[] rl = lines[0].split(" ");
            if (rl.length < 2) { s.close(); return; }
            String url = rl[1];
            int q = url.indexOf('?');
            if (q >= 0) url = url.substring(0, q);
            Map<String, String> h = new HashMap<>();
            for (int i = 1; i < lines.length; i++) {
                int c = lines[i].indexOf(':');
                if (c > 0) h.put(lines[i].substring(0, c).trim().toLowerCase(), lines[i].substring(c + 1).trim());
            }
            OutputStream out = s.getOutputStream();

            if (url.equals("/ws")) {
                String key = h.get("sec-websocket-key");
                String up = h.get("upgrade");
                if (key == null || up == null || !up.equalsIgnoreCase("websocket")) { s.close(); return; }
                String accept = base64(MessageDigest.getInstance("SHA-1").digest((key + WS_GUID).getBytes(StandardCharsets.ISO_8859_1)));
                out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                s.setSoTimeout(20000);
                wsSession(s, in, out);
                return;
            }

            byte[] body = cache.get(url);
            if (body != null) {
                String type = url.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8";
                respond(out, 200, "OK", type, body);
            } else if (url.equals("/favicon.ico")) {
                respond(out, 204, "No Content", "text/plain", new byte[0]);
            } else {
                respond(out, 404, "Not Found", "text/plain; charset=utf-8", "Tidak ditemukan".getBytes(StandardCharsets.UTF_8));
            }
            s.close();
        } catch (Exception e) {
            try { s.close(); } catch (IOException ignore) { /* abaikan */ }
        }
    }

    private static void respond(OutputStream out, int code, String text, String type, byte[] body) throws IOException {
        out.write(("HTTP/1.1 " + code + " " + text + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length +
                "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        out.flush();
    }

    /** Membaca header HTTP sampai CRLFCRLF. */
    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int state = 0, c;
        while ((c = in.read()) >= 0) {
            b.write(c);
            if (b.size() > 16384) return null;
            if ((state == 0 || state == 2) && c == '\r') state++;
            else if ((state == 1 || state == 3) && c == '\n') state++;
            else state = (c == '\r') ? 1 : 0;
            if (state == 4) return new String(b.toByteArray(), StandardCharsets.ISO_8859_1);
        }
        return null;
    }

    private static String base64(byte[] data) {
        final String A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < data.length; i += 3) {
            int b0 = data[i] & 0xff, b1 = i + 1 < data.length ? data[i + 1] & 0xff : 0, b2 = i + 2 < data.length ? data[i + 2] & 0xff : 0;
            sb.append(A.charAt(b0 >> 2)).append(A.charAt(((b0 & 3) << 4) | (b1 >> 4)));
            sb.append(i + 1 < data.length ? A.charAt(((b1 & 15) << 2) | (b2 >> 6)) : '=');
            sb.append(i + 2 < data.length ? A.charAt(b2 & 63) : '=');
        }
        return sb.toString();
    }

    // ------------------------------------------------------------ WebSocket
    private static byte[] wsFrame(int op, byte[] p) {
        int n = p.length;
        byte[] h;
        if (n < 126) { h = new byte[]{(byte) (0x80 | op), (byte) n}; }
        else if (n < 65536) { h = new byte[]{(byte) (0x80 | op), 126, (byte) (n >> 8), (byte) n}; }
        else { h = new byte[]{(byte) (0x80 | op), 127, 0, 0, 0, 0, (byte) (n >> 24), (byte) (n >> 16), (byte) (n >> 8), (byte) n}; }
        byte[] f = new byte[h.length + n];
        System.arraycopy(h, 0, f, 0, h.length);
        System.arraycopy(p, 0, f, h.length, n);
        return f;
    }

    private static byte[] textFrame(String s) { return wsFrame(1, s.getBytes(StandardCharsets.UTF_8)); }

    /** Satu koneksi WebSocket dengan antrean tulis sendiri (klien lambat tidak menghambat server). */
    private final class Conn {
        final Socket socket;
        final OutputStream out;
        final LinkedBlockingQueue<byte[]> queue = new LinkedBlockingQueue<>();
        volatile boolean closed = false;
        Player player;

        Conn(Socket s, OutputStream out) { this.socket = s; this.out = out; }

        void startWriter() {
            Thread t = new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        while (!closed) {
                            byte[] f = queue.take();
                            if (f.length == 0) break;
                            synchronized (out) { out.write(f); out.flush(); }
                        }
                    } catch (Exception e) {
                        /* koneksi putus */
                    }
                    close();
                }
            }, "arena-write");
            t.setDaemon(true);
            t.start();
        }

        void sendFrame(byte[] f) {
            if (closed || queue.size() > 64) return; // klien terlalu lambat: lewati
            queue.offer(f);
        }

        void send(String json) { sendFrame(textFrame(json)); }

        void rawWrite(byte[] f) throws IOException { synchronized (out) { out.write(f); out.flush(); } }

        void close() {
            if (closed) return;
            closed = true;
            queue.offer(new byte[0]);
            try { socket.close(); } catch (IOException e) { /* abaikan */ }
            onDisconnect(this);
        }
    }

    private void wsSession(Socket s, InputStream in, OutputStream out) {
        Conn conn = new Conn(s, out);
        synchronized (lock) { allConns.add(conn); }
        conn.startWriter();
        DataInputStream d = new DataInputStream(in);
        ByteArrayOutputStream frag = new ByteArrayOutputStream();
        try {
            while (running && !conn.closed) {
                int b0 = d.read();
                if (b0 < 0) break;
                int b1 = d.read();
                if (b1 < 0) break;
                boolean fin = (b0 & 0x80) != 0;
                int op = b0 & 0x0f;
                boolean masked = (b1 & 0x80) != 0;
                long len = b1 & 0x7f;
                if (len == 126) len = d.readUnsignedShort();
                else if (len == 127) len = d.readLong();
                if (len < 0 || len > 65536) break;
                byte[] mask = null;
                if (masked) { mask = new byte[4]; d.readFully(mask); }
                byte[] pl = new byte[(int) len];
                d.readFully(pl);
                if (masked) for (int i = 0; i < pl.length; i++) pl[i] ^= mask[i & 3];

                if (op == 0x8) break;
                if (op == 0x9) { conn.rawWrite(wsFrame(0xA, pl.length > 125 ? new byte[0] : pl)); continue; }
                if (op == 0xA) continue;
                if (op == 0x1 || op == 0x2 || op == 0x0) {
                    if (op != 0x0) frag.reset();
                    frag.write(pl, 0, pl.length);
                    if (frag.size() > 65536) break;
                    if (fin) {
                        String msg = new String(frag.toByteArray(), StandardCharsets.UTF_8);
                        frag.reset();
                        onMessage(conn, msg);
                    }
                }
            }
        } catch (Exception e) {
            /* putus atau timeout */
        }
        conn.close();
    }

    // ------------------------------------------------------------ model pemain
    private static final class Player {
        int id, color, hp = 100, kills, deaths;
        Conn conn;                       // null untuk bot
        String name;
        boolean bot;
        double x, y, z, yaw, pitch;
        int stance;
        boolean alive = true;
        long respawnAt, protectUntil;
        final long[] lastShot = new long[WeaponDefs.COUNT];
        int[] lo = WeaponDefs.DEFAULT_LO.clone();
        int[] nextLo = WeaponDefs.DEFAULT_LO.clone();
        int curW = WeaponDefs.DEFAULT_LO[0];
        int med = 5; long lastMed;
        final int[] gren = {2, 2, 2};     // granat: ledak, asap, beku
        long frozenUntil, lastNade;
        final ArrayList<double[]> hist = new ArrayList<>(); // {t,x,y,z}

        // --- khusus bot ---
        int diff;
        int slot;
        final int[] mag = new int[4];
        long reloadUntil;
        int targetId = -1;
        long lastSeen, reactAt, flipAt, repathAt, stuckAt, headAt;
        double lastX, lastZ, stuckX, stuckZ;
        boolean haveLast, aimHead;
        int strafe = 1;
        int[] path;
        int pathIdx;

        void send(String json) { if (conn != null) conn.send(json); }
    }

    // ------------------------------------------------------------ util
    private static double r2(double v) { return Math.round(v * 100) / 100.0; }

    private static String n(double v) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "0";
        v = r2(v);
        if (v == Math.rint(v) && Math.abs(v) < 1e9) return Long.toString((long) v);
        return Double.toString(v);
    }

    private static double num(Object o, double lo, double hi, double def) {
        if (!(o instanceof Double)) return def;
        double v = (Double) o;
        if (Double.isNaN(v) || Double.isInfinite(v)) return def;
        return Math.max(lo, Math.min(hi, v));
    }

    private static double wrapPi(double a) {
        while (a > Math.PI) a -= 2 * Math.PI;
        while (a < -Math.PI) a += 2 * Math.PI;
        return a;
    }

    private void broadcast(String json, Player except) {
        byte[] f = textFrame(json);
        for (Player p : players.values()) if (p != except && p.conn != null) p.conn.sendFrame(f);
    }

    private String rosterMsg() {
        StringBuilder sb = new StringBuilder("{\"t\":\"roster\",\"list\":[");
        boolean first = true;
        for (Player p : players.values()) {
            if (!first) sb.append(',');
            first = false;
            sb.append('[').append(p.id).append(",\"").append(p.name).append("\",").append(p.color).append(',').append(p.bot ? 1 : 0).append(']');
        }
        return sb.append("]}").toString();
    }

    private static String cleanName(Object o, int id) {
        String s = (o instanceof String) ? (String) o : "";
        s = s.replaceAll("[^A-Za-z0-9_ \\-.!]", "").trim();
        if (s.length() > 12) s = s.substring(0, 12).trim();
        return s.isEmpty() ? ("Pemain" + id) : s;
    }

    /** Membaca "lo":[a,b,c] dari pesan; nilai tidak valid diganti bawaan. */
    private static int[] parseLoadout(Object o, int[] fallback) {
        int[] r = fallback.clone();
        if (o instanceof List) {
            List<?> l = (List<?>) o;
            for (int i = 0; i < 4 && i < l.size(); i++) {
                Object e = l.get(i);
                if (e instanceof Double) {
                    int w = (int) Math.round((Double) e);
                    if (WeaponDefs.validFor(i, w)) r[i] = w;
                }
            }
        }
        return r;
    }

    private static boolean hasW(Player p, int w) {
        return w == p.lo[0] || w == p.lo[1] || w == p.lo[2] || w == p.lo[3];
    }

    private int humans() {
        int c = 0;
        for (Player p : players.values()) if (!p.bot) c++;
        return c;
    }

    // ------------------------------------------------------------ spawn
    private double[] pickSpawn(Player self) {
        double[] best = null;
        double bestD = -1;
        for (double[] sp : GameMap.SPAWNS) {
            double dmin = 1e9;
            for (Player p : players.values()) {
                if (p == self || !p.alive) continue;
                double d = Math.hypot(p.x - sp[0], p.z - sp[1]);
                if (d < dmin) dmin = d;
            }
            dmin += rnd.nextDouble() * 6;
            if (dmin > bestD) { bestD = dmin; best = sp; }
        }
        return best;
    }

    private void spawn(Player p) {
        double[] s = pickSpawn(p);
        p.x = s[0]; p.y = 0; p.z = s[1];
        p.yaw = Math.atan2(s[0], s[1]);
        p.pitch = 0;
        p.hp = 100; p.alive = true;
        p.protectUntil = System.currentTimeMillis() + PROTECT_MS;
        p.hist.clear();
        if (p.bot) p.nextLo = randomLoadout();
        p.lo = p.nextLo.clone();
        p.curW = p.lo[0];
        p.gren[0] = 2; p.gren[1] = 2; p.gren[2] = 2; p.frozenUntil = 0; p.med = 5;
        if (p.bot) {
            p.slot = 0;
            for (int i = 0; i < 4; i++) p.mag[i] = WeaponDefs.MAG[p.lo[i]];
            p.reloadUntil = 0; p.targetId = -1; p.haveLast = false; p.path = null;
        }
        p.send("{\"t\":\"respawn\",\"x\":" + n(p.x) + ",\"y\":0,\"z\":" + n(p.z) + ",\"yaw\":" + n(p.yaw) +
                ",\"lo\":[" + p.lo[0] + "," + p.lo[1] + "," + p.lo[2] + "," + p.lo[3] + "],\"g\":[2,2,2],\"md\":5}");
    }

    private int[] randomLoadout() {
        int[] primaries = {0, 0, 1, 1, 2, 3, 4, 10, 10, 11, 12};
        int[] secondaries = {5, 5, 6, 7};
        int[] melee = {8, 9, 13};
        int p1 = primaries[rnd.nextInt(primaries.length)], p2 = primaries[rnd.nextInt(primaries.length)];
        while (p2 == p1) p2 = primaries[rnd.nextInt(primaries.length)];
        return new int[]{p1, p2, secondaries[rnd.nextInt(secondaries.length)], melee[rnd.nextInt(melee.length)]};
    }

    // ------------------------------------------------------------ bot: jumlah
    private void balanceBots() {
        int h = humans();
        int want = h > 0 ? Math.min(botsWanted, MAX_PLAYERS - h) : 0;
        int have = 0;
        for (Player p : players.values()) if (p.bot) have++;
        boolean changed = false;
        while (have > want) {
            Player last = null;
            for (Player p : players.values()) if (p.bot) last = p;
            players.remove(last.id);
            have--; changed = true;
        }
        while (have < want) { addBot(); have++; changed = true; }
        if (changed) broadcast(rosterMsg(), null);
    }

    private void addBot() {
        Player b = new Player();
        b.id = nextId++;
        b.bot = true;
        b.diff = difficulty;
        String base = BOT_NAMES[(b.id - 1) % BOT_NAMES.length];
        String name = base;
        int k = 2;
        boolean dup = true;
        while (dup) {
            dup = false;
            for (Player p : players.values()) if (p.name.equals(name)) { dup = true; name = base + k++; break; }
        }
        b.name = name;
        b.color = b.id % 8;
        b.nextLo = randomLoadout();
        players.put(b.id, b);
        spawn(b);
    }

    // ------------------------------------------------------------ tembak
    private static double[] rewound(Player p, long T) {
        ArrayList<double[]> h = p.hist;
        if (h.isEmpty()) return new double[]{p.x, p.y, p.z};
        double[] f = h.get(0);
        if (T <= f[0]) return new double[]{f[1], f[2], f[3]};
        for (int i = h.size() - 1; i > 0; i--) {
            double[] a = h.get(i - 1), b = h.get(i);
            if (a[0] <= T) {
                double k = b[0] == a[0] ? 1 : Math.min(1, (T - a[0]) / (b[0] - a[0]));
                return new double[]{a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k};
            }
        }
        double[] l = h.get(h.size() - 1);
        return new double[]{l[1], l[2], l[3]};
    }

    /** Ray vs silinder tegak (badan pemain). */
    private static double rayCyl(double ox, double oy, double oz, double dx, double dy, double dz,
                                 double cx, double cy, double cz, double r, double h) {
        double best = Double.POSITIVE_INFINITY;
        double fx = ox - cx, fz = oz - cz, a = dx * dx + dz * dz;
        if (a > 1e-9) {
            double b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r, disc = b * b - 4 * a * c;
            if (disc >= 0) {
                double t = (-b - Math.sqrt(disc)) / (2 * a);
                if (t >= 0) { double y = oy + dy * t; if (y >= cy && y <= cy + h) best = t; }
            }
        }
        if (Math.abs(dy) > 1e-9) {
            double[] planes = {cy + h, cy};
            for (double py : planes) {
                double t = (py - oy) / dy;
                if (t >= 0 && t < best) {
                    double px = ox + dx * t - cx, pz = oz + dz * t - cz;
                    if (px * px + pz * pz <= r * r) best = t;
                }
            }
        }
        return best;
    }

    /** Menembak dengan senjata w. Mengembalikan true bila tembakan benar-benar terjadi. */
    private boolean fire(Player p, int w, double dx, double dy, double dz, boolean ads, long rw) {
        long t = System.currentTimeMillis();
        if (!p.alive || matchOver || t < p.frozenUntil) return false;
        if (t - p.lastShot[w] < WeaponDefs.RATE[w] * 0.8) return false;
        double L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L < 1e-6) return false;
        dx /= L; dy /= L; dz /= L;
        p.lastShot[w] = t;
        if (WeaponDefs.SLOT[w] == 2) { melee(p, w, dx, dy, dz); return true; }

        double ox = p.x, oy = p.y + 1.55, oz = p.z;
        int pel = WeaponDefs.PELLETS[w];
        double sp = WeaponDefs.SPREAD[w] * (ads ? WeaponDefs.ADS[w] : 1.0);
        double range = WeaponDefs.RANGE[w];

        // basis tegak lurus arah bidik untuk sebaran
        double ux, uy, uz;
        if (Math.abs(dy) > 0.99) { ux = 0; uy = 0; uz = 1; } else { ux = -dz; uy = 0; uz = dx; }
        double ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        ux /= ul; uy /= ul; uz /= ul;
        double vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;

        LinkedHashMap<Player, double[]> acc = new LinkedHashMap<>(); // {damage, headFlag}
        StringBuilder ends = new StringBuilder();
        for (int i = 0; i < pel; i++) {
            double ddx = dx, ddy = dy, ddz = dz;
            if (sp > 0) {
                double a, b;
                do { a = rnd.nextDouble() * 2 - 1; b = rnd.nextDouble() * 2 - 1; } while (a * a + b * b > 1);
                ddx = dx + (ux * a + vx * b) * sp; ddy = dy + (uy * a + vy * b) * sp; ddz = dz + (uz * a + vz * b) * sp;
                double l2 = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
                ddx /= l2; ddy /= l2; ddz /= l2;
            }
            double bestT = Math.min(GameMap.rayWorld(ox, oy, oz, ddx, ddy, ddz), range);
            Player target = null;
            boolean head = false;
            for (Player q : players.values()) {
                if (q == p || !q.alive || t < q.protectUntil) continue;
                double[] pos = rewound(q, t - rw);
                double d = rayCyl(ox, oy, oz, ddx, ddy, ddz, pos[0], pos[1], pos[2], 0.45, 1.8);
                if (d < bestT) { bestT = d; target = q; head = (oy + ddy * d) >= pos[1] + 1.4; }
            }
            int kind = target != null ? 2 : (bestT < range ? 1 : 0);
            if (i > 0) ends.append(',');
            ends.append('[').append(n(ox + ddx * bestT)).append(',').append(n(oy + ddy * bestT)).append(',').append(n(oz + ddz * bestT)).append(',').append(kind).append(']');
            if (target != null) {
                double mult = 1 - (1 - WeaponDefs.FALL[w]) * Math.min(1.0, bestT / range);
                double dmg = WeaponDefs.DMG[w] * mult * (head ? WeaponDefs.HEAD[w] : 1.0);
                double[] s = acc.get(target);
                if (s == null) { s = new double[2]; acc.put(target, s); }
                s[0] += dmg;
                if (head) s[1] = 1;
            }
        }
        broadcast("{\"t\":\"shot\",\"id\":" + p.id + ",\"w\":" + w + ",\"o\":[" + n(ox) + "," + n(oy) + "," + n(oz) + "],\"e\":[" + ends + "]}", null);
        for (Map.Entry<Player, double[]> e : acc.entrySet()) damage(p, e.getKey(), (int) Math.round(e.getValue()[0]), e.getValue()[1] > 0, w);
        return true;
    }

    private void melee(Player p, int w, double dx, double dy, double dz) {
        long t = System.currentTimeMillis();
        double range = WeaponDefs.RANGE[w];
        double ox = p.x, oy = p.y + 1.55, oz = p.z;
        double hl = Math.hypot(dx, dz);
        double ax = hl > 1e-6 ? dx / hl : 0, az = hl > 1e-6 ? dz / hl : 0;
        Player target = null;
        double bestD = 1e9;
        for (Player q : players.values()) {
            if (q == p || !q.alive || t < q.protectUntil) continue;
            double ex = q.x - p.x, ez = q.z - p.z, hd = Math.hypot(ex, ez);
            if (hd > range + 0.5) continue;
            if (Math.abs((q.y + 1.0) - oy) > 1.4) continue;
            if (hd > 0.9 && (ex * ax + ez * az) / hd < 0.62) continue;
            double tx = q.x, ty = q.y + 1.0, tz = q.z;
            double L = Math.sqrt((tx - ox) * (tx - ox) + (ty - oy) * (ty - oy) + (tz - oz) * (tz - oz));
            if (L > 1e-6 && GameMap.rayWorld(ox, oy, oz, (tx - ox) / L, (ty - oy) / L, (tz - oz) / L) < L - 0.4) continue;
            if (hd < bestD) { bestD = hd; target = q; }
        }
        double wt = GameMap.rayWorld(ox, oy, oz, dx, dy, dz);
        int kind = target != null ? 2 : (wt < range ? 1 : 0);
        double reach = Math.min(wt, range);
        broadcast("{\"t\":\"shot\",\"id\":" + p.id + ",\"w\":" + w + ",\"o\":[" + n(ox) + "," + n(oy) + "," + n(oz) + "],\"e\":[[" +
                n(ox + dx * reach) + "," + n(oy + dy * reach) + "," + n(oz + dz * reach) + "," + kind + "]]}", null);
        if (target != null) damage(p, target, (int) Math.round(WeaponDefs.DMG[w]), false, w);
    }

    private void damage(Player a, Player v, int dmg, boolean head, int w) {
        if (dmg <= 0 || !v.alive) return;
        long t = System.currentTimeMillis();
        int hd = head ? 1 : 0;
        v.hp -= dmg;
        if (v.hp > 0) {
            a.send("{\"t\":\"hit\",\"h\":" + hd + ",\"k\":0,\"d\":" + dmg + "}");
            v.send("{\"t\":\"hurt\",\"hp\":" + v.hp + ",\"ax\":" + n(a.x) + ",\"az\":" + n(a.z) + ",\"a\":" + a.id + ",\"w\":" + w + "}");
            if (v.bot) botHurt(v, a, t);
            return;
        }
        v.hp = 0; v.alive = false; v.deaths++; v.respawnAt = t + RESPAWN_MS;
        a.kills++;
        a.send("{\"t\":\"hit\",\"h\":" + hd + ",\"k\":1,\"d\":" + dmg + "}");
        v.send("{\"t\":\"hurt\",\"hp\":0,\"ax\":" + n(a.x) + ",\"az\":" + n(a.z) + ",\"a\":" + a.id + ",\"w\":" + w + "}");
        broadcast("{\"t\":\"kill\",\"k\":" + a.id + ",\"v\":" + v.id + ",\"h\":" + hd + ",\"w\":" + w + "}", null);
        if (a.kills >= killLimit) endMatch(a);
    }

    private void endMatch(Player winner) {
        matchOver = true;
        broadcast("{\"t\":\"win\",\"id\":" + winner.id + ",\"name\":\"" + winner.name + "\",\"ms\":" + RESET_MS + "}", null);
        if (resetFuture != null) resetFuture.cancel(false);
        resetFuture = sched.schedule(new Runnable() {
            @Override public void run() {
                synchronized (lock) {
                    matchOver = false;
                    for (Player q : players.values()) { q.kills = 0; q.deaths = 0; }
                    for (Player q : players.values()) spawn(q);
                    nades.clear(); smokes.clear();
                    broadcast("{\"t\":\"reset\"}", null);
                }
            }
        }, RESET_MS, TimeUnit.MILLISECONDS);
    }

    // ------------------------------------------------------------ pesan dari klien
    private void onMessage(Conn conn, String raw) {
        Map<String, Object> m = Json.parseObject(raw);
        if (m == null) return;
        Object to = m.get("t");
        if (!(to instanceof String)) return;
        String t = (String) to;

        if (t.equals("ping")) {
            Object c = m.get("c");
            String cs = "0";
            if (c instanceof Double && !Double.isNaN((Double) c) && !Double.isInfinite((Double) c)) cs = BigDecimal.valueOf((Double) c).toPlainString();
            conn.send("{\"t\":\"pong\",\"c\":" + cs + "}");
            return;
        }

        synchronized (lock) {
            Player me = conn.player;
            if (t.equals("join")) {
                if (me != null) return;
                if (humans() >= MAX_PLAYERS) {
                    try { conn.rawWrite(textFrame("{\"t\":\"full\"}")); } catch (IOException e) { /* abaikan */ }
                    conn.close();
                    return;
                }
                me = new Player();
                me.id = nextId++;
                me.conn = conn;
                me.name = cleanName(m.get("name"), me.id);
                me.color = me.id % 8;
                me.nextLo = parseLoadout(m.get("lo"), WeaponDefs.DEFAULT_LO);
                conn.player = me;
                players.put(me.id, me);
                balanceBots();
                spawn(me);
                conn.send("{\"t\":\"welcome\",\"map\":\"" + GameMap.IDS[Math.max(0, GameMap.curId)] + "\",\"id\":" + me.id + ",\"killLimit\":" + killLimit + ",\"matchOver\":" + matchOver +
                        ",\"bots\":" + botsWanted + ",\"diff\":" + difficulty + "}");
                broadcast(rosterMsg(), null);
                return;
            }
            if (me == null) return;

            if (t.equals("state")) {
                if (!me.alive) return;
                me.x = num(m.get("x"), GameMap.MINX, GameMap.MAXX, me.x);
                me.y = num(m.get("y"), -2, 40, me.y);
                me.z = num(m.get("z"), GameMap.MINZ, GameMap.MAXZ, me.z);
                me.yaw = num(m.get("yaw"), -1000, 1000, me.yaw);
                me.pitch = num(m.get("pitch"), -1.6, 1.6, me.pitch);
                int w = (int) num(m.get("w"), -1, WeaponDefs.COUNT, -1);
                if (hasW(me, w)) me.curW = w;
                me.stance = (int) num(m.get("st"), 0, 2, 0);
                long now = System.currentTimeMillis();
                me.hist.add(new double[]{now, me.x, me.y, me.z});
                while (!me.hist.isEmpty() && me.hist.get(0)[0] < now - 1000) me.hist.remove(0);
                return;
            }
            if (t.equals("shoot")) {
                int w = (int) num(m.get("w"), -1, WeaponDefs.COUNT, -1);
                if (w < 0 || !hasW(me, w)) return;
                boolean ads = num(m.get("ads"), 0, 1, 0) > 0.5;
                fire(me, w, num(m.get("dx"), -1, 1, 0), num(m.get("dy"), -1, 1, 0), num(m.get("dz"), -1, 1, 0), ads, (long) num(m.get("rw"), 0, 300, 0));
                return;
            }
            if (t.equals("nade")) {
                throwNade(me, (int) num(m.get("k"), 0, 2, -1), num(m.get("dx"), -1, 1, 0), num(m.get("dy"), -1, 1, 0), num(m.get("dz"), -1, 1, 0));
                return;
            }
            if (t.equals("med")) {
                long now = System.currentTimeMillis();
                if (me.alive && !matchOver && me.hp < 100 && me.med > 0 && now - me.lastMed > 1200) {
                    me.med--; me.lastMed = now; me.hp = Math.min(100, me.hp + 50);
                    me.send("{\"t\":\"med\",\"hp\":" + me.hp + ",\"m\":" + me.med + "}");
                }
                return;
            }
            if (t.equals("respawn")) {
                if (!me.alive && !matchOver && System.currentTimeMillis() >= me.respawnAt) spawn(me);
                return;
            }
            if (t.equals("loadout")) {
                me.nextLo = parseLoadout(m.get("lo"), me.nextLo);
            }
        }
    }

    private void onDisconnect(Conn conn) {
        synchronized (lock) {
            allConns.remove(conn);
            Player me = conn.player;
            if (me == null) return;
            conn.player = null;
            if (players.remove(me.id) != null && running) {
                balanceBots();
                broadcast(rosterMsg(), null);
            }
        }
    }

    // ------------------------------------------------------------ bot AI
    private void botHurt(Player v, Player attacker, long t) {
        v.targetId = attacker.id;
        v.lastSeen = t;
        v.lastX = attacker.x; v.lastZ = attacker.z; v.haveLast = true;
        if (v.reactAt < t) v.reactAt = t + BOT_REACT_MS[v.diff] / 2;
    }

    private int nearestNode(double x, double z) {
        int best = -1, bestAny = -1;
        double bd = 1e18, bdAny = 1e18;
        for (int i = 0; i < GameMap.NODES.length; i++) {
            double dx = GameMap.NODES[i][0] - x, dz = GameMap.NODES[i][1] - z, d2 = dx * dx + dz * dz;
            if (d2 < bdAny) { bdAny = d2; bestAny = i; }
            if (d2 < bd && GameMap.segClear(x, z, GameMap.NODES[i][0], GameMap.NODES[i][1])) { bd = d2; best = i; }
        }
        return best >= 0 ? best : bestAny;
    }

    /** Dijkstra sederhana pada graf jalan. */
    private static int[] findPath(int s, int g) {
        int n = GameMap.NODES.length;
        double[] dist = new double[n];
        int[] prev = new int[n];
        boolean[] done = new boolean[n];
        java.util.Arrays.fill(dist, 1e18);
        java.util.Arrays.fill(prev, -1);
        dist[s] = 0;
        for (int it = 0; it < n; it++) {
            int u = -1;
            for (int i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
            if (u < 0 || dist[u] >= 1e17) break;
            done[u] = true;
            if (u == g) break;
            for (int v : GameMap.ADJ[u]) {
                double d = dist[u] + Math.hypot(GameMap.NODES[u][0] - GameMap.NODES[v][0], GameMap.NODES[u][1] - GameMap.NODES[v][1]);
                if (d < dist[v]) { dist[v] = d; prev[v] = u; }
            }
        }
        if (prev[g] < 0 && s != g) return new int[]{g};
        ArrayList<Integer> r = new ArrayList<>();
        for (int c = g; c >= 0; c = prev[c]) { r.add(0, c); if (c == s) break; }
        int[] out = new int[r.size()];
        for (int i = 0; i < out.length; i++) out[i] = r.get(i);
        return out;
    }

    private void botMove(Player b, double vx, double vz, double dt) {
        double nx = b.x + vx * dt;
        if (!GameMap.blocked(nx, b.z, 0)) b.x = nx;
        double nz = b.z + vz * dt;
        if (!GameMap.blocked(b.x, nz, 0)) b.z = nz;
        b.x = Math.max(GameMap.MINX + 0.4, Math.min(GameMap.MAXX - 0.4, b.x));
        b.z = Math.max(GameMap.MINZ + 0.4, Math.min(GameMap.MAXZ - 0.4, b.z));
    }

    private static double preferredDistance(int w) {
        switch (w) {
            case 12: return 60;  // sniper berat
            case 11: return 35;  // dmr
            case 10: return 20;  // ak-47
            case 3: return 45;   // sniper
            case 4: return 24;   // lmg
            case 0: return 18;   // karabin
            case 1: return 10;   // smg
            case 2: return 5;    // shotgun
            case 6: return 16;   // revolver
            case 5: return 14;   // pistol
            case 7: return 9;    // machine pistol
            default: return 1.2; // melee
        }
    }

    private static int botW(Player b, int slot) { return b.lo[slot == 0 ? 0 : (slot == 1 ? 2 : 3)]; }

    private void botThink(Player b, long t) {
        final double dt = TICK_MS / 1000.0;
        int dif = b.diff;
        if (b.reloadUntil != 0 && t >= b.reloadUntil) { b.mag[b.slot] = WeaponDefs.MAG[botW(b, b.slot)]; b.reloadUntil = 0; }

        // --- cari target
        Player best = null;
        double bd = 1e9;
        double fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
        double viewR = (b.lo[0] == 3 || b.lo[0] == 12) ? 130 : 75;
        for (Player q : players.values()) {
            if (q == b || !q.alive) continue;
            double dx = q.x - b.x, dz = q.z - b.z, d = Math.hypot(dx, dz);
            if (d > viewR) continue;
            boolean cone = d < 7 || q.id == b.targetId || (dx * fx + dz * fz) / Math.max(d, 1e-6) > 0.35;
            if (!cone) continue;
            double ty = q.y + 1.2, dy = ty - 1.55, dd = Math.sqrt(d * d + dy * dy);
            if (GameMap.rayWorld(b.x, 1.55, b.z, dx / dd, dy / dd, dz / dd) < dd - 0.6) continue;
            if (smokeBlocks(b.x, 1.55, b.z, q.x, ty, q.z, t)) continue;
            if (d < bd) { bd = d; best = q; }
        }
        if (best != null) {
            if (b.targetId != best.id) { b.targetId = best.id; b.reactAt = Math.max(b.reactAt, t + BOT_REACT_MS[dif]); b.headAt = 0; }
            b.lastSeen = t; b.lastX = best.x; b.lastZ = best.z; b.haveLast = true;
        } else if (b.targetId != -1 && t - b.lastSeen > 3000) {
            b.targetId = -1;
        }

        // --- pilih senjata
        if (best != null) {
            int w0 = b.lo[0], w1 = b.lo[2];
            int want;
            if (bd < 2.6) want = 2;
            else if (b.mag[0] > 0 && bd <= WeaponDefs.RANGE[w0] * 0.85) want = 0;
            else if (b.mag[1] > 0 && bd <= WeaponDefs.RANGE[w1]) want = 1;
            else want = (b.mag[0] > 0 || b.reloadUntil != 0) ? 0 : 1;
            if (want != b.slot) { b.slot = want; b.reloadUntil = 0; b.reactAt = Math.max(b.reactAt, t + 250); }
        }
        int w = botW(b, b.slot);
        b.curW = w;

        // --- isi ulang bila perlu
        if (b.slot != 2 && b.reloadUntil == 0 && (b.mag[b.slot] <= 0 || (best == null && b.mag[b.slot] < WeaponDefs.MAG[w] / 2))) {
            b.reloadUntil = t + WeaponDefs.RELOAD[w];
        }

        double speed = 5.0 * BOT_SPEED[dif] * WeaponDefs.SPEED[w];
        double mvx = 0, mvz = 0;
        double wantYaw = b.yaw, wantPitch = 0;

        if (best != null) {
            double dx = best.x - b.x, dz = best.z - b.z;
            double d = Math.max(bd, 1e-6);
            double ux = dx / d, uz = dz / d;
            if (t >= b.headAt) { b.aimHead = rnd.nextDouble() < BOT_HEAD[dif]; b.headAt = t + 2000; }
            double ty = best.y + (b.aimHead ? 1.5 : 1.1);
            wantYaw = Math.atan2(-dx, -dz);
            wantPitch = Math.atan2(ty - 1.55, d);

            if (w != 3) {
                double pref = preferredDistance(w);
                double radial = d > pref + 3 ? 1 : (d < pref - 3 ? -1 : 0);
                if (b.slot == 2) radial = 1;
                if (t >= b.flipAt) { b.strafe = -b.strafe; b.flipAt = t + 600 + (long) (rnd.nextDouble() * 1000); }
                double tx = -uz * b.strafe, tz = ux * b.strafe;
                double sk = b.slot == 2 ? 0.2 : 0.7;
                mvx = ux * radial + tx * sk;
                mvz = uz * radial + tz * sk;
                double ml = Math.hypot(mvx, mvz);
                if (ml > 1) { mvx /= ml; mvz /= ml; }
            }
            b.path = null;
        } else {
            // --- jelajah / kejar posisi terakhir lewat graf jalan
            if (b.path == null || b.pathIdx >= b.path.length) {
                int dest;
                if (b.haveLast && t - b.lastSeen < 10000 && Math.hypot(b.lastX - b.x, b.lastZ - b.z) > 4) dest = nearestNode(b.lastX, b.lastZ);
                else { b.haveLast = false; dest = rnd.nextInt(GameMap.NODES.length); }
                int start = nearestNode(b.x, b.z);
                b.path = findPath(start, dest);
                b.pathIdx = 0;
            }
            if (b.pathIdx < b.path.length) {
                double[] wp = GameMap.NODES[b.path[b.pathIdx]];
                double dx = wp[0] - b.x, dz = wp[1] - b.z, d = Math.hypot(dx, dz);
                if (d < 1.4) b.pathIdx++;
                else { mvx = dx / d; mvz = dz / d; wantYaw = Math.atan2(-dx, -dz); }
            }
            wantPitch = 0;
        }

        // --- putar arah pandang
        double maxTurn = BOT_TURN[dif] * dt;
        double dyaw = wrapPi(wantYaw - b.yaw);
        b.yaw += Math.max(-maxTurn, Math.min(maxTurn, dyaw));
        double dpit = wantPitch - b.pitch;
        b.pitch += Math.max(-maxTurn, Math.min(maxTurn, dpit));

        // --- tembak
        if (best != null && t >= b.reactAt && b.reloadUntil == 0) {
            boolean aimed = Math.abs(wrapPi(wantYaw - b.yaw)) < 0.07 && Math.abs(wantPitch - b.pitch) < 0.09;
            double range = WeaponDefs.RANGE[w];
            boolean inRange = b.slot == 2 ? bd < 2.6 : bd <= range * 0.95;
            boolean ammo = b.slot == 2 || b.mag[b.slot] > 0;
            if (aimed && inRange && ammo && t - b.lastShot[w] >= WeaponDefs.RATE[w]) {
                double sig = BOT_SIGMA[dif] * (1 + bd / 60.0);
                double yw = b.yaw + (rnd.nextDouble() + rnd.nextDouble() + rnd.nextDouble() - 1.5) * 2 * sig;
                double pt = b.pitch + (rnd.nextDouble() + rnd.nextDouble() + rnd.nextDouble() - 1.5) * 2 * sig;
                double cp = Math.cos(pt);
                if (fire(b, w, -Math.sin(yw) * cp, Math.sin(pt), -Math.cos(yw) * cp, false, 0) && b.slot != 2) {
                    b.mag[b.slot]--;
                    if (b.mag[b.slot] <= 0) b.reloadUntil = t + WeaponDefs.RELOAD[w];
                }
            }
        }

        // --- bergerak + deteksi macet
        botMove(b, mvx * speed, mvz * speed, dt);
        if (t - b.stuckAt > 1200) {
            if ((mvx != 0 || mvz != 0) && Math.hypot(b.x - b.stuckX, b.z - b.stuckZ) < 0.5) {
                b.path = null; b.haveLast = false; b.strafe = -b.strafe;
            }
            b.stuckAt = t; b.stuckX = b.x; b.stuckZ = b.z;
        }
    }

    // ------------------------------------------------------------ loop utama
    private void tick() {
        long t = System.currentTimeMillis();
        synchronized (lock) {
            if (humans() == 0) return;
            stepNades(t, TICK_MS / 1000.0);
            StringBuilder sb = new StringBuilder("{\"t\":\"s\",\"p\":[");
            boolean first = true;
            for (Player p : new ArrayList<>(players.values())) {
                if (!p.alive && !matchOver && p.bot && t >= p.respawnAt) spawn(p);
                if (p.bot && p.alive && !matchOver) {
                    if (t >= p.frozenUntil) botThink(p, t);
                    p.hist.add(new double[]{t, p.x, p.y, p.z});
                    while (!p.hist.isEmpty() && p.hist.get(0)[0] < t - 1000) p.hist.remove(0);
                }
                if (!first) sb.append(',');
                first = false;
                sb.append('[').append(p.id).append(',').append(n(p.x)).append(',').append(n(p.y)).append(',').append(n(p.z)).append(',')
                  .append(n(p.yaw)).append(',').append(n(p.pitch)).append(',').append(p.hp).append(',').append(p.alive ? 1 : 0).append(',')
                  .append(p.kills).append(',').append(p.deaths).append(',').append(p.curW).append(',').append(p.bot ? 0 : p.stance).append(']');
            }
            sb.append("]}");
            broadcast(sb.toString(), null);
            if (!nades.isEmpty()) {
                StringBuilder nb = new StringBuilder("{\"t\":\"n\",\"l\":[");
                for (int i = 0; i < nades.size(); i++) {
                    Nade g = nades.get(i);
                    if (i > 0) nb.append(',');
                    nb.append('[').append(g.id).append(',').append(g.type).append(',').append(n(g.x)).append(',').append(n(g.y)).append(',').append(n(g.z)).append(']');
                }
                broadcast(nb.append("]}").toString(), null);
            }
        }
    }

    // ------------------------------------------------------------ granat
    private static final class Nade { int id, type, owner; double x, y, z, vx, vy, vz; long fuseAt; }
    private static final class Smoke { double x, y, z; long until; }
    private final ArrayList<Nade> nades = new ArrayList<>();
    private final ArrayList<Smoke> smokes = new ArrayList<>();
    private int nextNade = 1;
    private static final long[] NADE_FUSE = {2300, 1500, 1500};
    private static final double SMOKE_R = 4.5, FROST_R = 7.0, FRAG_R = 8.0;
    private static final long SMOKE_MS = 12000, FREEZE_MS = 4000;

    private void throwNade(Player p, int k, double dx, double dy, double dz) {
        long t = System.currentTimeMillis();
        if (k < 0 || k > 2 || !p.alive || matchOver || t < p.frozenUntil || p.gren[k] <= 0 || t - p.lastNade < 600) return;
        double L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L < 1e-6) return;
        dx /= L; dy /= L; dz /= L;
        p.gren[k]--; p.lastNade = t;
        double ox = p.x, oy = p.y + 1.45, oz = p.z;
        double free = Math.min(0.6, GameMap.rayWorld(ox, oy, oz, dx, dy, dz) - 0.3);
        if (free < 0) free = 0;
        Nade g = new Nade();
        g.id = nextNade++; g.type = k; g.owner = p.id;
        g.x = ox + dx * free; g.y = oy + dy * free; g.z = oz + dz * free;
        g.vx = dx * 16; g.vy = dy * 16 + 3.5; g.vz = dz * 16;
        g.fuseAt = t + NADE_FUSE[k];
        nades.add(g);
        broadcast("{\"t\":\"throw\",\"id\":" + p.id + ",\"k\":" + k + "}", null);
    }

    private void stepNades(long t, double dt) {
        for (int i = smokes.size() - 1; i >= 0; i--) if (t >= smokes.get(i).until) smokes.remove(i);
        for (int i = nades.size() - 1; i >= 0; i--) {
            Nade g = nades.get(i);
            if (t >= g.fuseAt) { nades.remove(i); explode(g, t); continue; }
            g.vy -= 18 * dt;
            double nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
            if (GameMap.blocked(nx, g.z, g.y - 1.0)) { g.vx = -g.vx * 0.45; nx = g.x; }
            if (GameMap.blocked(g.x, nz, g.y - 1.0)) { g.vz = -g.vz * 0.45; nz = g.z; }
            nx = Math.max(GameMap.MINX + 0.3, Math.min(GameMap.MAXX - 0.3, nx));
            nz = Math.max(GameMap.MINZ + 0.3, Math.min(GameMap.MAXZ - 0.3, nz));
            double gnd = GameMap.groundAt(nx, nz, g.y - 0.1) + 0.12;
            if (ny < gnd) {
                ny = gnd;
                g.vy = -g.vy * 0.35;
                if (Math.abs(g.vy) < 1.6) g.vy = 0;
                g.vx *= 0.72; g.vz *= 0.72;
            }
            g.x = nx; g.y = ny; g.z = nz;
        }
    }

    private boolean smokeBlocks(double ax, double ay, double az, double bx, double by, double bz, long t) {
        for (Smoke s : smokes) {
            if (t >= s.until) continue;
            double vx = bx - ax, vy = by - ay, vz = bz - az, l2 = vx * vx + vy * vy + vz * vz;
            double u = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((s.x - ax) * vx + (s.y - ay) * vy + (s.z - az) * vz) / l2));
            double px = ax + vx * u - s.x, py = ay + vy * u - s.y, pz = az + vz * u - s.z;
            if (px * px + py * py + pz * pz < SMOKE_R * SMOKE_R) return true;
        }
        return false;
    }

    private void explode(Nade g, long t) {
        Player owner = players.get(g.owner);
        broadcast("{\"t\":\"boom\",\"k\":" + g.type + ",\"x\":" + n(g.x) + ",\"y\":" + n(g.y) + ",\"z\":" + n(g.z) + ",\"ms\":" + (g.type == 1 ? SMOKE_MS : 0) + "}", null);
        if (g.type == 1) {
            Smoke s = new Smoke(); s.x = g.x; s.y = g.y + 1.2; s.z = g.z; s.until = t + SMOKE_MS;
            smokes.add(s);
            return;
        }
        double R = g.type == 0 ? FRAG_R : FROST_R;
        for (Player q : new ArrayList<>(players.values())) {
            if (!q.alive || q.id == g.owner || t < q.protectUntil) continue;
            double cx = q.x - g.x, cy = (q.y + 1.0) - (g.y + 0.3), cz = q.z - g.z;
            double d = Math.sqrt(cx * cx + cy * cy + cz * cz);
            if (d >= R) continue;
            if (d > 0.8 && GameMap.rayWorld(g.x, g.y + 0.3, g.z, cx / d, cy / d, cz / d) < d - 0.4) continue;
            if (g.type == 0) {
                int dmg = (int) Math.round(130 * (1 - d / R));
                if (dmg < 8) dmg = 8;
                if (owner != null) damage(owner, q, dmg, false, 14);
                else { q.hp -= dmg; if (q.hp <= 0) { q.hp = 0; q.alive = false; q.deaths++; q.respawnAt = t + RESPAWN_MS; broadcast("{\"t\":\"kill\",\"k\":-1,\"v\":" + q.id + ",\"h\":0,\"w\":14}", null); } }
            } else {
                q.frozenUntil = t + FREEZE_MS;
                broadcast("{\"t\":\"freeze\",\"id\":" + q.id + ",\"ms\":" + FREEZE_MS + "}", null);
                if (owner != null && q.bot) botHurt(q, owner, t);
            }
        }
    }
}
