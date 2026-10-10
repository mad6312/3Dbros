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

const playerColors = [
    0x3366ff, 0xff3366, 0x33cc66, 0xff9900,
    0x9933ff, 0x00cccc, 0xffcc00, 0xff66cc
];

io.on('connection', (socket) => {
    console.log(`[接続] プレイヤーが入室: ${socket.id}`);

    const randomColor = playerColors[Math.floor(Math.random() * playerColors.length)];
    const defaultName = `Player_${socket.id.substring(0, 4)}`;

    players[socket.id] = {
        id: socket.id,
        name: defaultName,
        x: (Math.random() - 0.5) * 10,
        y: 0,
        z: (Math.random() - 0.5) * 10,
        rotationY: 0,
        color: randomColor,
        swingAngle: 0,
        isOnGround: true,
        punchRatio: 0,
        spinRatio: 0,
        isDiving: false,
        diveRatio: 0,
        armScaleZ: 1.0,
        damage: 0
    };

    socket.emit('init', {
        myId: socket.id,
        players: players
    });

    socket.broadcast.emit('newPlayer', players[socket.id]);

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

            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // 攻撃命中通知（パンチ・回転斬り・ドラゴンダイブ共通）
    socket.on('punchHit', (data) => {
        if (players[data.targetId]) {
            players[data.targetId].damage += data.damageDealt;

            io.emit('playerKnocked', {
                targetId: data.targetId,
                attackerId: socket.id,
                dirX: data.dirX,
                dirZ: data.dirZ,
                force: data.force,
                newDamage: players[data.targetId].damage
            });
        }
    });

    // ドラゴンダイブ衝撃波エフェクトのマルチ同期
    socket.on('spawnShockwave', (data) => {
        socket.broadcast.emit('shockwaveSpawned', {
            x: data.x,
            y: data.y,
            z: data.z
        });
    });

    socket.on('playerRespawn', () => {
        if (players[socket.id]) {
            players[socket.id].damage = 0;
            players[socket.id].x = 0;
            players[socket.id].y = 0;
            players[socket.id].z = 0;
            io.emit('playerDamageReset', { id: socket.id, damage: 0 });
        }
    });

    socket.on('targetFellOut', (data) => {
        const tid = data.targetId;
        if (players[tid]) {
            players[tid].damage = 0;
            players[tid].x = 0;
            players[tid].y = 0;
            players[tid].z = 0;
            io.emit('playerForceRespawned', {
                id: tid,
                x: 0,
                y: 0,
                z: 0,
                damage: 0
            });
        }
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
        io.emit('playerDisconnected', socket.id);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`マルチプレイサーバー稼働中: http://localhost:${PORT}`);
    console.log(`=========================================`);
});