// =======================================================
// モジュール3: ゲームループ・新スキル・完全描画保証
// =======================================================

// --- 1. プレイヤーキャラクターの管理 ---
let myName = 'Player';
let myDamage = 0;
let myInvincibleTimer = 0;
let myStock = null;

const myCharacter = createCharacterMesh(0x3366ff, myName, myDamage, myStock);
const playerGroup = myCharacter.mesh;
scene.add(playerGroup);

const otherPlayers = {};

Controls.init(
    (newName) => {
        socket.emit('changeName', newName);
    },
    () => {
        if (currentRoomMode === 'stock_battle') {
            socket.emit('stopStockBattle');
        } else {
            socket.emit('startStockBattle');
        }
    },
    () => {
        handleReturnToFreeMode();
    }
);

let currentHostId = null;
let currentRoomMode = 'free';
let currentBattleStartTime = 0;

// --- 2. オンライン通信（Socket.io） ---
const socket = (typeof io !== 'undefined') ? io() : {
    on: () => { },
    emit: () => { },
    connected: false
};

const serverStatus = document.getElementById('server-status');
let myId = null;

socket.on('connect', () => {
    myId = socket.id;
    if (serverStatus) {
        serverStatus.textContent = 'オンライン接続中';
        serverStatus.classList.add('connected');
    }
});

socket.on('disconnect', () => {
    if (serverStatus) {
        serverStatus.textContent = 'サーバー切断';
        serverStatus.classList.remove('connected');
    }
});

socket.on('init', (data) => {
    myId = data.myId;
    currentHostId = data.hostId;
    currentRoomMode = data.currentMode;
    currentBattleStartTime = data.battleStartTime || 0;

    const myData = data.players[myId];
    if (myData) {
        playerGroup.position.set(myData.x, myData.y, myData.z);
        // 【二重防壁】スポーン時のブロックめり込みを即座に安全脱出
        unstickFromObstacles(playerGroup.position);

        if (myCharacter.bodyMesh && myCharacter.bodyMesh.material) {
            myCharacter.bodyMesh.material.color.setHex(myData.color);
        }
        myName = myData.name;
        myDamage = myData.damage || 0;
        myStock = (currentRoomMode === 'stock_battle') ? myData.stock : null;

        updateNameSpriteName(myCharacter.nameObj, myName);
        updateNameSpriteDamage(myCharacter.nameObj, myDamage);
        updateNameSpriteStock(myCharacter.nameObj, myStock);

        const nameInput = document.getElementById('player-name-input');
        if (nameInput) nameInput.value = myName;

        if (myData.isEliminated) {
            Controls.isEliminated = true;
            setCharacterGhostMode(myCharacter, true);
        }
    }

    for (let id in data.players) {
        if (id !== myId) addOtherPlayer(data.players[id]);
    }
    updateHostButtonUI();
});

socket.on('roomStateUpdate', (data) => {
    currentHostId = data.hostId;
    currentRoomMode = data.currentMode;
    updateHostButtonUI(data.playerCount);
});

function updateHostButtonUI(playerCount = null) {
    const hostBtn = document.getElementById('host-battle-btn');
    if (!hostBtn) return;

    const isHost = (myId && myId === currentHostId);
    if (!isHost) {
        hostBtn.style.display = 'none';
        return;
    }

    hostBtn.style.display = 'block';

    if (currentRoomMode === 'stock_battle') {
        hostBtn.textContent = 'ストック制バトルを終了';
        hostBtn.className = 'stop-mode';
        hostBtn.disabled = false;
    } else {
        hostBtn.textContent = 'ストック制バトルを開始';
        hostBtn.className = 'start-mode';

        const count = (playerCount !== null) ? playerCount : (Object.keys(otherPlayers).length + 1);
        hostBtn.disabled = (count < 2);
    }
}

socket.on('newPlayer', (playerData) => {
    if (playerData.id !== myId && !otherPlayers[playerData.id]) {
        addOtherPlayer(playerData);
    }
    updateHostButtonUI();
});

