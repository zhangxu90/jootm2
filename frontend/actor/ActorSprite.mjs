// 实体精灵：根据实体快照 + 动作状态（_action/_actionAt）计算当前帧图索引，并懒加载纹理。
// 对应 Delphi 客户端 TActor/THumActor 的帧计算（Actor.pas）。
// 渲染层按绘制顺序返回（武器→身体→头发，后者覆盖前者）。

import { getLib } from '../image/Images.mjs';
import * as A from './actorData.mjs';

// 动作名 → 动作表段名（玩家用 HA，怪物/NPC 用 MA）
// 施法（spell）映射到 HA.spell 段（start 392, 6 帧×60ms），与普通攻击 hit 段不同（原版 ActSpell）
// 冲撞（rush）映射到 run 段（原版 ActRushLeft/Right 即 run 段 128 起的 3 帧子段，见 Actor.pas）
const PLAYER_SEG = { stand: 'stand', walk: 'walk', run: 'run', rush: 'run', attack: 'hit', spell: 'spell', struck: 'struck', die: 'die' };
const MON_SEG = { stand: 'stand', walk: 'walk', attack: 'attack', struck: 'struck', die: 'die' };

export class ActorSprite {
    constructor(entity) {
        this.entity = entity;
        // 站立帧动画相位（各实体错开，避免同帧同步）
        this._phase = ((entity.id || 0) % 1000) * 37;
        this._tex = new Map();      // 'lib/index' -> {canvas,px,py} 或 null
        this._loading = new Set();  // 已触发加载的 key（防重复）
        this._preloaded = false;
    }

    /**
     * 预取角色/怪物常用站立与行走动画帧（8 方向）。
     * 请求优先级低于当前实际渲染帧和地图可视瓦片，不会抢占关键帧带宽。
     */
    preloadCommon(priority = 50) {
        if (this._preloaded) return;
        this._preloaded = true;

        const e = this.entity;
        const original = {
            action: e._action,
            actionAt: e._actionAt,
            dir: e.dir,
        };

        try {
            let segments;
            if (e.type === 'player') segments = A.HA;
            else if (e.type === 'npc') segments = A.npcAction(e.appr);
            else segments = A.raceByPM(e.raceImg);
            if (!segments) return;

            const actions = e.type === 'player' ? ['stand', 'walk'] : ['stand', 'walk'];
            for (const action of actions) {
                const segmentName = e.type === 'player' ? (PLAYER_SEG[action] || 'stand')
                    : (MON_SEG[action] || 'stand');
                const segment = segments[segmentName] || segments.stand;
                if (!segment) continue;
                const frameInfo = A.actionFrames(0, segment, 0);
                const count = Math.min(frameInfo.count || 1, action === 'stand' ? 4 : 6);
                if (count <= 0) continue;

                e._action = action;
                e._actionAt = 0;
                for (let dir = 0; dir < 8; dir++) {
                    e.dir = dir;
                    for (let frame = 0; frame < count; frame++) {
                        let simulatedNow = frame * Math.max(1, frameInfo.ftime || 1);
                        if (action === 'stand') {
                            simulatedNow -= this._phase;
                            while (simulatedNow < 0) simulatedNow += Math.max(1, frameInfo.ftime || 1) * count;
                        }
                        const spec = this._frameSpec(simulatedNow);
                        if (!spec) continue;
                        for (const item of spec) this._texture(item.lib, item.index, priority);
                    }
                }
            }
        } catch (error) {
            console.debug('[sprite] common animation prefetch skipped:', error);
        } finally {
            e._action = original.action;
            e._actionAt = original.actionAt;
            e.dir = original.dir;
        }
    }

    /** 返回当前帧的绘制层 [{canvas,px,py}]；未加载返回 null。 */
    getLayers(now) {
        const spec = this._frameSpec(now);
        if (!spec) return null;
        const out = [];
        for (const f of spec) {
            const tex = this._texture(f.lib, f.index);
            if (tex) out.push({ canvas: tex.canvas, px: tex.px, py: tex.py });
        }
        return out.length ? out : null;
    }

