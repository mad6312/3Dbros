// =======================================================
// モジュール3: ゲームループ・新スキル・完全同期管理
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

let ignoreEffectsUntilTimestamp = 0;
let serverTimeOffset = 0;

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
        const resultModal = document.getElementById('battle-result-modal');
        if (resultModal) resultModal.style.display = 'none';
    }
);

let currentHostId = null;
let currentRoomMode = 'free';
let currentBattleStartTime = 0;

// --- 2. オンライン通信（Socket.io） ---
const socket = (typeof io !== 'undefined') ? io() : {
    on: () => { },
    emit: () => { },
    volatile: { emit: () => { } },
    connected: false
};

const serverStatus = document.getElementById('server-status');
let myId = null;

// キャラクターリソースの完全な破棄（SpriteMaterial含むメモリリーク防止）
function disposePlayerCharacter(op) {
    if (!op || !op.mesh) return;
    scene.remove(op.mesh);
    if (op.charObj && op.charObj.allMeshes) {
        op.charObj.allMeshes.forEach(m => {
            if (m.geometry) m.geometry.dispose();
            if (m.material) {
                if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
                else m.material.dispose();
            }
        });
    }
    // 【項目9改善】スプライト用マテリアル・テクスチャの明示的解放
    if (op.nameObj) {
        if (op.nameObj.spriteMat) op.nameObj.spriteMat.dispose();
        if (op.nameObj.texture) op.nameObj.texture.dispose();
    }
}

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
    serverTimeOffset = (data.serverNow || Date.now()) - Date.now();

    for (let id in otherPlayers) {
        disposePlayerCharacter(otherPlayers[id]);
        delete otherPlayers[id];
    }

    // 【項目2改善】モードを問わずステージを初期復元（縮小は毎フレーム経過時間から再計算される）
    resetStageToInitial();

    const myData = data.players[myId];
    if (myData) {
        playerGroup.position.set(myData.x, myData.y, myData.z);
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

        // 【項目2改善】再接続時の脱落フラグ同期、無敵・ノックバック・速度の確実な初期化
        Controls.isEliminated = !!myData.isEliminated;
        setCharacterGhostMode(myCharacter, Controls.isEliminated);
        myInvincibleTimer = 0;
        isKnockedBack = false;
        isDiving = false;
        divePhase = 'idle';
        velocityX = 0;
        velocityZ = 0;
        yVelocity = 0;
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
    if (playerData.id !== myId) {
        if (otherPlayers[playerData.id]) {
            disposePlayerCharacter(otherPlayers[playerData.id]);
            delete otherPlayers[playerData.id];
        }
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

        if (data.isOnGround) {
            p.isKnockedOut = false;
        }
        p.lastPacketTime = Date.now();
    }
});

// =======================================================
// 【ストック制バトル通信イベント】
// =======================================================

socket.on('battleStarted', (data) => {
    currentRoomMode = 'stock_battle';
    currentBattleStartTime = data.battleStartTime || Date.now();
    serverTimeOffset = (data.serverNow || Date.now()) - Date.now();

    resetStageToInitial();

    Controls.isEliminated = false;
    setCharacterGhostMode(myCharacter, false);

    const resultModal = document.getElementById('battle-result-modal');
    if (resultModal) resultModal.style.display = 'none';

    Controls.resetAllSkillsAndStamina();
    myDamage = 0;
    myStock = 3;
    myInvincibleTimer = 0;
    isKnockedBack = false;

    updateNameSpriteDamage(myCharacter.nameObj, 0);
    updateNameSpriteStock(myCharacter.nameObj, 3);

    const myData = data.players[myId];
    if (myData) {
        playerGroup.position.set(myData.x, 0, myData.z);
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
            op.hasReportedFall = false;
            updateNameSpriteDamage(op.nameObj, 0);
            updateNameSpriteStock(op.nameObj, 3);
            setCharacterGhostMode(op.charObj, false);
        }
    }

    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) settingsModal.style.display = 'none';

    updateHostButtonUI();
    startCountdownSequence();
});

function startCountdownSequence() {
    if (document.activeElement) document.activeElement.blur();
    Controls.isCountdownActive = true;

    const announceBanner = document.getElementById('battle-announce-banner');
    if (announceBanner) announceBanner.style.display = 'block';

    const overlay = document.getElementById('battle-countdown-overlay');
    if (!overlay) return;

    const playCountNumber = (txt, color) => {
        overlay.classList.remove('countdown-animate');
        void overlay.offsetWidth;
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

socket.on('battleFinished', (data) => {
    currentRoomMode = 'free';
    currentBattleStartTime = 0;
    updateHostButtonUI();

    resetStageToInitial();

    myStock = null;
    Controls.isEliminated = false;
    setCharacterGhostMode(myCharacter, false);
    Controls.resetAllSkillsAndStamina();
    myDamage = 0;
    myInvincibleTimer = 0;
    isKnockedBack = false;
    updateNameSpriteDamage(myCharacter.nameObj, 0);
    updateNameSpriteStock(myCharacter.nameObj, null);

    for (let id in otherPlayers) {
        const op = otherPlayers[id];
        op.isEliminated = false;
        op.mesh.visible = true;
        op.invincibleTimer = 0;
        op.hasReportedFall = false;
        updateNameSpriteStock(op.nameObj, null);
        updateNameSpriteDamage(op.nameObj, 0);
        setCharacterGhostMode(op.charObj, false);
    }

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

            const nameSpan = document.createElement('span');
            nameSpan.textContent = res.name;

            const heartSpan = document.createElement('span');
            heartSpan.className = 'result-heart-txt';
            heartSpan.textContent = res.heartDisplay;

            row.appendChild(nameSpan);
            row.appendChild(heartSpan);
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
            const labelSpan = document.createElement('span');
            labelSpan.textContent = `${rankLabel}: ${res.name}`;

            const statusSpan = document.createElement('span');
            if (res.rank === 1 && res.stock > 0) {
                statusSpan.className = 'result-heart-txt';
                statusSpan.textContent = res.heartDisplay;
            } else {
                statusSpan.textContent = '脱落';
            }

            row.appendChild(labelSpan);
            row.appendChild(statusSpan);
            listContainer.appendChild(row);
        });
    }

    resultModal.style.display = 'block';
});