socket.on('playerRenamed', (data) => {
    if (data.id === myId) {
        myName = data.name;
        updateNameSpriteName(myCharacter.nameObj, myName);
    } else if (otherPlayers[data.id]) {
        updateNameSpriteName(otherPlayers[data.id].nameObj, data.name);
    }
});

socket.on('playerMoved', (data) => {
    const p = otherPlayers[data.id];
    if (p) {
        p.targetX = data.x;
        p.targetY = data.y;
        p.targetZ = data.z;
        p.targetRotY = data.rotationY;
        p.swingAngle = data.swingAngle;
        p.isOnGround = data.isOnGround;
        p.punchRatio = data.punchRatio || 0;
        p.chargeLevel = data.chargeLevel || 0;
        p.spinRatio = data.spinRatio || 0;
        p.isSpinAttack = data.isSpinAttack || false;
        p.isHoldingSpin = data.isHoldingSpin || false;
        p.holdingCharge = data.holdingCharge || 0;
        p.isDiving = data.isDiving || false;
        p.diveRatio = data.diveRatio || 0;
        p.isInvincible = data.isInvincible || false;
        p.isKnockedOut = false;
    }
});

// =======================================================
// 【ストック制バトル通信イベント】
// =======================================================

socket.on('battleStarted', (data) => {
    currentRoomMode = 'stock_battle';
    currentBattleStartTime = data.battleStartTime || Date.now();
    Controls.isEliminated = false;
    setCharacterGhostMode(myCharacter, false);

    // 古いリザルト画面の強制破棄
    const resultModal = document.getElementById('battle-result-modal');
    if (resultModal) resultModal.style.display = 'none';

    Controls.resetAllSkillsAndStamina();
    myDamage = 0;
    myStock = 3;
    myInvincibleTimer = 0;

    updateNameSpriteDamage(myCharacter.nameObj, 0);
    updateNameSpriteStock(myCharacter.nameObj, 3);

    const myData = data.players[myId];
    if (myData) {
        playerGroup.position.set(myData.x, 0, myData.z);
        // 【二重防壁】開始スポーン時のブロックめり込みを即時回避
        unstickFromObstacles(playerGroup.position);

        velocityX = 0;
        velocityZ = 0;
        yVelocity = 0;
        isOnGround = true;
    }

    for (let id in data.players) {
        if (id !== myId && otherPlayers[id]) {
            const op = otherPlayers[id];
            const pData = data.players[id];
            op.stock = 3;
            op.damage = 0;
            op.isEliminated = false;
            op.mesh.visible = true;
            op.targetX = pData.x;
            op.targetY = 0;
            op.targetZ = pData.z;
            op.mesh.position.set(pData.x, 0, pData.z);
            updateNameSpriteDamage(op.nameObj, 0);
            updateNameSpriteStock(op.nameObj, 3);
        }
    }

    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) settingsModal.style.display = 'none';

    updateHostButtonUI();
    startCountdownSequence();
});

// 【改良】大迫力カウントダウン ＆ 上部アナウンス演出
function startCountdownSequence() {
    if (document.activeElement) document.activeElement.blur();
    Controls.isCountdownActive = true;

    // 画面上部アナウンスバナー表示
    const announceBanner = document.getElementById('battle-announce-banner');
    if (announceBanner) announceBanner.style.display = 'block';

    const overlay = document.getElementById('battle-countdown-overlay');
    if (!overlay) return;

    const playCountNumber = (txt, color) => {
        overlay.classList.remove('countdown-animate');
        void overlay.offsetWidth; // リフロー発生でアニメーションを毎回最初から再生
        overlay.textContent = txt;
        overlay.style.color = color;
        overlay.style.display = 'block';
        overlay.classList.add('countdown-animate');
    };

    playCountNumber('3', '#ff3344');

    setTimeout(() => {
        playCountNumber('2', '#ff8800');
    }, 1000);

    setTimeout(() => {
        playCountNumber('1', '#ffcc00');
    }, 2000);

    setTimeout(() => {
        // GO! と同時に上部バナー消去＆操作解禁！
        if (announceBanner) announceBanner.style.display = 'none';
        playCountNumber('GO!', '#00ff88');
        Controls.isCountdownActive = false;
    }, 3000);

    setTimeout(() => {
        overlay.style.display = 'none';
        overlay.classList.remove('countdown-animate');
    }, 4000);
}