    // 计算当前帧（各层 {lib,index}），按绘制顺序
    _frameSpec(now) {
        const e = this.entity;
        const dir = e.dir || 0;
        const action = e._action || 'stand';
        const at = e._actionAt || 0;

        let segs, segKey;
        if (e.type === 'player') {
            segs = A.HA;
            segKey = PLAYER_SEG[action] || 'stand';
        } else if (e.type === 'npc') {
            segs = A.npcAction(e.appr);
            segKey = MON_SEG[action] || 'stand';
        } else {
            segs = A.raceByPM(e.raceImg);
            segKey = MON_SEG[action] || 'stand';
        }
        if (!segs) return null;

        // attack/spell/struck 一次性播放完回 stand；walk/run 循环播放（停止由 PlayScene 超时回 stand）
        if (action === 'attack' || action === 'spell' || action === 'struck') {
            const seg = segs[segKey] || segs.stand;
            const af = A.actionFrames(0, seg, dir);
            if (af.ftime > 0 && (now - at) > af.count * af.ftime) {
                segKey = 'stand';
            }
        }

        const seg = segs[segKey] || segs.stand;
        const af = A.actionFrames(0, seg, dir);   // offset 统一为 0，怪物/NPC 之后再加外观 offset

        // 相对帧（0..count-1）
        let rel;
        if (action === 'die') {
            rel = af.ftime > 0 ? Math.min(Math.floor((now - at) / af.ftime), af.count - 1) : 0;
        } else if (segKey === 'stand') {
            rel = af.ftime > 0 ? Math.floor((now + this._phase) / af.ftime) % af.count : 0;
        } else {
            rel = af.ftime > 0 ? Math.floor((now - at) / af.ftime) % af.count : 0;
        }
        const cf = af.start + rel;   // 相对帧号（已含方向偏移）

        // 玩家分层：武器与衣服的前后关系随方向/动作帧变化（原版 Actor.pas THumActor.DrawChr + WORDER[Sex, currentframe]）
        //   wpord=0：武器先画（在衣服后面）→ 身体 → 头发
        //   wpord=1：身体 → 头发 → 武器后画（在衣服前面）
        // dress/weapon 由服务端按 Delphi GetRelFeature 算好（shape*2+sex；无装备 = sex）
        if (e.type === 'player') {
            const dress = e.dress != null ? e.dress : e.sex;
            const weapon = e.weapon != null ? e.weapon : 0;
            const sex = e.sex || 0;
            const layers = [];
            const wpord = cf >= 0 && cf < 600 && (A.WORDER[sex] || '')[cf] === '1';
            const weaponLayer = { lib: 'weapon', index: A.HUMANFRAME * weapon + cf };
            if (!wpord && weapon >= 2) {
                layers.push(weaponLayer);
            }
            layers.push({ lib: 'hum', index: A.HUMANFRAME * dress + cf });
            if ((e.hair || 0) >= 1) {
                layers.push({ lib: 'hair', index: A.HUMANFRAME * (e.hair * 2 + sex) + cf });
            }
            if (wpord && weapon >= 2) {
                layers.push(weaponLayer);
            }
            return layers;
        }

        // 怪物/NPC：单层，外观 offset + cf
        const offset = e.type === 'npc' ? A.getNpcOffset(e.appr) : A.getMonOffset(e.appr);
        const lib = e.type === 'npc' ? 'npc' : A.getMonImgLib(e.appr);
        return [{ lib, index: offset + cf }];
    }

    // 取纹理（同步返回已加载，未加载触发异步并返回 null）
    _texture(lib, index, priority = 95) {
        const key = lib + '/' + index;
        if (this._tex.has(key)) return this._tex.get(key);
        const wlib = getLib(lib);
        if (!wlib) return null;

        if (!this._loading.has(key)) {
            this._loading.add(key);
            this._tex.set(key, null); // Loading placeholder prevents duplicate fetches.
            wlib.getTexture(index, priority).then(tex => {
                this._loading.delete(key);
                if (tex) {
                    this._tex.set(key, tex);
                } else {
                    // Missing/empty images are retriable if the library becomes available later.
                    this._tex.delete(key);
                }
            }).catch(error => {
                this._loading.delete(key);
                this._tex.delete(key);
                console.warn('[sprite] texture request failed; it can be retried:', lib, index, error);
            });
        }
        return null;
    }
}
