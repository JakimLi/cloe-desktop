import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// ==================== Config ====================
// Default VRM model (local file, place .vrm in models/ directory)
// ==================== Config ====================
// Local VRM models (downloaded) - tried in order
const LOCAL_VRM_MODELS = [
  'Rose.vrm',       // 100Avatars CC0 - female
  'vipe_hero_1.vrm' // VIPE Heroes CC-BY
];

// Fallback remote model
const FALLBACK_VRM_URL =
  'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';

// WebSocket port for Hermes integration
const WS_PORT = 19850;

// ==================== Renderer Setup ====================
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();

// Camera - portrait style, focus on upper body
const camera = new THREE.PerspectiveCamera(
  25,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 1.3, 3.5);
camera.lookAt(0, 1.0, 0);

// Lighting
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(1, 2, 3);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
fillLight.position.set(-1, 1, -1);
scene.add(fillLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

// ==================== VRM Model ====================
let vrm = null;
const clock = new THREE.Clock();

async function loadVRM(url) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  try {
    const gltf = await loader.loadAsync(url);
    const loaded = gltf.userData.vrm;

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.removeUnnecessaryJoints(gltf.scene);

    scene.add(loaded.scene);
    loaded.scene.rotation.y = Math.PI; // face camera

    vrm = loaded;
    document.getElementById('loading').classList.add('hidden');
    console.log('VRM loaded successfully');
    return true;
  } catch (err) {
    console.error('Failed to load VRM:', err);
    document.getElementById('loading').textContent = 'Failed to load VRM: ' + err.message;
    return false;
  }
}

// Load model - try local models first, then fallback
async function loadModel() {
  for (const name of LOCAL_VRM_MODELS) {
    try {
      const ok = await loadVRM(`/models/${name}`);
      if (ok) {
        console.log(`Loaded local VRM: ${name}`);
        return;
      }
    } catch (e) {
      console.log(`Failed to load ${name}, trying next...`);
    }
  }
  console.log('No local VRM found, trying fallback remote...');
  await loadVRM(FALLBACK_VRM_URL);
}

loadModel();

// ==================== Animation State ====================
let blinkTimer = Math.random() * 3;
let breathPhase = 0;
let currentExpression = null;
let expressionTimer = 0;
let actionQueue = [];
let currentAction = null;

// ==================== Expression System ====================
function setExpression(name) {
  if (!vrm?.expressionManager) return;

  // VRM expression names vary. Try common presets.
  const allPresets = vrm.expressionManager.expressions?.map(e => e.name) || [];
  const targetName = findBestExpression(name, allPresets);

  // Reset custom expressions, keep blink
  vrm.expressionManager.expressions?.forEach((expr) => {
    if (!expr.name.includes('blink')) {
      expr.setValue(0);
    }
  });

  if (targetName) {
    const expr = vrm.expressionManager.getExpression(targetName);
    if (expr) expr.setValue(1.0);
  }

  if (name && name !== 'neutral') {
    currentExpression = name;
    expressionTimer = 3.0;
  } else {
    currentExpression = null;
    expressionTimer = 0;
  }
}

function findBestExpression(target, available) {
  if (available.includes(target)) return target;
  // Fallback mappings
  const map = {
    happy: ['happy', 'smile', 'joy'],
    angry: ['angry', 'annoyed'],
    sad: ['sad', 'sorrow'],
    relaxed: ['relaxed', 'neutral'],
    surprised: ['surprised'],
    neutral: ['neutral', 'default'],
    fun: ['happy', 'smile', 'joy'],
    approve: ['happy', 'smile', 'nod'],
    think: ['surprised', 'neutral'],
  };
  const candidates = map[target] || [target];
  for (const c of candidates) {
    if (available.includes(c)) return c;
  }
  return null;
}

// ==================== Head Animations ====================
function getBone(name) {
  return vrm?.humanoid?.getNormalizedBoneNode(name);
}

function animateShakeHead(duration = 1.5) {
  if (!vrm) return;
  const head = getBone('head');
  if (!head) return;

  setExpression('sad');
  const startTime = clock.getElapsedTime();
  const origRotY = 0;

  currentAction = {
    update: () => {
      const t = clock.getElapsedTime() - startTime;
      if (t > duration) {
        head.rotation.y = origRotY;
        setExpression('neutral');
        currentAction = null;
        return;
      }
      // Shake 4 times
      const freq = 8 / duration;
      head.rotation.y = origRotY + Math.sin(t * Math.PI * freq) * 0.25;
    },
  };
}

