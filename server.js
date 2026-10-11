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

// 豊富なカラーパレット（最大10色）
const playerColors = [
    0x3366ff, // ブルー
    0xff3344, // レッド
    0x33cc66, // グリーン
    0xff9900, // オレンジ
    0x9933ff, // パープル
    0x00d4ff, // シアン
    0xffcc00, // イエロー
    0xff66cc, // ピンク
    0x00ffaa, // ミント
    0xaaaaaa  // シルバー
];

// 【新機能】現在誰も使っていないカラーを自動選定する関数
function getAvailableColor() {
    const usedColors = Object.values(players).map(p => p.color);
    // 未使用のカラーを探す
    const available = playerColors.filter(c => !usedColors.includes(c));
    if (available.length > 0) {
        return available[Math.floor(Math.random() * available.length)];
    }
    // 全色使われている場合はランダム
    return playerColors[Math.floor(Math.random() * playerColors.length)];
}

io.on('connection', (socket) => {
    console.log(`[接続] プレイヤーが入室: ${socket.id}`);

    // 重複しないカラーを自動割り当て
    const assignedColor = getAvailableColor();
    const defaultName = `Player_${socket.id.substring(0, 4)}`;

    players[socket.id] = {
        id: socket.id,
        name: defaultName,
        x: (Math.random() - 0.5) * 10,
        y: 0,
        z: (Math.random() - 0.5) * 10,
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
        isInvincible: false
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
            players[socket.id].isInvincible = data.isInvincible || false;

            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // 攻撃命中通知
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

    socket.on('spawnShockwave', (data) => {
        socket.broadcast.emit('shockwaveSpawned', {
            x: data.x,
            y: data.y,
            z: data.z
        });
    });

    // リスポーン（無敵時間フラグ付与）
    socket.on('playerRespawn', () => {
        if (players[socket.id]) {
            players[socket.id].damage = 0;
            players[socket.id].x = 0;
            players[socket.id].y = 0;
            players[socket.id].z = 0;
            players[socket.id].isInvincible = true;
            io.emit('playerDamageReset', { id: socket.id, damage: 0 });
        }
    });

    // 相手が裏画面でも場外に落ちた際の強制リスポーン
    socket.on('targetFellOut', (data) => {
        const tid = data.targetId;
        if (players[tid]) {
            players[tid].damage = 0;
            players[tid].x = 0;
            players[tid].y = 0;
            players[tid].z = 0;
            players[tid].isInvincible = true;
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