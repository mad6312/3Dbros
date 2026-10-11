// =======================================================
// モジュール: 3D空間・ステージ・障害物・エフェクト管理
// =======================================================

// --- 1. シーン・カメラ・レンダラーの設定 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // スカイブルーの空
scene.fog = new THREE.Fog(0x87ceeb, 30, 120);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// ウィンドウリサイズ対応
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

// --- 3. ステージ（浮島ステージ 60x60） ---
const stageSize = 60;
const halfStage = stageSize / 2; // 30m

// 地面の足場（上面が y = 0）
const floorGeo = new THREE.BoxGeometry(stageSize, 2, stageSize);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x55aa55 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.position.y = -1;
floor.receiveShadow = true;
scene.add(floor);

// 浮島の土台（崖）
const cliffGeo = new THREE.BoxGeometry(stageSize - 2, 10, stageSize - 2);
const cliffMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
const cliff = new THREE.Mesh(cliffGeo, cliffMat);
cliff.position.y = -7;
scene.add(cliff);

// シード固定乱数による全プレイヤー完全共通の障害物配置
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

// --- 4. リーチ予測ガイドの生成 ---
// パンチ直線ガイド（赤色）
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

// 回転斬り360度円形ガイド（青色）
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