// .map 地图解析（对应旧 Maps.mjs）
// 解析出每个 tile 的地砖/小地砖/对象层索引 + 可行走标记。
// 同一张地图的并发加载会复用一个 Promise；失败会从缓存移除，后续请求可以重试。

import { mapUrl } from '../gfx/resource.mjs';

const loadedMaps = new Map();   // mapId -> {width,height,tiles}
const loadingMaps = new Map();  // mapId -> Promise

export async function loadMap(mapId) {
    if (loadedMaps.has(mapId)) return loadedMaps.get(mapId);
    if (loadingMaps.has(mapId)) return loadingMaps.get(mapId);

    const promise = readMap(mapId);
    loadingMaps.set(mapId, promise);
    try {
        const map = await promise;
        loadedMaps.set(mapId, map);
        return map;
    } finally {
        loadingMaps.delete(mapId);
    }
}

async function readMap(mapId) {
    const url = mapUrl(mapId);
    if (!url) throw new Error(`地图 ${mapId} 未在 resources.json 中`);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`加载 ${url} 失败（HTTP ${response.status}）`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 52) throw new Error(`地图 ${mapId} 文件头不完整`);

    const view = new DataView(buffer);
    const width = view.getUint16(0, true);
    const height = view.getUint16(2, true);
    if (!width || !height) throw new Error(`地图 ${mapId} 尺寸无效：${width}×${height}`);

    const dataLength = buffer.byteLength - 52;
    const tileCount = width * height;
    const tileByteSize = dataLength / tileCount;
    if (!Number.isFinite(tileByteSize) || tileByteSize < 12 || dataLength % tileCount !== 0) {
        throw new Error(`地图 ${mapId} 数据长度无效：${buffer.byteLength} bytes`);
    }

    let offset = 52;
    const tiles = [];
    for (let x = 0; x < width; x++) {
        tiles[x] = [];
        for (let y = 0; y < height; y++) {
            const background = view.getInt16(offset, true); offset += 2;
            const middle = view.getInt16(offset, true); offset += 2;
            const object = view.getInt16(offset, true); offset += 2;
            const doorIndex = view.getInt8(offset); offset++;
            const doorOffset = view.getInt8(offset); offset++;
            const animation = view.getInt8(offset); offset++;
            const animationTick = view.getInt8(offset); offset++;
            const objectFileIndex = view.getInt8(offset); offset++;
            const light = view.getInt8(offset); offset++;

            let backgroundFileIndex = 0;
            let middleFileIndex = 0;
            if (tileByteSize >= 14) {
                backgroundFileIndex = view.getInt8(offset); offset++;
                middleFileIndex = view.getInt8(offset); offset++;
                if (tileByteSize > 14) offset += tileByteSize - 14;
            }

            tiles[x][y] = {
                bng: (background & 0x7fff) > 0 ? (background & 0x7fff) - 1 : -1,
                mid: (middle & 0x7fff) > 0 ? (middle & 0x7fff) - 1 : -1,
                obj: (object & 0x7fff) > 0 ? (object & 0x7fff) - 1 : -1,
                canStand: (background & 0x8000) === 0
                    && (middle & 0x8000) === 0 && (object & 0x8000) === 0,
                highWall: (object & 0x8000) !== 0,
                doorIndex,
                doorOffset,
                light,
                bngFile: backgroundFileIndex !== 0 ? backgroundFileIndex + 1 : 0,
                midFile: middleFileIndex !== 0 ? middleFileIndex + 1 : 0,
                objFile: objectFileIndex !== 0 ? objectFileIndex + 1 : 0,
                hasAni: (animation & 0x7f) > 0,
                aniFrame: animation & 0x7f,
                aniTick: animationTick,
                blend: (animation & 0x80) !== 0,
            };
        }
    }

    return { width, height, tiles };
}
