// =======================================================
// モジュール3: ゲームループ・ローカル物理・アクション管理
// =======================================================

// --- 1. 自キャラクターの管理 ---
let myName = 'Player';
let myDamage = 0;
let myInvincibleTimer = 0;
let myStock = null;

const myCharacter = createCharacterMesh(0x3366ff, myName, myDamage, myStock);
const playerGroup = myCharacter.mesh;
scene.add(playerGroup);

// --- 2. 物理演算・アクション変数 ---
let velocityX = 0;
let velocityZ = 0;
let yVelocity = 0;
const gravity = -26.0;
let isOnGround = true;
let isKnockedBack = false;

let walkTime = 0;
let currentSwingAngle = 0;
let currentPunchRatio = 0;
let currentSpinRatio = 0;
let currentDiveRatio = 0;
let prevTime = performance.now();
let lastSendTime = 0;

let isPunching = false;
let punchTimer = 0;
const PUNCH_TOTAL_TIME = 0.44;
let punchHitChecked = false;
let currentChargeLevel = 0;

let isSpinAttack = false;
let spinTimer = 0;
const SPIN_TOTAL_TIME = 0.36;
let spinChargeLevel = 0;
const hitTargetsThisSpin = new Set();

let isDiving = false;
let divePhase = 'idle';
let diveTimer = 0;
const DIVE_RISE_DURATION = 0.16;
const DIVE_FALL_DURATION = 0.19;
let diveApexY = 16.0;

function startDragonDive() {
    isDiving = true;
    divePhase = 'rising';
    diveTimer = 0;
    diveApexY = Math.max(16.0, playerGroup.position.y + 16.0);
    isOnGround = false;
    Controls.consumeDive();
}

// --- 3. ネットワーク同期ハンドラ（自キャラ用コールバック） ---
const localPlayerHandler = {
    onInitLocalPlayer(myData, currentMode) {
        playerGroup.position.set(myData.x, myData.y, myData.z);
        unstickFromObstacles(playerGroup.position);

        if (myCharacter.bodyMesh && myCharacter.bodyMesh.material) {
            myCharacter.bodyMesh.material.color.setHex(myData.color);
        }
        myName = myData.name;
        myDamage = myData.damage || 0;
        myStock = (currentMode === 'stock_battle') ? myData.stock : null;

        updateNameSpriteName(myCharacter.nameObj, myName);
        updateNameSpriteDamage(myCharacter.nameObj, myDamage);
        updateNameSpriteStock(myCharacter.nameObj, myStock);

        const nameInput = document.getElementById('player-name-input');
        if (nameInput) nameInput.value = myName;

        Controls.isEliminated = !!myData.isEliminated;
        setCharacterGhostMode(myCharacter, Controls.isEliminated);
        myInvincibleTimer = 0;
        isKnockedBack = false;
        isDiving = false;
        divePhase = 'idle';
        velocityX = 0;
        velocityZ = 0;
        yVelocity = 0;
    },

    onRenameLocalPlayer(name) {
        myName = name;
        updateNameSpriteName(myCharacter.nameObj, myName);
    },

    onBattleStartedLocalPlayer(myData) {
        Controls.isEliminated = false;
        setCharacterGhostMode(myCharacter, false);
        Controls.resetAllSkillsAndStamina();
        myDamage = 0;
        myStock = 3;
        myInvincibleTimer = 0;
        isKnockedBack = false;

        updateNameSpriteDamage(myCharacter.nameObj, 0);
        updateNameSpriteStock(myCharacter.nameObj, 3);

        if (myData) {
            playerGroup.position.set(myData.x, 0, myData.z);
            unstickFromObstacles(playerGroup.position);
            velocityX = 0;
            velocityZ = 0;
            yVelocity = 0;
            isOnGround = true;
        }
    },

    onStockUpdatedLocalPlayer(stock) {
        myStock = stock;
        updateNameSpriteStock(myCharacter.nameObj, myStock);
    },

    onEliminatedLocalPlayer() {
        Controls.isEliminated = true;
        setCharacterGhostMode(myCharacter, true);
    },

    onBattleFinishedLocalPlayer() {
        myStock = null;
        Controls.isEliminated = false;
        setCharacterGhostMode(myCharacter, false);
        Controls.resetAllSkillsAndStamina();
        myDamage = 0;
        myInvincibleTimer = 0;
        isKnockedBack = false;
        updateNameSpriteDamage(myCharacter.nameObj, 0);
        updateNameSpriteStock(myCharacter.nameObj, null);
    },

    onKnockedLocalPlayer(data) {
        if (Controls.isEliminated) return;

        myDamage = data.newDamage;
        updateNameSpriteDamage(myCharacter.nameObj, myDamage);
        Controls.cancelPunchCharge();

        if (isDiving) isDiving = false;

        isKnockedBack = true;
        velocityX = data.dirX * data.force;
        velocityZ = data.dirZ * data.force;
        yVelocity = 8.5 + (myDamage / 80.0) * 4.0;
        isOnGround = false;
    },

    onForceRespawnedLocalPlayer(data) {
        playerGroup.position.set(data.x, 0, data.z);
        unstickFromObstacles(playerGroup.position);

        velocityX = 0;
        velocityZ = 0;
        yVelocity = 0;
        isOnGround = true;
        isKnockedBack = false;
        myDamage = 0;
        updateNameSpriteDamage(myCharacter.nameObj, 0);

        if (!data.isEliminated && !Controls.isEliminated) {
            myInvincibleTimer = 2.0;
        } else {
            myInvincibleTimer = 0;
        }
    },

    onDamageResetLocalPlayer() {
        myDamage = 0;
        if (!Controls.isEliminated) myInvincibleTimer = 2.0;
        updateNameSpriteDamage(myCharacter.nameObj, 0);
    },

    onSyncSelf(serverData) {
        playerGroup.position.set(serverData.x, serverData.y || 0, serverData.z);
        unstickFromObstacles(playerGroup.position);
        myDamage = serverData.damage || 0;
        updateNameSpriteDamage(myCharacter.nameObj, myDamage);
        velocityX = 0;
        velocityZ = 0;
        yVelocity = 0;
        isOnGround = true;
        isKnockedBack = false;
    }
};

