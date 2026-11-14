// Web Audio implementation of the original Mir2 sound-list contract.
// Sound effects are addressed by sound.lst index; WAV files are resolved by basename
// through resources.json. Scene music uses the original WAV filenames.
import { soundListUrl, wavUrl } from '../gfx/resource.mjs';

const SETTINGS_KEY = 'jootm2.audio.v1';
const MAX_EFFECT_VOICES = 48;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function readSettings() {
    try {
        const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        return {
            effectsEnabled: value.effectsEnabled !== false,
            musicEnabled: value.musicEnabled !== false,
            effectsVolume: clamp(value.effectsVolume ?? 0.85, 0, 1),
            musicVolume: clamp(value.musicVolume ?? 0.65, 0, 1),
        };
    } catch {
        return {
            effectsEnabled: true,
            musicEnabled: true,
            effectsVolume: 0.85,
            musicVolume: 0.65,
        };
    }
}

export class AudioManager {
    constructor() {
        const settings = readSettings();
        this._effectsEnabled = settings.effectsEnabled;
        this._musicEnabled = settings.musicEnabled;
        this._effectsVolume = settings.effectsVolume;
        this._musicVolume = settings.musicVolume;

        this.context = null;
        this.effectsBus = null;
        this.musicBus = null;
        this._bufferPromises = new Map();
        this._soundFiles = null;
        this._soundFilesPromise = null;
        this._activeEffects = new Set();

        this._desiredMusic = null;
        this._musicSource = null;
        this._musicGain = null;
        this._currentMusic = null;

        // Browsers require a user gesture before audio can start. Keep the requested
        // login BGM queued and resume it after the first pointer/key interaction.
        if (typeof window !== 'undefined') {
            const unlock = () => { void this.unlock(); };
            window.addEventListener('pointerdown', unlock, { capture: true, once: true });
            window.addEventListener('keydown', unlock, { capture: true, once: true });
        }
    }

    get effectsEnabled() {
        return this._effectsEnabled;
    }

    get musicEnabled() {
        return this._musicEnabled;
    }

