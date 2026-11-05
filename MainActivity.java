package com.arenafps;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Satu layar WebView penuh. Halaman awal (launcher.html) menawarkan "Jadi Host" atau "Gabung".
 * Host menjalankan server game di dalam app ini; semua pemain (termasuk host) membuka game lewat WebView.
 */
public class MainActivity extends Activity {

    private static final int PORT = 3000;
    private static final String LAUNCHER = "file:///android_asset/launcher.html";

    private WebView web;
    private GameServer server;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0b0b0d"));
        setContentView(web);

        WebSettings st = web.getSettings();
        st.setJavaScriptEnabled(true);
        st.setDomStorageEnabled(true);
        st.setMediaPlaybackRequiresUserGesture(false);
        st.setCacheMode(WebSettings.LOAD_NO_CACHE);
        st.setBuiltInZoomControls(false);
        st.setSupportZoom(false);

        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) showConnectError(view, request.getUrl().toString());
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                // dipakai di Android 5.x (API 21-22)
                if (failingUrl != null) showConnectError(view, failingUrl);
            }
        });
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { return true; } // matikan menu tekan-lama
        });
        web.setLongClickable(false);
        web.loadUrl(LAUNCHER);
    }

    // ------------------------------------------------------------ jembatan JS <-> Java
    public final class Bridge {
        /**
         * Menyalakan (atau menyalakan ulang) server. cfg = JSON {"bots":n,"diff":0-2,"kills":n}.
         * Mengembalikan JSON {"ok":true,"port":3000,"ips":["192.168.x.x"]}.
         */
        @JavascriptInterface
        public String startHost(String cfg) {
            try {
                int bots = 0, diff = 1, kills = 15;
                java.util.Map<String, Object> c = Json.parseObject(cfg == null ? "{}" : cfg);
                if (c != null) {
                    bots = clampInt(c.get("bots"), 0, 8, 0);
                    diff = clampInt(c.get("diff"), 0, 2, 1);
                    kills = clampInt(c.get("kills"), 5, 50, 15);
                }
                if (server != null) { server.stop(); server = null; }
                server = new GameServer(new GameServer.Assets() {
                    @Override public byte[] get(String name) throws IOException { return readAsset("public/" + name); }
                }, PORT, kills, bots, diff);
                server.start();
                acquireLocks();
                StringBuilder sb = new StringBuilder("{\"ok\":true,\"port\":" + PORT + ",\"ips\":[");
                List<String> ips = localAddresses();
                for (int i = 0; i < ips.size(); i++) { if (i > 0) sb.append(','); sb.append('"').append(ips.get(i)).append('"'); }
                return sb.append("]}").toString();
            } catch (Exception e) {
                String msg = String.valueOf(e.getMessage()).replace("\\", " ").replace("\"", "'");
                return "{\"ok\":false,\"error\":\"" + msg + "\"}";
            }
        }

        @JavascriptInterface
        public void enterHost() { open("http://127.0.0.1:" + PORT + "/"); }

        @JavascriptInterface
        public void join(String host) {
            String h = host == null ? "" : host.trim().replace("http://", "").replace("https://", "");
            int slash = h.indexOf('/');
            if (slash >= 0) h = h.substring(0, slash);
            if (h.isEmpty()) return;
            if (h.indexOf(':') < 0) h = h + ":" + PORT;
            open("http://" + h + "/");
        }

        @JavascriptInterface
        public void back() { open(LAUNCHER); }

        @JavascriptInterface
        public void quit() { runOnUiThread(new Runnable() { @Override public void run() { finish(); } }); }
    }

    private static int clampInt(Object o, int lo, int hi, int def) {
        if (!(o instanceof Double)) return def;
        int v = (int) Math.round((Double) o);
        return Math.max(lo, Math.min(hi, v));
    }

    private static void showConnectError(WebView view, String failingUrl) {
        if (failingUrl.startsWith("file:")) return;
        String host = android.net.Uri.parse(failingUrl).getAuthority();
        view.loadUrl(LAUNCHER + "#err=" + android.net.Uri.encode("Tidak bisa terhubung ke " + host
                + ". Pastikan satu WiFi dengan host dan host sudah menjalankan server."));
    }

    private void open(final String url) {
        runOnUiThread(new Runnable() { @Override public void run() { web.loadUrl(url); } });
    }

    private byte[] readAsset(String path) throws IOException {
        InputStream in = getAssets().open(path);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }

    /** Semua alamat IPv4 lokal (WiFi, hotspot, dll) selain loopback. */
    private static List<String> localAddresses() {
        List<String> r = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress() && !a.isLinkLocalAddress()) r.add(a.getHostAddress());
                }
            }
        } catch (Exception e) {
            /* beberapa perangkat melarang ini */
        }
        return r;
    }

    private void acquireLocks() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "arenafps:host");
                wakeLock.acquire();
            }
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "arenafps:host");
                wifiLock.acquire();
            }
        } catch (Exception e) {
            /* tidak fatal */
        }
    }

    private void releaseLocks() {
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception e) { /* abaikan */ }
        try { if (wifiLock != null && wifiLock.isHeld()) wifiLock.release(); } catch (Exception e) { /* abaikan */ }
        wakeLock = null;
        wifiLock = null;
    }

    // ------------------------------------------------------------ layar penuh & tombol back
    @SuppressWarnings("deprecation")
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        String u = web.getUrl();
        if (u != null && !u.startsWith("file:")) web.loadUrl(LAUNCHER);  // dari game kembali ke menu
        else super.onBackPressed();                                        // dari menu: keluar
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        releaseLocks();
        web.destroy();
        super.onDestroy();
    }
}