Network.init(localPlayerHandler);

Controls.init(
    (newName) => { Network.socket.emit('changeName', newName); },
    () => {
        if (Network.currentRoomMode === 'stock_battle') {
            Network.socket.emit('stopStockBattle');
        } else {
            Network.socket.emit('startStockBattle');
        }
    },
    () => {
        const resultModal = document.getElementById('battle-result-modal');
        if (resultModal) resultModal.style.display = 'none';
    }
);

// --- 4. メインゲームループ ---
function animate() {
    requestAnimationFrame(animate);

    try {
        const time = performance.now();
        const delta = Math.min((time - prevTime) / 1000, 0.1);
        prevTime = time;

        if (myInvincibleTimer > 0) {
            myInvincibleTimer = Math.max(0, myInvincibleTimer - delta);
            if (myInvincibleTimer === 0) {
                myCharacter.mesh.visible = true;
            } else {
                myCharacter.mesh.visible = (Math.floor(time / 80) % 2 === 0);
            }
        } else {
            if (!Controls.isEliminated) {
                myCharacter.mesh.visible = true;
            }
        }

        if (Network.currentRoomMode === 'stock_battle' && Network.currentBattleStartTime > 0) {
            const currentSyncedNow = Date.now() + Network.serverTimeOffset;
            const elapsedSeconds = (currentSyncedNow - Network.currentBattleStartTime) / 1000.0;
            updateStageShrinkAndPhysics(elapsedSeconds, delta);
        }

        const input = Controls.getInputs(delta);

        const currentKnockSpeed = Math.hypot(velocityX, velocityZ);
        if (isKnockedBack && currentKnockSpeed < 6.0) {
            isKnockedBack = false;
        }

        if (input.diveTriggered && !isDiving && !isKnockedBack && Controls.diveCooldownTimer <= 0) {
            startDragonDive();
        }

        if (input.attackTriggered && !isPunching && !isSpinAttack && !isDiving) {
            if (input.attackType === 'spin') {
                Controls.consumeSpinStack();
                isSpinAttack = true;
                spinTimer = SPIN_TOTAL_TIME;
                spinChargeLevel = input.chargeLevel;
                hitTargetsThisSpin.clear();
            } else {
                isPunching = true;
                punchTimer = PUNCH_TOTAL_TIME;
                punchHitChecked = false;
                currentChargeLevel = input.chargeLevel;
            }
        }

        if (input.isHoldingAttack && !isPunching && !isSpinAttack && !isDiving) {
            const predictedReach = 2.4 + input.currentHoldingCharge * 5.6;

            if (input.holdingAttackType === 'spin') {
                spinGuide.visible = true;
                reachGuide.visible = false;
                spinGuide.scale.set(predictedReach, 1.0, predictedReach);
                spinGuide.position.set(playerGroup.position.x, playerGroup.position.y + 0.02, playerGroup.position.z);
            } else {
                reachGuide.visible = true;
                spinGuide.visible = false;
                reachGuide.scale.set(1.0, 1.0, predictedReach);
                reachGuide.position.set(playerGroup.position.x, playerGroup.position.y + 0.02, playerGroup.position.z);
                reachGuide.rotation.y = playerGroup.rotation.y;
            }
        } else {
            reachGuide.visible = false;
            spinGuide.visible = false;
        }

        const baseSpeed = 11.0;
        let currentMaxSpeed = input.isDashing ? baseSpeed * 1.3 : baseSpeed;

        if (isDiving) {
            diveTimer += delta;
            const totalDiveTime = DIVE_RISE_DURATION + DIVE_FALL_DURATION;
            currentDiveRatio = Math.min(1.0, diveTimer / totalDiveTime);

            const diveMoveSpeed = 16.0 / totalDiveTime;
            const diveInputMag = Math.hypot(input.inputX, input.inputZ);

            if (diveInputMag > 0.05) {
                const inputAngle = Math.atan2(-input.inputX, input.inputZ);
                const moveAngle = Controls.currentYaw + inputAngle;
                velocityX = Math.sin(moveAngle) * diveMoveSpeed;
                velocityZ = Math.cos(moveAngle) * diveMoveSpeed;
                playerGroup.rotation.y = moveAngle;
            } else {
                velocityX = 0;
                velocityZ = 0;
            }

            moveWithCollision(playerGroup.position, velocityX, velocityZ, delta, false);

            if (divePhase === 'rising') {
                playerGroup.position.y = THREE.MathUtils.lerp(playerGroup.position.y, diveApexY, Math.min(1.0, 18.0 * delta));

                if (diveTimer >= DIVE_RISE_DURATION) {
                    divePhase = 'diving';
                }
            } else {
                yVelocity = -55.0;
                const prevY = playerGroup.position.y;
                const nextY = prevY + yVelocity * delta;

                const isOverStage = !isStageCompletelyGone && (Math.abs(playerGroup.position.x) <= halfStage && Math.abs(playerGroup.position.z) <= halfStage);
                let highestGroundY = isOverStage ? 0 : -9999;

                for (let obs of obstacles) {
                    const collideX = (playerGroup.position.x + PLAYER_RADIUS > obs.minX) && (playerGroup.position.x - PLAYER_RADIUS < obs.maxX);
                    const collideZ = (playerGroup.position.z + PLAYER_RADIUS > obs.minZ) && (playerGroup.position.z - PLAYER_RADIUS < obs.maxZ);
                    if (collideX && collideZ) {
                        if (prevY >= (obs.maxY - 0.4) && nextY <= obs.maxY) {
                            if (obs.maxY > highestGroundY) {
                                highestGroundY = obs.maxY;
                            }
                        }
                    }
                }

                if (nextY <= highestGroundY) {
                    playerGroup.position.y = highestGroundY;
                    isDiving = false;
                    divePhase = 'idle';
                    currentDiveRatio = 0;
                    velocityX = 0;
                    velocityZ = 0;
                    yVelocity = 0;
                    isOnGround = true;
                    triggerShockwaveExplosion(playerGroup.position, Network.otherPlayers, Network.socket, Controls.isEliminated);
                } else if (!isOverStage && nextY < 0) {
                    playerGroup.position.y = nextY;
                    isDiving = false;
                    divePhase = 'idle';
                    currentDiveRatio = 0;
                    isOnGround = false;
                    yVelocity = -40.0;
                } else {
                    playerGroup.position.y = nextY;
                }
            }
        } else {
            const inputMagnitude = Math.hypot(input.inputX, input.inputZ);
            const hasInput = inputMagnitude > 0.05;

            let targetVX = 0;
            let targetVZ = 0;

            if (hasInput) {
                const inputAngle = Math.atan2(-input.inputX, input.inputZ);
                const moveAngle = Controls.currentYaw + inputAngle;

                const speedScale = Math.min(inputMagnitude, 1.0);
                targetVX = Math.sin(moveAngle) * currentMaxSpeed * speedScale;
                targetVZ = Math.cos(moveAngle) * currentMaxSpeed * speedScale;

                if (!isSpinAttack && (!isPunching || currentPunchRatio > 0.38)) {
                    playerGroup.rotation.y = moveAngle;
                }
            }

            if (isOnGround) {
                isKnockedBack = false;
                const groundAccel = 14.0;
                velocityX += (targetVX - velocityX) * groundAccel * delta;
                velocityZ += (targetVZ - velocityZ) * groundAccel * delta;
            } else {
                const airAccel = isKnockedBack ? 0.4 : 2.5;

                if (hasInput) {
                    velocityX += (targetVX - velocityX) * airAccel * delta;
                    velocityZ += (targetVZ - velocityZ) * airAccel * delta;
                } else {
                    velocityX += (0 - velocityX) * 0.6 * delta;
                    velocityZ += (0 - velocityZ) * 0.6 * delta;
                }
            }

            const moved = moveWithCollision(playerGroup.position, velocityX, velocityZ, delta, isKnockedBack);
            velocityX = moved.vx;
            velocityZ = moved.vz;

            const velVec = { x: velocityX, z: velocityZ };
            resolvePlayerCollisions(playerGroup.position, Network.otherPlayers, velVec, Controls.isEliminated);
            velocityX = velVec.x;
            velocityZ = velVec.z;

            if (isOnGround && input.jump) {
                yVelocity = 11.5;
                isOnGround = false;
            }

            const isOverStage = !isStageCompletelyGone && (Math.abs(playerGroup.position.x) <= halfStage && Math.abs(playerGroup.position.z) <= halfStage);
            yVelocity += gravity * delta;
            const nextY = playerGroup.position.y + yVelocity * delta;

            if (yVelocity < 0) {
                let groundY = (isOverStage && playerGroup.position.y >= -0.15) ? 0 : -9999;

                for (let obs of obstacles) {
                    const collideX = playerGroup.position.x + PLAYER_RADIUS > obs.minX && playerGroup.position.x - PLAYER_RADIUS < obs.maxX;
                    const collideZ = playerGroup.position.z + PLAYER_RADIUS > obs.minZ && playerGroup.position.z - PLAYER_RADIUS < obs.maxZ;
                    if (collideX && collideZ && playerGroup.position.y >= (obs.maxY - 0.25) && nextY <= obs.maxY) {
                        if (obs.maxY > groundY) groundY = obs.maxY;
                    }
                }

                if (nextY <= groundY) {
                    playerGroup.position.y = groundY;
                    yVelocity = 0;
                    isOnGround = true;
                    isKnockedBack = false;
                } else {
                    playerGroup.position.y = nextY;
                    isOnGround = false;
                }
            } else if (yVelocity > 0) {
                const hitObstacle = checkObstacleCollision(playerGroup.position.x, nextY, playerGroup.position.z);
                if (hitObstacle) {
                    yVelocity = 0;
                } else {
                    playerGroup.position.y = nextY;
                    isOnGround = false;
                }
            }
        }

        // 場外落下判定
        if (playerGroup.position.y < -25) {
            const fellX = playerGroup.position.x;
            const fellY = playerGroup.position.y;
            const fellZ = playerGroup.position.z;

            playerGroup.position.set(0, 0, 0);
            unstickFromObstacles(playerGroup.position);

            velocityX = 0;
            velocityZ = 0;
            yVelocity = 0;
            isOnGround = true;
            isDiving = false;
            divePhase = 'idle';
            isKnockedBack = false;
            Controls.smoothedTargetY = 1.0;

            myDamage = 0;
            updateNameSpriteDamage(myCharacter.nameObj, 0);

            Network.socket.emit('playerMove', {
                x: fellX,
                y: fellY,
                z: fellZ,
                rotationY: playerGroup.rotation.y,
                swingAngle: 0,
                isOnGround: false,
                punchRatio: 0,
                chargeLevel: 0,
                isSpinAttack: false,
                spinRatio: 0,
                isHoldingSpin: false,
                holdingCharge: 0,
                isDiving: false,
                diveRatio: 0,
                isInvincible: false
            });
            Network.socket.emit('playerRespawn');
        }

        const currentSpeed = Math.hypot(velocityX, velocityZ);

        if (isOnGround && currentSpeed > 0.5) {
            walkTime += delta * currentSpeed * 1.3;
            currentSwingAngle = Math.sin(walkTime) * 0.65;
        } else {
            currentSwingAngle *= 0.8;
        }

        if (isPunching) {
            punchTimer -= delta;
            currentPunchRatio = Math.max(0, Math.min(1.0, 1.0 - (punchTimer / PUNCH_TOTAL_TIME)));

            if (currentPunchRatio >= 0.38 && !punchHitChecked) {
                checkPunchHit(playerGroup.position, playerGroup.rotation.y, currentChargeLevel, Network.otherPlayers, Network.socket, Controls.isEliminated);
                punchHitChecked = true;
            }

            if (punchTimer <= 0) {
                isPunching = false;
                currentPunchRatio = 0;
            }
        } else {
            currentPunchRatio = 0;
        }

        if (isSpinAttack) {
            spinTimer -= delta;
            currentSpinRatio = Math.max(0, Math.min(1.0, 1.0 - (spinTimer / SPIN_TOTAL_TIME)));
            checkSpinSweepHit(playerGroup.position, playerGroup.rotation.y, spinChargeLevel, currentSpinRatio, Network.otherPlayers, Network.socket, hitTargetsThisSpin, Controls.isEliminated);

            if (spinTimer <= 0) {
                isSpinAttack = false;
                currentSpinRatio = 0;
            }
        } else {
            currentSpinRatio = 0;
        }

        const isHoldingSpin = input.isHoldingAttack && input.holdingAttackType === 'spin';
        const activeChargeForMotion = isSpinAttack ? spinChargeLevel : currentChargeLevel;

        updateCharacterMotion(
            myCharacter,
            currentSwingAngle,
            isOnGround,
            currentPunchRatio,
            activeChargeForMotion,
            isSpinAttack,
            currentSpinRatio,
            isHoldingSpin,
            input.currentHoldingCharge,
            isDiving,
            currentDiveRatio
        );

        updateShockwaves(delta);

        const targetPos = new THREE.Vector3(playerGroup.position.x, playerGroup.position.y + 1.0, playerGroup.position.z);
        Controls.updateCamera(camera, targetPos, currentSpeed, currentMaxSpeed, delta);

        const nowMs = Date.now();
        Network.updateOtherPlayersPhysics(delta, nowMs, time);

        if (Network.myId && time - lastSendTime > 33) {
            const moveData = {
                x: playerGroup.position.x,
                y: playerGroup.position.y,
                z: playerGroup.position.z,
                rotationY: playerGroup.rotation.y,
                swingAngle: currentSwingAngle,
                isOnGround: isOnGround,
                punchRatio: currentPunchRatio,
                chargeLevel: isSpinAttack ? spinChargeLevel : currentChargeLevel,
                isSpinAttack: isSpinAttack,
                spinRatio: currentSpinRatio,
                isHoldingSpin: isHoldingSpin,
                holdingCharge: input.currentHoldingCharge,
                isDiving: isDiving,
                diveRatio: currentDiveRatio,
                isInvincible: myInvincibleTimer > 0
            };

            if (Network.socket.volatile) {
                Network.socket.volatile.emit('playerMove', moveData);
            } else {
                Network.socket.emit('playerMove', moveData);
            }
            lastSendTime = time;
        }

    } catch (loopErr) {
        console.error('Render Loop Error:', loopErr);
    }

    renderer.render(scene, camera);
}

animate();