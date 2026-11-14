package com.jootm2.server.game;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Properties;

/**
 * Persists mutable castle runtime state separately from the original Sabuk.txt
 * configuration, so a process restart does not reset an active siege or damage.
 */
public final class CastleStateStore {

    private CastleStateStore() {
    }

    public static boolean load(Path file, Castle castle) throws IOException {
        if (file == null || castle == null || !Files.isRegularFile(file)) return false;
        Properties values = new Properties();
        try (InputStream in = Files.newInputStream(file)) {
            values.load(in);
        }

        castle.ownGuild = values.getProperty("ownGuild", castle.ownGuild);
        castle.mainDoorHp = intValue(values, "mainDoorHp", castle.mainDoorHp);
        castle.mainDoorOpen = boolValue(values, "mainDoorOpen", castle.mainDoorOpen);
        for (int i = 0; i < castle.wallHp.length; i++) {
            castle.wallHp[i] = intValue(values, "wallHp." + i, castle.wallHp[i]);
        }

        castle.warActive = boolValue(values, "warActive", false);
        castle.warEndAt = longValue(values, "warEndAt", 0L);
        castle.warGuild = values.getProperty("warGuild", "");

        // An expired siege must be resolved by the regular world tick immediately.
        if (castle.warActive && castle.warEndAt <= 0L) {
            castle.warActive = false;
            castle.warGuild = "";
        }
        return true;
    }

    public static void save(Path file, Castle castle) throws IOException {
        if (file == null || castle == null) return;
        Path parent = file.toAbsolutePath().getParent();
        if (parent != null) Files.createDirectories(parent);

        Properties values = new Properties();
        values.setProperty("ownGuild", safe(castle.ownGuild));
        values.setProperty("mainDoorHp", Integer.toString(castle.mainDoorHp));
        values.setProperty("mainDoorOpen", Boolean.toString(castle.mainDoorOpen));
        for (int i = 0; i < castle.wallHp.length; i++) {
            values.setProperty("wallHp." + i, Integer.toString(castle.wallHp[i]));
        }
        values.setProperty("warActive", Boolean.toString(castle.warActive));
        values.setProperty("warEndAt", Long.toString(castle.warEndAt));
        values.setProperty("warGuild", safe(castle.warGuild));

        Path temp = file.resolveSibling(file.getFileName().toString() + ".tmp");
        try {
            try (OutputStream out = Files.newOutputStream(temp)) {
                values.store(out, "JootM2 mutable castle runtime state");
            }
            try {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temp);
        }
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private static int intValue(Properties values, String key, int fallback) {
        try {
            return Integer.parseInt(values.getProperty(key, Integer.toString(fallback)).trim());
        } catch (RuntimeException ignored) {
            return fallback;
        }
    }

    private static long longValue(Properties values, String key, long fallback) {
        try {
            return Long.parseLong(values.getProperty(key, Long.toString(fallback)).trim());
        } catch (RuntimeException ignored) {
            return fallback;
        }
    }

    private static boolean boolValue(Properties values, String key, boolean fallback) {
        String value = values.getProperty(key);
        if (value == null) return fallback;
        if ("true".equalsIgnoreCase(value) || "1".equals(value)) return true;
        if ("false".equalsIgnoreCase(value) || "0".equals(value)) return false;
        return fallback;
    }
}
