// 选角 / 建角界面 —— 1:1 移植 Delphi TSelectChrScene（IntroScn.pas）
// + FrmDlg 的 DSelectChr（按钮 Prguse[66..72]）/ DCreateChr（Prguse[73]，职业/性别/发型 74..80）。
// 场景背景 = Prguse[65]（800×600，照 PlayScene 的 WProgUse.Images[65]）。
// 角色立绘 = ChrSel 站立帧（40 + job*40 + sex*120，10 帧循环，每 300ms）；未选中显示冻结帧（60 + job*40 + sex*120）。
// 名字/等级/职业用描边字（BoldTextOut 白字黑边）。

import { Scene } from '../scene/Scene.mjs';
import { audio } from '../audio/AudioManager.mjs';
import { PlayScene } from '../scene/PlayScene.mjs';
import { NoticeScene } from './NoticeScene.mjs';
import { getLib } from '../image/Images.mjs';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../core/config.mjs';

const JOB_NAMES = ['武士', '魔法师', '道士'];   // GetJobName

// 立绘位置（照 PlayScene：bx/by=冻结帧锚点，fx/fy=站立帧锚点；n=1 时 +340/+2）
const CHAR_POS = [
    [{ bx: 71, by: 52, fx: 71, fy: 52 }, { bx: 65, by: 55, fx: 65, fy: 55 }],
    [{ bx: 77, by: 46, fx: 77, fy: 46 }, { bx: 171, by: 97, fx: 141, fy: 83 }],
    [{ bx: 85, by: 63, fx: 85, fy: 63 }, { bx: 164, by: 103, fx: 141, fy: 83 }],
];
const STAND_FRAME_COUNT = 16;   // 站立动画帧数（SELECTEDFRAME）
const FRAME_MS = 300;           // 站立帧推进间隔
const TRANSITION_FRAME_MS = 50;
const TRANSITION_FRAME_COUNT = 13;
const TRANSITION_EFFECT_FRAME_COUNT = 14;

// 建角字段（照 MakeNewChar / FState.pas DCreateChr 按钮布局）
const CREATE_JOB_BTNS = [74, 75, 76];   // 武士/法师/道士

export class SelectCharScene extends Scene {
    constructor(manager) {
        super(manager);
        this.prg = getLib('prguse');
        this.chr = getLib('chrsel');
        this._prgCache = new Map();  // Prguse 图 → img URL
        this._chrCache = new Map();  // ChrSel 图 → decoded WIL texture
        this._bgTex = null;
        this.chars = [null, null];   // 两个角色槽（照 ChrArr[0..1]）
        this.selected = 0;
        this.createMode = false;
        this.newIndex = 0;
        this._frame = 0;
        this._frameAt = 0;
        this._slotTransitions = [null, null];
        this.root = null;
        this.createWin = null;
    }

    onEnter() {
        void audio.playBgm('sellect-loop2');
        const gui = this.manager.winManager.container;
        gui.innerHTML = '';
        this.root = document.createElement('div');
        this.root.style.cssText = 'position:absolute;inset:0;pointer-events:auto;';
        gui.appendChild(this.root);
        this._buildButtons();
        this.conn.send('listCharacters');
    }

    onExit() {
        audio.stopBgm();
        this._closeMessageDialog('cancel');
        if (this.root) this.root.remove();
        document.removeEventListener('keydown', this._keyHandler);
    }

    // ---- 纹理加载 ---------------------------------------------------------

    // Prguse 图 → img URL（缓存）
    async _prgUrl(idx) {
        if (!this.prg) return null;
        if (this._prgCache.has(idx)) return this._prgCache.get(idx);
        const tex = await this.prg.getTexture(idx);
        if (!tex) return null;
        const url = tex.canvas.toDataURL
            ? tex.canvas.toDataURL('image/png')
            : URL.createObjectURL(await tex.canvas.convertToBlob());
        this._prgCache.set(idx, url);
        return url;
    }

    // ChrSel 图 → canvas 纹理（懒加载，未加载返回 null 并异步触发）
    _chrTexture(idx) {
        if (this._chrCache.has(idx)) return this._chrCache.get(idx).texture || null;
        this._chrCache.set(idx, { texture: null });
        this.chr.getTexture(idx).then((texture) => {
            const entry = this._chrCache.get(idx);
            if (entry) entry.texture = texture || null;
        });
        return null;
    }

