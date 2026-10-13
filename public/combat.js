// =======================================================
// モジュール: 物理衝突・壁バウンド・攻撃＆スキル判定
// =======================================================

const PLAYER_RADIUS = 0.45;
const PLAYER_HEIGHT = 1.9;

// --- 1. 障害物＆動的絶壁コライダー衝突判定 ---
function checkObstacleCollision(px, py, pz) {
    for (let obs of obstacles) {
        const collideX = px + PLAYER_RADIUS > obs.minX && px - PLAYER_RADIUS < obs.maxX;
        const collideZ = pz + PLAYER_RADIUS > obs.minZ && pz - PLAYER_RADIUS < obs.maxZ;
        const collideY = py < (obs.maxY - 0.05) && (py + PLAYER_HEIGHT) > obs.minY;

        if (collideX && collideZ && collideY) return obs;
    }

    if (py < 0 && py > -25) {
        const inCliffX = px + PLAYER_RADIUS > -halfStage && px - PLAYER_RADIUS < halfStage;
        const inCliffZ = pz + PLAYER_RADIUS > -halfStage && pz - PLAYER_RADIUS < halfStage;
        if (inCliffX && inCliffZ) return { isCliff: true };
    }
    return null;
}

function unstickFromObstacles(pos) {
    for (let obs of obstacles) {
        const collideX = pos.x + PLAYER_RADIUS > obs.minX && pos.x - PLAYER_RADIUS < obs.maxX;
        const collideZ = pos.z + PLAYER_RADIUS > obs.minZ && pos.z - PLAYER_RADIUS < obs.maxZ;
        const collideY = pos.y < (obs.maxY - 0.05) && (pos.y + PLAYER_HEIGHT) > obs.minY;

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

function resolvePlayerCollisions(myPos, otherPlayers, velocity, myIsEliminated = false) {
    if (myIsEliminated) return;

    const minDist = PLAYER_RADIUS * 2;

    for (let id in otherPlayers) {
        const op = otherPlayers[id];
        if (op.isEliminated) continue;

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

function checkPunchHit(myPos, rotY, currentChargeLevel, otherPlayers, socket, myIsEliminated = false) {
    if (myIsEliminated) return;

    const punchReach = 2.4 + currentChargeLevel * 5.6;
    const forward = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)).normalize();

    for (let id in otherPlayers) {
        const op = otherPlayers[id];
        if (op.invincibleTimer > 0 || op.isEliminated) continue;

        const targetPos = new THREE.Vector3(op.targetX, op.targetY, op.targetZ);
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

function checkSpinSweepHit(myPos, rotY, spinChargeLevel, currentSpinRatio, otherPlayers, socket, hitTargetsThisSpin, myIsEliminated = false) {
    if (myIsEliminated) return;

    const spinReach = 2.4 + spinChargeLevel * 5.6;
    const currentTorsoY = 1.8 - currentSpinRatio * (Math.PI * 2);
    const currentArmAngle = rotY + currentTorsoY - Math.PI / 2;

    for (let id in otherPlayers) {
        if (hitTargetsThisSpin.has(id)) continue;

        const op = otherPlayers[id];
        if (op.invincibleTimer > 0 || op.isEliminated) continue;

        const targetPos = new THREE.Vector3(op.targetX, op.targetY, op.targetZ);
        const dist = myPos.distanceTo(targetPos);

        if (dist <= spinReach) {
            const dx = targetPos.x - myPos.x;
            const dz = targetPos.z - myPos.z;
            const targetAngle = Math.atan2(dx, dz);

            // 【重大度I改善】Math.atan2を用いた完全な角度差正規化（無限カメラ回転時の破綻を防止）
            const rawDiff = targetAngle - currentArmAngle;
            const angleDiff = Math.atan2(Math.sin(rawDiff), Math.cos(rawDiff));

            if (Math.abs(angleDiff) < 0.65 || currentSpinRatio > 0.85) {
                hitTargetsThisSpin.add(id);

                const baseDmg = 15 + Math.floor(Math.random() * 5);
                const finalDamage = Math.round(baseDmg * (1.0 + spinChargeLevel * 0.4));

                const targetDamage = op.damage || 0;
                const damageScaling = 1.0 + (targetDamage / 80.0) * 1.5;
                const chargeMult = 1.0 + spinChargeLevel * 0.4;
                const finalForce = 18.75 * damageScaling * chargeMult;

                const pushDist = Math.hypot(dx, dz);
                const pushDirX = pushDist > 0.001 ? dx / pushDist : Math.sin(rotY);
                const pushDirZ = pushDist > 0.001 ? dz / pushDist : Math.cos(rotY);

                socket.emit('punchHit', {
                    targetId: id,
                    dirX: pushDirX,
                    dirZ: pushDirZ,
                    force: finalForce,
                    damageDealt: finalDamage
                });
            }
        }
    }
}

function triggerShockwaveExplosion(myPos, otherPlayers, socket, myIsEliminated = false) {
    if (myIsEliminated) return;

    createShockwaveEffect(myPos.x, myPos.y, myPos.z);
    socket.emit('spawnShockwave', { x: myPos.x, y: myPos.y, z: myPos.z });

    const radius = 8.0;

    for (let id in otherPlayers) {
        const op = otherPlayers[id];
        if (op.invincibleTimer > 0 || op.isEliminated) continue;

        const targetPos = new THREE.Vector3(op.targetX, op.targetY, op.targetZ);
        const dist3D = myPos.distanceTo(targetPos);

        if (dist3D <= radius) {
            const baseDmg = 15 + Math.floor(Math.random() * 5);
            const finalDamage = Math.round(baseDmg * 1.4);

            const targetDamage = op.damage || 0;
            const damageScaling = 1.0 + (targetDamage / 80.0) * 1.5;
            const finalForce = 18.75 * damageScaling * 1.4;

            // 【重大度J改善】水平方向のみで正規化し、高低差による吹っ飛び威力減衰を完全に解消
            const hx = targetPos.x - myPos.x;
            const hz = targetPos.z - myPos.z;
            const hDist = Math.hypot(hx, hz);

            let pushDirX, pushDirZ;
            if (hDist > 0.05) {
                pushDirX = hx / hDist;
                pushDirZ = hz / hDist;
            } else {
                const randAngle = Math.random() * Math.PI * 2;
                pushDirX = Math.sin(randAngle);
                pushDirZ = Math.cos(randAngle);
            }

            socket.emit('punchHit', {
                targetId: id,
                dirX: pushDirX,
                dirZ: pushDirZ,
                force: finalForce,
                damageDealt: finalDamage
            });
        }
    }
}