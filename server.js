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

    Object.values(players).forEach(p => {
        p.stock = 3;
        p.damage = 0;
        p.isEliminated = false;
        p.joinedMidBattle = false;
        p.lastFallTime = 0;
    });
}

function forceEndStockBattle(reason = 'manual') {
    if (currentMode !== 'stock_battle') return;

    const results = Object.values(players).map(p => ({
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

    const participants = Object.values(players).filter(p => !p.joinedMidBattle);
    const alivePlayers = participants.filter(p => p.stock > 0);

    if (alivePlayers.length <= 1 && participants.length >= 2) {
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

        eliminatedOrder.reverse().forEach((elId) => {
            if (players[elId] && elId !== (winner ? winner.id : null)) {
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
        spinRatio: 0,
        isDiving: false,
        diveRatio: 0,
        armScaleZ: 1.0,
        damage: 0,
        isInvincible: false,
        stock: isMidJoin ? 0 : 3,
        isEliminated: isMidJoin,
        joinedMidBattle: isMidJoin,
        lastFallTime: 0
    };

    socket.emit('init', {
        myId: socket.id,
        players: players,
        hostId: hostId,
        currentMode: currentMode,
        battleStartTime: battleStartTime
    });

    socket.broadcast.emit('newPlayer', players[socket.id]);
    updateRoomInfo();

    socket.on('changeName', (newName) => {
        if (players[socket.id] && typeof newName === 'string') {
            const cleanName = newName.trim().substring(0, 12) || 'NoName';
            players[socket.id].name = cleanName;
            io.emit('playerRenamed', { id: socket.id, name: cleanName });
        }
    });

    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].rotationY = data.rotationY;
            players[socket.id].swingAngle = data.swingAngle;
            players[socket.id].isOnGround = data.isOnGround;
            players[socket.id].punchRatio = data.punchRatio;
            players[socket.id].spinRatio = data.spinRatio || 0;
            players[socket.id].chargeLevel = data.chargeLevel || 0;
            players[socket.id].isSpinAttack = data.isSpinAttack || false;
            players[socket.id].isDiving = data.isDiving || false;
            players[socket.id].diveRatio = data.diveRatio || 0;
            players[socket.id].isInvincible = data.isInvincible || false;

            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('startStockBattle', () => {
        if (socket.id !== hostId || Object.keys(players).length < 2) return;

        currentMode = 'stock_battle';
        battleStartTime = Date.now();
        eliminatedOrder = [];

        const ids = Object.keys(players);
        const spawns = generateBattleSpawnPositions(ids.length);

        ids.forEach((id, idx) => {
            const p = players[id];
            p.stock = 3;
            p.damage = 0;
            p.isEliminated = false;
            p.joinedMidBattle = false;
            p.lastFallTime = 0;
            p.x = spawns[idx].x;
            p.y = 0;
            p.z = spawns[idx].z;
        });

        io.emit('battleStarted', {
            players: players,
            countdown: 3,
            battleStartTime: battleStartTime
        });
        updateRoomInfo();
    });

    socket.on('stopStockBattle', () => {
        if (socket.id !== hostId || currentMode !== 'stock_battle') return;
        forceEndStockBattle('manual');
    });

    socket.on('punchHit', (data) => {
        const target = players[data.targetId];
        const attacker = players[socket.id];
        if (!target || !attacker || target.isEliminated || attacker.isEliminated) return;

        target.damage += data.damageDealt;

        io.emit('playerKnocked', {
            targetId: data.targetId,
            attackerId: socket.id,
            dirX: data.dirX,
            dirZ: data.dirZ,
            force: data.force,
            newDamage: target.damage
        });
    });

    socket.on('spawnShockwave', (data) => {
        socket.broadcast.emit('shockwaveSpawned', {
            x: data.x,
            y: data.y,
            z: data.z,
            timestamp: Date.now()
        });
    });

    // 【重要改善】二重落下判定ガード（同一落下イベントを1.5秒間クールダウンしストック二重減少を完全防止）
    const handleFall = (targetId) => {
        const p = players[targetId];
        if (!p) return;

        const now = Date.now();
        if (p.lastFallTime && (now - p.lastFallTime < 1500)) {
            return; // 1.5秒以内の重複通知は破棄
        }
        p.lastFallTime = now;

        p.damage = 0;
        p.x = 0;
        p.y = 0;
        p.z = 0;

        if (currentMode === 'stock_battle' && !p.isEliminated) {
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
        handleFall(socket.id);
    });

    socket.on('targetFellOut', (data) => {
        handleFall(data.targetId);
    });

    socket.on('updateTargetPosition', (data) => {
        if (players[data.targetId]) {
            players[data.targetId].x = data.x;
            players[data.targetId].y = data.y;
            players[data.targetId].z = data.z;
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

        if (currentMode === 'stock_battle' && Object.keys(players).length <= 1) {
            forceEndStockBattle('low_players');
        } else {
            checkStockBattleWinner();
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`3Dbros サーバー稼働中: http://localhost:${PORT}`);
    console.log(`=========================================`);
});