    _chrTex(idx) {
        return this._chrTexture(idx)?.canvas || null;
    }

    _startSlotTransition(slot, direction) {
        if (!this.chars[slot]) {
            this._slotTransitions[slot] = null;
            return;
        }
        this._slotTransitions[slot] = { direction, startedAt: performance.now() };
    }

    // ---- DOM 构建 ---------------------------------------------------------

    // Prguse 图按钮（绝对坐标，照 FState.pas）
    // WIL 图按钮：正常态画在背景图里；透明热区接收点击，img（按下态）按下显示、抬起恢复
    async _btn(idx, left, top, onClick) {
        const url = await this._prgUrl(idx);
        if (!url) return null;
        const hot = document.createElement('div');
        hot.style.cssText = `position:absolute;left:${left}px;top:${top}px;cursor:pointer;`;
        const el = document.createElement('img');
        el.src = url;
        el.draggable = false;
        el.style.cssText = 'visibility:hidden;display:block;';
        el.addEventListener('load', () => {
            hot.style.width = el.naturalWidth + 'px';
            hot.style.height = el.naturalHeight + 'px';
        });
        hot.appendChild(el);
        hot.addEventListener('mousedown', () => { el.style.visibility = 'visible'; });
        const restore = () => { el.style.visibility = 'hidden'; };
        hot.addEventListener('mouseup', restore);
        hot.addEventListener('mouseleave', restore);
        hot.addEventListener('click', onClick);
        this.root.appendChild(hot);
        return hot;
    }

    _buildButtons() {
        // 选角按钮（FState.pas DSelectChr），并行加载
        return Promise.all([
            this._btn(66, 133, 453, () => this._select(0)),    // 选角色1
            this._btn(67, 685, 454, () => this._select(1)),    // 选角色2
            this._btn(68, 385, 456, () => this._start()),      // 开始
            this._btn(69, 348, 486, () => this._newChr()),     // 创建角色
            this._btn(70, 347, 506, () => this._erase()),      // 删除角色
            this._btn(71, 362, 527, () => {}),                 // 制作人员（原版空实现）
            this._btn(72, 379, 547, () => this.conn.close()),  // 退出
        ]);
    }

    // ---- 交互 ---------------------------------------------------------------

    _select(n) {
        if (!this.chars[n] || this.selected === n) return;
        const previous = this.selected;
        this._startSlotTransition(previous, -1);
        this.selected = n;
        this._startSlotTransition(n, 1);
        void audio.playSound(101); // Original s_meltstone selection sound.
    }

    _start() {
        const c = this.chars[this.selected];
        if (c) {
            this._pendingName = c.name;   // 记住角色名，notice 确认后用它进游戏
            this.conn.send('enterGame', { name: c.name });
        } else {
            this._msg('一开始你应该创建一个新角色。\n选择「创建角色」你就能建立一个新角色了。');
        }
    }

    _newChr() {
        if (!this.chars[0]) this._openCreate(0);
        else if (!this.chars[1]) this._openCreate(1);
        else this._msg('你可以为每个单独的帐户创建两个角色。');
    }

    async _erase() {
        const character = this.chars[this.selected];
        if (!character) return;
        const result = await this._msg(
            '"' + character.name + '" 删除后不能恢复。\n真的要删除这个角色吗？',
            ['no', 'yes']);
        if (result === 'yes') {
            this.conn.send('deleteCharacter', { name: character.name });
        }
    }

    _closeMessageDialog(result = 'cancel') {
        const dialog = this._messageDialog;
        if (!dialog) return;
        this._messageDialog = null;
        document.removeEventListener('keydown', dialog.keyHandler);
        if (dialog.overlay.isConnected) dialog.overlay.remove();
        dialog.resolve(result);
    }

