// =======================================================
// モジュール1: キャラクター・ハート残ストック・ゴースト化
// =======================================================

function drawSafeRoundRect(ctx, x, y, width, height, radius) {
    if (ctx.roundRect) {
        ctx.roundRect(x, y, width, height, radius);
    } else {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }
}

// 頭上のネーム・ダメージ・残ストック表示スプライト
function createNameSprite(nameText, damage = 0, stock = null) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.4, 1.12, 1);
    sprite.position.y = 2.45;

    const nameObj = {
        sprite,
        spriteMat,
        texture,
        canvas,
        ctx,
        currentName: nameText,
        currentDamage: damage,
        currentStock: (stock !== null && stock !== undefined) ? Number(stock) : null
    };
    renderNameSprite(nameObj);
    return nameObj;
}

// ネームタグ描画
function renderNameSprite(nameObj) {
    const ctx = nameObj.ctx;
    ctx.clearRect(0, 0, 256, 120);

    const isBattle = (nameObj.currentStock !== null && nameObj.currentStock !== undefined);

    // 背景プレート
    ctx.fillStyle = 'rgba(10, 15, 25, 0.78)';
    ctx.beginPath();
    drawSafeRoundRect(ctx, 8, 6, 240, 108, 12);
    ctx.fill();

    let nameY = 40;
    let dmgY = 82;

    // ストック制バトル中：最上段にハートマークを表示
    if (isBattle) {
        let heartStr = '♡♡♡';
        const st = Number(nameObj.currentStock);
        if (st >= 3) heartStr = '♥♥♥';
        else if (st === 2) heartStr = '♥♥♡';
        else if (st === 1) heartStr = '♥♡♡';

        ctx.font = 'bold 22px sans-serif';
        ctx.fillStyle = '#ff3366';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(heartStr, 128, 25);

        nameY = 55;
        dmgY = 92;
    }

    // 【項目9改善】プレイヤーネーム（全角12文字でもプレートからはみ出さない自動縮小フィット）
    const maxNameWidth = 220;
    let fontSize = 22;
    ctx.font = `bold ${fontSize}px sans-serif`;
    let measured = ctx.measureText(nameObj.currentName).width;

    while (measured > maxNameWidth && fontSize > 13) {
        fontSize -= 1;
        ctx.font = `bold ${fontSize}px sans-serif`;
        measured = ctx.measureText(nameObj.currentName).width;
    }

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(nameObj.currentName, 128, nameY);

    // 蓄積ダメージ（%）
    const dmg = Math.round(nameObj.currentDamage);
    let dmgColor = '#ffffff';
    if (dmg >= 100) dmgColor = '#ff3344';
    else if (dmg >= 50) dmgColor = '#ffcc00';

    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = dmgColor;
    ctx.fillText(`${dmg}%`, 128, dmgY);

    nameObj.texture.needsUpdate = true;
}

function updateNameSpriteName(nameObj, newName) {
    nameObj.currentName = newName;
    renderNameSprite(nameObj);
}

function updateNameSpriteDamage(nameObj, newDamage) {
    nameObj.currentDamage = newDamage;
    renderNameSprite(nameObj);
}

function updateNameSpriteStock(nameObj, newStock) {
    if (!nameObj) return;
    nameObj.currentStock = (newStock !== null && newStock !== undefined) ? Number(newStock) : null;
    renderNameSprite(nameObj);
}