// 【項目5改善】サーバー確定判定に従い、クライアント手元の無敵タイマーによる弾きを削除（脱落チェックのみ維持）
socket.on('playerKnocked', (data) => {
    if (data.targetId === myId) {
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
    } else if (otherPlayers[data.targetId]) {
        const op = otherPlayers[data.targetId];
        if (op.isEliminated) return;

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
    if (document.hidden) return;
    if (Date.now() < ignoreEffectsUntilTimestamp) return;
    if (data.timestamp && (Date.now() - data.timestamp > 800)) return;

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
        op.hasReportedFall = false;

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
    if (!document.hidden) {
        ignoreEffectsUntilTimestamp = Date.now() + 350;
        prevTime = performance.now();

        if (isDiving) isDiving = false;
        if (isPunching) isPunching = false;
        if (isSpinAttack) isSpinAttack = false;
        Controls.cancelPunchCharge();

        if (socket.connected) socket.emit('requestSync');
    }
});

socket.on('playerDisconnected', (id) => {
    if (otherPlayers[id]) {
        disposePlayerCharacter(otherPlayers[id]);
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
        invincibleTimer: 0,
        lastPacketTime: Date.now()
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

        if (currentRoomMode === 'stock_battle' && currentBattleStartTime > 0) {
            const currentSyncedNow = Date.now() + serverTimeOffset;
            const elapsedSeconds = (currentSyncedNow - currentBattleStartTime) / 1000.0;
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
                    triggerShockwaveExplosion(playerGroup.position, otherPlayers, socket, Controls.isEliminated);
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
            resolvePlayerCollisions(playerGroup.position, otherPlayers, velVec, Controls.isEliminated);
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
            const fellY = playerGroup.position.y;

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

            // 【項目4改善】テレポート前に落下位置（y < -25）をサーバーに確実に送信してから申告
            if (socket.volatile) {
                socket.volatile.emit('playerMove', {
                    x: playerGroup.position.x,
                    y: fellY,
                    z: playerGroup.position.z,
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
            }
            socket.emit('playerRespawn');
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

        const nowMs = Date.now();
        for (let id in otherPlayers) {
            const op = otherPlayers[id];

            if (op.isEliminated) {
                op.mesh.visible = false;
                continue;
            }

            if (op.isDiving && (nowMs - op.lastPacketTime > 450)) {
                op.isDiving = false;
                op.diveRatio = 0;
            }

            if (nowMs - op.lastPacketTime > 250) {
                op.swingAngle = 0;
            }

            const opOverStage = !isStageCompletelyGone && (Math.abs(op.targetX) <= halfStage && Math.abs(op.targetZ) <= halfStage);
            let opFloorY = opOverStage ? 0 : -9999;

            for (let obs of obstacles) {
                const collideX = op.targetX + PLAYER_RADIUS > obs.minX && op.targetX - PLAYER_RADIUS < obs.maxX;
                const collideZ = op.targetZ + PLAYER_RADIUS > obs.minZ && op.targetZ - PLAYER_RADIUS < obs.maxZ;
                if (collideX && collideZ && op.targetY >= obs.maxY - 0.2) {
                    if (obs.maxY > opFloorY) opFloorY = obs.maxY;
                }
            }

            if (!op.isKnockedOut && (nowMs - op.lastPacketTime > 400) && op.targetY > opFloorY) {
                op.targetY += gravity * delta;
                if (op.targetY <= opFloorY) {
                    op.targetY = opFloorY;
                    op.isOnGround = true;
                } else {
                    op.isOnGround = false;
                }

                if (op.targetY < -25 && !op.hasReportedFall) {
                    op.hasReportedFall = true;
                    socket.emit('targetFellOut', { targetId: id });
                }
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

                if (op.targetY < -25 && !op.hasReportedFall && (nowMs - op.lastPacketTime > 600)) {
                    op.hasReportedFall = true;
                    op.isKnockedOut = false;
                    op.kbVX = 0;
                    op.kbVY = 0;
                    op.kbVZ = 0;
                    socket.emit('targetFellOut', { targetId: id });
                }
            }

            const distToTarget = Math.hypot(op.targetX - op.mesh.position.x, op.targetZ - op.mesh.position.z);
            if (distToTarget > 25.0) {
                op.mesh.position.set(op.targetX, op.targetY, op.targetZ);
            } else {
                const lerpFactor = op.isKnockedOut ? 0.45 : 0.25;
                op.mesh.position.x += (op.targetX - op.mesh.position.x) * lerpFactor;
                op.mesh.position.y += (op.targetY - op.mesh.position.y) * lerpFactor;
                op.mesh.position.z += (op.targetZ - op.mesh.position.z) * lerpFactor;
            }
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

        // 【項目8改善】クライアント→サーバーのplayerMoveをvolatile送信にして遅延・滞留を抑制
        if (myId && time - lastSendTime > 33) {
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

            if (socket.volatile) {
                socket.volatile.emit('playerMove', moveData);
            } else {
                socket.emit('playerMove', moveData);
            }
            lastSendTime = time;
        }

    } catch (loopErr) {
        console.error('Render Loop Error:', loopErr);
    }

    renderer.render(scene, camera);
}

animate();