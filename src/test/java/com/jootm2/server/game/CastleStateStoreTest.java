package com.jootm2.server.game;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CastleStateStoreTest {

    @TempDir
    Path tempDir;

    @Test
    void persistsAndRestoresMutableCastleState() throws Exception {
        Path stateFile = tempDir.resolve("Castle").resolve("Sabuk.runtime.properties");
        Castle before = new Castle();
        before.ownGuild = "测试行会";
        before.mainDoorHp = 1234;
        before.mainDoorOpen = true;
        before.wallHp[0] = 100;
        before.wallHp[1] = 200;
        before.wallHp[2] = 300;
        before.warActive = true;
        before.warEndAt = 1_900_000_000_000L;
        before.warGuild = "攻城行会";

        CastleStateStore.save(stateFile, before);

        assertTrue(Files.isRegularFile(stateFile));
        Castle restored = new Castle();
        restored.mainDoorHp = restored.mainDoorMaxHp;
        restored.wallHp[0] = 900;
        restored.wallHp[1] = 900;
        restored.wallHp[2] = 900;

        assertTrue(CastleStateStore.load(stateFile, restored));
        assertEquals("测试行会", restored.ownGuild);
        assertEquals(1234, restored.mainDoorHp);
        assertTrue(restored.mainDoorOpen);
        assertEquals(100, restored.wallHp[0]);
        assertEquals(200, restored.wallHp[1]);
        assertEquals(300, restored.wallHp[2]);
        assertTrue(restored.warActive);
        assertEquals(1_900_000_000_000L, restored.warEndAt);
        assertEquals("攻城行会", restored.warGuild);
    }

    @Test
    void absentStateFileLeavesStaticConfigurationUntouched() throws Exception {
        Castle castle = new Castle();
        castle.ownGuild = "配置城主";
        castle.mainDoorHp = 5000;

        assertFalse(CastleStateStore.load(tempDir.resolve("missing.properties"), castle));
        assertEquals("配置城主", castle.ownGuild);
        assertEquals(5000, castle.mainDoorHp);
        assertFalse(castle.warActive);
    }

    @Test
    void malformedRuntimeValuesFallBackToSabukConfiguration() throws Exception {
        Path file = tempDir.resolve("malformed.properties");
        Files.write(file, ("ownGuild=PersistedGuild\n"
                + "mainDoorHp=not-a-number\n"
                + "mainDoorOpen=maybe\n"
                + "warActive=true\n"
                + "warEndAt=0\n"
                + "wallHp.0=200\n").getBytes(java.nio.charset.StandardCharsets.ISO_8859_1));

        Castle castle = new Castle();
        castle.ownGuild = "ConfigGuild";
        castle.mainDoorHp = 700;
        castle.mainDoorOpen = true;
        castle.wallHp[0] = 900;

        assertTrue(CastleStateStore.load(file, castle));
        assertEquals("PersistedGuild", castle.ownGuild);
        assertEquals(700, castle.mainDoorHp);
        assertTrue(castle.mainDoorOpen);
        assertEquals(200, castle.wallHp[0]);
        assertFalse(castle.warActive);
        assertEquals(0L, castle.warEndAt);
        assertEquals("", castle.warGuild);
    }
}
