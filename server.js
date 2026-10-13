const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const players = {};
let hostId = null;

let currentMode = 'free';
let battleStartTime = 0;
let eliminatedOrder = [];
let battleParticipantIds = new Set();

const playerColors = [
    0x3366ff, 0xff3344, 0x33cc66, 0xff9900,
    0x9933ff, 0x00cccc, 0xffcc00, 0xff66cc,
    0x00ffaa, 0xaaaaaa
];

function getAvailableColor() {
    const usedColors = Object.values(players).map(p => p.color);
    const available = playerColors.filter(c => !usedColors.includes(c));
    if (available.length > 0) {
        return available[Math.floor(Math.random() * available.length)];
    }
    return playerColors[Math.floor(Math.random() * playerColors.length)];
}

const obstacleBoxes = [];
let seed = 12345;
function seededRandom() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
}
for (let i = 0; i < 35; i++) {
    seededRandom();
    const bx = (seededRandom() - 0.5) * 44;
    const bz = (seededRandom() - 0.5) * 44;
    obstacleBoxes.push({
        minX: bx - 1.0,
        maxX: bx + 1.0,
        minZ: bz - 1.0,
        maxZ: bz + 1.0
    });
}

function isCollidingWithBlocks(x, z) {
    const r = 0.65;
    for (let b of obstacleBoxes) {
        if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) {
            return true;
        }
    }
    return false;
}

function generateSafeRoomSpawn() {
    for (let attempts = 0; attempts < 500; attempts++) {
        const x = (Math.random() - 0.5) * 20;
        const z = (Math.random() - 0.5) * 20;
        if (!isCollidingWithBlocks(x, z)) {
            return { x, y: 0, z };
        }
    }
    return { x: 0, y: 0, z: 0 };
}

function generateBattleSpawnPositions(count) {
    const positions = [];
    const minDistance = 3.5;

    for (let i = 0; i < count; i++) {
        let placed = false;
        for (let attempts = 0; attempts < 800; attempts++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 3.0 + Math.random() * 11.5;
            const x = Math.sin(angle) * radius;
            const z = Math.cos(angle) * radius;

            if (isCollidingWithBlocks(x, z)) continue;

            const tooClose = positions.some(p => Math.hypot(p.x - x, p.z - z) < minDistance);
            if (!tooClose) {
                positions.push({ x, y: 0, z });
                placed = true;
                break;
            }
        }
        if (!placed) {
            positions.push({ x: (i * 3) - 6, y: 0, z: (i * 3) - 6 });
        }
    }
    return positions;
}

function formatStockToHearts(stock) {
    if (stock >= 3) return '♥♥♥';
    if (stock === 2) return '♥♥♡';
    if (stock === 1) return '♥♡♡';
    return '♡♡♡';
}

function updateRoomInfo() {
    const ids = Object.keys(players);
    if (!hostId || !players[hostId]) {
        hostId = ids.length > 0 ? ids[0] : null;
    }

    io.emit('roomStateUpdate', {
        hostId: hostId,
        playerCount: ids.length,
        currentMode: currentMode
    });
}

function resetAllPlayersToFreeMode() {
    currentMode = 'free';
    battleStartTime = 0;
    battleParticipantIds.clear();

    Object.values(players).forEach(p => {
        p.stock = 3;
        p.damage = 0;
        p.isEliminated = false;
        p.joinedMidBattle = false;
        p.isRespawning = false;
        p.respawnedAt = 0;
        p.invincibleUntil = 0;
    });
}

function forceEndStockBattle(reason = 'manual') {
    if (currentMode !== 'stock_battle') return;

    const results = Object.values(players)
        .filter(p => battleParticipantIds.has(p.id))
        .map(p => ({
            id: p.id,
            name: p.name,
            stock: p.stock,
            heartDisplay: formatStockToHearts(p.stock)
        }));

    resetAllPlayersToFreeMode();

    io.emit('battleFinished', {
        results: results,
        isForceEnd: true,
        reason: reason
    });
    updateRoomInfo();
}

