// =======================================================
// モジュール: ネットワーク通信・マルチ同期・ルーム演出管理
// =======================================================

const Network = {
    socket: (typeof io !== 'undefined') ? io() : {
        on: () => { },
        emit: () => { },
        volatile: { emit: () => { } },
        connected: false
    },
    myId: null,
    currentHostId: null,
    currentRoomMode: 'free',
    currentBattleStartTime: 0,
    serverTimeOffset: 0,
    ignoreEffectsUntilTimestamp: 0,
    otherPlayers: {},
    localPlayerRef: null,

    init(localPlayerRef) {
        this.localPlayerRef = localPlayerRef;
        const serverStatus = document.getElementById('server-status');

        this.socket.on('connect', () => {
            this.myId = this.socket.id;
            if (serverStatus) {
                serverStatus.textContent = 'オンライン接続中';
                serverStatus.classList.add('connected');
            }
        });

        this.socket.on('disconnect', () => {
            if (serverStatus) {
                serverStatus.textContent = 'サーバー切断';
                serverStatus.classList.remove('connected');
            }
        });

        this.setupEventHandlers();
        this.setupVisibilityHandler();
    },

    disposePlayerCharacter(op) {
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
        if (op.nameObj) {
            if (op.nameObj.spriteMat) op.nameObj.spriteMat.dispose();
            if (op.nameObj.texture) op.nameObj.texture.dispose();
        }
    },

    setupEventHandlers() {
        this.socket.on('init', (data) => {
            this.myId = data.myId;
            this.currentHostId = data.hostId;
            this.currentRoomMode = data.currentMode;
            this.currentBattleStartTime = data.battleStartTime || 0;
            this.serverTimeOffset = (data.serverNow || Date.now()) - Date.now();

            for (let id in this.otherPlayers) {
                this.disposePlayerCharacter(this.otherPlayers[id]);
                delete this.otherPlayers[id];
            }

            resetStageToInitial();

            const myData = data.players[this.myId];
            if (myData && this.localPlayerRef) {
                this.localPlayerRef.onInitLocalPlayer(myData, this.currentRoomMode);
            }

            for (let id in data.players) {
                if (id !== this.myId) this.addOtherPlayer(data.players[id]);
            }
            this.updateHostButtonUI();
        });

        this.socket.on('roomStateUpdate', (data) => {
            this.currentHostId = data.hostId;
            this.currentRoomMode = data.currentMode;
            this.updateHostButtonUI(data.playerCount);
        });

        this.socket.on('newPlayer', (playerData) => {
            if (playerData.id !== this.myId) {
                if (this.otherPlayers[playerData.id]) {
                    this.disposePlayerCharacter(this.otherPlayers[playerData.id]);
                    delete this.otherPlayers[playerData.id];
                }
                this.addOtherPlayer(playerData);
            }
            this.updateHostButtonUI();
        });

        this.socket.on('playerRenamed', (data) => {
            if (data.id === this.myId && this.localPlayerRef) {
                this.localPlayerRef.onRenameLocalPlayer(data.name);
            } else if (this.otherPlayers[data.id]) {
                updateNameSpriteName(this.otherPlayers[data.id].nameObj, data.name);
            }
        });

        this.socket.on('playerMoved', (data) => {
            const p = this.otherPlayers[data.id];
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

        this.socket.on('battleStarted', (data) => {
            this.currentRoomMode = 'stock_battle';
            this.currentBattleStartTime = data.battleStartTime || Date.now();
            this.serverTimeOffset = (data.serverNow || Date.now()) - Date.now();

            resetStageToInitial();

            if (this.localPlayerRef) {
                this.localPlayerRef.onBattleStartedLocalPlayer(data.players[this.myId]);
            }

            for (let id in data.players) {
                if (id !== this.myId && this.otherPlayers[id]) {
                    const op = this.otherPlayers[id];
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
                    op.fallReportedAt = 0;
                    updateNameSpriteDamage(op.nameObj, 0);
                    updateNameSpriteStock(op.nameObj, 3);
                    setCharacterGhostMode(op.charObj, false);
                }
            }

            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal) settingsModal.style.display = 'none';

            this.updateHostButtonUI();
            this.startCountdownSequence();
        });

        this.socket.on('stockUpdated', (data) => {
            if (data.id === this.myId && this.localPlayerRef) {
                this.localPlayerRef.onStockUpdatedLocalPlayer(data.stock);
            } else if (this.otherPlayers[data.id]) {
                this.otherPlayers[data.id].stock = data.stock;
                updateNameSpriteStock(this.otherPlayers[data.id].nameObj, data.stock);
            }
        });

        this.socket.on('playerEliminated', (data) => {
            if (data.id === this.myId && this.localPlayerRef) {
                this.localPlayerRef.onEliminatedLocalPlayer();
            } else if (this.otherPlayers[data.id]) {
                const op = this.otherPlayers[data.id];
                op.isEliminated = true;
                op.mesh.visible = false;
            }
        });

        this.socket.on('battleFinished', (data) => {
            this.currentRoomMode = 'free';
            this.currentBattleStartTime = 0;
            this.updateHostButtonUI();

            resetStageToInitial();

            if (this.localPlayerRef) {
                this.localPlayerRef.onBattleFinishedLocalPlayer();
            }

            for (let id in this.otherPlayers) {
                const op = this.otherPlayers[id];
                op.isEliminated = false;
                op.mesh.visible = true;
                op.invincibleTimer = 0;
                op.hasReportedFall = false;
                op.fallReportedAt = 0;
                updateNameSpriteStock(op.nameObj, null);
                updateNameSpriteDamage(op.nameObj, 0);
                setCharacterGhostMode(op.charObj, false);
            }

            this.showResultModal(data);
        });

        this.socket.on('playerKnocked', (data) => {
            if (data.targetId === this.myId && this.localPlayerRef) {
                this.localPlayerRef.onKnockedLocalPlayer(data);
            } else if (this.otherPlayers[data.targetId]) {
                const op = this.otherPlayers[data.targetId];
                if (op.isEliminated) return;

                op.damage = data.newDamage;
                updateNameSpriteDamage(op.nameObj, op.damage);

                op.kbVX = data.dirX * data.force;
                op.kbVZ = data.dirZ * data.force;
                op.kbVY = 8.5 + (op.damage / 80.0) * 4.0;
                op.isKnockedOut = true;
                op.isOnGround = false;
                op.isAttacker = (data.attackerId === this.myId);
                op.hasReportedSettlement = false;
                op.hasReportedFall = false;
                op.fallReportedAt = 0;
            }
        });

        this.socket.on('shockwaveSpawned', (data) => {
            if (document.hidden) return;
            if (Date.now() < this.ignoreEffectsUntilTimestamp) return;
            if (data.timestamp && (Date.now() - data.timestamp > 800)) return;
            createShockwaveEffect(data.x, data.y, data.z);
        });

        this.socket.on('playerForceRespawned', (data) => {
            if (data.id === this.myId && this.localPlayerRef) {
                this.localPlayerRef.onForceRespawnedLocalPlayer(data);
            } else if (this.otherPlayers[data.id]) {
                const op = this.otherPlayers[data.id];
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
                op.fallReportedAt = 0;

                if (!data.isEliminated && !op.isEliminated) {
                    op.invincibleTimer = 2.0;
                } else {
                    op.invincibleTimer = 0;
                    op.mesh.visible = false;
                }
            }
        });

        this.socket.on('playerDamageReset', (data) => {
            if (data.id === this.myId && this.localPlayerRef) {
                this.localPlayerRef.onDamageResetLocalPlayer();
            } else if (this.otherPlayers[data.id]) {
                this.otherPlayers[data.id].damage = 0;
                if (!this.otherPlayers[data.id].isEliminated) this.otherPlayers[data.id].invincibleTimer = 2.0;
                updateNameSpriteDamage(this.otherPlayers[data.id].nameObj, 0);
            }
        });

        this.socket.on('syncSelf', (serverData) => {
            if (this.localPlayerRef) {
                this.localPlayerRef.onSyncSelf(serverData);
            }
        });

        this.socket.on('playerDisconnected', (id) => {
            if (this.otherPlayers[id]) {
                this.disposePlayerCharacter(this.otherPlayers[id]);
                delete this.otherPlayers[id];
            }
            this.updateHostButtonUI();
        });
    },

    setupVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.ignoreEffectsUntilTimestamp = Date.now() + 350;
                if (this.socket.connected) this.socket.emit('requestSync');
            }
        });
    },

    updateHostButtonUI(playerCount = null) {
        const hostBtn = document.getElementById('host-battle-btn');
        if (!hostBtn) return;

        const isHost = (this.myId && this.myId === this.currentHostId);
        if (!isHost) {
            hostBtn.style.display = 'none';
            return;
        }

        hostBtn.style.display = 'block';

        if (this.currentRoomMode === 'stock_battle') {
            hostBtn.textContent = 'ストック制バトルを終了';
            hostBtn.className = 'stop-mode';
            hostBtn.disabled = false;
        } else {
            hostBtn.textContent = 'ストック制バトルを開始';
            hostBtn.className = 'start-mode';

            const count = (playerCount !== null) ? playerCount : (Object.keys(this.otherPlayers).length + 1);
            hostBtn.disabled = (count < 2);
        }
    },

    addOtherPlayer(data) {
        const isBattle = (this.currentRoomMode === 'stock_battle');
        const charStock = isBattle ? (data.stock !== undefined ? data.stock : 3) : null;
        const char = createCharacterMesh(data.color || 0xff3366, data.name || 'Player', data.damage || 0, charStock);
        char.mesh.position.set(data.x, data.y, data.z);
        char.mesh.rotation.y = data.rotationY || 0;
        scene.add(char.mesh);

        const isElim = !!data.isEliminated;
        if (isElim) {
            char.mesh.visible = false;
        }

        this.otherPlayers[data.id] = {
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
            fallReportedAt: 0,
            invincibleTimer: 0,
            lastPacketTime: Date.now()
        };
    },

    startCountdownSequence() {
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

        setTimeout(() => { playCountNumber('2', '#ff8800'); }, 1000);
        setTimeout(() => { playCountNumber('1', '#ffcc00'); }, 2000);
        setTimeout(() => {
            if (announceBanner) announceBanner.style.display = 'none';
            playCountNumber('GO!', '#00ff88');
            Controls.isCountdownActive = false;
        }, 3000);
        setTimeout(() => {
            overlay.style.display = 'none';
            overlay.classList.remove('countdown-animate');
        }, 4000);
    },

    showResultModal(data) {
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
    },

    updateOtherPlayersPhysics(delta, nowMs, time) {
        for (let id in this.otherPlayers) {
            const op = this.otherPlayers[id];

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

            const canReportNormal = !op.hasReportedFall || (nowMs - (op.fallReportedAt || 0) > 1500);
            if (!op.isKnockedOut && (nowMs - op.lastPacketTime > 400) && op.targetY > opFloorY) {
                op.targetY += -26.0 * delta;
                if (op.targetY <= opFloorY) {
                    op.targetY = opFloorY;
                    op.isOnGround = true;
                } else {
                    op.isOnGround = false;
                }

                if (op.targetY < -25 && canReportNormal) {
                    op.hasReportedFall = true;
                    op.fallReportedAt = nowMs;
                    this.socket.emit('targetFellOut', { targetId: id });
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

                op.kbVY += -26.0 * delta;
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
                            this.socket.emit('updateTargetPosition', {
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

                const canReportKnock = !op.hasReportedFall || (nowMs - (op.fallReportedAt || 0) > 1500);
                if (op.targetY < -25 && canReportKnock && (nowMs - op.lastPacketTime > 600)) {
                    op.hasReportedFall = true;
                    op.fallReportedAt = nowMs;
                    op.isKnockedOut = false;
                    op.kbVX = 0;
                    op.kbVY = 0;
                    op.kbVZ = 0;
                    this.socket.emit('targetFellOut', { targetId: id });
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
    }
};