socket.on('stockUpdated', (data) => {
    if (data.id === myId) {
        myStock = data.stock;
        updateNameSpriteStock(myCharacter.nameObj, myStock);
    } else if (otherPlayers[data.id]) {
        otherPlayers[data.id].stock = data.stock;
        updateNameSpriteStock(otherPlayers[data.id].nameObj, data.stock);
    }
});

socket.on('playerEliminated', (data) => {
    if (data.id === myId) {
        Controls.isEliminated = true;
        setCharacterGhostMode(myCharacter, true);
    } else if (otherPlayers[data.id]) {
        const op = otherPlayers[data.id];
        op.isEliminated = true;
        op.mesh.visible = false;
    }
});

// バトル終了（リザルト画面表示）
socket.on('battleFinished', (data) => {
    currentRoomMode = 'free';
    currentBattleStartTime = 0;
    updateHostButtonUI();

    resetStageToInitial();

    const resultModal = document.getElementById('battle-result-modal');
    const headerTitle = document.getElementById('result-modal-header');
    const winnerTitle = document.getElementById('result-winner-title');
    const listContainer = document.getElementById('result-list-container');

    if (!resultModal || !listContainer) return;

    listContainer.innerHTML = '';

    if (data.isForceEnd) {
        headerTitle.textContent = '⏹️ BATTLE ENDED (強制終了)';
        winnerTitle.textContent = (data.reason === 'low_players') ? '人数が1人以下になったため終了しました' : 'ホストによりバトルが終了されました';

        data.results.forEach(res => {
            const row = document.createElement('div');
            row.className = 'result-row';
            // 【仕様変更】「残ストック：」ラベルを削除し、ハートのみを表示！
            row.innerHTML = `<span>${res.name}</span><span class="result-heart-txt">${res.heartDisplay}</span>`;
            listContainer.appendChild(row);
        });
    } else {
        headerTitle.textContent = '🏆 BATTLE RESULT';
        const topWinner = data.results.find(r => r.rank === 1);
        winnerTitle.textContent = topWinner ? `Winner: ${topWinner.name}` : '決着！';

        data.results.forEach(res => {
            const row = document.createElement('div');
            row.className = `result-row ${res.rank === 1 ? 'rank-1' : ''}`;
            const rankLabel = res.rank === 1 ? '👑 1位' : `${res.rank}位`;
            // 【仕様変更】ハートのみ表示
            const stockLabel = (res.rank === 1 && res.stock > 0) ? `<span class="result-heart-txt">${res.heartDisplay}</span>` : '脱落';
            row.innerHTML = `<span>${rankLabel}: ${res.name}</span><span>${stockLabel}</span>`;
            listContainer.appendChild(row);
        });
    }

    resultModal.style.display = 'block';
});

function handleReturnToFreeMode() {
    myStock = null;
    Controls.isEliminated = false;
    setCharacterGhostMode(myCharacter, false);
    Controls.resetAllSkillsAndStamina();
    myDamage = 0;
    updateNameSpriteDamage(myCharacter.nameObj, 0);
    updateNameSpriteStock(myCharacter.nameObj, null);

    resetStageToInitial();
    socket.emit('returnToFreeMode');
}

socket.on('playerReturnedToFree', (data) => {
    if (otherPlayers[data.id]) {
        const op = otherPlayers[data.id];
        op.isEliminated = false;
        op.mesh.visible = true;
        updateNameSpriteStock(op.nameObj, null);
        updateNameSpriteDamage(op.nameObj, 0);
    }
});