function checkStockBattleWinner() {
    if (currentMode !== 'stock_battle') return;

    const activeParticipants = Object.values(players).filter(p => battleParticipantIds.has(p.id));
    const alivePlayers = activeParticipants.filter(p => p.stock > 0);

    if (alivePlayers.length <= 1) {
        const winner = alivePlayers[0] || null;
        const results = [];

        if (winner) {
            results.push({
                rank: 1,
                id: winner.id,
                name: winner.name,
                stock: winner.stock,
                heartDisplay: formatStockToHearts(winner.stock),
                isWinner: true
            });
        }

        const reversedEliminated = [...eliminatedOrder].reverse();
        reversedEliminated.forEach((elId) => {
            if (players[elId] && (!winner || elId !== winner.id) && battleParticipantIds.has(elId)) {
                results.push({
                    rank: results.length + 1,
                    id: elId,
                    name: players[elId].name,
                    stock: 0,
                    heartDisplay: '♡♡♡',
                    isWinner: false
                });
            }
        });

        resetAllPlayersToFreeMode();

        io.emit('battleFinished', {
            results: results,
            isForceEnd: false
        });
        updateRoomInfo();
    }
}

io.on('connection', (socket) => {
    console.log(`[接続] プレイヤーが入室: ${socket.id}`);

    const assignedColor = getAvailableColor();
    const defaultName = `Player_${socket.id.substring(0, 4)}`;
    const isMidJoin = (currentMode === 'stock_battle');
    const initSpawn = generateSafeRoomSpawn();

    players[socket.id] = {
        id: socket.id,
        name: defaultName,
        x: initSpawn.x,
        y: initSpawn.y,
        z: initSpawn.z,
        rotationY: 0,
        color: assignedColor,
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
        armScaleZ: 1.0,
        damage: 0,
        isInvincible: false,
        stock: isMidJoin ? 0 : 3,
        isEliminated: isMidJoin,
        joinedMidBattle: isMidJoin,
        isRespawning: false,
        respawnedAt: 0,
        invincibleUntil: 0,
        lastMoveAt: Date.now(),
        lastPunchHitAt: 0,
        lastShockwaveAt: 0
    };

    socket.emit('init', {
        myId: socket.id,
        players: players,
        hostId: hostId,
        currentMode: currentMode,
        battleStartTime: battleStartTime,
        serverNow: Date.now()
    });

    socket.broadcast.emit('newPlayer', players[socket.id]);
    updateRoomInfo();

    socket.on('changeName', (newName) => {
        if (players[socket.id] && typeof newName === 'string') {
            const cleanName = Array.from(newName.trim()).slice(0, 12).join('') || 'NoName';
            players[socket.id].name = cleanName;
            io.emit('playerRenamed', { id: socket.id, name: cleanName });
        }
    });

    socket.on('playerMove', (data) => {
        const p = players[socket.id];
        if (p && data && Number.isFinite(data.x) && Number.isFinite(data.y) && Number.isFinite(data.z)) {
            p.x = data.x;
            p.y = data.y;
            p.z = data.z;
            p.rotationY = Number.isFinite(data.rotationY) ? data.rotationY : 0;
            p.swingAngle = Number.isFinite(data.swingAngle) ? data.swingAngle : 0;
            p.isOnGround = !!data.isOnGround;
            p.punchRatio = Number.isFinite(data.punchRatio) ? data.punchRatio : 0;
            p.chargeLevel = Number.isFinite(data.chargeLevel) ? data.chargeLevel : 0;
            p.spinRatio = Number.isFinite(data.spinRatio) ? data.spinRatio : 0;
            p.isSpinAttack = !!data.isSpinAttack;
            p.isHoldingSpin = !!data.isHoldingSpin;
            p.holdingCharge = Number.isFinite(data.holdingCharge) ? data.holdingCharge : 0;
            p.isDiving = !!data.isDiving;
            p.diveRatio = Number.isFinite(data.diveRatio) ? data.diveRatio : 0;
            p.isInvincible = !!data.isInvincible;
            p.lastMoveAt = Date.now();

            // 本人パケットによりリスポーン完了を解除
            if (p.isRespawning && p.y >= -1.0) {
                p.isRespawning = false;
            }

            socket.broadcast.volatile.emit('playerMoved', {
                id: p.id,
                x: p.x,
                y: p.y,
                z: p.z,
                rotationY: p.rotationY,
                swingAngle: p.swingAngle,
                isOnGround: p.isOnGround,
                punchRatio: p.punchRatio,
                chargeLevel: p.chargeLevel,
                spinRatio: p.spinRatio,
                isSpinAttack: p.isSpinAttack,
                isHoldingSpin: p.isHoldingSpin,
                holdingCharge: p.holdingCharge,
                isDiving: p.isDiving,
                diveRatio: p.diveRatio,
                isInvincible: p.isInvincible
            });
        }
    });

    socket.on('startStockBattle', () => {
        if (socket.id !== hostId || currentMode !== 'free') return;
        if (Object.keys(players).length < 2) return;

        currentMode = 'stock_battle';
        battleStartTime = Date.now();
        eliminatedOrder = [];
        battleParticipantIds = new Set(Object.keys(players));

        const ids = Array.from(battleParticipantIds);
        const spawns = generateBattleSpawnPositions(ids.length);

        ids.forEach((id, idx) => {
            const p = players[id];
            p.stock = 3;
            p.damage = 0;
            p.isEliminated = false;
            p.joinedMidBattle = false;
            p.isRespawning = false;
            p.respawnedAt = 0;
            p.invincibleUntil = 0;
            p.x = spawns[idx].x;
            p.y = 0;
            p.z = spawns[idx].z;
        });

        io.emit('battleStarted', {
            players: players,
            countdown: 3,
            battleStartTime: battleStartTime,
            serverNow: Date.now()
        });
        updateRoomInfo();
    });

    socket.on('stopStockBattle', () => {
        if (socket.id !== hostId || currentMode !== 'stock_battle') return;
        forceEndStockBattle('manual');
    });

    socket.on('punchHit', (data) => {
        if (!data || typeof data.targetId !== 'string') return;
        if (data.targetId === socket.id) return;

        // レート制限（1プレイヤーあたり最低50ms間隔）
        const now = Date.now();
        const attacker = players[socket.id];
        if (!attacker || (now - (attacker.lastPunchHitAt || 0) < 50)) return;
        attacker.lastPunchHitAt = now;

        if (currentMode === 'stock_battle' && now < (battleStartTime + 3000)) return;

        const target = players[data.targetId];
        if (!target || target.isEliminated || attacker.isEliminated) return;

        if (target.invincibleUntil > now) return;

        const dist = Math.hypot(target.x - attacker.x, target.z - attacker.z);
        if (dist > 11.5) return;

        const damageDealt = Math.min(35, Math.max(0, Number(data.damageDealt) || 0));

        const rawDirX = Number.isFinite(data.dirX) ? data.dirX : 0;
        const rawDirZ = Number.isFinite(data.dirZ) ? data.dirZ : 1;
        const dirLen = Math.hypot(rawDirX, rawDirZ) || 1.0;
        const ndx = rawDirX / dirLen;
        const ndz = rawDirZ / dirLen;

        const maxTheoreticalForce = 18.75 * (1.0 + (target.damage / 80.0) * 1.5) * 1.4 * 1.15;
        const force = Math.min(maxTheoreticalForce, Math.max(0, Number(data.force) || 0));

        target.damage += damageDealt;

        io.emit('playerKnocked', {
            targetId: data.targetId,
            attackerId: socket.id,
            dirX: ndx,
            dirZ: ndz,
            force: force,
            newDamage: target.damage
        });
    });

    socket.on('spawnShockwave', (data) => {
        if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y) || !Number.isFinite(data.z)) return;
        const now = Date.now();
        const p = players[socket.id];
        if (!p || (now - (p.lastShockwaveAt || 0) < 300)) return;
        p.lastShockwaveAt = now;

        socket.broadcast.emit('shockwaveSpawned', {
            x: data.x,
            y: data.y,
            z: data.z,
            timestamp: now
        });
    });

    // 【重要改善 4.1】非アクティブ時のラッチ時間失効 ＆ 重複時の確定復帰同期
    const handleFall = (targetId, reporterSocket = null) => {
        const p = players[targetId];
        if (!p) return;
        const now = Date.now();

        if (p.isRespawning) {
            // 復帰後に本人のパケットが届いておらず、かつ前回復帰から1秒以上経過していれば失効
            const noPacketSinceRespawn = (p.lastMoveAt || 0) <= (p.respawnedAt || 0);
            const expired = noPacketSinceRespawn && (now - (p.respawnedAt || 0) > 1000);

            if (!expired) {
                // 重複申告時：申告者の画面に確定復帰位置を再通知し、相手の「消失」を防止
                if (reporterSocket) {
                    reporterSocket.emit('playerForceRespawned', {
                        id: p.id,
                        x: 0,
                        y: 0,
                        z: 0,
                        damage: 0,
                        isEliminated: p.isEliminated
                    });
                }
                return;
            }
        }

        p.isRespawning = true;
        p.respawnedAt = now;
        p.damage = 0;
        p.x = 0;
        p.y = 0;
        p.z = 0;
        p.invincibleUntil = now + 2000;

        if (currentMode === 'stock_battle' && battleParticipantIds.has(p.id) && !p.isEliminated) {
            p.stock = Math.max(0, p.stock - 1);

            if (p.stock === 0) {
                p.isEliminated = true;
                eliminatedOrder.push(p.id);
                io.emit('playerEliminated', { id: p.id });
            }

            io.emit('stockUpdated', { id: p.id, stock: p.stock });
            checkStockBattleWinner();
        }

        io.emit('playerForceRespawned', {
            id: p.id,
            x: 0,
            y: 0,
            z: 0,
            damage: 0,
            isEliminated: p.isEliminated
        });
    };

    socket.on('playerRespawn', () => {
        const p = players[socket.id];
        if (!p || p.y > -18.0) return;
        handleFall(socket.id, socket);
    });

    socket.on('targetFellOut', (data) => {
        if (!data || !data.targetId) return;
        const target = players[data.targetId];
        if (!target || data.targetId === socket.id) return;

        // 本人がアクティブに通信中（500ms以内）なら本人の申告を優先
        if (Date.now() - (target.lastMoveAt || 0) < 500) return;

        handleFall(data.targetId, socket);
    });

    socket.on('updateTargetPosition', (data) => {
        if (data && players[data.targetId]) {
            const t = players[data.targetId];
            if (Date.now() - (t.lastMoveAt || 0) >= 500) {
                if (Number.isFinite(data.x) && Number.isFinite(data.y) && Number.isFinite(data.z)) {
                    t.x = data.x;
                    t.y = data.y;
                    t.z = data.z;
                }
            }
        }
    });

    socket.on('requestSync', () => {
        if (players[socket.id]) {
            socket.emit('syncSelf', players[socket.id]);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[切断] プレイヤーが退出: ${socket.id}`);
        delete players[socket.id];

        if (socket.id === hostId) {
            hostId = null;
        }

        io.emit('playerDisconnected', socket.id);
        updateRoomInfo();

        if (currentMode === 'stock_battle') {
            const activeParticipants = Object.values(players).filter(p => battleParticipantIds.has(p.id));
            if (activeParticipants.length <= 1) {
                forceEndStockBattle('low_players');
            } else {
                checkStockBattleWinner();
            }
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`3Dbros サーバー稼働中: http://localhost:${PORT}`);
    console.log(`=========================================`);
});