    async _msg(message, buttons = ['ok']) {
        this._closeMessageDialog('replaced');
        const overlay = document.createElement('div');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', '游戏消息');
        overlay.style.cssText = 'position:absolute;inset:0;z-index:10000;pointer-events:auto;';

        const win = document.createElement('div');
        win.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
            + 'overflow:visible;image-rendering:pixelated;';
        overlay.appendChild(win);
        this.root.appendChild(overlay);

        const bgTex = this.prg ? await this.prg.getTexture(360) : null;
        const bgUrl = await this._prgUrl(360);
        const width = bgTex && bgTex.canvas ? bgTex.canvas.width : 440;
        const height = bgTex && bgTex.canvas ? bgTex.canvas.height : 190;
        win.style.width = width + 'px';
        win.style.height = height + 'px';
        if (bgUrl) {
            win.style.backgroundImage = 'url("' + bgUrl + '")';
            win.style.backgroundRepeat = 'no-repeat';
            win.style.backgroundSize = '100% 100%';
        } else {
            win.style.background = 'rgba(22, 17, 12, 0.96)';
            win.style.border = '2px solid #a78a57';
            win.style.boxShadow = '0 4px 20px #000';
        }

        const text = document.createElement('div');
        text.textContent = String(message || '').split(/\\|\r?\n/).join('\n');
        text.style.cssText = 'position:absolute;left:39px;top:38px;right:39px;'
            + 'color:#fff;font:12px/14px SimSun,serif;white-space:pre-wrap;'
            + 'text-shadow:1px 1px #000;pointer-events:none;';
        win.appendChild(text);

        const buttonDefs = {
            ok: { index: 361, label: '确定' },
            yes: { index: 363, label: '是' },
            cancel: { index: 365, label: '取消' },
            no: { index: 367, label: '否' },
        };
        const requested = Array.from(new Set(buttons)).filter(key => buttonDefs[key]);
        const ordered = ['cancel', 'no', 'yes', 'ok'].filter(key => requested.includes(key));
        const promise = new Promise(resolve => {
            const dialog = { overlay, resolve, keyHandler: null };
            dialog.keyHandler = event => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    this._closeMessageDialog(requested.includes('no') ? 'no'
                        : (requested.includes('cancel') ? 'cancel' : 'ok'));
                } else if (event.key === 'Enter') {
                    event.preventDefault();
                    this._closeMessageDialog(requested.includes('yes') ? 'yes' : 'ok');
                }
            };
            this._messageDialog = dialog;
            document.addEventListener('keydown', dialog.keyHandler);
        });

        let left = 324;
        for (const key of ordered) {
            const def = buttonDefs[key];
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('aria-label', def.label);
            button.style.cssText = 'position:absolute;left:' + left + 'px;top:126px;'
                + 'width:80px;height:22px;padding:0;border:0;background:transparent;cursor:pointer;';
            const image = document.createElement('img');
            image.alt = def.label;
            image.draggable = false;
            image.style.cssText = 'display:block;width:100%;height:100%;image-rendering:pixelated;';
            const up = await this._prgUrl(def.index);
            const down = await this._prgUrl(def.index + 1);
            image.src = up || '';
            button.appendChild(image);
            if (!up) {
                button.textContent = def.label;
                button.style.cssText += 'background:#5b472b;color:#fff;border:1px solid #c6a56c;';
            }
            button.addEventListener('pointerdown', () => { if (down) image.src = down; });
            const restore = () => { if (up) image.src = up; };
            button.addEventListener('pointerup', restore);
            button.addEventListener('pointerleave', restore);
            button.addEventListener('click', () => this._closeMessageDialog(key));
            win.appendChild(button);
            left -= 110;
        }

        const firstButton = win.querySelector('button');
        if (firstButton) firstButton.focus();
        return promise;
    }

    // ---- 建角窗口（DCreateChr） --------------------------------------------

    async _openCreate(index) {
        this.createMode = true;
        this.newIndex = index;
        this.createState = { job: 0, sex: 0, hair: 0 };   // 建角状态（同步初始化，避免 await 后才可用）
        const left = index === 0 ? 415 : 75;   // 照 MakeNewChar：槽0在右、槽1在左
        const top = 15;

        // 窗口容器 + 名字输入框先同步创建（照 EdChrName：窗口 Left+71, Top+107，宽137），
        // 背景图/按钮异步插入，保证 _nameInput 立即可用。
        const win = document.createElement('div');
        win.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:300px;height:417px;`;
        this.root.appendChild(win);
        this.createWin = win;

        const name = document.createElement('input');
        name.type = 'text';
        name.maxLength = 14;
        name.style.cssText = 'position:absolute;left:71px;top:107px;width:137px;height:16px;'
            + 'border:none;background:#000;color:#fff;font-size:12px;font-family:SimSun,serif;'
            + 'padding:0 3px;box-sizing:content-box;outline:none;';
        win.appendChild(name);
        this._nameInput = name;

        // 窗口背景 Prguse[73]（300×417，异步插入）
        this._prgUrl(73).then((bgUrl) => {
            if (!bgUrl || !this.createWin) return;
            const bg = document.createElement('img');
            bg.src = bgUrl;
            bg.draggable = false;
            bg.style.cssText = 'position:absolute;left:0;top:0;';
            bg.style.zIndex = '-1';
            win.insertBefore(bg, win.firstChild);
        });

        // 职业/性别/发型/确定/关闭按钮（并行加载，坐标照 FState.pas；透明热区 + 按下态 img）
        const mk = (idx, l, t, onClick) => this._prgUrl(idx).then((url) => {
            if (!url) return;
            const hot = document.createElement('div');
            hot.style.cssText = `position:absolute;left:${l}px;top:${t}px;cursor:pointer;`;
            const el = document.createElement('img');
            el.src = url;
            el.draggable = false;
            el.style.cssText = 'visibility:hidden;display:block;';
            el.addEventListener('load', () => {
                hot.style.width = el.naturalWidth + 'px';
                hot.style.height = el.naturalHeight + 'px';
            });
            hot.appendChild(el);
            hot.addEventListener('mousedown', () => { el.style.visibility = 'visible'; });
            const restore = () => { el.style.visibility = 'hidden'; };
            hot.addEventListener('mouseup', restore);
            hot.addEventListener('mouseleave', restore);
            hot.addEventListener('click', onClick);
            win.appendChild(hot);
        });
        // 职业（DccWarrior(48,157) DccWizzard(93,157) DccMonk(138,157)）
        // 性别（DccMale(93,231) DccFemale(138,231)）
        // 发型（DccLeftHair(76,308) DccRightHair(170,308)）
        // 确定（DccOk 图62 (102,359)）/ 关闭（DccClose 图64 (248,31)）
        return Promise.all([
            mk(74, 48, 157, () => this._setJob(0)),
            mk(75, 93, 157, () => this._setJob(1)),
            mk(76, 138, 157, () => this._setJob(2)),
            mk(77, 93, 231, () => this._setSex(0)),
            mk(78, 138, 231, () => this._setSex(1)),
            mk(79, 76, 308, () => this._setHair(-1)),
            mk(80, 170, 308, () => this._setHair(+1)),
            mk(62, 102, 359, () => this._createOk()),
            mk(64, 248, 31, () => this._createClose()),
        ]).then(() => {
            name.focus();
            this._keyHandler = (e) => { if (e.key === 'Enter') this._createOk(); };
            document.addEventListener('keydown', this._keyHandler);
        });
    }

    _setJob(job) { this.createState.job = job; }
    _setSex(sex) { this.createState.sex = sex; }
    _setHair(d) { this.createState.hair = (this.createState.hair + d + 10) % 10; }

    _createOk() {
        const name = this._nameInput.value.trim();
        if (!name) { this._nameInput.focus(); return; }
        this.conn.send('createCharacter', { name, ...this.createState });
        this._createClose();
    }

    _createClose() {
        this.createMode = false;
        if (this.createWin) { this.createWin.remove(); this.createWin = null; }
        document.removeEventListener('keydown', this._keyHandler);
    }

    // ---- 消息 ---------------------------------------------------------------

    onMessage(type, msg) {
        if (type === 'characterList') {
            const list = msg.characters || [];
            const previousChars = this.chars;
            const previousSelected = this.selected;
            this.chars = [list[0] || null, list[1] || null];
            if (!this.chars[this.selected]) {
                this.selected = this.chars[0] ? 0 : (this.chars[1] ? 1 : 0);
            }
            for (let slot = 0; slot < 2; slot++) {
                const oldCharacter = previousChars[slot];
                const newCharacter = this.chars[slot];
                if (!newCharacter) {
                    this._slotTransitions[slot] = null;
                    continue;
                }
                if (!oldCharacter || oldCharacter.name !== newCharacter.name) {
                    this._startSlotTransition(slot, slot === this.selected ? 1 : -1);
                }
            }
            if (previousSelected !== this.selected && this.chars[this.selected]) {
                this._startSlotTransition(previousSelected, -1);
                this._startSlotTransition(this.selected, 1);
            }
        } else if (type === 'createCharacterResult') {
            if (!msg.ok) this._msg(msg.error || '创建失败。');
            this.conn.send('listCharacters');
        } else if (type === 'deleteCharacterResult') {
            this.conn.send('listCharacters');
        } else if (type === 'enterGameResult') {
            if (!msg.ok) this._msg(msg.error || '进入游戏失败。');
        } else if (type === 'notice') {
            this.manager.switchTo(new NoticeScene(this.manager, this._pendingName, msg.lines || []));
        } else if (type === 'enterGame') {
            this.manager.switchTo(new PlayScene(this.manager, msg));
        }
    }

    // ---- 渲染 ---------------------------------------------------------------

    _text(ctx, text, x, y) {
        ctx.font = 'bold 13px SimSun,serif';
        ctx.textAlign = 'left';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, x, y);
    }

    render(ctx) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

        // 背景 Prguse[65]
        if (this._bgTex) {
            ctx.drawImage(this._bgTex, 0, 0);
        } else if (!this._bgLoading) {
            this._bgLoading = true;
            this.prg.getTexture(65).then((t) => { this._bgTex = t ? t.canvas : null; });
        }

        // 站立帧推进（SELECTEDFRAME=16，300ms/帧）
        const now = performance.now();
        if (now - this._frameAt >= FRAME_MS) {
            this._frameAt = now;
            this._frame = (this._frame + 1) % STAND_FRAME_COUNT;
        }

        // 两个角色立绘
        for (let n = 0; n < 2; n++) {
            const c = this.chars[n];
            if (!c) continue;
            const pos = CHAR_POS[c.job] && CHAR_POS[c.job][c.sex];
            if (!pos) continue;
            const off = n === 1 ? { bx: 340, by: 2, fx: 340, fy: 2 } : { bx: 0, by: 0, fx: 0, fy: 0 };

            let img, x, y;
            let transitionEffect = null;
            const transition = this._slotTransitions[n];
            const frozenBase = 60 + c.job * 40 + c.sex * 120;
            let transitionFrame = -1;
            if (transition) {
                const elapsed = Math.max(0, now - transition.startedAt);
                transitionFrame = Math.min(TRANSITION_FRAME_COUNT - 1, Math.floor(elapsed / TRANSITION_FRAME_MS));
                if (elapsed >= TRANSITION_FRAME_COUNT * TRANSITION_FRAME_MS) {
                    this._slotTransitions[n] = null;
                    transitionFrame = -1;
                }
            }

            if (transitionFrame >= 0 && transition) {
                // Thaw plays the 13-frame ChrSel freeze sequence forward; freeze plays it backward.
                img = frozenBase + (transition.direction > 0 ? transitionFrame : TRANSITION_FRAME_COUNT - 1 - transitionFrame);
                x = pos.fx + off.fx;
                y = pos.fy + off.fy;
                // Original ChrSel[4..17] DrawBlend flicker uses 14 frames at 50ms each.
                transitionEffect = this._chrTexture(4 + (transitionFrame % TRANSITION_EFFECT_FRAME_COUNT));
            } else if (n === this.selected) {
                img = 40 + c.job * 40 + this._frame + c.sex * 120;
                x = pos.fx + off.fx;
                y = pos.fy + off.fy;
            } else {
                img = frozenBase;
                x = pos.bx + off.bx;
                y = pos.by + off.by;
            }
            const tex = this._chrTex(img);
            if (tex) ctx.drawImage(tex, x, y);
            // 名字/等级/职业（照 BoldTextOut 位置）
            if (n === 0) {
                this._text(ctx, c.name, 136, 476);
                this._text(ctx, String(c.level), 136, 513);
                this._text(ctx, JOB_NAMES[c.job] || '', 136, 548);
            } else {
                this._text(ctx, c.name, 586, 476);
                this._text(ctx, String(c.level), 666, 513);
                this._text(ctx, JOB_NAMES[c.job] || '', 638, 548);
            }
        }
    }
}