socket.on('playerKnocked', (data) => {
    if (data.targetId === myId) {
        if (myInvincibleTimer > 0 || Controls.isEliminated) return;

        myDamage = data.newDamage;
        updateNameSpriteDamage(myCharacter.nameObj, myDamage);
        Controls.cancelPunchCharge();

        if (isDiving) isDiving = false;

        isKnockedBack = true;
        velocityX = data.dirX * data.force;
        velocityZ = data.dirZ * data.force;
        yVelocity = 8.5 + (myDamage / 80.0) * 4.0;
        isOnGround = false;
    } else if (otherPlayers[data.targetId]) {
        const op = otherPlayers[data.targetId];
        if (op.invincibleTimer > 0 || op.isEliminated) return;

        op.damage = data.newDamage;
        updateNameSpriteDamage(op.nameObj, op.damage);

        op.kbVX = data.dirX * data.force;
        op.kbVZ = data.dirZ * data.force;
        op.kbVY = 8.5 + (op.damage / 80.0) * 4.0;
        op.isKnockedOut = true;
        op.isOnGround = false;
        op.isAttacker = (data.attackerId === myId);
        op.hasReportedSettlement = false;
        op.hasReportedFall = false;
    }
});

socket.on('shockwaveSpawned', (data) => {
    createShockwaveEffect(data.x, data.y, data.z);
});

socket.on('playerForceRespawned', (data) => {
    if (data.id === myId) {
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
    } else if (otherPlayers[data.id]) {
        const op = otherPlayers[data.id];
        op.targetX = data.x;
        op.targetY = 0;
        op.targetZ = data.z;
        op.mesh.position.set(data.x, 0, data.z);
        op.damage = 0;
        updateNameSpriteDamage(op.nameObj, 0);
        op.kbVX = 0;
        op.kbVY = 0;
        op.kbVZ = 0;
        op.isKnockedOut = false;
        op.isOnGround = true;

        if (!data.isEliminated && !op.isEliminated) {
            op.invincibleTimer = 2.0;
        } else {
            op.invincibleTimer = 0;
            op.mesh.visible = false;
        }
    }
});

socket.on('playerDamageReset', (data) => {
    if (data.id === myId) {
        myDamage = 0;
        if (!Controls.isEliminated) myInvincibleTimer = 2.0;
        updateNameSpriteDamage(myCharacter.nameObj, 0);
    } else if (otherPlayers[data.id]) {
        otherPlayers[data.id].damage = 0;
        if (!otherPlayers[data.id].isEliminated) otherPlayers[data.id].invincibleTimer = 2.0;
        updateNameSpriteDamage(otherPlayers[data.id].nameObj, 0);
    }
});

socket.on('syncSelf', (serverData) => {
    playerGroup.position.set(serverData.x, serverData.y || 0, serverData.z);
    unstickFromObstacles(playerGroup.position);

    myDamage = serverData.damage || 0;
    updateNameSpriteDamage(myCharacter.nameObj, myDamage);
    velocityX = 0;
    velocityZ = 0;
    yVelocity = 0;
    isOnGround = true;
    isKnockedBack = false;
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && socket.connected) socket.emit('requestSync');
});
window.addEventListener('focus', () => {
    if (socket.connected) socket.emit('requestSync');
});

socket.on('playerDisconnected', (id) => {
    if (otherPlayers[id]) {
        scene.remove(otherPlayers[id].mesh);
        delete otherPlayers[id];
    }
    updateHostButtonUI();
});

