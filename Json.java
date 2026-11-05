package com.arenafps;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** JSON parser minimal (cukup untuk pesan game). Tidak bergantung pada Android. */
final class Json {
    private Json() {}

    /** Mengembalikan objek JSON sebagai Map, atau null jika tidak valid. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> parseObject(String s) {
        try {
            Parser p = new Parser(s);
            p.ws();
            Object o = p.value(0);
            return (o instanceof Map) ? (Map<String, Object>) o : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static final class Parser {
        final String s;
        int i = 0;

        Parser(String s) { this.s = s; }

        void ws() { while (i < s.length() && s.charAt(i) <= ' ') i++; }

        Object value(int depth) {
            if (depth > 8) throw new IllegalStateException("terlalu dalam");
            ws();
            if (i >= s.length()) throw new IllegalStateException("kosong");
            char c = s.charAt(i);
            if (c == '{') return object(depth);
            if (c == '[') return array(depth);
            if (c == '"') return string();
            if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
            if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
            if (s.startsWith("null", i)) { i += 4; return null; }
            return number();
        }

        Map<String, Object> object(int depth) {
            Map<String, Object> m = new HashMap<>();
            i++; ws();
            if (s.charAt(i) == '}') { i++; return m; }
            for (;;) {
                ws();
                String k = string();
                ws();
                if (s.charAt(i++) != ':') throw new IllegalStateException(":");
                m.put(k, value(depth + 1));
                ws();
                char c = s.charAt(i++);
                if (c == '}') return m;
                if (c != ',') throw new IllegalStateException(",");
            }
        }

        List<Object> array(int depth) {
            List<Object> l = new ArrayList<>();
            i++; ws();
            if (s.charAt(i) == ']') { i++; return l; }
            for (;;) {
                l.add(value(depth + 1));
                ws();
                char c = s.charAt(i++);
                if (c == ']') return l;
                if (c != ',') throw new IllegalStateException(",");
            }
        }

        String string() {
            if (s.charAt(i) != '"') throw new IllegalStateException("\"");
            i++;
            StringBuilder b = new StringBuilder();
            for (;;) {
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c == '\\') {
                    char e = s.charAt(i++);
                    switch (e) {
                        case 'n': b.append('\n'); break;
                        case 't': b.append('\t'); break;
                        case 'r': b.append('\r'); break;
                        case 'b': b.append('\b'); break;
                        case 'f': b.append('\f'); break;
                        case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                        default: b.append(e);
                    }
                } else {
                    b.append(c);
                }
                if (b.length() > 4096) throw new IllegalStateException("string terlalu panjang");
            }
        }

        Double number() {
            int st = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            if (st == i) throw new IllegalStateException("angka");
            return Double.valueOf(s.substring(st, i));
        }
    }
}
