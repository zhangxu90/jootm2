import assert from 'node:assert/strict';
import test from 'node:test';

import { RangeScheduler } from './scheduler.mjs';

function fakeResponse() {
    return {
        ok: true,
        status: 206,
        headers: { get: name => name === 'content-range' ? 'bytes 0-15/256' : null },
        arrayBuffer: async () => new ArrayBuffer(16),
    };
}

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

test('higher priority ranges start before older low priority queued ranges', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = (url, options) => {
        const gate = deferred();
        const range = options.headers.Range;
        requests.push({ range, gate });
        return gate.promise;
    };

    try {
        const scheduler = new RangeScheduler(1);
        const first = scheduler.schedule('/test.wil', 0, 15, 1);
        const low = scheduler.schedule('/test.wil', 32, 47, 5);
        const high = scheduler.schedule('/test.wil', 64, 79, 95);

        assert.deepEqual(requests.map(r => r.range), ['bytes=0-15']);
        requests[0].gate.resolve(fakeResponse());
        await first;

        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(requests.map(r => r.range), ['bytes=0-15', 'bytes=64-79']);

        requests[1].gate.resolve(fakeResponse());
        await high;
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(requests.map(r => r.range), [
            'bytes=0-15', 'bytes=64-79', 'bytes=32-47',
        ]);

        requests[2].gate.resolve(fakeResponse());
        await low;
        assert.equal(scheduler.stats().peakActive, 1);
        assert.equal(scheduler.stats().total, 3);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('queued overlapping ranges are deduplicated and inherit the highest priority', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = (url, options) => {
        const gate = deferred();
        requests.push({ range: options.headers.Range, gate });
        return gate.promise;
    };

    try {
        const scheduler = new RangeScheduler(1);
        const active = scheduler.schedule('/test.wil', 0, 63, 10);
        const queuedA = scheduler.schedule('/test.wil', 128, 191, 10);
        const queuedB = scheduler.schedule('/test.wil', 144, 159, 90);

        assert.equal(scheduler.stats().queue, 1);
        assert.equal(scheduler.stats().deduped, 1);
        assert.equal(scheduler.queue[0].priority, 90);

        requests[0].gate.resolve(fakeResponse());
        await active;
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(requests.length, 2);
        assert.equal(requests[1].range, 'bytes=128-191');

        requests[1].gate.resolve(fakeResponse());
        const [a, b] = await Promise.all([queuedA, queuedB]);
        assert.equal(a.start, 128);
        assert.equal(b.start, 128);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