function addOtherPlayer(data) {
    const isBattle = (currentRoomMode === 'stock_battle');
    const charStock = isBattle ? (data.stock !== undefined ? data.stock : 3) : null;
    const char = createCharacterMesh(data.color || 0xff3366, data.name || 'Player', data.damage || 0, charStock);
    char.mesh.position.set(data.x, data.y, data.z);
    char.mesh.rotation.y = data.rotationY || 0;
    scene.add(char.mesh);

    const isElim = !!data.isEliminated;
    if (isElim) {
        char.mesh.visible = false;
    }

    otherPlayers[data.id] = {
        mesh: char.mesh,
        charObj: char,
        nameObj: char.nameObj,
        damage: data.damage || 0,
        stock: data.stock !== undefined ? data.stock : 3,
        isEliminated: isElim,
        targetX: data.x,
        targetY: data.y,
        targetZ: data.z,
        targetRotY: data.rotationY || 0,
        swingAngle: 0,
        isOnGround: true,
        punchRatio: 0,
        chargeLevel: 0,
        spinRatio: 0,
        isSpinAttack: false,
        isHoldingSpin: false,
        holdingCharge: 0,
        isDiving: false,
        diveRatio: 0,
        kbVX: 0,
        kbVY: 0,
        kbVZ: 0,
        isKnockedOut: false,
        isAttacker: false,
        hasReportedSettlement: false,
        hasReportedFall: false,
        invincibleTimer: 0
    };
}

// --- 3. アクション変数 ---
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
let diveElapsed = 0;
const DIVE_ARC_TIME = 0.35;
let diveOriginY = 0;

// --- 4. メインゲームループ ---
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