    _saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({
                effectsEnabled: this._effectsEnabled,
                musicEnabled: this._musicEnabled,
                effectsVolume: this._effectsVolume,
                musicVolume: this._musicVolume,
            }));
        } catch {
            // Private browsing / storage-disabled contexts still support audio.
        }
    }

    toggleEffects() {
        this._effectsEnabled = !this._effectsEnabled;
        if (!this._effectsEnabled) this.stopEffects();
        this._saveSettings();
        return this._effectsEnabled;
    }

    setEffectsEnabled(enabled) {
        this._effectsEnabled = Boolean(enabled);
        if (!this._effectsEnabled) this.stopEffects();
        this._saveSettings();
    }

    setMusicEnabled(enabled) {
        this._musicEnabled = Boolean(enabled);
        if (!this._musicEnabled) {
            this._stopMusicSource();
        } else if (this._desiredMusic) {
            void this.playBgm(this._desiredMusic);
        }
        this._saveSettings();
    }

    async unlock() {
        if (typeof window === 'undefined') return false;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return false;

        try {
            if (!this.context) {
                this.context = new AudioContextClass();
                this.effectsBus = this.context.createGain();
                this.musicBus = this.context.createGain();
                this.effectsBus.gain.value = this._effectsVolume;
                this.musicBus.gain.value = this._musicVolume;
                this.effectsBus.connect(this.context.destination);
                this.musicBus.connect(this.context.destination);
            }
            if (this.context.state !== 'running') await this.context.resume();
            if (this.context.state === 'running' && this._desiredMusic
                && this._musicEnabled && !this._musicSource) {
                void this._startMusic(this._desiredMusic);
            }
            return this.context.state === 'running';
        } catch (error) {
            console.debug('[audio] browser audio is unavailable:', error);
            return false;
        }
    }

    async _loadSoundFiles() {
        if (this._soundFiles) return this._soundFiles;
        if (this._soundFilesPromise) return this._soundFilesPromise;

        this._soundFilesPromise = (async () => {
            const files = new Map();
            const url = soundListUrl();
            if (!url) {
                this._soundFiles = files;
                return files;
            }

            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const source = await response.text();
                let lastIndex = -1;
                for (const rawLine of source.split(/\r?\n/)) {
                    const line = rawLine.trim();
                    if (!line || line.startsWith(';')) continue;
                    const match = line.match(/^(\d+)\s*[:\s\t]+(.+)$/);
                    if (!match) continue;
                    const index = Number(match[1]);
                    // The original loader accepts strictly increasing sparse indices.
                    if (!Number.isSafeInteger(index) || index <= lastIndex) continue;
                    const relativePath = match[2].trim().replace(/\\/g, '/');
                    const filename = relativePath.split('/').pop();
                    const baseName = filename.replace(/\.[^.]+$/, '').toLowerCase();
                    if (!baseName) continue;
                    files.set(index, baseName);
                    lastIndex = index;
                }
            } catch (error) {
                console.warn('[audio] unable to load Wav/sound.lst:', error);
            }
            this._soundFiles = files;
            return files;
        })();

        return this._soundFilesPromise;
    }

    async _loadBuffer(baseName) {
        const key = String(baseName || '').toLowerCase();
        if (!key || !this.context) return null;
        if (this._bufferPromises.has(key)) return this._bufferPromises.get(key);

        const url = wavUrl(key);
        if (!url) return null;

        const promise = (async () => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
            const bytes = await response.arrayBuffer();
            return this.context.decodeAudioData(bytes);
        })();
        this._bufferPromises.set(key, promise);
        try {
            return await promise;
        } catch (error) {
            this._bufferPromises.delete(key);
            console.warn('[audio] unable to decode WAV:', key, error);
            return null;
        }
    }

    async playSound(index, options = {}) {
        const id = Number(index);
        if (!this._effectsEnabled || !Number.isSafeInteger(id) || id < 0) return false;
        if (!await this.unlock() || !this._effectsEnabled) return false;

        const soundFiles = await this._loadSoundFiles();
        const baseName = soundFiles.get(id);
        if (!baseName) return false;
        const buffer = await this._loadBuffer(baseName);
        if (!buffer || !this._effectsEnabled || !this.context) return false;

        while (this._activeEffects.size >= MAX_EFFECT_VOICES) {
            const oldest = this._activeEffects.values().next().value;
            if (!oldest) break;
            try { oldest.stop(); } catch { /* already stopped */ }
            this._activeEffects.delete(oldest);
        }

        const source = this.context.createBufferSource();
        const gain = this.context.createGain();
        source.buffer = buffer;
        source.playbackRate.value = clamp(options.playbackRate ?? 1, 0.5, 2);
        gain.gain.value = clamp(options.volume ?? 1, 0, 1);
        source.connect(gain);
        gain.connect(this.effectsBus);

        this._activeEffects.add(source);
        source.addEventListener('ended', () => {
            this._activeEffects.delete(source);
            try { source.disconnect(); gain.disconnect(); } catch { /* already disconnected */ }
        }, { once: true });
        source.start(0);
        return true;
    }

    stopEffects() {
        for (const source of this._activeEffects) {
            try { source.stop(); } catch { /* already stopped */ }
        }
        this._activeEffects.clear();
    }

    async playBgm(baseName) {
        const name = String(baseName || '').replace(/\.[^.]+$/, '').toLowerCase();
        this._desiredMusic = name || null;
        if (!name || !this._musicEnabled) {
            this._stopMusicSource();
            return false;
        }
        if (!await this.unlock() || !this._musicEnabled) return false;
        return this._startMusic(name);
    }

    async _startMusic(name) {
        if (!this.context || this.context.state !== 'running' || !this._musicEnabled) return false;
        if (this._currentMusic === name && this._musicSource) return true;

        this._stopMusicSource();
        const buffer = await this._loadBuffer(name);
        if (!buffer || this._desiredMusic !== name || !this._musicEnabled) return false;

        const source = this.context.createBufferSource();
        const gain = this.context.createGain();
        source.buffer = buffer;
        source.loop = true;
        gain.gain.value = 1;
        source.connect(gain);
        gain.connect(this.musicBus);
        this._musicSource = source;
        this._musicGain = gain;
        this._currentMusic = name;
        source.addEventListener('ended', () => {
            if (this._musicSource === source) {
                this._musicSource = null;
                this._musicGain = null;
                this._currentMusic = null;
            }
            try { source.disconnect(); gain.disconnect(); } catch { /* already disconnected */ }
        }, { once: true });
        source.start(0);
        return true;
    }

    _stopMusicSource() {
        const source = this._musicSource;
        const gain = this._musicGain;
        this._musicSource = null;
        this._musicGain = null;
        this._currentMusic = null;
        if (source) {
            try { source.stop(); } catch { /* already stopped */ }
            try { source.disconnect(); } catch { /* already disconnected */ }
        }
        if (gain) {
            try { gain.disconnect(); } catch { /* already disconnected */ }
        }
    }

    stopBgm() {
        this._desiredMusic = null;
        this._stopMusicSource();
    }

    destroy() {
        this.stopEffects();
        this.stopBgm();
        if (this.context && this.context.state !== 'closed') {
            void this.context.close().catch(() => {});
        }
        this.context = null;
        this.effectsBus = null;
        this.musicBus = null;
        this._bufferPromises.clear();
    }
}

export const audio = new AudioManager();
