package com.jootm2.server.resource;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ResourcesIndexGeneratorTest {

    @TempDir
    Path tempDir;

    @Test
    void indexesImageMapWaveAndOptionalMusicResources() throws Exception {
        Path data = Files.createDirectories(tempDir.resolve("Data"));
        Path maps = Files.createDirectories(tempDir.resolve("Map"));
        Path wavs = Files.createDirectories(tempDir.resolve("Wav"));
        Path music = Files.createDirectories(tempDir.resolve("Music"));

        Files.write(data.resolve("ChrSel.wil"), new byte[] {1, 2, 3});
        Files.write(data.resolve("ChrSel.wix"), new byte[] {4, 5, 6});
        Files.write(maps.resolve("0.map"), new byte[] {7, 8, 9});
        Files.write(wavs.resolve("log-in-long2.wav"), new byte[] {10, 11});
        Files.write(wavs.resolve("sound.lst"), "1: wav\\walk-ground-l.wav".getBytes(StandardCharsets.UTF_8));
        Files.write(music.resolve("7.mp3"), new byte[] {12, 13});

        ResourcesIndexGenerator.generate(tempDir);

        JsonObject root = JsonParser.parseString(
                new String(Files.readAllBytes(tempDir.resolve("resources.json")), StandardCharsets.UTF_8))
                .getAsJsonObject();
        assertEquals("Data/ChrSel.wix", root.getAsJsonObject("images")
                .getAsJsonObject("chrsel").get("x").getAsString());
        assertEquals("Data/ChrSel.wil", root.getAsJsonObject("images")
                .getAsJsonObject("chrsel").get("l").getAsString());
        assertEquals("Map/0.map", root.getAsJsonObject("maps").get("0").getAsString());
        assertEquals("Wav/log-in-long2.wav", root.getAsJsonObject("wavs")
                .get("log-in-long2").getAsString());
        assertEquals("Music/7.mp3", root.getAsJsonObject("music").get("7").getAsString());
    }

    @Test
    void musicDirectoryIsOptional() throws Exception {
        Files.createDirectories(tempDir.resolve("Data"));
        Files.createDirectories(tempDir.resolve("Map"));
        Files.createDirectories(tempDir.resolve("Wav"));

        ResourcesIndexGenerator.generate(tempDir);

        JsonObject root = JsonParser.parseString(
                new String(Files.readAllBytes(tempDir.resolve("resources.json")), StandardCharsets.UTF_8))
                .getAsJsonObject();
        assertTrue(root.getAsJsonObject("music").entrySet().isEmpty());
    }
    @Test
    void wavAndMusicDirectoriesAreOptional() throws Exception {
        Files.createDirectories(tempDir.resolve("Data"));
        Files.createDirectories(tempDir.resolve("Map"));

        ResourcesIndexGenerator.generate(tempDir);

        JsonObject root = JsonParser.parseString(
                new String(Files.readAllBytes(tempDir.resolve("resources.json")), StandardCharsets.UTF_8))
                .getAsJsonObject();
        assertTrue(root.getAsJsonObject("wavs").entrySet().isEmpty());
        assertTrue(root.getAsJsonObject("music").entrySet().isEmpty());
    }

}
