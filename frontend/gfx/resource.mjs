// 资源清单：从服务端 resources.json 加载图片库 / 地图 URL 映射
// 对应旧代码 WIL 文件路径（Data\*.wil / Map\*.map）

let _images = null;   // { key: { x: wix路径, l: wil路径 } }
let _maps = null;     // { mapId: map路径 }
let _wavs = null;     // { soundId: wav路径 }
let _music = null;    // { musicId: mp3路径 }
let _wavDir = 'Wav';

export async function loadResources() {
    const resp = await fetch('/resources/resources.json');
    if (!resp.ok) throw new Error('加载 resources.json 失败');
    const data = await resp.json();
    _images = data.images || {};
    _maps = data.maps || {};
    _wavs = data.wavs || {};
    _music = data.music || {};

    const missingLibraries = ['tiles', 'smtiles', 'objects', 'hum', 'chrsel', 'prguse']
        .filter(key => !_images[key]);
    if (missingLibraries.length || Object.keys(_maps).length === 0) {
        throw new Error('1.80 客户端资源不完整：缺少图像库 '
            + (missingLibraries.join(', ') || '无')
            + '；地图文件数量 ' + Object.keys(_maps).length
            + '。请在资源根目录配置 Data（WIL/WIX）和 Map（.map）。');
    }
    if (Object.keys(_wavs).length === 0) {
        console.warn('[resources] WAV 音效资源不存在；画面可加载，但原版声音无法完整复刻。');
    }
    const firstWav = Object.values(_wavs)[0];
    if (firstWav) _wavDir = firstWav.split('/')[0] || 'Wav';
    return data;
}

// 取图片库 URL（key 如 'tiles'/'hum'/'mon1'）
export function imageUrls(key) {
    const img = _images?.[key];
    if (!img) return null;
    return { wil: `/resources/${img.l}`, wix: `/resources/${img.x}` };
}

// 取地图文件 URL
export function mapUrl(mapId) {
    const m = _maps?.[mapId];
    return m ? `/resources/${m}` : null;
}

// 取音频 URL（soundId 如 '001'/'1'/'100'，对应旧 SoundUtil 的音效索引）
export function wavUrl(soundId) {
    const w = _wavs?.[String(soundId)];
    return w ? `/resources/${w}` : null;
}

// 音频总数
export function wavCount() {
    return _wavs ? Object.keys(_wavs).length : 0;
}

// Original sound.lst lives beside the WAV files and maps sparse numeric IDs to filenames.
export function soundListUrl() {
    return `/resources/${_wavDir}/sound.lst`;
}

// MapInfo.txt MUSIC(n) resolves to Music/n.mp3 through this index.
export function musicUrl(musicId) {
    const path = _music?.[String(musicId)];
    return path ? `/resources/${path}` : null;
}

export function musicCount() {
    return _music ? Object.keys(_music).length : 0;
}
