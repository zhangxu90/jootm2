package com.jootm2.server.game;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GameMapDoorStateTest {

    @Test
    void reportsOpenDoorCoordinatesAndRemovesThemAfterTimeout() {
        GameMap map = new GameMap("test", 20, 20);
        map.setDoor(4, 7);
        map.setDoor(9, 12);
        assertTrue(map.openDoors().isEmpty());

        map.openDoor(4, 7, 1000L);
        map.openDoor(9, 12, 2000L);
        List<int[]> open = map.openDoors();
        assertEquals(2, open.size());
        assertTrue(open.stream().anyMatch(xy -> xy[0] == 4 && xy[1] == 7));
        assertTrue(open.stream().anyMatch(xy -> xy[0] == 9 && xy[1] == 12));

        List<int[]> closed = map.closeTimedOutDoors(1000L + 5000L, 3000L);
        assertEquals(1, closed.size());
        assertEquals(4, closed.get(0)[0]);
        assertEquals(7, closed.get(0)[1]);
        assertFalse(map.isDoorOpen(4, 7));
        assertTrue(map.isDoorOpen(9, 12));
        assertEquals(1, map.openDoors().size());
    }

    @Test
    void ignoresCoordinatesOutsideMap() {
        GameMap map = new GameMap("test", 5, 5);
        map.setDoor(-1, 0);
        map.setDoor(5, 5);
        assertTrue(map.openDoors().isEmpty());
    }
}