// キャラクターモデル作成
function createCharacterMesh(colorHex, nameText, damage = 0, stock = null) {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffcc88 });
    const limbMat = new THREE.MeshStandardMaterial({ color: 0x2244aa });

    const torsoGroup = new THREE.Group();
    torsoGroup.position.y = 0;
    group.add(torsoGroup);

    // 胴体
    const bodyGeo = new THREE.BoxGeometry(0.65, 0.75, 0.35);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    torsoGroup.add(body);

    // 頭
    const headGeo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.62;
    head.castShadow = true;
    torsoGroup.add(head);

    // 目
    const eyeGeo = new THREE.BoxGeometry(0.28, 0.08, 0.08);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const eyes = new THREE.Mesh(eyeGeo, eyeMat);
    eyes.position.set(0, 1.62, 0.23);
    torsoGroup.add(eyes);

    const legGeo = new THREE.BoxGeometry(0.22, 0.65, 0.22);
    const leftArmGeo = new THREE.BoxGeometry(0.18, 0.6, 0.18);

    // 左腕
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.42, 1.3, 0);
    const leftArm = new THREE.Mesh(leftArmGeo, limbMat);
    leftArm.position.y = -0.3;
    leftArm.castShadow = true;
    leftArmPivot.add(leftArm);
    torsoGroup.add(leftArmPivot);

    // 右腕
    const rightArmGeo = new THREE.BoxGeometry(0.2, 1.0, 0.2);
    rightArmGeo.translate(0, -0.5, 0);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.42, 1.3, 0);
    const rightArm = new THREE.Mesh(rightArmGeo, limbMat);
    rightArm.scale.set(1.0, 0.6, 1.0);
    rightArm.castShadow = true;
    rightArmPivot.add(rightArm);
    torsoGroup.add(rightArmPivot);

    // 脚
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.2, 0.65, 0);
    const leftLeg = new THREE.Mesh(legGeo, limbMat);
    leftLeg.position.y = -0.325;
    leftLeg.castShadow = true;
    leftLegPivot.add(leftLeg);
    group.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.2, 0.65, 0);
    const rightLeg = new THREE.Mesh(legGeo, limbMat);
    rightLeg.position.y = -0.325;
    rightLeg.castShadow = true;
    rightLegPivot.add(rightLeg);
    group.add(rightLegPivot);

    const nameObj = createNameSprite(nameText, damage, stock);
    group.add(nameObj.sprite);

    const allMeshes = [body, head, eyes, leftArm, rightArm, leftLeg, rightLeg];

    return {
        mesh: group,
        bodyMesh: body,
        torsoGroup,
        leftArmPivot,
        rightArmPivot,
        rightArm,
        leftLegPivot,
        rightLegPivot,
        nameObj,
        allMeshes
    };
}

// 脱落プレイヤーの半透明ゴースト化
function setCharacterGhostMode(char, isGhost) {
    if (!char || !char.allMeshes) return;

    char.allMeshes.forEach(mesh => {
        if (mesh && mesh.material) {
            mesh.material.transparent = isGhost;
            mesh.material.opacity = isGhost ? 0.35 : 1.0;
        }
    });

    if (char.nameObj && char.nameObj.sprite && char.nameObj.sprite.material) {
        char.nameObj.sprite.material.opacity = isGhost ? 0.4 : 1.0;
    }
}