function animate() {
    requestAnimationFrame(animate);

    try {
        const time = performance.now();
        const delta = Math.min((time - prevTime) / 1000, 0.1);
        prevTime = time;

        if (currentRoomMode === 'stock_battle' && currentBattleStartTime > 0) {
            const elapsedSeconds = (Date.now() - currentBattleStartTime) / 1000.0;
            updateStageShrinkAndPhysics(elapsedSeconds, delta);
        }

        const input = Controls.getInputs(delta);

        if (myInvincibleTimer > 0 && !Controls.isEliminated) {
            myInvincibleTimer -= delta;
            if (myInvincibleTimer <= 0) {
                myInvincibleTimer = 0;
                playerGroup.visible = true;
            } else {
                playerGroup.visible = (Math.floor(time / 80) % 2 === 0);
            }
        } else {
            playerGroup.visible = true;
        }

        if (input.diveTriggered && !isDiving && !isKnockedBack && Controls.diveCooldownTimer <= 0) {
            isDiving = true;
            diveElapsed = 0;
            diveOriginY = playerGroup.position.y;
            Controls.consumeDive();
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
            diveElapsed += delta;
            currentDiveRatio = Math.min(1.0, diveElapsed / DIVE_ARC_TIME);

            const diveMoveSpeed = 16.0 / DIVE_ARC_TIME;
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

            if (diveElapsed <= DIVE_ARC_TIME) {
                const arcY = Math.sin((diveElapsed / DIVE_ARC_TIME) * Math.PI) * 16.0;
                playerGroup.position.y = diveOriginY + arcY;
            } else {
                yVelocity = -45.0;
                playerGroup.position.y += yVelocity * delta;
            }

            const isOverStage = Math.abs(playerGroup.position.x) <= halfStage && Math.abs(playerGroup.position.z) <= halfStage;
            let targetGroundY = -9999;
            if (isOverStage) targetGroundY = 0;

            for (let obs of obstacles) {
                const collideX = playerGroup.position.x + PLAYER_RADIUS > obs.minX && playerGroup.position.x - PLAYER_RADIUS < obs.maxX;
                const collideZ = playerGroup.position.z + PLAYER_RADIUS > obs.minZ && playerGroup.position.z - PLAYER_RADIUS < obs.maxZ;
                if (collideX && collideZ && playerGroup.position.y >= obs.maxY - 0.3) {
                    if (obs.maxY > targetGroundY) targetGroundY = obs.maxY;
                }
            }

            if (diveElapsed > (DIVE_ARC_TIME * 0.5) && playerGroup.position.y <= targetGroundY) {
                playerGroup.position.y = targetGroundY;
                isDiving = false;
                currentDiveRatio = 0;
                velocityX = 0;
                velocityZ = 0;
                yVelocity = 0;
                isOnGround = true;
                triggerShockwaveExplosion(playerGroup.position, otherPlayers, socket, Controls.isEliminated);
            } else if (diveElapsed > DIVE_ARC_TIME && !isOverStage && playerGroup.position.y < 0) {
                isDiving = false;
                currentDiveRatio = 0;
                isOnGround = false;
                yVelocity = -35.0;
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
            resolvePlayerCollisions(playerGroup.position, otherPlayers, velVec, Controls.isEliminated);
            velocityX = velVec.x;
            velocityZ = velVec.z;

            if (isOnGround && input.jump) {
                yVelocity = 11.5;
                isOnGround = false;
            }

            const isOverStage = Math.abs(playerGroup.position.x) <= halfStage && Math.abs(playerGroup.position.z) <= halfStage;

            yVelocity += gravity * delta;
            const nextY = playerGroup.position.y + yVelocity * delta;

            if (yVelocity < 0) {
                let groundY = (isOverStage && playerGroup.position.y >= -0.15) ? 0 : -9999;

                for (let obs of obstacles) {
                    const collideX = playerGroup.position.x + PLAYER_RADIUS > obs.minX && playerGroup.position.x - PLAYER_RADIUS < obs.maxX;
                    const collideZ = playerGroup.position.z + PLAYER_RADIUS > obs.minZ && playerGroup.position.z - PLAYER_RADIUS < obs.maxZ;
                    if (collideX && collideZ && playerGroup.position.y >= obs.maxY - 0.2 && nextY <= obs.maxY) {
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

        // 場外落下
        if (playerGroup.position.y < -25) {
            playerGroup.position.set(0, 0, 0);
            unstickFromObstacles(playerGroup.position);

            velocityX = 0;
            velocityZ = 0;
            yVelocity = 0;
            isOnGround = true;
            isDiving = false;
            isKnockedBack = false;
            Controls.smoothedTargetY = 1.0;

            myDamage = 0;
            updateNameSpriteDamage(myCharacter.nameObj, 0);
            socket.emit('playerRespawn');
        }

        const currentSpeed = Math.hypot(velocityX, velocityZ);

        if (isOnGround && currentSpeed > 0.5) {
            walkTime += delta * currentSpeed * 1.3;
            currentSwingAngle = Math.sin(walkTime) * 0.65;
        } else {
            currentSwingAngle *= 0.8;
        }

        // パンチ進行
        if (isPunching) {
            punchTimer -= delta;
            currentPunchRatio = Math.max(0, Math.min(1.0, 1.0 - (punchTimer / PUNCH_TOTAL_TIME)));

            if (currentPunchRatio >= 0.38 && !punchHitChecked) {
                checkPunchHit(playerGroup.position, playerGroup.rotation.y, currentChargeLevel, otherPlayers, socket, Controls.isEliminated);
                punchHitChecked = true;
            }

            if (punchTimer <= 0) {
                isPunching = false;
                currentPunchRatio = 0;
            }
        } else {
            currentPunchRatio = 0;
        }

        // 回転斬り進行
        if (isSpinAttack) {
            spinTimer -= delta;
            currentSpinRatio = Math.max(0, Math.min(1.0, 1.0 - (spinTimer / SPIN_TOTAL_TIME)));
            checkSpinSweepHit(playerGroup.position, playerGroup.rotation.y, spinChargeLevel, currentSpinRatio, otherPlayers, socket, hitTargetsThisSpin, Controls.isEliminated);

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

        // 他プレイヤー処理
        for (let id in otherPlayers) {
            const op = otherPlayers[id];

            if (op.isEliminated) {
                op.mesh.visible = false;
                continue;
            }

            if (op.invincibleTimer > 0) {
                op.invincibleTimer -= delta;
                if (op.invincibleTimer <= 0) {
                    op.invincibleTimer = 0;
                    op.mesh.visible = true;
                } else {
                    op.mesh.visible = (Math.floor(time / 80) % 2 === 0);
                }
            } else {
                op.mesh.visible = true;
            }

            if (op.isKnockedOut) {
                const opPos = { x: op.targetX, y: op.targetY, z: op.targetZ };
                const opMoved = moveWithCollision(opPos, op.kbVX, op.kbVZ, delta, true);
                op.targetX = opPos.x;
                op.targetZ = opPos.z;
                op.kbVX = opMoved.vx;
                op.kbVZ = opMoved.vz;

                if (op.isOnGround) {
                    op.kbVX += (0 - op.kbVX) * 14.0 * delta;
                    op.kbVZ += (0 - op.kbVZ) * 14.0 * delta;
                } else {
                    op.kbVX += (0 - op.kbVX) * 0.6 * delta;
                    op.kbVZ += (0 - op.kbVZ) * 0.6 * delta;
                }

                op.kbVY += gravity * delta;
                const opNextY = op.targetY + op.kbVY * delta;

                const opOverStage = Math.abs(op.targetX) <= halfStage && Math.abs(op.targetZ) <= halfStage;
                let opGroundY = (opOverStage && op.targetY >= -0.15) ? 0 : -9999;

                for (let obs of obstacles) {
                    const collideX = op.targetX + PLAYER_RADIUS > obs.minX && op.targetX - PLAYER_RADIUS < obs.maxX;
                    const collideZ = op.targetZ + PLAYER_RADIUS > obs.minZ && op.targetZ - PLAYER_RADIUS < obs.maxZ;
                    if (collideX && collideZ && op.targetY >= obs.maxY - 0.2 && opNextY <= obs.maxY) {
                        if (obs.maxY > opGroundY) opGroundY = obs.maxY;
                    }
                }

                if (opNextY <= opGroundY) {
                    op.targetY = opGroundY;
                    op.kbVY = 0;
                    op.isOnGround = true;

                    if (Math.hypot(op.kbVX, op.kbVZ) < 0.2) {
                        op.isKnockedOut = false;
                        if (op.isAttacker && !op.hasReportedSettlement) {
                            socket.emit('updateTargetPosition', {
                                targetId: id,
                                x: op.targetX,
                                y: op.targetY,
                                z: op.targetZ
                            });
                            op.hasReportedSettlement = true;
                        }
                    }
                } else {
                    op.targetY = opNextY;
                    op.isOnGround = false;
                }

                if (op.targetY < -25 && !op.hasReportedFall) {
                    op.hasReportedFall = true;
                    op.isKnockedOut = false;
                    op.kbVX = 0;
                    op.kbVY = 0;
                    op.kbVZ = 0;
                    socket.emit('targetFellOut', { targetId: id });
                }
            }

            op.mesh.position.x += (op.targetX - op.mesh.position.x) * 0.25;
            op.mesh.position.y += (op.targetY - op.mesh.position.y) * 0.25;
            op.mesh.position.z += (op.targetZ - op.mesh.position.z) * 0.25;
            op.mesh.rotation.y += (op.targetRotY - op.mesh.rotation.y) * 0.25;

            updateCharacterMotion(
                op.charObj,
                op.swingAngle,
                op.isOnGround,
                op.punchRatio || 0,
                op.chargeLevel || 0,
                op.isSpinAttack || false,
                op.spinRatio || 0,
                op.isHoldingSpin || false,
                op.holdingCharge || 0,
                op.isDiving || false,
                op.diveRatio || 0
            );
        }

        if (myId && time - lastSendTime > 33) {
            socket.emit('playerMove', {
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
            });
            lastSendTime = time;
        }

    } catch (loopErr) {
        console.error('Render Loop Error:', loopErr);
    }

    renderer.render(scene, camera);
}

animate();