function animateNod(duration = 1.0) {
  if (!vrm) return;
  const head = getBone('head');
  if (!head) return;

  setExpression('happy');
  const startTime = clock.getElapsedTime();

  currentAction = {
    update: () => {
      const t = clock.getElapsedTime() - startTime;
      if (t > duration) {
        head.rotation.x = 0;
        setExpression('neutral');
        currentAction = null;
        return;
      }
      // Nod 3 times
      const freq = 6 / duration;
      head.rotation.x = Math.max(0, Math.sin(t * Math.PI * freq)) * 0.2;
    },
  };
}

function animateWave(duration = 1.5) {
  if (!vrm) return;
  const rightUpperArm = getBone('rightUpperArm');
  const rightLowerArm = getBone('rightLowerArm');
  if (!rightUpperArm) return;

  setExpression('happy');
  const startTime = clock.getElapsedTime();

  currentAction = {
    update: () => {
      const t = clock.getElapsedTime() - startTime;
      if (t > duration) {
        rightUpperArm.rotation.z = 0;
        rightUpperArm.rotation.x = 0;
        if (rightLowerArm) rightLowerArm.rotation.x = 0;
        setExpression('neutral');
        currentAction = null;
        return;
      }
      // Raise arm and wave
      rightUpperArm.rotation.z = -1.2;
      rightUpperArm.rotation.x = -0.3;
      if (rightLowerArm) {
        rightLowerArm.rotation.x = -Math.sin(t * 10) * 0.3;
      }
    },
  };
}

// ==================== Animation Loop ====================
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const time = clock.getElapsedTime();

  if (vrm) {
    // Breathing
    breathPhase += delta * 1.5;
    const breathVal = Math.sin(breathPhase) * 0.005;

    // Apply breathing to chest
    const chest = getBone('chest');
    if (chest) {
      chest.position.y += breathVal * delta * 10;
    }

    // Blinking (random interval 2-5s)
    blinkTimer -= delta;
    if (blinkTimer <= 0) {
      blinkTimer = 2 + Math.random() * 3;
      const blink = vrm.expressionManager?.getExpression('blink');
      if (blink) {
        blink.setValue(1.0);
        setTimeout(() => blink?.setValue(0), 150);
      }
    }

    // Expression auto-reset
    if (currentExpression && expressionTimer > 0) {
      expressionTimer -= delta;
      if (expressionTimer <= 0) {
        setExpression('neutral');
      }
    }

    // Idle head sway (only when no action)
    if (!currentAction) {
      const head = getBone('head');
      if (head) {
        head.rotation.z = Math.sin(time * 0.5) * 0.02;
        head.rotation.x = Math.sin(time * 0.3) * 0.01;
      }
    }

    // Run current action
    if (currentAction?.update) {
      currentAction.update();
    }

    vrm.update(delta);
  }

  renderer.render(scene, camera);
}

animate();

// ==================== WebSocket (Hermes Integration) ====================
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  try {
    ws = new WebSocket(`ws://localhost:${WS_PORT}`);

    ws.onopen = () => {
      document.getElementById('ws-status').style.color = '#4CAF50';
      console.log('WebSocket connected to Hermes');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleAction(data);
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    ws.onclose = () => {
      document.getElementById('ws-status').style.color = '#f44336';
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => ws.close();
  } catch (e) {
    console.error('WebSocket init error:', e);
    document.getElementById('ws-status').style.color = '#f44336';
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 5000);
  }
}

function handleAction(data) {
  if (!vrm) return;

  console.log('Action:', data.action, data);

  switch (data.action) {
    case 'expression':
      setExpression(data.expression || 'happy');
      break;
    case 'nod':
      animateNod(data.duration || 1.0);
      break;
    case 'shake_head':
      animateShakeHead(data.duration || 1.5);
      break;
    case 'wave':
      animateWave(data.duration || 1.5);
      break;
    case 'speak':
      // TTS would play here; show happy expression while speaking
      setExpression('happy');
      if (data.duration) expressionTimer = data.duration;
      break;
    case 'think':
      setExpression('think');
      break;
    case 'approve':
      animateNod(0.8);
      setExpression('happy');
      expressionTimer = 2;
      break;
    case 'tease':
      animateShakeHead(1.0);
      setExpression('happy');
      expressionTimer = 2;
      break;
    default:
      setExpression('surprised');
      setTimeout(() => setExpression('neutral'), 1000);
  }
}

connectWebSocket();

// ==================== Window Resize ====================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==================== Window Drag ====================
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  window.electronAPI?.moveWindow(dx, dy);
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

// Double-click to toggle devtools (dev only)
canvas.addEventListener('dblclick', () => {
  // no-op for now
});
