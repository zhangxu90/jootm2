import assert from 'node:assert/strict';
import test from 'node:test';

import { loadResources } from '../gfx/resource.mjs';
import { loadMap } from './Maps.mjs';

function makeMapBuffer() {
    const buffer = new ArrayBuffer(64);
    const view = new DataView(buffer);
    view.setUint16(0, 1, true);
    view.setUint16(2, 1, true);
    // One 12-byte tile with no image layers and no collision bits.
    return buffer;
}

function responseForJson(value) {
    return { ok: true, status: 200, json: async () => value };
}

test('concurrent requests for the same map share one fetch', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    const resources = {
        images: {
            tiles: {}, smtiles: {}, objects: {}, hum: {}, chrsel: {}, prguse: {},
        },
        maps: { 'test-concurrent': 'Map/test-concurrent.map', 'test-retry': 'Map/test-retry.map' },
        wavs: {},
        music: {},
    };

    globalThis.fetch = async url => {
        if (url === '/resources/resources.json') return responseForJson(resources);
        requests.push(url);
        await new Promise(resolve => setImmediate(resolve));
        return { ok: true, status: 200, arrayBuffer: async () => makeMapBuffer() };
    };

    try {
        await loadResources();
        const [first, second] = await Promise.all([
            loadMap('test-concurrent'),
            loadMap('test-concurrent'),
        ]);
        assert.equal(first, second);
        assert.equal(first.width, 1);
        assert.equal(first.height, 1);
        assert.equal(first.tiles[0][0].canStand, true);
        assert.equal(requests.filter(url => url === '/resources/Map/test-concurrent.map').length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('a failed map fetch is removed from the in-flight cache and can be retried', async () => {
    const originalFetch = globalThis.fetch;
    let attempt = 0;
    globalThis.fetch = async url => {
        if (url === '/resources/resources.json') {
            return responseForJson({
                images: {
                    tiles: {}, smtiles: {}, objects: {}, hum: {}, chrsel: {}, prguse: {},
                },
                maps: { 'test-retry': 'Map/test-retry.map' },
                wavs: {},
                music: {},
            });
        }
        attempt++;
        if (attempt === 1) {
            return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
        }
        return { ok: true, status: 200, arrayBuffer: async () => makeMapBuffer() };
    };

    try {
        await assert.rejects(loadMap('test-retry'), /HTTP 503/);
        const restored = await loadMap('test-retry');
        assert.equal(restored.width, 1);
        assert.equal(attempt, 2);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
