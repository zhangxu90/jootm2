import assert from 'node:assert/strict';
import test from 'node:test';

import { MapActor } from './MapActor.mjs';

test('authoritative door snapshots reset stale cached open doors', () => {
    const actor = new MapActor(800, 600);
    const firstDoor = { doorIndex: 0x81, doorOffset: 0x05 };
    const secondDoor = { doorIndex: 0x82, doorOffset: 0x03 };
    const notDoor = { doorIndex: 0x01, doorOffset: 0x80 };
    actor.map = {
        tiles: [
            [firstDoor],
            [secondDoor],
            [notDoor],
        ],
    };

    actor.applyDoorStates([{ x: 0, y: 0 }]);
    assert.equal(firstDoor.doorOffset, 0x85);
    assert.equal(secondDoor.doorOffset, 0x03);

    // The player left while the first door was open; server says both are now closed.
    actor.applyDoorStates([]);
    assert.equal(firstDoor.doorOffset, 0x05);
    assert.equal(secondDoor.doorOffset, 0x03);
    assert.equal(notDoor.doorOffset, 0x80);
});
