// =======================================================
// モジュール: 3D空間・ステージ・動的縮小・ブロック物理管理
// =======================================================

// --- 1. シーン・カメラ・レンダラーの設定 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 120);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- 2. ライトの設定 ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(30, 50, 30);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

// --- 3. ステージ（浮島ステージ初期60x60） ---
const DEFAULT_STAGE_SIZE = 60.0;
let stageSize = DEFAULT_STAGE_SIZE;
let halfStage = stageSize / 2; // 30m
let isStageCompletelyGone = false; // 【新機能】完全消滅フラグ

const floorGeo = new THREE.BoxGeometry(DEFAULT_STAGE_SIZE, 2, DEFAULT_STAGE_SIZE);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x55aa55 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.position.y = -1;
floor.receiveShadow = true;
scene.add(floor);

const cliffGeo = new THREE.BoxGeometry(DEFAULT_STAGE_SIZE - 2, 10, DEFAULT_STAGE_SIZE - 2);
const cliffMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
const cliff = new THREE.Mesh(cliffGeo, cliffMat);
cliff.position.y = -7;
scene.add(cliff);

// 障害物データ管理配列
const obstacles = [];
const dynamicBlockObjects = [];

const boxGeo = new THREE.BoxGeometry(2, 2, 2);

function setupInitialBlocks() {
    dynamicBlockObjects.forEach(b => {
        if (b.mesh) scene.remove(b.mesh);
    });
    dynamicBlockObjects.length = 0;
    obstacles.length = 0;

    let seed = 12345;
    function seededRandom() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    }

    for (let i = 0; i < 35; i++) {
        const boxMat = new THREE.MeshStandardMaterial({
            color: Math.floor(seededRandom() * 0xffffff)
        });
        const box = new THREE.Mesh(boxGeo, boxMat);
        const bx = (seededRandom() - 0.5) * 44;
        const bz = (seededRandom() - 0.5) * 44;
        const by = 1;

        box.position.set(bx, by, bz);
        box.castShadow = true;
        box.receiveShadow = true;
        scene.add(box);

        const obsData = {
            minX: bx - 1,
            maxX: bx + 1,
            minY: by - 1,
            maxY: by + 1,
            minZ: bz - 1,
            maxZ: bz + 1,
            blockRef: null
        };
        obstacles.push(obsData);

        const blockObj = {
            mesh: box,
            x: bx,
            y: by,
            z: bz,
            origX: bx,
            origY: by,
            origZ: bz,
            isFalling: false,
            vy: 0,
            isDestroyed: false,
            obsData: obsData
        };
        obsData.blockRef = blockObj;
        dynamicBlockObjects.push(blockObj);
    }
}
setupInitialBlocks();

function resetStageToInitial() {
    stageSize = DEFAULT_STAGE_SIZE;
    halfStage = stageSize / 2;
    isStageCompletelyGone = false; // フラグ解除

    floor.scale.set(1, 1, 1);
    floor.visible = true;
    cliff.scale.set(1, 1, 1);
    cliff.visible = true;

    setupInitialBlocks();
}

// ステージ動的縮小 ＆ ブロック物理落下の更新
function updateStageShrinkAndPhysics(elapsedSeconds, delta) {
    if (elapsedSeconds >= 180) {
        const shrinkProgress = Math.min(1.0, (elapsedSeconds - 180) / 180.0); // 0.0 -> 1.0
        stageSize = DEFAULT_STAGE_SIZE * (1.0 - shrinkProgress);
        halfStage = stageSize / 2;

        const scaleRatio = Math.max(0.0001, 1.0 - shrinkProgress);
        floor.scale.set(scaleRatio, 1, scaleRatio);
        cliff.scale.set(scaleRatio, 1, scaleRatio);

        // 【重要】360秒経過して完全消滅した場合、足場判定を物理的にもゼロにする
        if (shrinkProgress >= 1.0) {
            stageSize = 0;
            halfStage = 0;
            isStageCompletelyGone = true;
            floor.visible = false;
            cliff.visible = false;
        } else {
            isStageCompletelyGone = false;
        }
    } else {
        isStageCompletelyGone = false;
    }

    const blockGravity = -26.0;
    for (let b of dynamicBlockObjects) {
        if (b.isDestroyed) continue;

        if (!b.isFalling) {
            // ステージが完全消滅したか、重心が外にはみ出たら落下
            if (isStageCompletelyGone || Math.abs(b.x) > halfStage || Math.abs(b.z) > halfStage) {
                b.isFalling = true;
            }
        }

        if (b.isFalling) {
            b.vy += blockGravity * delta;
            b.y += b.vy * delta;
            b.mesh.position.y = b.y;

            if (b.obsData) {
                b.obsData.minY = b.y - 1;
                b.obsData.maxY = b.y + 1;
            }

            if (b.y < -25) {
                b.isDestroyed = true;
                scene.remove(b.mesh);
                const obsIdx = obstacles.indexOf(b.obsData);
                if (obsIdx !== -1) obstacles.splice(obsIdx, 1);
            }
        }
    }
}

// --- 4. リーチ予測ガイド ---
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

// --- 5. 半球衝撃波エフェクトプール ---
const activeShockwaves = [];
const domeGeo = new THREE.SphereGeometry(1.0, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
const ringGeo = new THREE.RingGeometry(0.92, 1.0, 40);
ringGeo.rotateX(-Math.PI / 2);

function createShockwaveEffect(x, y, z) {
    const shockGroup = new THREE.Group();
    shockGroup.position.set(x, y + 0.02, z);

    const domeMat = new THREE.MeshBasicMaterial({
        color: 0x00d4ff,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    shockGroup.add(domeMesh);

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
        expandDuration: 0.18,
        lingerDuration: 0.32
    });
}

function updateShockwaves(delta) {
    for (let i = activeShockwaves.length - 1; i >= 0; i--) {
        const sw = activeShockwaves[i];
        sw.time += delta;

        if (sw.time < sw.expandDuration) {
            const progress = sw.time / sw.expandDuration;
            const currentR = progress * 8.0;
            sw.group.scale.set(currentR, currentR, currentR);
            sw.domeMesh.material.opacity = 0.7 * (1.0 - progress * 0.3);
            sw.ringMesh.material.opacity = 0.95;
        } else if (sw.time < (sw.expandDuration + sw.lingerDuration)) {
            sw.group.scale.set(8.0, 8.0, 8.0);
            const lingerProgress = (sw.time - sw.expandDuration) / sw.lingerDuration;
            sw.domeMesh.material.opacity = Math.max(0, 0.45 * (1.0 - lingerProgress));
            sw.ringMesh.material.opacity = Math.max(0, 0.95 * (1.0 - lingerProgress));
        } else {
            scene.remove(sw.group);
            activeShockwaves.splice(i, 1);
        }
    }
}