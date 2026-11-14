package com.jootm2.server.resource;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.Charset;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorldDataMapInfoTest {

    @TempDir
    Path tempDir;

    @Test
    void parsesOriginalMusicFlagAndSafeArea() throws Exception {
        Path file = tempDir.resolve("MapInfo.txt");
        String source = String.join("\r\n",
                "[0\t比奇省] MUSIC(7) SAFE",
                "[1\t兽人古墓一层] FIGHT",
                "[2\t毒蛇山谷]",
                "0 300,300 -> 1 20,30");
        Files.write(file, source.getBytes(Charset.forName("GBK")));

        WorldData.MapInfo info = WorldData.loadMapInfo(file);

        assertEquals("比奇省", info.maps.get("0").name);
        assertTrue(info.maps.get("0").safe);
        assertEquals(7, info.maps.get("0").musicId);
        assertEquals(-1, info.maps.get("1").musicId);
        assertEquals(-1, info.maps.get("2").musicId);
        assertEquals(1, info.gates.size());
        assertEquals("1", info.gates.get(0).dstMap);
        assertEquals(20, info.gates.get(0).dstX);
        assertEquals(30, info.gates.get(0).dstY);
    }

    @Test
    void parsesDisabledMusicFlagAsNoMusic() throws Exception {
        Path file = tempDir.resolve("MapInfo-no-music.txt");
        Files.write(file, "[D001\t半兽古墓一层] SAFE".getBytes(Charset.forName("GBK")));

        WorldData.MapInfo info = WorldData.loadMapInfo(file);

        assertEquals(-1, info.maps.get("D001").musicId);
        assertTrue(info.maps.get("D001").safe);
    }
}