// モーション更新
function updateCharacterMotion(char, swingAngle, isOnGround, punchRatio = 0, chargeLevel = 0, isSpinAttack = false, spinRatio = 0, isHoldingSpin = false, holdingCharge = 0, isDiving = false, diveRatio = 0) {
    if (!char || !char.torsoGroup) return;

    if (isDiving) {
        char.rightArm.scale.set(1.1, 0.65, 1.1);

        if (diveRatio < 0.9) {
            char.torsoGroup.rotation.x = 0.6;
            char.torsoGroup.rotation.y = 0;
            char.torsoGroup.position.z = 0.1;

            char.rightArmPivot.rotation.x = -Math.PI / 1.3;
            char.rightArmPivot.rotation.y = -0.2;
            char.rightArmPivot.rotation.z = -0.2;

            char.leftArmPivot.rotation.x = 0.6;
            char.leftArmPivot.rotation.y = 0;
            char.leftArmPivot.rotation.z = 0.3;

            char.leftLegPivot.rotation.x = -0.6;
            char.rightLegPivot.rotation.x = -0.6;
        } else {
            char.torsoGroup.rotation.x = 0.8;
            char.torsoGroup.rotation.y = -0.3;
            char.torsoGroup.position.z = 0.2;

            char.rightArmPivot.rotation.x = -Math.PI / 1.1;
            char.leftArmPivot.rotation.x = 0.8;
            char.leftLegPivot.rotation.x = 0.5;
            char.rightLegPivot.rotation.x = -0.7;
        }
        return;
    } else {
        char.torsoGroup.rotation.x = 0;
    }

    if (isOnGround) {
        char.leftLegPivot.rotation.x = swingAngle;
        char.rightLegPivot.rotation.x = -swingAngle;
    } else {
        char.leftLegPivot.rotation.x = -0.4;
        char.rightLegPivot.rotation.x = 0.2;
    }

    if (isSpinAttack && spinRatio > 0) {
        const fullReach = 2.4 + chargeLevel * 5.6;
        const armLength = fullReach - 0.3;

        char.rightArm.scale.set(1.2, armLength, 1.2);
        char.rightArmPivot.rotation.x = -Math.PI / 2;
        char.rightArmPivot.rotation.y = 0;
        char.rightArmPivot.rotation.z = -Math.PI / 2;

        char.leftArmPivot.rotation.x = -Math.PI / 2;
        char.leftArmPivot.rotation.z = Math.PI / 2;

        const startAngle = 1.8;
        char.torsoGroup.rotation.y = startAngle - spinRatio * (Math.PI * 2);
        char.torsoGroup.position.z = 0;
        return;
    }

    if (isHoldingSpin) {
        char.rightArm.scale.set(1.0, 0.6, 1.0);
        const t = Math.min(1.0, holdingCharge);
        char.torsoGroup.rotation.y = 1.75 * t;
        char.torsoGroup.position.z = -0.22 * t;

        char.rightArmPivot.rotation.x = 0.6 * t;
        char.rightArmPivot.rotation.y = 0.8 * t;
        char.rightArmPivot.rotation.z = 0.9 * t;

        char.leftArmPivot.rotation.x = -1.1 * t;
        char.leftArmPivot.rotation.y = -0.4 * t;
        char.leftArmPivot.rotation.z = -0.5 * t;
        return;
    }

    if (punchRatio === 0) {
        char.rightArm.scale.set(1.0, 0.6, 1.0);
        char.torsoGroup.rotation.y = 0;
        char.torsoGroup.position.z = 0;

        if (isOnGround) {
            char.leftArmPivot.rotation.x = -swingAngle;
            char.rightArmPivot.rotation.x = swingAngle;
        } else {
            char.leftArmPivot.rotation.x = 0.5;
            char.rightArmPivot.rotation.x = -0.5;
        }
        char.leftArmPivot.rotation.y = 0;
        char.leftArmPivot.rotation.z = 0;
        char.rightArmPivot.rotation.y = 0;
        char.rightArmPivot.rotation.z = 0;
    } else {
        const fullReach = 2.4 + chargeLevel * 5.6;
        const maxArmLength = fullReach - 0.3;

        if (punchRatio < 0.38) {
            const t = punchRatio / 0.38;
            char.rightArm.scale.set(1.0, 0.6, 1.0);
            char.torsoGroup.rotation.y = 0.75 * t;
            char.torsoGroup.position.z = -0.18 * t;

            char.rightArmPivot.rotation.x = 0.9 * t;
            char.rightArmPivot.rotation.y = 0.4 * t;
            char.rightArmPivot.rotation.z = 0.6 * t;

            char.leftArmPivot.rotation.x = -0.9 * t;
            char.leftArmPivot.rotation.y = 0.3 * t;
            char.leftArmPivot.rotation.z = -0.3 * t;
        } else if (punchRatio < 0.78) {
            const t = (punchRatio - 0.38) / 0.40;
            let currentLen = 0.6;
            if (t < 0.2) currentLen = THREE.MathUtils.lerp(0.6, maxArmLength, t / 0.2);
            else if (t < 0.85) currentLen = maxArmLength;
            else currentLen = THREE.MathUtils.lerp(maxArmLength, 0.6, (t - 0.85) / 0.15);

            char.rightArm.scale.set(1.2, currentLen, 1.2);
            char.torsoGroup.rotation.y = THREE.MathUtils.lerp(0.75, -0.7, Math.min(1.0, t * 2.0));
            char.torsoGroup.position.z = 0.3;

            char.rightArmPivot.rotation.x = -Math.PI / 2;
            char.rightArmPivot.rotation.y = 0;
            char.rightArmPivot.rotation.z = 0;

            char.leftArmPivot.rotation.x = 0.5;
            char.leftArmPivot.rotation.y = 0;
            char.leftArmPivot.rotation.z = 0;
        } else {
            const t = (punchRatio - 0.78) / 0.22;
            char.rightArm.scale.set(1.0, 0.6, 1.0);
            char.torsoGroup.rotation.y = THREE.MathUtils.lerp(-0.7, 0, t);
            char.torsoGroup.position.z = 0.3;

            char.rightArmPivot.rotation.x = THREE.MathUtils.lerp(-Math.PI / 2, 0, t);
            char.rightArmPivot.rotation.y = 0;
            char.rightArmPivot.rotation.z = 0;

            char.leftArmPivot.rotation.x = THREE.MathUtils.lerp(0.5, 0, t);
            char.leftArmPivot.rotation.y = 0;
            char.leftArmPivot.rotation.z = 0;
        }
    }
}