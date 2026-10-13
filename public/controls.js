// =======================================================
// モジュール2: 操作入力・スタミナ/スキルCT・カメラ制御・環境設定
// =======================================================

const Controls = {
    targetYaw: 0,
    targetPitch: 0.3,
    currentYaw: 0,
    currentPitch: 0.3,
    cameraDistance: 6.5,
    minDistance: 2.0,
    maxDistance: 20.0,
    smoothedTargetY: 1.5,

    invertY: true,
    antiSickness: true,
    angularSpeed: 0,

    isDragging: false,
    previousMousePosition: { x: 0, y: 0 },

    dashStamina: 100.0,
    isExhausted: false,

    // 攻撃＆溜め管理
    isHoldingAttack: false,
    attackType: 'punch',
    chargeTime: 0,
    chargeLevel: 0,

    // スキルCT管理
    spinStacks: 2,
    spinMaxStacks: 2,
    spinCooldownTimer: 0,
    readonlyCooldown: 10.0,

    diveCooldownTimer: 0,
    readonlyDiveCooldown: 20.0,

    isCountdownActive: false,
    isEliminated: false,

    // 単発ジャンプ判定用
    prevJumpHeld: false,

    lastHiddenTimestamp: 0,

    activeKeys: {},
    activeMouseButtons: {},

    init(onNameChangeCallback, onHostBattleToggle, onReturnToFree) {
        KeyConfig.init();
        this.initUI(onNameChangeCallback, onHostBattleToggle, onReturnToFree);
        this.initEventListeners();
        this.initVisibilityHandler();
    },

    clearAllInputs() {
        this.activeKeys = {};
        this.activeMouseButtons = {};
        this.isDragging = false;
        this.cancelPunchCharge();
    },

    initVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.lastHiddenTimestamp = Date.now();
                this.clearAllInputs();
            } else {
                this.clearAllInputs();
                if (this.lastHiddenTimestamp > 0) {
                    const elapsedSeconds = (Date.now() - this.lastHiddenTimestamp) / 1000.0;
                    this.applyCatchupTime(elapsedSeconds);
                    this.lastHiddenTimestamp = 0;
                }
            }
        });

        window.addEventListener('blur', () => {
            this.clearAllInputs();
        });
    },

    applyCatchupTime(seconds) {
        if (seconds <= 0) return;

        this.dashStamina = Math.min(100.0, this.dashStamina + 5.0 * seconds);
        if (this.isExhausted && this.dashStamina >= 20.0) {
            this.isExhausted = false;
        }

        if (this.diveCooldownTimer > 0) {
            this.diveCooldownTimer = Math.max(0, this.diveCooldownTimer - seconds);
        }

        let remainingTime = seconds;
        while (this.spinStacks < this.spinMaxStacks && remainingTime > 0) {
            if (this.spinCooldownTimer <= 0) {
                this.spinCooldownTimer = this.readonlyCooldown;
            }
            if (remainingTime >= this.spinCooldownTimer) {
                remainingTime -= this.spinCooldownTimer;
                this.spinStacks++;
                this.spinCooldownTimer = (this.spinStacks < this.spinMaxStacks) ? this.readonlyCooldown : 0;
            } else {
                this.spinCooldownTimer -= remainingTime;
                remainingTime = 0;
            }
        }
    },

    initUI(onNameChangeCallback, onHostBattleToggle, onReturnToFree) {
        const toggleInstructionsBtn = document.getElementById('toggle-instructions-btn');
        const instructionsBody = document.getElementById('instructions-body');
        const instructionsHeader = document.getElementById('instructions-header');

        const toggleInstructions = () => {
            if (instructionsBody) {
                if (instructionsBody.style.display === 'none') {
                    instructionsBody.style.display = 'block';
                    if (toggleInstructionsBtn) toggleInstructionsBtn.textContent = '折りたたむ ▲';
                } else {
                    instructionsBody.style.display = 'none';
                    if (toggleInstructionsBtn) toggleInstructionsBtn.textContent = '展開する ▼';
                }
            }
            if (toggleInstructionsBtn) toggleInstructionsBtn.blur();
        };

        if (toggleInstructionsBtn) {
            toggleInstructionsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleInstructions();
            });
        }
        if (instructionsHeader) {
            instructionsHeader.addEventListener('click', toggleInstructions);
        }

        const settingsBtn = document.getElementById('settings-btn');
        const settingsModal = document.getElementById('settings-modal');
        const closeSettingsBtn = document.getElementById('close-settings-btn');

        const invertYCheckbox = document.getElementById('invert-y-checkbox');
        const antiSicknessCheckbox = document.getElementById('anti-sickness-checkbox');
        const cockpitFrame = document.getElementById('cockpit-frame');
        const horizonLine = document.getElementById('horizon-line');
        const sicknessDot = document.getElementById('sickness-dot');
        const vignetteOverlay = document.getElementById('vignette-overlay');

        const nameInput = document.getElementById('player-name-input');
        const saveNameBtn = document.getElementById('save-name-btn');
        const nameChangedToast = document.getElementById('name-changed-toast');

        const hostBattleBtn = document.getElementById('host-battle-btn');
        if (hostBattleBtn) {
            hostBattleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                hostBattleBtn.blur();
                if (onHostBattleToggle) onHostBattleToggle();
            });
        }

        const resultNextBtn = document.getElementById('result-next-btn');
        const battleResultModal = document.getElementById('battle-result-modal');
        if (resultNextBtn) {
            resultNextBtn.addEventListener('click', () => {
                resultNextBtn.blur();
                if (battleResultModal) battleResultModal.style.display = 'none';
                if (onReturnToFree) onReturnToFree();
            });
        }

        if (settingsBtn) {
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsBtn.blur();
                if (settingsModal) settingsModal.style.display = 'block';
            });
        }

        if (closeSettingsBtn) {
            closeSettingsBtn.addEventListener('click', () => {
                closeSettingsBtn.blur();
                if (settingsModal) settingsModal.style.display = 'none';
            });
        }

        if (saveNameBtn) {
            saveNameBtn.addEventListener('click', () => {
                saveNameBtn.blur();
                const val = nameInput ? nameInput.value.trim() : '';
                if (val) {
                    if (onNameChangeCallback) onNameChangeCallback(val);
                    if (nameChangedToast) {
                        nameChangedToast.style.display = 'block';
                        setTimeout(() => { nameChangedToast.style.display = 'none'; }, 2000);
                    }
                }
            });
        }

        if (invertYCheckbox) {
            invertYCheckbox.addEventListener('change', (e) => {
                this.invertY = e.target.checked;
                invertYCheckbox.blur();
            });
        }

        if (antiSicknessCheckbox) {
            antiSicknessCheckbox.addEventListener('change', (e) => {
                this.antiSickness = e.target.checked;
                antiSicknessCheckbox.blur();
                const displayStyle = this.antiSickness ? 'block' : 'none';
                if (cockpitFrame) cockpitFrame.style.display = displayStyle;
                if (horizonLine) horizonLine.style.display = displayStyle;
                if (sicknessDot) sicknessDot.style.display = displayStyle;
                if (!this.antiSickness && vignetteOverlay) vignetteOverlay.style.opacity = 0;
            });
        }
    },

    initEventListeners() {
        window.addEventListener('contextmenu', (e) => e.preventDefault());

        window.addEventListener('keydown', (e) => {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
            if (KeyConfig.isKeyConfigOpen) return;
            this.activeKeys[e.code] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.activeKeys[e.code] = false;
        });

        window.addEventListener('mousedown', (e) => {
            if (e.target && e.target.tagName !== 'CANVAS') return;
            if (KeyConfig.isKeyConfigOpen) return;

            this.activeMouseButtons[e.button] = true;

            const lookBtn = Number(KeyConfig.bindings.lookDrag !== undefined ? KeyConfig.bindings.lookDrag : 2);
            if (e.button === lookBtn || e.button === 2) {
                this.isDragging = true;
                this.previousMousePosition = { x: e.clientX, y: e.clientY };
            }
        });

        window.addEventListener('mouseup', (e) => {
            this.activeMouseButtons[e.button] = false;
            this.isDragging = false;
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isDragging || KeyConfig.isKeyConfigOpen) return;

            const deltaX = e.clientX - this.previousMousePosition.x;
            const deltaY = e.clientY - this.previousMousePosition.y;

            this.targetYaw -= deltaX * 0.005;

            const pitchFactor = this.invertY ? -1 : 1;
            this.targetPitch -= deltaY * 0.005 * pitchFactor;
            this.targetPitch = Math.max(-0.2, Math.min(Math.PI / 2.5, this.targetPitch));

            this.angularSpeed += Math.hypot(deltaX, deltaY) * 0.08;
            this.previousMousePosition = { x: e.clientX, y: e.clientY };
        });

        window.addEventListener('wheel', (e) => {
            if (KeyConfig.isKeyConfigOpen) return;
            this.cameraDistance += e.deltaY * 0.008;
            this.cameraDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.cameraDistance));
        }, { passive: true });

        const gamepadStatus = document.getElementById('gamepad-status');
        window.addEventListener('gamepadconnected', () => {
            if (gamepadStatus) {
                gamepadStatus.textContent = 'コントローラー接続中';
                gamepadStatus.classList.add('connected');
            }
        });
        window.addEventListener('gamepaddisconnected', () => {
            if (gamepadStatus) {
                gamepadStatus.textContent = 'コントローラー未接続';
                gamepadStatus.classList.remove('connected');
            }
        });
    },

    applyDeadzone(val, deadzone = 0.15) {
        return Math.abs(val) > deadzone ? val : 0;
    },

    cancelPunchCharge() {
        this.isHoldingAttack = false;
        this.chargeTime = 0;
        this.chargeLevel = 0;
    },

    consumeSpinStack() {
        if (this.spinStacks > 0) {
            this.spinStacks--;
            if (this.spinCooldownTimer <= 0) {
                this.spinCooldownTimer = this.readonlyCooldown;
            }
        }
    },

    consumeDive() {
        this.diveCooldownTimer = this.readonlyDiveCooldown;
    },

    resetAllSkillsAndStamina() {
        this.spinStacks = 2;
        this.spinCooldownTimer = 0;
        this.diveCooldownTimer = 0;
        this.dashStamina = 100.0;
        this.isExhausted = false;
        this.prevJumpHeld = false;
        this.cancelPunchCharge();

        const dashBarFill = document.getElementById('dash-bar-fill');
        const dashText = document.getElementById('dash-text');
        if (dashBarFill && dashText) {
            dashBarFill.style.width = '100%';
            dashText.textContent = '100%';
            dashBarFill.classList.remove('exhausted');
        }
    },

    getInputs(delta) {
        if (this.spinStacks < this.spinMaxStacks) {
            this.spinCooldownTimer -= delta;
            if (this.spinCooldownTimer <= 0) {
                this.spinStacks++;
                if (this.spinStacks < this.spinMaxStacks) {
                    this.spinCooldownTimer = this.readonlyCooldown;
                } else {
                    this.spinCooldownTimer = 0;
                }
            }
        } else {
            this.spinCooldownTimer = 0;
        }

        const skillSpinBadge = document.getElementById('skill-spin-stack-badge');
        const skillSpinCdOverlay = document.getElementById('skill-spin-cd-overlay');
        const skillSpinBox = document.getElementById('skill-spin-box');

        if (skillSpinBadge && skillSpinCdOverlay) {
            skillSpinBadge.textContent = this.spinStacks;
            skillSpinBadge.style.background = this.spinStacks > 0 ? '#ffcc00' : '#888';

            if (this.spinCooldownTimer > 0) {
                skillSpinCdOverlay.style.display = 'flex';
                skillSpinCdOverlay.textContent = `${this.spinCooldownTimer.toFixed(1)}s`;
            } else {
                skillSpinCdOverlay.style.display = 'none';
            }

            if (skillSpinBox) {
                skillSpinBox.style.filter = this.spinStacks > 0 ? 'none' : 'grayscale(80%)';
            }
        }

        if (this.diveCooldownTimer > 0) {
            this.diveCooldownTimer -= delta;
            if (this.diveCooldownTimer < 0) this.diveCooldownTimer = 0;
        }

        const skillDiveCdOverlay = document.getElementById('skill-dive-cd-overlay');
        const skillDiveBox = document.getElementById('skill-dive-box');

        if (skillDiveCdOverlay && skillDiveBox) {
            if (this.diveCooldownTimer > 0) {
                skillDiveCdOverlay.style.display = 'flex';
                skillDiveCdOverlay.textContent = `${this.diveCooldownTimer.toFixed(1)}s`;
                skillDiveBox.style.filter = 'grayscale(80%)';
            } else {
                skillDiveCdOverlay.style.display = 'none';
                skillDiveBox.style.filter = 'none';
            }
        }

        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3];

        if (gp && !KeyConfig.isKeyConfigOpen) {
            const lookAxes = KeyConfig.bindings.padLookStick === 'right' ? [gp.axes[2], gp.axes[3]] : [gp.axes[0], gp.axes[1]];
            const isZoomHolding = KeyConfig.isPadButtonPressed(gp, KeyConfig.bindings.padZoom);
            const stickRX = this.applyDeadzone(lookAxes[0]);
            const stickRY = this.applyDeadzone(lookAxes[1]);

            if (isZoomHolding) {
                if (stickRY !== 0) {
                    this.cameraDistance += stickRY * 12.0 * delta;
                    this.cameraDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.cameraDistance));
                }
            } else {
                if (stickRX !== 0) {
                    this.targetYaw -= stickRX * 2.8 * delta;
                    this.angularSpeed += Math.abs(stickRX) * 2.5;
                }
                if (stickRY !== 0) {
                    const pitchFactor = this.invertY ? -1 : 1;
                    this.targetPitch -= stickRY * 2.5 * delta * pitchFactor;
                    this.targetPitch = Math.max(-0.2, Math.min(Math.PI / 2.5, this.targetPitch));
                    this.angularSpeed += Math.abs(stickRY) * 2.0;
                }
            }
        }

        if (this.antiSickness) {
            const smoothFactor = Math.min(1.0, 14.0 * delta);
            this.currentYaw += (this.targetYaw - this.currentYaw) * smoothFactor;
            this.currentPitch += (this.targetPitch - this.currentPitch) * smoothFactor;
        } else {
            this.currentYaw = this.targetYaw;
            this.currentPitch = this.targetPitch;
        }

        let isJumpKeyCurrentlyHeld = KeyConfig.isKeyOrCombinationPressed(this.activeKeys, this.activeMouseButtons, KeyConfig.bindings.jump);
        let isPadJumpCurrentlyHeld = false;
        if (gp) {
            if (KeyConfig.isPadButtonPressed(gp, KeyConfig.bindings.padJump)) isPadJumpCurrentlyHeld = true;
        }
        const isJumpAnyHeld = isJumpKeyCurrentlyHeld || isPadJumpCurrentlyHeld;

        if (KeyConfig.isKeyConfigOpen) {
            this.prevJumpHeld = isJumpAnyHeld;
            this.cancelPunchCharge();
            return {
                inputX: 0, inputZ: 0, jump: false, isDashing: false,
                attackTriggered: false, attackType: 'punch', chargeLevel: 0,
                isHoldingAttack: false, currentHoldingCharge: 0, diveTriggered: false
            };
        }

        if (this.isCountdownActive) {
            this.prevJumpHeld = isJumpAnyHeld;
            this.cancelPunchCharge();
            return {
                inputX: 0, inputZ: 0, jump: false, isDashing: false,
                attackTriggered: false, attackType: 'punch', chargeLevel: 0,
                isHoldingAttack: false, currentHoldingCharge: 0, diveTriggered: false
            };
        }

        let inputX = 0;
        let inputZ = 0;

        const isTyping = document.activeElement && document.activeElement.tagName === 'INPUT';
        if (!isTyping) {
            if (KeyConfig.isKeyOrCombinationPressed(this.activeKeys, this.activeMouseButtons, KeyConfig.bindings.forward)) inputZ += 1;
            if (KeyConfig.isKeyOrCombinationPressed(this.activeKeys, this.activeMouseButtons, KeyConfig.bindings.backward)) inputZ -= 1;
            if (KeyConfig.isKeyOrCombinationPressed(this.activeKeys, this.activeMouseButtons, KeyConfig.bindings.left)) inputX -= 1;
            if (KeyConfig.isKeyOrCombinationPressed(this.activeKeys, this.activeMouseButtons, KeyConfig.bindings.right)) inputX += 1;
        }

        let isDashRequested = KeyConfig.isKeyOrCombinationPressed(this.activeKeys, this.activeMouseButtons, KeyConfig.bindings.dash);
        let isPunchKeyPressed = KeyConfig.isKeyOrCombinationPressed(this.activeKeys, this.activeMouseButtons, KeyConfig.bindings.punch);
        let isSpinKeyPressed = KeyConfig.isKeyOrCombinationPressed(this.activeKeys, this.activeMouseButtons, KeyConfig.bindings.spinKey);
        let isDiveKeyPressed = KeyConfig.isKeyOrCombinationPressed(this.activeKeys, this.activeMouseButtons, KeyConfig.bindings.diveKey);

        let isPadPunchPressed = false;
        let isPadSpinPressed = false;
        let isPadDivePressed = false;

        if (gp) {
            const moveAxes = KeyConfig.bindings.padMoveStick === 'left' ? [gp.axes[0], gp.axes[1]] : [gp.axes[2], gp.axes[3]];
            const stickLX = this.applyDeadzone(moveAxes[0]);
            const stickLY = this.applyDeadzone(moveAxes[1]);
            if (stickLX !== 0) inputX = stickLX;
            if (stickLY !== 0) inputZ = -stickLY;

            if (KeyConfig.isPadButtonPressed(gp, KeyConfig.bindings.padDash)) isDashRequested = true;
            if (KeyConfig.isPadButtonPressed(gp, KeyConfig.bindings.padPunch)) isPadPunchPressed = true;
            if (KeyConfig.isPadButtonPressed(gp, KeyConfig.bindings.padSpin)) isPadSpinPressed = true;
            if (KeyConfig.isPadButtonPressed(gp, KeyConfig.bindings.padDive)) isPadDivePressed = true;
        }

        const jumpJustTriggered = isJumpAnyHeld && !this.prevJumpHeld;
        this.prevJumpHeld = isJumpAnyHeld;

        const hasMovement = Math.hypot(inputX, inputZ) > 0.05;
        let isDashing = false;

        if (this.isExhausted && this.dashStamina >= 20.0) {
            this.isExhausted = false;
        }

        if (isDashRequested && hasMovement && !this.isExhausted && this.dashStamina > 0) {
            isDashing = true;
            this.dashStamina = Math.max(0, this.dashStamina - 10.0 * delta);
            if (this.dashStamina === 0) this.isExhausted = true;
        } else {
            this.dashStamina = Math.min(100.0, this.dashStamina + 5.0 * delta);
        }

        const dashBarFill = document.getElementById('dash-bar-fill');
        const dashText = document.getElementById('dash-text');
        if (dashBarFill && dashText) {
            dashBarFill.style.width = `${this.dashStamina}%`;
            dashText.textContent = `${Math.round(this.dashStamina)}%`;
            if (this.isExhausted) dashBarFill.classList.add('exhausted');
            else dashBarFill.classList.remove('exhausted');
        }

        if (this.isEliminated) {
            this.cancelPunchCharge();
            return {
                inputX, inputZ, jump: jumpJustTriggered, isDashing,
                attackTriggered: false, attackType: 'punch', chargeLevel: 0,
                isHoldingAttack: false, currentHoldingCharge: 0, diveTriggered: false
            };
        }

        let diveTriggered = false;
        if ((isDiveKeyPressed || isPadDivePressed) && this.diveCooldownTimer <= 0) {
            diveTriggered = true;
        }

        let attackTriggered = false;
        let triggeredAttackType = 'punch';
        let triggeredChargeRatio = 0;

        const isSpinStartReq = isSpinKeyPressed || isPadSpinPressed;
        const isPunchStartReq = isPunchKeyPressed || isPadPunchPressed;

        if (!this.isHoldingAttack) {
            if (isSpinStartReq && this.spinStacks > 0) {
                this.isHoldingAttack = true;
                this.attackType = 'spin';
                this.chargeTime = 0;
            } else if (isPunchStartReq) {
                this.isHoldingAttack = true;
                this.attackType = 'punch';
                this.chargeTime = 0;
            }
        }

        let isCurrentAttackKeyHeld = false;
        if (this.isHoldingAttack) {
            if (this.attackType === 'spin') {
                isCurrentAttackKeyHeld = isSpinKeyPressed || isPadSpinPressed || isPadPunchPressed;
            } else {
                isCurrentAttackKeyHeld = isPunchKeyPressed || isPadPunchPressed;
            }

            if (isCurrentAttackKeyHeld) {
                this.chargeTime += delta;
                this.chargeLevel = Math.min(1.0, this.chargeTime / 1.0);

                if (this.chargeTime >= 3.0) {
                    attackTriggered = true;
                    triggeredAttackType = this.attackType;
                    triggeredChargeRatio = 1.0;
                    this.cancelPunchCharge();
                }
            } else {
                attackTriggered = true;
                triggeredAttackType = this.attackType;
                triggeredChargeRatio = this.chargeLevel;
                this.cancelPunchCharge();
            }
        }

        return {
            inputX,
            inputZ,
            jump: jumpJustTriggered,
            isDashing,
            attackTriggered,
            attackType: triggeredAttackType,
            chargeLevel: triggeredChargeRatio,
            isHoldingAttack: this.isHoldingAttack,
            holdingAttackType: this.attackType,
            currentHoldingCharge: this.chargeLevel,
            diveTriggered
        };
    },

    updateCamera(camera, realPlayerPos, currentSpeed = 0, maxSpeed = 11.0, delta = 0.016) {
        if (!camera) return;

        const targetFOV = this.antiSickness ? 50 : 60;
        if (camera.fov !== targetFOV) {
            camera.fov = targetFOV;
            camera.updateProjectionMatrix();
        }

        const safeY = (realPlayerPos && typeof realPlayerPos.y === 'number') ? realPlayerPos.y : 0;
        const safeX = (realPlayerPos && typeof realPlayerPos.x === 'number') ? realPlayerPos.x : 0;
        const safeZ = (realPlayerPos && typeof realPlayerPos.z === 'number') ? realPlayerPos.z : 0;

        const targetEyeY = safeY + 1.0;
        if (this.antiSickness) {
            this.smoothedTargetY += (targetEyeY - this.smoothedTargetY) * Math.min(1.0, 3.5 * delta);
        } else {
            this.smoothedTargetY = targetEyeY;
        }

        const stableTarget = new THREE.Vector3(safeX, this.smoothedTargetY, safeZ);

        if (this.antiSickness) {
            const vignetteOverlay = document.getElementById('vignette-overlay');
            const movementFactor = currentSpeed / maxSpeed;
            const turnFactor = Math.min(1.0, this.angularSpeed);
            const targetVignette = Math.min(0.94, (movementFactor * 0.25) + (turnFactor * 0.85));
            if (vignetteOverlay) vignetteOverlay.style.opacity = targetVignette;
            this.angularSpeed *= Math.max(0, 1.0 - 6.0 * delta);
        }

        const offsetX = this.cameraDistance * Math.sin(this.currentYaw) * Math.cos(this.currentPitch);
        const offsetZ = this.cameraDistance * Math.cos(this.currentYaw) * Math.cos(this.currentPitch);
        const offsetY = this.cameraDistance * Math.sin(this.currentPitch);

        camera.position.set(stableTarget.x - offsetX, stableTarget.y + offsetY, stableTarget.z - offsetZ);
        camera.lookAt(stableTarget);
    }
};