// =======================================================
// モジュール: 物理衝突・壁バウンド・攻撃＆スキル判定
// =======================================================

// 全モジュール共通の体格定数
const PLAYER_RADIUS = 0.45;
const PLAYER_HEIGHT = 1.9;

// --- 1. 障害物＆絶壁コライダー衝突判定 ---
function checkObstacleCollision(px, py, pz) {
    // 1. 各ボックス障害物との当たり判定
    for (let obs of obstacles) {
        const collideX = px + PLAYER_RADIUS > obs.minX && px - PLAYER_RADIUS < obs.maxX;
        const collideZ = pz + PLAYER_RADIUS > obs.minZ && pz - PLAYER_RADIUS < obs.maxZ;
        const collideY = py < obs.maxY && (py + PLAYER_HEIGHT) > obs.minY;

        if (collideX && collideZ && collideY) return obs;
    }

    // 2. ステージ側面（崖の絶壁）の当たり判定
    if (py < 0 && py > -25) {
        const inCliffX = px + PLAYER_RADIUS > -halfStage && px - PLAYER_RADIUS < halfStage;
        const inCliffZ = pz + PLAYER_RADIUS > -halfStage && pz - PLAYER_RADIUS < halfStage;
        if (inCliffX && inCliffZ) return { isCliff: true };
    }
    return null;
}

// ブロックめり込み脱出救済処理
function unstickFromObstacles(pos) {
    for (let obs of obstacles) {
        const collideX = pos.x + PLAYER_RADIUS > obs.minX && pos.x - PLAYER_RADIUS < obs.maxX;
        const collideZ = pos.z + PLAYER_RADIUS > obs.minZ && pos.z - PLAYER_RADIUS < obs.maxZ;
        const collideY = pos.y < obs.maxY && (pos.y + PLAYER_HEIGHT) > obs.minY;

        if (collideX && collideZ && collideY) {
            const dLeft = Math.abs((pos.x + PLAYER_RADIUS) - obs.minX);
            const dRight = Math.abs(obs.maxX - (pos.x - PLAYER_RADIUS));
            const dBack = Math.abs((pos.z + PLAYER_RADIUS) - obs.minZ);
            const dFront = Math.abs(obs.maxZ - (pos.z - PLAYER_RADIUS));
            const minPush = Math.min(dLeft, dRight, dBack, dFront);

            if (minPush === dLeft) pos.x = obs.minX - PLAYER_RADIUS - 0.02;
            else if (minPush === dRight) pos.x = obs.maxX + PLAYER_RADIUS + 0.02;
            else if (minPush === dBack) pos.z = obs.minZ - PLAYER_RADIUS - 0.02;
            else if (minPush === dFront) pos.z = obs.maxZ + PLAYER_RADIUS + 0.02;
        }
    }
}

// 分割移動＆壁バウンド反発物理
function moveWithCollision(pos, vx, vz, delta, isKnocked = false) {
    const totalDist = Math.hypot(vx * delta, vz * delta);
    const steps = totalDist > 0.3 ? Math.ceil(totalDist / 0.25) : 1;
    const stepDelta = delta / steps;

    for (let i = 0; i < steps; i++) {
        const nextX = pos.x + vx * stepDelta;
        if (!checkObstacleCollision(nextX, pos.y, pos.z)) {
            pos.x = nextX;
        } else {
            if (isKnocked) vx = -vx * 0.8;
            else vx = 0;
        }

        const nextZ = pos.z + vz * stepDelta;
        if (!checkObstacleCollision(pos.x, pos.y, nextZ)) {
            pos.z = nextZ;
        } else {
            if (isKnocked) vz = -vz * 0.8;
            else vz = 0;
        }
    }

    unstickFromObstacles(pos);
    return { vx, vz };
}

