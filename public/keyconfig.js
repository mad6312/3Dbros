// =======================================================
// モジュール: キーコンフィグ・ボタンマッピング・UI管理
// =======================================================

const KeyConfig = {
    isKeyConfigOpen: false,
    activeListeningCleanup: null,

    padButtonNames: {
        0: '×', 1: '○', 2: '□', 3: '△',
        4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2',
        8: 'SHARE', 9: 'OPTIONS', 10: 'L3', 11: 'R3',
        12: '↑', 13: '↓', 14: '←', 15: '→', 16: 'PS', 17: 'タッチパッド'
    },

    defaultBindings: {
        forward: 'KeyW',
        backward: 'KeyS',
        left: 'KeyA',
        right: 'KeyD',
        dash: 'ShiftLeft',
        jump: 'Space',
        punch: 'Mouse0',
        spinKey: 'KeyE',
        diveKey: 'KeyR',
        lookDrag: 2,

        padPunch: 2,
        padSpin: '6+2',
        padDive: 1,
        padDash: 0,
        padJump: 3,
        padZoom: 4,
        padMoveStick: 'left',
        padLookStick: 'right'
    },

    bindings: {},

    init() {
        this.bindings = Object.assign({}, this.defaultBindings);
        this.loadKeyBindings();
        this.initUI();
    },

    loadKeyBindings() {
        try {
            const saved = localStorage.getItem('tps_key_bindings');
            if (saved) {
                this.bindings = Object.assign({}, this.defaultBindings, JSON.parse(saved));
            }
        } catch (e) {
            console.warn('localStorageアクセス不可。デフォルト設定を使用します:', e);
            this.bindings = Object.assign({}, this.defaultBindings);
        }
    },

    saveKeyBindings() {
        try {
            localStorage.setItem('tps_key_bindings', JSON.stringify(this.bindings));
        } catch (e) {
            console.warn('localStorageへの保存に失敗しました:', e);
        }
    },

    resetToDefaultBindings() {
        this.bindings = Object.assign({}, this.defaultBindings);
        this.saveKeyBindings();
        this.updateKeyConfigUI();
    },

    cancelCurrentListening() {
        if (this.activeListeningCleanup) {
            this.activeListeningCleanup();
            this.activeListeningCleanup = null;
        }
        this.updateKeyConfigUI();
    },

    formatPadButtonText(bindingVal) {
        if (bindingVal === undefined || bindingVal === null) return '未設定';
        const strVal = String(bindingVal);
        if (strVal.includes('+')) {
            const parts = strVal.split('+').map(Number);
            const name1 = this.padButtonNames[parts[0]] || `Btn${parts[0]}`;
            const name2 = this.padButtonNames[parts[1]] || `Btn${parts[1]}`;
            return `Button ${parts[0]} (${name1}) ＋ Button ${parts[1]} (${name2})`;
        } else {
            const btnIdx = Number(strVal);
            const name = this.padButtonNames[btnIdx] || `Btn${btnIdx}`;
            return `Button ${btnIdx} (${name})`;
        }
    },

    formatKeyText(bindingVal) {
        if (bindingVal === undefined || bindingVal === null) return '未設定';
        const strVal = String(bindingVal);
        if (strVal.includes('+')) {
            const parts = strVal.split('+');
            const p1 = parts[0];
            const p2 = parts[1] === 'Mouse0' ? 'Mouse0 (左クリック)' : (parts[1] === 'Mouse1' ? 'Mouse1 (中クリック)' : (parts[1] === 'Mouse2' ? 'Mouse2 (右クリック)' : parts[1]));
            return `${p1} ＋ ${p2}`;
        } else {
            if (strVal === 'Mouse0') return 'Mouse0 (左クリック)';
            if (strVal === 'Mouse1') return 'Mouse1 (中クリック)';
            if (strVal === 'Mouse2') return 'Mouse2 (右クリック)';
            return strVal;
        }
    },

    initUI() {
        const openKeyconfigBtn = document.getElementById('open-keyconfig-btn');
        const keyconfigModal = document.getElementById('keyconfig-modal');
        const closeKeyconfigBtn = document.getElementById('close-keyconfig-btn');
        const resetKeyconfigBtn = document.getElementById('reset-keyconfig-btn');

        if (openKeyconfigBtn) {
            openKeyconfigBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openKeyconfigBtn.blur();
                this.isKeyConfigOpen = true;
                if (window.Controls) Controls.clearAllInputs();
                this.updateKeyConfigUI();
                if (keyconfigModal) keyconfigModal.style.display = 'block';
            });
        }

        if (closeKeyconfigBtn) {
            closeKeyconfigBtn.addEventListener('click', () => {
                closeKeyconfigBtn.blur();
                this.cancelCurrentListening();
                this.isKeyConfigOpen = false;
                if (keyconfigModal) keyconfigModal.style.display = 'none';
            });
        }

        if (resetKeyconfigBtn) {
            resetKeyconfigBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                resetKeyconfigBtn.blur();
                this.cancelCurrentListening();
                this.resetToDefaultBindings();
            });
        }

        this.initKeyConfigListeners();
    },

    updateKeyConfigUI() {
        const setTxt = (id, txt) => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = txt;
                el.classList.remove('listening');
            }
        };

        setTxt('cfg-forward', this.formatKeyText(this.bindings.forward));
        setTxt('cfg-backward', this.formatKeyText(this.bindings.backward));
        setTxt('cfg-left', this.formatKeyText(this.bindings.left));
        setTxt('cfg-right', this.formatKeyText(this.bindings.right));
        setTxt('cfg-dash', this.formatKeyText(this.bindings.dash));
        setTxt('cfg-jump', this.formatKeyText(this.bindings.jump));
        setTxt('cfg-punch', this.formatKeyText(this.bindings.punch));
        setTxt('cfg-spin-key', this.formatKeyText(this.bindings.spinKey));
        setTxt('cfg-dive-key', this.formatKeyText(this.bindings.diveKey));

        setTxt('cfg-pad-punch', this.formatPadButtonText(this.bindings.padPunch));
        setTxt('cfg-pad-spin', this.formatPadButtonText(this.bindings.padSpin));
        setTxt('cfg-pad-dive', this.formatPadButtonText(this.bindings.padDive));
        setTxt('cfg-pad-dash', this.formatPadButtonText(this.bindings.padDash));
        setTxt('cfg-pad-jump', this.formatPadButtonText(this.bindings.padJump));
        setTxt('cfg-pad-zoom', this.formatPadButtonText(this.bindings.padZoom));
        setTxt('cfg-pad-move-stick', this.bindings.padMoveStick === 'left' ? '左スティック' : '右スティック');
        setTxt('cfg-pad-look-stick', this.bindings.padLookStick === 'right' ? '右スティック' : '左スティック');
    },

    initKeyConfigListeners() {
        const setupBindingBtn = (elemId, bindingKey) => {
            const btn = document.getElementById(elemId);
            if (!btn) return;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.cancelCurrentListening();
                btn.blur();

                btn.textContent = '入力待ち...';
                btn.classList.add('listening');

                setTimeout(() => {
                    let activeModifier = null;
                    const modifierKeys = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'];

                    const keyHandler = (event) => {
                        event.preventDefault();
                        const code = event.code;

                        if (modifierKeys.includes(code)) {
                            activeModifier = code;
                            btn.textContent = `${code} ＋ [キー/マウスを押してください]`;
                            return;
                        }

                        if (activeModifier) {
                            this.bindings[bindingKey] = `${activeModifier}+${code}`;
                        } else {
                            this.bindings[bindingKey] = code;
                        }
                        cleanup();
                    };

                    const mouseHandler = (event) => {
                        event.preventDefault();
                        const mouseName = `Mouse${event.button}`;

                        if (activeModifier) {
                            this.bindings[bindingKey] = `${activeModifier}+${mouseName}`;
                        } else {
                            this.bindings[bindingKey] = mouseName;
                        }
                        cleanup();
                    };

                    const cleanup = () => {
                        window.removeEventListener('keydown', keyHandler);
                        window.removeEventListener('mousedown', mouseHandler);
                        this.activeListeningCleanup = null;
                        btn.classList.remove('listening');
                        btn.blur();
                        this.updateKeyConfigUI();
                        this.saveKeyBindings();
                    };

                    this.activeListeningCleanup = () => {
                        window.removeEventListener('keydown', keyHandler);
                        window.removeEventListener('mousedown', mouseHandler);
                        btn.classList.remove('listening');
                        btn.blur();
                    };

                    window.addEventListener('keydown', keyHandler);
                    window.addEventListener('mousedown', mouseHandler);
                }, 60);
            });
        };

        setupBindingBtn('cfg-forward', 'forward');
        setupBindingBtn('cfg-backward', 'backward');
        setupBindingBtn('cfg-left', 'left');
        setupBindingBtn('cfg-right', 'right');
        setupBindingBtn('cfg-dash', 'dash');
        setupBindingBtn('cfg-jump', 'jump');
        setupBindingBtn('cfg-punch', 'punch');
        setupBindingBtn('cfg-spin-key', 'spinKey');
        setupBindingBtn('cfg-dive-key', 'diveKey');

        const setupPadBtn = (elemId, bindingKey) => {
            const btn = document.getElementById(elemId);
            if (!btn) return;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.cancelCurrentListening();
                btn.blur();

                btn.textContent = 'ボタンを押して...';
                btn.classList.add('listening');

                setTimeout(() => {
                    let isNeutral = false;
                    let heldModifierBtn = null;
                    const padModifiers = [4, 5, 6, 7];

                    const checkPad = setInterval(() => {
                        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
                        let activeGp = null;
                        for (let g of gamepads) {
                            if (g && g.connected) { activeGp = g; break; }
                        }

                        if (activeGp) {
                            const pressedButtons = [];
                            for (let i = 0; i < activeGp.buttons.length; i++) {
                                const b = activeGp.buttons[i];
                                if (b.pressed || (typeof b.value === 'number' && b.value > 0.3)) {
                                    pressedButtons.push(i);
                                }
                            }

                            if (pressedButtons.length === 0) {
                                isNeutral = true;
                                return;
                            }

                            if (!isNeutral) return;

                            const foundMod = pressedButtons.find(idx => padModifiers.includes(idx));
                            const foundMain = pressedButtons.find(idx => !padModifiers.includes(idx));

                            if (foundMod !== undefined && foundMain !== undefined) {
                                this.bindings[bindingKey] = `${foundMod}+${foundMain}`;
                                cleanup();
                                return;
                            } else if (foundMod !== undefined && !heldModifierBtn) {
                                heldModifierBtn = foundMod;
                                const mName = this.padButtonNames[foundMod] || `Btn${foundMod}`;
                                btn.textContent = `${mName} ＋ [ボタン待ち...]`;
                            } else if (foundMain !== undefined && !heldModifierBtn) {
                                this.bindings[bindingKey] = foundMain;
                                cleanup();
                                return;
                            }
                        }
                    }, 40);

                    const cleanup = () => {
                        clearInterval(checkPad);
                        this.activeListeningCleanup = null;
                        btn.classList.remove('listening');
                        btn.blur();
                        this.updateKeyConfigUI();
                        this.saveKeyBindings();
                    };

                    this.activeListeningCleanup = () => {
                        clearInterval(checkPad);
                        btn.classList.remove('listening');
                        btn.blur();
                    };
                }, 120);
            });
        };

        setupPadBtn('cfg-pad-punch', 'padPunch');
        setupPadBtn('cfg-pad-spin', 'padSpin');
        setupPadBtn('cfg-pad-dive', 'padDive');
        setupPadBtn('cfg-pad-dash', 'padDash');
        setupPadBtn('cfg-pad-jump', 'padJump');
        setupPadBtn('cfg-pad-zoom', 'padZoom');

        document.getElementById('cfg-pad-move-stick')?.addEventListener('click', () => {
            this.bindings.padMoveStick = this.bindings.padMoveStick === 'left' ? 'right' : 'left';
            this.bindings.padLookStick = this.bindings.padMoveStick === 'left' ? 'right' : 'left';
            this.updateKeyConfigUI();
            this.saveKeyBindings();
        });
        document.getElementById('cfg-pad-look-stick')?.addEventListener('click', () => {
            this.bindings.padLookStick = this.bindings.padLookStick === 'right' ? 'left' : 'right';
            this.bindings.padMoveStick = this.bindings.padLookStick === 'right' ? 'left' : 'right';
            this.updateKeyConfigUI();
            this.saveKeyBindings();
        });
    },

    isKeyOrCombinationPressed(activeKeys, activeMouseButtons, bindingVal) {
        if (bindingVal === undefined || bindingVal === null) return false;

        const checkSingle = (val) => {
            if (val === undefined || val === null) return false;
            const str = String(val);
            if (str.startsWith('Mouse')) {
                const btnIdx = parseInt(str.replace('Mouse', ''), 10);
                return !!activeMouseButtons[btnIdx];
            }
            return !!activeKeys[str];
        };

        const strVal = String(bindingVal);
        if (strVal.includes('+')) {
            const [mod, key] = strVal.split('+');
            return checkSingle(mod) && checkSingle(key);
        } else {
            return checkSingle(strVal);
        }
    },

    isPadButtonPressed(gp, bindingVal) {
        if (!gp || bindingVal === undefined || bindingVal === null) return false;

        const checkBtn = (idx) => {
            const b = gp.buttons[idx];
            return b && (b.pressed || (typeof b.value === 'number' && b.value > 0.3));
        };

        const strVal = String(bindingVal);
        if (strVal.includes('+')) {
            const [mod, main] = strVal.split('+').map(Number);
            return checkBtn(mod) && checkBtn(main);
        } else {
            return checkBtn(Number(strVal));
        }
    }
};