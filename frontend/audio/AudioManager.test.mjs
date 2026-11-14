import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSoundList } from './AudioManager.mjs';

test('parses sparse sound.lst IDs and Windows paths', () => {
    const source = [
        '; legacy sound list',
        '',
        '1: wav\\walk-ground-l.wav',
        '2 wav\\walk-ground-r.wav',
        '5:\twav\\HIT-SWORD.WAV',
        '4: wav\\out-of-order.wav',
        '5: wav\\duplicate.wav',
        'not-an-index: wav\\ignored.wav',
    ].join('\r\n');

    const sounds = parseSoundList(source);
    assert.deepEqual([...sounds.entries()], [
        [1, 'walk-ground-l'],
        [2, 'walk-ground-r'],
        [5, 'hit-sword'],
    ]);
});

test('empty and malformed sound lists are safe', () => {
    assert.equal(parseSoundList('').size, 0);
    assert.equal(parseSoundList('; comment\ninvalid\n  \n').size, 0);
});

test('accepts zero-based sound IDs while preserving strict ordering', () => {
    const sounds = parseSoundList('0: wav\\first.wav\n0: wav\\duplicate.wav\n3: wav\\fourth.wav');
    assert.deepEqual([...sounds.entries()], [[0, 'first'], [3, 'fourth']]);
});