// プレイヤー同士の押し合い判定
function resolvePlayerCollisions(myPos, otherPlayers, velocity) {
    const minDist = PLAYER_RADIUS * 2; // 0.9m

    for (let id in otherPlayers) {
        // 相手の実座標を取得
        const op = otherPlayers[id];
        const opPosX = (typeof op.targetX === 'number') ? op.targetX : op.mesh.position.x;
        const opPosY = (typeof op.targetY === 'number') ? op.targetY : op.mesh.position.y;
        const opPosZ = (typeof op.targetZ === 'number') ? op.targetZ : op.mesh.position.z;

        const yOverlap = Math.abs(myPos.y - opPosY) < PLAYER_HEIGHT;

        if (yOverlap) {
            const dx = myPos.x - opPosX;
            const dz = myPos.z - opPosZ;
            const distXZ = Math.hypot(dx, dz);

            if (distXZ < minDist && distXZ > 0.001) {
                const overlap = minDist - distXZ;
                const pushX = (dx / distXZ) * overlap;
                const pushZ = (dz / distXZ) * overlap;

                if (!checkObstacleCollision(myPos.x + pushX, myPos.y, myPos.z)) myPos.x += pushX;
                if (!checkObstacleCollision(myPos.x, myPos.y, myPos.z + pushZ)) myPos.z += pushZ;

                velocity.x *= 0.5;
                velocity.z *= 0.5;
            }
        }
    }
}

// --- 2. 攻撃＆スキル当たり判定ロジック ---

// 通常パンチ / 溜めパンチ判定（【実座標基準で判定】）
function checkPunchHit(myPos, rotY, currentChargeLevel, otherPlayers, socket) {
    const punchReach = 2.4 + currentChargeLevel * 5.6;
    const forward = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)).normalize();

    for (let id in otherPlayers) {
        const op = otherPlayers[id];
        if (op.invincibleTimer > 0) continue; // 無敵ガード

        // 描画メッシュではなく、サーバーから届いた最新の実座標で当たり判定を行う！
        const targetPos = new THREE.Vector3(op.targetX, op.targetY, op.targetZ);
        const dist = myPos.distanceTo(targetPos);

        if (dist < punchReach) {
            const toTarget = new THREE.Vector3().subVectors(targetPos, myPos).normalize();
            const dot = forward.dot(toTarget);

            if (dot > 0.35) {
                const baseDmg = 13 + Math.floor(Math.random() * 5); // 13〜17
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

// 回転斬り判定（【実座標基準で判定】）
function checkSpinSweepHit(myPos, rotY, spinChargeLevel, currentSpinRatio, otherPlayers, socket, hitTargetsThisSpin) {
    const spinReach = 2.4 + spinChargeLevel * 5.6;
    const currentTorsoY = 1.8 - currentSpinRatio * (Math.PI * 2);
    const currentArmAngle = rotY + currentTorsoY - Math.PI / 2;

    for (let id in otherPlayers) {
        if (hitTargetsThisSpin.has(id)) continue;

        const op = otherPlayers[id];
        if (op.invincibleTimer > 0) continue;

        const targetPos = new THREE.Vector3(op.targetX, op.targetY, op.targetZ);
        const dist = myPos.distanceTo(targetPos);

        if (dist <= spinReach) {
            const dx = targetPos.x - myPos.x;
            const dz = targetPos.z - myPos.z;
            const targetAngle = Math.atan2(dx, dz);

            let angleDiff = (targetAngle - currentArmAngle + Math.PI * 3) % (Math.PI * 2) - Math.PI;

            if (Math.abs(angleDiff) < 0.65 || currentSpinRatio > 0.85) {
                hitTargetsThisSpin.add(id);

                const baseDmg = 15 + Math.floor(Math.random() * 5); // 15〜19
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
}

// ドラゴンダイブ衝撃波判定（【実座標基準で判定】）
function triggerShockwaveExplosion(myPos, otherPlayers, socket) {
    createShockwaveEffect(myPos.x, myPos.y, myPos.z);
    socket.emit('spawnShockwave', { x: myPos.x, y: myPos.y, z: myPos.z });

    const radius = 8.0;

    for (let id in otherPlayers) {
        const op = otherPlayers[id];
        if (op.invincibleTimer > 0) continue;

        const targetPos = new THREE.Vector3(op.targetX, op.targetY, op.targetZ);
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