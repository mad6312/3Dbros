// =======================================================
// モジュール3: ゲームループ・高度16mダイブ・余韻衝撃波
// =======================================================

window.addEventListener('error', (e) => {
    console.error('Game Error:', e.error || e.message);
    const errBox = document.getElementById('debug-error-box');
    if (errBox) {
        errBox.style.display = 'block';
        errBox.textContent = `[Error]: ${e.message}`;
    }
});

// --- 1. シーン・カメラ・レンダラーの設定 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 120);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// --- 2. ライトの設定 ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(30, 50, 30);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

// --- 3. ステージ（浮島ステージ 60x60） ---
const stageSize = 60;
const halfStage = stageSize / 2; // 30m

const floorGeo = new THREE.BoxGeometry(stageSize, 2, stageSize);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x55aa55 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.position.y = -1;
floor.receiveShadow = true;
scene.add(floor);

const cliffGeo = new THREE.BoxGeometry(stageSize - 2, 10, stageSize - 2);
const cliffMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
const cliff = new THREE.Mesh(cliffGeo, cliffMat);
cliff.position.y = -7;
scene.add(cliff);

let seed = 12345;
function seededRandom() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
}

const obstacles = [];
const boxGeo = new THREE.BoxGeometry(2, 2, 2);

for (let i = 0; i < 35; i++) {
    const boxMat = new THREE.MeshStandardMaterial({
        color: Math.floor(seededRandom() * 0xffffff)
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.x = (seededRandom() - 0.5) * 44;
    box.position.z = (seededRandom() - 0.5) * 44;
    box.position.y = 1;
    box.castShadow = true;
    box.receiveShadow = true;
    scene.add(box);

    obstacles.push({
        minX: box.position.x - 1,
        maxX: box.position.x + 1,
        minY: 0,
        maxY: 2,
        minZ: box.position.z - 1,
        maxZ: box.position.z + 1
    });
}

// --- 4. プレイヤーキャラクター＆各種リーチ予測ガイド ---
let myName = 'Player';
let myDamage = 0;
const myCharacter = createCharacterMesh(0x3366ff, myName, myDamage);
const playerGroup = myCharacter.mesh;
scene.add(playerGroup);

const playerRadius = 0.45;
const playerHeight = 1.9;
const otherPlayers = {};

// パンチ直線ガイド
const reachGuideGeo = new THREE.BoxGeometry(0.85, 0.03, 1.0);
reachGuideGeo.translate(0, 0.015, 0.5);
const reachGuideMat = new THREE.MeshBasicMaterial({
    color: 0xff1133,
    transparent: true,
    opacity: 0.55,
    depthWrite: false
});
const reachGuide = new THREE.Mesh(reachGuideGeo, reachGuideMat);
reachGuide.visible = false;
scene.add(reachGuide);

// 回転斬り360度円形ガイド
const spinGuideGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.03, 36);
const spinGuideMat = new THREE.MeshBasicMaterial({
    color: 0x00d4ff,
    transparent: true,
    opacity: 0.4,
    depthWrite: false
});
const spinGuide = new THREE.Mesh(spinGuideGeo, spinGuideMat);
spinGuide.visible = false;
scene.add(spinGuide);

// --- 【改良：最大到達点8.0mで余韻を残す立体半球衝撃波】 ---
const activeShockwaves = [];
const domeGeo = new THREE.SphereGeometry(1.0, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
const ringGeo = new THREE.RingGeometry(0.92, 1.0, 40);
ringGeo.rotateX(-Math.PI / 2);

function createShockwaveEffect(x, y, z) {
    const shockGroup = new THREE.Group();
    shockGroup.position.set(x, y + 0.02, z);

    // 外郭ドーム
    const domeMat = new THREE.MeshBasicMaterial({
        color: 0x00d4ff,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    shockGroup.add(domeMesh);

    // 外周境界リング（最大到達点を明示する発光枠）
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.02;
    shockGroup.add(ringMesh);

    scene.add(shockGroup);

    activeShockwaves.push({
        group: shockGroup,
        domeMesh,
        ringMesh,
        time: 0,
        expandDuration: 0.18, // 0.18秒で8.0mまで急拡大
        lingerDuration: 0.32, // その後0.32秒間、最大サイズで余韻表示
        hasDamaged: false
    });
}

// --- 5. オンライン通信 ---
const socket = (typeof io !== 'undefined') ? io() : {
    on: () => { },
    emit: () => { },
    connected: false
};

const serverStatus = document.getElementById('server-status');
let myId = null;

socket.on('connect', () => {
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
    const myData = data.players[myId];
    if (myData) {
        playerGroup.position.set(myData.x, myData.y, myData.z);
        if (myCharacter.bodyMesh && myCharacter.bodyMesh.material) {
            myCharacter.bodyMesh.material.color.setHex(myData.color);
        }
        myName = myData.name;
        myDamage = myData.damage || 0;
        updateNameSpriteName(myCharacter.nameObj, myName);
        updateNameSpriteDamage(myCharacter.nameObj, myDamage);
        const nameInput = document.getElementById('player-name-input');
        if (nameInput) nameInput.value = myName;
    }

    for (let id in data.players) {
        if (id !== myId) addOtherPlayer(data.players[id]);
    }
});

socket.on('newPlayer', (playerData) => {
    if (playerData.id !== myId && !otherPlayers[playerData.id]) {
        addOtherPlayer(playerData);
    }
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
        p.isKnockedOut = false;
    }
});

socket.on('playerKnocked', (data) => {
    if (data.targetId === myId) {
        myDamage = data.newDamage;
        updateNameSpriteDamage(myCharacter.nameObj, myDamage);
        Controls.cancelPunchCharge();

        // ダイブ中の被弾キャンセル
        if (isDiving) {
            isDiving = false;
        }

        // 被弾フラグを立てる
        isKnockedBack = true;

        velocityX = data.dirX * data.force;
        velocityZ = data.dirZ * data.force;
        yVelocity = 8.5 + (myDamage / 80.0) * 4.0;
        isOnGround = false;
    } else if (otherPlayers[data.targetId]) {
        const op = otherPlayers[data.targetId];
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
        velocityX = 0;
        velocityZ = 0;
        yVelocity = 0;
        isOnGround = true;
        isKnockedBack = false;
        myDamage = 0;
        updateNameSpriteDamage(myCharacter.nameObj, 0);
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
    }
});

socket.on('playerDamageReset', (data) => {
    if (data.id === myId) {
        myDamage = 0;
        updateNameSpriteDamage(myCharacter.nameObj, 0);
    } else if (otherPlayers[data.id]) {
        otherPlayers[data.id].damage = 0;
        updateNameSpriteDamage(otherPlayers[data.id].nameObj, 0);
    }
});

socket.on('syncSelf', (serverData) => {
    playerGroup.position.set(serverData.x, serverData.y || 0, serverData.z);
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
});

function addOtherPlayer(data) {
    const char = createCharacterMesh(data.color || 0xff3366, data.name || 'Player', data.damage || 0);
    char.mesh.position.set(data.x, data.y, data.z);
    char.mesh.rotation.y = data.rotationY || 0;
    scene.add(char.mesh);

    otherPlayers[data.id] = {
        mesh: char.mesh,
        charObj: char,
        nameObj: char.nameObj,
        damage: data.damage || 0,
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
        hasReportedFall: false
    };
}

Controls.init((newName) => {
    socket.emit('changeName', newName);
});

// --- 6. 衝突判定 ---
function checkObstacleCollision(px, py, pz) {
    for (let obs of obstacles) {
        const collideX = px + playerRadius > obs.minX && px - playerRadius < obs.maxX;
        const collideZ = pz + playerRadius > obs.minZ && pz - playerRadius < obs.maxZ;
        const collideY = py < obs.maxY && (py + playerHeight) > obs.minY;

        if (collideX && collideZ && collideY) return obs;
    }

    if (py < 0 && py > -25) {
        const inCliffX = px + playerRadius > -halfStage && px - playerRadius < halfStage;
        const inCliffZ = pz + playerRadius > -halfStage && pz - playerRadius < halfStage;
        if (inCliffX && inCliffZ) return { isCliff: true };
    }
    return null;
}

function unstickFromObstacles(pos) {
    for (let obs of obstacles) {
        const collideX = pos.x + playerRadius > obs.minX && pos.x - playerRadius < obs.maxX;
        const collideZ = pos.z + playerRadius > obs.minZ && pos.z - playerRadius < obs.maxZ;
        const collideY = pos.y < obs.maxY && (pos.y + playerHeight) > obs.minY;

        if (collideX && collideZ && collideY) {
            const dLeft = Math.abs((pos.x + playerRadius) - obs.minX);
            const dRight = Math.abs(obs.maxX - (pos.x - playerRadius));
            const dBack = Math.abs((pos.z + playerRadius) - obs.minZ);
            const dFront = Math.abs(obs.maxZ - (pos.z - playerRadius));
            const minPush = Math.min(dLeft, dRight, dBack, dFront);

            if (minPush === dLeft) pos.x = obs.minX - playerRadius - 0.02;
            else if (minPush === dRight) pos.x = obs.maxX + playerRadius + 0.02;
            else if (minPush === dBack) pos.z = obs.minZ - playerRadius - 0.02;
            else if (minPush === dFront) pos.z = obs.maxZ + playerRadius + 0.02;
        }
    }
}

function moveWithCollision(pos, vx, vz, delta) {
    const totalDist = Math.hypot(vx * delta, vz * delta);
    const steps = totalDist > 0.3 ? Math.ceil(totalDist / 0.25) : 1;
    const stepDelta = delta / steps;

    for (let i = 0; i < steps; i++) {
        const nextX = pos.x + vx * stepDelta;
        if (!checkObstacleCollision(nextX, pos.y, pos.z)) {
            pos.x = nextX;
        } else {
            vx = 0;
        }

        const nextZ = pos.z + vz * stepDelta;
        if (!checkObstacleCollision(pos.x, pos.y, nextZ)) {
            pos.z = nextZ;
        } else {
            vz = 0;
        }
    }

    unstickFromObstacles(pos);
    return { vx, vz };
}

function resolvePlayerCollisions() {
    const myPos = playerGroup.position;
    const minDist = playerRadius * 2;

    for (let id in otherPlayers) {
        const opPos = otherPlayers[id].mesh.position;
        const yOverlap = Math.abs(myPos.y - opPos.y) < playerHeight;

        if (yOverlap) {
            const dx = myPos.x - opPos.x;
            const dz = myPos.z - opPos.z;
            const distXZ = Math.hypot(dx, dz);

            if (distXZ < minDist && distXZ > 0.001) {
                const overlap = minDist - distXZ;
                const pushX = (dx / distXZ) * overlap;
                const pushZ = (dz / distXZ) * overlap;

                if (!checkObstacleCollision(myPos.x + pushX, myPos.y, myPos.z)) myPos.x += pushX;
                if (!checkObstacleCollision(myPos.x, myPos.y, myPos.z + pushZ)) myPos.z += pushZ;

                velocityX *= 0.5;
                velocityZ *= 0.5;
            }
        }
    }
}

// --- 7. 攻撃処理 ---
let isPunching = false;
let punchTimer = 0;
const PUNCH_TOTAL_TIME = 0.44;
let punchHitChecked = false;
let currentChargeLevel = 0;

function startPunch(chargeLevel) {
    isPunching = true;
    punchTimer = PUNCH_TOTAL_TIME;
    punchHitChecked = false;
    currentChargeLevel = chargeLevel;
}

function checkPunchHit() {
    const punchReach = 2.4 + currentChargeLevel * 5.6;
    const myPos = playerGroup.position;
    const forward = new THREE.Vector3(
        Math.sin(playerGroup.rotation.y),
        0,
        Math.cos(playerGroup.rotation.y)
    ).normalize();

    for (let id in otherPlayers) {
        const op = otherPlayers[id];
        const targetPos = op.mesh.position;
        const dist = myPos.distanceTo(targetPos);

        if (dist < punchReach) {
            const toTarget = new THREE.Vector3().subVectors(targetPos, myPos).normalize();
            const dot = forward.dot(toTarget);

            if (dot > 0.35) {
                const baseDmg = 13 + Math.floor(Math.random() * 5);
                const dmgMultiplier = 1.0 + currentChargeLevel * 0.4;
                const finalDamage = Math.round(baseDmg * dmgMultiplier);

                const targetDamage = op.damage || 0;
                const damageScaling = 1.0 + (targetDamage / 100.0) * 1.5;
                const chargeMult = 1.0 + currentChargeLevel * 0.4;
                const finalForce = 15.0 * damageScaling * chargeMult;

                socket.emit('punchHit', {
                    targetId: id,
                    dirX: forward.x,
                    dirZ: forward.z,
                    force: finalForce,
                    damageDealt: finalDamage
                });
            }
        }
    }
}

// 回転斬り
let isSpinAttack = false;
let spinTimer = 0;
const SPIN_TOTAL_TIME = 0.36;
let spinChargeLevel = 0;
let prevSpinArmAngle = 0;
const hitTargetsThisSpin = new Set();

function startSpinAttack(chargeLevel) {
    isSpinAttack = true;
    spinTimer = SPIN_TOTAL_TIME;
    spinChargeLevel = chargeLevel;
    hitTargetsThisSpin.clear();
    prevSpinArmAngle = playerGroup.rotation.y + 1.8 - Math.PI / 2;
}

function checkSpinSweepHit(currentSpinRatio) {
    const spinReach = 2.4 + spinChargeLevel * 5.6;
    const myPos = playerGroup.position;

    const currentTorsoY = 1.8 - currentSpinRatio * (Math.PI * 2);
    const currentArmAngle = playerGroup.rotation.y + currentTorsoY - Math.PI / 2;

    for (let id in otherPlayers) {
        if (hitTargetsThisSpin.has(id)) continue;

        const op = otherPlayers[id];
        const targetPos = op.mesh.position;
        const dist = myPos.distanceTo(targetPos);

        if (dist <= spinReach) {
            const dx = targetPos.x - myPos.x;
            const dz = targetPos.z - myPos.z;
            const targetAngle = Math.atan2(dx, dz);

            let angleDiff = (targetAngle - currentArmAngle + Math.PI * 3) % (Math.PI * 2) - Math.PI;

            if (Math.abs(angleDiff) < 0.65 || currentSpinRatio > 0.85) {
                hitTargetsThisSpin.add(id);

                const baseDmg = 15 + Math.floor(Math.random() * 5);
                const finalDamage = Math.round(baseDmg * (1.0 + spinChargeLevel * 0.4));

                const targetDamage = op.damage || 0;
                const damageScaling = 1.0 + (targetDamage / 80.0) * 1.5;
                const chargeMult = 1.0 + spinChargeLevel * 0.4;
                const finalForce = 18.75 * damageScaling * chargeMult;

                const pushDir = new THREE.Vector3(dx, 0, dz).normalize();

                socket.emit('punchHit', {
                    targetId: id,
                    dirX: pushDir.x,
                    dirZ: pushDir.z,
                    force: finalForce,
                    damageDealt: finalDamage
                });
            }
        }
    }
    prevSpinArmAngle = currentArmAngle;
}

// --- 【新仕様】ドラゴンダイブ処理 ---
let isDiving = false;
let diveElapsed = 0;
const DIVE_ARC_TIME = 0.35; // 放物線時間: 0.35秒
let diveOriginY = 0;

function startDragonDive() {
    isDiving = true;
    diveElapsed = 0;
    diveOriginY = playerGroup.position.y;
    Controls.consumeDive();
}

// 着地時の【XYZ全方向8.0m 立体半球衝撃波】発生＆ダメージ判定
function triggerShockwaveExplosion() {
    const cx = playerGroup.position.x;
    const cy = playerGroup.position.y;
    const cz = playerGroup.position.z;

    createShockwaveEffect(cx, cy, cz);
    socket.emit('spawnShockwave', { x: cx, y: cy, z: cz });

    const radius = 8.0;
    const myPos = new THREE.Vector3(cx, cy, cz);

    for (let id in otherPlayers) {
        const op = otherPlayers[id];
        const targetPos = op.mesh.position;
        const dist3D = myPos.distanceTo(targetPos);

        if (dist3D <= radius) {
            const baseDmg = 15 + Math.floor(Math.random() * 5);
            const finalDamage = Math.round(baseDmg * 1.4);

            const targetDamage = op.damage || 0;
            const damageScaling = 1.0 + (targetDamage / 80.0) * 1.5;
            const finalForce = 18.75 * damageScaling * 1.4;

            const pushDir = new THREE.Vector3().subVectors(targetPos, myPos);
            if (pushDir.length() < 0.1) pushDir.set(0, 1, 0);
            pushDir.normalize();

            socket.emit('punchHit', {
                targetId: id,
                dirX: pushDir.x,
                dirZ: pushDir.z,
                force: finalForce,
                damageDealt: finalDamage
            });
        }
    }
}

// --- 8. メインゲームループ ---
let velocityX = 0;
let velocityZ = 0;
let yVelocity = 0;
const gravity = -26.0;
let isOnGround = true;
let isKnockedBack = false; // 被弾吹っ飛び中フラグ

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

        const input = Controls.getInputs(delta);

        // 【改良1：ダッシュ中の発動完全対応】
        // ダッシュ中であっても被弾中でなければ即座にドラゴンダイブ発動可能！
        if (input.diveTriggered && !isDiving && !isKnockedBack && Controls.diveCooldownTimer <= 0) {
            startDragonDive();
        }

        // 攻撃発動
        if (input.attackTriggered && !isPunching && !isSpinAttack && !isDiving) {
            if (input.attackType === 'spin') {
                Controls.consumeSpinStack();
                startSpinAttack(input.chargeLevel);
            } else {
                startPunch(input.chargeLevel);
            }
        }

        // リーチガイド
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

        // --- 【改良2 & 3：高度16m・超高速16m/0.35s ＆ 地面接触着地判定】 ---
        if (isDiving) {
            diveElapsed += delta;
            currentDiveRatio = Math.min(1.0, diveElapsed / DIVE_ARC_TIME);

            // 1. 【移動速度：16.0m ÷ 0.35秒 (約45.71m/s)】
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

            moveWithCollision(playerGroup.position, velocityX, velocityZ, delta);

            // 2. 【垂直軌道：高度16.0m跳躍】
            if (diveElapsed <= DIVE_ARC_TIME) {
                // 跳躍放物線（0〜0.35秒の間）
                const arcY = Math.sin((diveElapsed / DIVE_ARC_TIME) * Math.PI) * 16.0;
                playerGroup.position.y = diveOriginY + arcY;
            } else {
                // 0.35秒経過後：地面に接触するまで高速急降下！
                yVelocity = -45.0; // 急降下速度
                playerGroup.position.y += yVelocity * delta;
            }

            // 3. 【実際の地面接触判定 ＆ ステージ外への突入落下処理】
            const isOverStage = Math.abs(playerGroup.position.x) <= halfStage && Math.abs(playerGroup.position.z) <= halfStage;
            let targetGroundY = -9999;

            if (isOverStage) {
                targetGroundY = 0;
            }

            // 箱の上
            for (let obs of obstacles) {
                const collideX = playerGroup.position.x + playerRadius > obs.minX && playerGroup.position.x - playerRadius < obs.maxX;
                const collideZ = playerGroup.position.z + playerRadius > obs.minZ && playerGroup.position.z - playerRadius < obs.maxZ;
                if (collideX && collideZ && playerGroup.position.y >= obs.maxY - 0.3) {
                    if (obs.maxY > targetGroundY) targetGroundY = obs.maxY;
                }
            }

            // 頂点を通過し、地面・箱の上面に接触した瞬間
            if (diveElapsed > (DIVE_ARC_TIME * 0.5) && playerGroup.position.y <= targetGroundY) {
                // 【ステージ内】：着地成功 ＆ 衝撃波炸裂！
                playerGroup.position.y = targetGroundY;
                isDiving = false;
                currentDiveRatio = 0;
                velocityX = 0;
                velocityZ = 0;
                yVelocity = 0;
                isOnGround = true;
                triggerShockwaveExplosion();
            } else if (diveElapsed > DIVE_ARC_TIME && !isOverStage && playerGroup.position.y < 0) {
                // 【ステージ外】：着地も衝撃波も発生させず、速度を維持したまま奈落へ直滑降！
                isDiving = false;
                currentDiveRatio = 0;
                isOnGround = false;
                // 下向きの急降下速度を維持したまま落下を継続
                yVelocity = -35.0;
            }
        } else {
            // 通常移動計算
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
                isKnockedBack = false; // 着地したら被弾状態解除
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

            const moved = moveWithCollision(playerGroup.position, velocityX, velocityZ, delta);
            velocityX = moved.vx;
            velocityZ = moved.vz;

            resolvePlayerCollisions();

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
                    const collideX = playerGroup.position.x + playerRadius > obs.minX && playerGroup.position.x - playerRadius < obs.maxX;
                    const collideZ = playerGroup.position.z + playerRadius > obs.minZ && playerGroup.position.z - playerRadius < obs.maxZ;
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
                checkPunchHit();
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
            checkSpinSweepHit(currentSpinRatio);

            if (spinTimer <= 0) {
                isSpinAttack = false;
                currentSpinRatio = 0;
            }
        } else {
            currentSpinRatio = 0;
        }

        // モーション更新
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

        // --- 【改良4：最大到達点8.0mで余韻を残す衝撃波エフェクト更新】 ---
        for (let i = activeShockwaves.length - 1; i >= 0; i--) {
            const sw = activeShockwaves[i];
            sw.time += delta;

            if (sw.time < sw.expandDuration) {
                // 第1段階: 0〜0.18秒で半径0mから8.0mへ急速拡大！
                const progress = sw.time / sw.expandDuration;
                const currentR = progress * 8.0;
                sw.group.scale.set(currentR, currentR, currentR);
                sw.domeMesh.material.opacity = 0.7 * (1.0 - progress * 0.3);
                sw.ringMesh.material.opacity = 0.95;
            } else if (sw.time < (sw.expandDuration + sw.lingerDuration)) {
                // 第2段階: 【余韻表示】最大半径8.0mを完全維持したまま、外周リングをくっきり残像表示！
                sw.group.scale.set(8.0, 8.0, 8.0);
                const lingerProgress = (sw.time - sw.expandDuration) / sw.lingerDuration; // 0 -> 1

                // ドームは消え、最大到達点の境界リングが鮮明に残って徐々にフェードアウト
                sw.domeMesh.material.opacity = Math.max(0, 0.45 * (1.0 - lingerProgress));
                sw.ringMesh.material.opacity = Math.max(0, 0.95 * (1.0 - lingerProgress));
            } else {
                // 消滅
                scene.remove(sw.group);
                activeShockwaves.splice(i, 1);
            }
        }

        const targetPos = new THREE.Vector3(playerGroup.position.x, playerGroup.position.y + 1.0, playerGroup.position.z);
        Controls.updateCamera(camera, targetPos, currentSpeed, currentMaxSpeed, delta);

        // 他プレイヤー処理
        for (let id in otherPlayers) {
            const op = otherPlayers[id];

            if (op.isKnockedOut) {
                const opPos = { x: op.targetX, y: op.targetY, z: op.targetZ };
                const opMoved = moveWithCollision(opPos, op.kbVX, op.kbVZ, delta);
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
                    const collideX = op.targetX + playerRadius > obs.minX && op.targetX - playerRadius < obs.maxX;
                    const collideZ = op.targetZ + playerRadius > obs.minZ && op.targetZ - playerRadius < obs.maxZ;
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
                diveRatio: currentDiveRatio
            });
            lastSendTime = time;
        }

    } catch (loopErr) {
        console.error('Render Loop Error:', loopErr);
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();