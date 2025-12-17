import "./style.css";
import * as THREE from "three";
import {
  SparkRenderer,
  SplatMesh,
  SplatFileType,
} from "@sparkjsdev/spark";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { readPlyCamera } from "./plyCamera.js";

const app = document.querySelector("#app");

app.innerHTML = `
  <div class="page">
    <div id="viewer" class="viewer">
      <div class="drop-help">
        <div class="eyebrow">拖拽 PLY 文件到这里</div>
        <div class="fine-print">Spark + THREE 3DGS</div>
      </div>
    </div>
    <div class="side">
      <div class="header">
        <div>
          <div class="title">3DGS PLY 上传</div>
          <div class="subtitle">本地拖拽 / 选择文件 即刻查看</div>
        </div>
        <button id="pick-btn" class="primary">选择文件</button>
        <input id="file-input" type="file" accept=".ply" hidden />
      </div>
      <div class="hint">导入后会在右侧打印调试信息，同时在左侧实时渲染。</div>
      <div class="debug">
        <div class="row"><span>状态</span><span id="status">等待文件...</span></div>
        <div class="row"><span>文件</span><span id="file-name">-</span></div>
        <div class="row"><span>大小</span><span id="file-size">-</span></div>
        <div class="row"><span>Splats</span><span id="splat-count">-</span></div>
        <div class="row"><span>耗时</span><span id="load-time">-</span></div>
        <div class="row"><span>包围盒</span><span id="bounds">-</span></div>
      </div>
      <div class="log" id="log"></div>
    </div>
  </div>
`;

// UI references
const viewerEl = document.getElementById("viewer");
const pickBtn = document.getElementById("pick-btn");
const fileInput = document.getElementById("file-input");
const statusEl = document.getElementById("status");
const fileNameEl = document.getElementById("file-name");
const fileSizeEl = document.getElementById("file-size");
const splatCountEl = document.getElementById("splat-count");
const loadTimeEl = document.getElementById("load-time");
const boundsEl = document.getElementById("bounds");
const logEl = document.getElementById("log");

const logBuffer = [];
const appendLog = (message) => {
  const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
  logBuffer.unshift(entry);
  logBuffer.length = Math.min(logBuffer.length, 14);
  logEl.textContent = logBuffer.join("\n");
  console.info(message);
};

const setStatus = (message) => {
  statusEl.textContent = message;
  appendLog(message);
};

const resetInfo = () => {
  fileNameEl.textContent = "-";
  fileSizeEl.textContent = "-";
  splatCountEl.textContent = "-";
  loadTimeEl.textContent = "-";
  boundsEl.textContent = "-";
};

resetInfo();
setStatus("等待文件...");

// Three + Spark setup
const scene = new THREE.Scene();
scene.background = new THREE.Color("#0c1018");

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(window.devicePixelRatio);
viewerEl.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 500);
camera.position.set(0.5, 0.5, 2.5);
const defaultCamera = {
  fov: camera.fov,
  near: camera.near,
  far: camera.far,
};

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.75;
controls.zoomSpeed = 0.6;
controls.panSpeed = 0.6;
controls.target.set(0, 0, 0);
const defaultControls = {
  dampingFactor: controls.dampingFactor,
  rotateSpeed: controls.rotateSpeed,
  zoomSpeed: controls.zoomSpeed,
  panSpeed: controls.panSpeed,
};

const spark = new SparkRenderer({ renderer });
scene.add(spark);

// Provide a simple ground for orientation
const grid = new THREE.GridHelper(2.5, 10, 0x2a2f3a, 0x151822);
grid.position.y = -0.5;
scene.add(grid);

let currentMesh = null;
let activePlyCamera = null;

const resize = () => {
  const { clientWidth, clientHeight } = viewerEl;
  renderer.setSize(clientWidth, clientHeight, false);
  if (activePlyCamera) {
    applyPlyProjection(activePlyCamera, clientWidth, clientHeight);
  } else {
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }
};

window.addEventListener("resize", resize);
resize();

const animate = () => {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
};
animate();

// Helpers
const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
};

const formatVec3 = (vec) =>
  `${vec.x.toFixed(2)}, ${vec.y.toFixed(2)}, ${vec.z.toFixed(2)}`;

const fitViewToMesh = (mesh) => {
  if (!mesh.getBoundingBox) return;
  const box = mesh.getBoundingBox();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const radius = Math.max(size.length() * 0.5, 0.5);
  const dist = radius / Math.tan((camera.fov * Math.PI) / 360);

  camera.position.copy(center).add(new THREE.Vector3(dist, dist, dist));
  camera.near = Math.max(0.01, radius * 0.01);
  camera.far = Math.max(dist * 4, radius * 8);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();

  boundsEl.textContent = `${formatVec3(center)} | size ${formatVec3(size)}`;
};

const makeAxisFlipCvToGl = () =>
  new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);

const quantileSorted = (sorted, q) => {
  if (!sorted.length) return null;
  const clampedQ = Math.max(0, Math.min(1, q));
  const pos = (sorted.length - 1) * clampedQ;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  const weight = pos - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

const computeMlSharpDepthFocus = (
  mesh,
  { qFocus = 0.1, minDepthFocus = 2.0, maxSamples = 50_000 } = {},
) => {
  const numSplats = mesh?.packedSplats?.numSplats ?? 0;
  if (!numSplats) return minDepthFocus;

  const step = Math.max(1, Math.floor(numSplats / maxSamples));
  const depths = [];
  for (let i = 0; i < numSplats; i += step) {
    const { center } = mesh.packedSplats.getSplat(i);
    const z = center.z;
    if (Number.isFinite(z) && z > 0) depths.push(z);
  }

  if (!depths.length) return minDepthFocus;
  depths.sort((a, b) => a - b);
  const q = quantileSorted(depths, qFocus);
  if (!Number.isFinite(q)) return minDepthFocus;
  return Math.max(minDepthFocus, q);
};

const makeProjectionFromIntrinsics = ({
  fx,
  fy,
  cx,
  cy,
  width,
  height,
  near,
  far,
}) => {
  const left = (-cx * near) / fx;
  const right = ((width - cx) * near) / fx;
  const top = (cy * near) / fy;
  const bottom = (-(height - cy) * near) / fy;

  return new THREE.Matrix4().set(
    (2 * near) / (right - left),
    0,
    (right + left) / (right - left),
    0,
    0,
    (2 * near) / (top - bottom),
    (top + bottom) / (top - bottom),
    0,
    0,
    0,
    -(far + near) / (far - near),
    (-2 * far * near) / (far - near),
    0,
    0,
    -1,
    0,
  );
};

const applyPlyProjection = (plyCam, viewportWidth, viewportHeight) => {
  const { intrinsics, near, far } = plyCam;
  const sx = viewportWidth / intrinsics.imageWidth;
  const sy = viewportHeight / intrinsics.imageHeight;

  const fx = intrinsics.fx * sx;
  const fy = intrinsics.fy * sy;
  const cx = intrinsics.cx * sx;
  const cy = intrinsics.cy * sy;

  camera.aspect = viewportWidth / viewportHeight;
  camera.fov = THREE.MathUtils.radToDeg(
    2 * Math.atan(viewportHeight / (2 * Math.max(1e-6, fy))),
  );
  camera.near = near;
  camera.far = far;

  const fovScale = THREE.MathUtils.clamp(camera.fov / defaultCamera.fov, 0.05, 2.0);
  controls.rotateSpeed = Math.max(0.02, defaultControls.rotateSpeed * fovScale * 0.45);
  controls.zoomSpeed = Math.max(0.05, defaultControls.zoomSpeed * fovScale * 0.8);
  controls.panSpeed = Math.max(0.05, defaultControls.panSpeed * fovScale * 0.8);

  const projection = makeProjectionFromIntrinsics({
    fx,
    fy,
    cx,
    cy,
    width: viewportWidth,
    height: viewportHeight,
    near,
    far,
  });
  camera.projectionMatrix.copy(projection);
  camera.projectionMatrixInverse.copy(projection).invert();
};

const applyPlyCamera = (mesh, plyCamera) => {
  const cvToThree = makeAxisFlipCvToGl();
  if (!mesh.userData.__cvToThreeApplied) {
    mesh.applyMatrix4(cvToThree);
    mesh.userData.__cvToThreeApplied = true;
  }
  mesh.updateMatrixWorld(true);

  const e = plyCamera.extrinsicCv;
  const extrinsicCv = new THREE.Matrix4().set(
    e[0],
    e[1],
    e[2],
    e[3],
    e[4],
    e[5],
    e[6],
    e[7],
    e[8],
    e[9],
    e[10],
    e[11],
    e[12],
    e[13],
    e[14],
    e[15],
  );

  const view = new THREE.Matrix4().multiplyMatrices(cvToThree, extrinsicCv).multiply(cvToThree);
  const cameraWorld = new THREE.Matrix4().copy(view).invert();

  camera.matrixAutoUpdate = true;
  camera.matrixWorld.copy(cameraWorld);
  camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
  camera.updateMatrix();
  camera.updateMatrixWorld(true);

  if (mesh?.getBoundingBox) {
    const box = mesh.getBoundingBox();
    const worldBox = box.clone().applyMatrix4(mesh.matrixWorld);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    worldBox.getSize(size);
    worldBox.getCenter(center);
    const radius = Math.max(size.length() * 0.5, 0.25);

    const camPos = camera.position.clone();
    const dist = camPos.distanceTo(center);

    const near = Math.max(0.01, dist - radius * 2.0);
    const far = Math.max(near + 1.0, dist + radius * 6.0);
    activePlyCamera = { ...plyCamera, near, far };

    boundsEl.textContent = `${formatVec3(center)} | size ${formatVec3(size)}`;
  } else {
    activePlyCamera = { ...plyCamera, near: 0.01, far: 1000 };
  }

  const depthFocusCv = computeMlSharpDepthFocus(mesh);
  const lookAtCv = new THREE.Vector3(0, 0, depthFocusCv);
  const lookAtThree = lookAtCv.applyMatrix4(mesh.matrixWorld);
  controls.target.copy(lookAtThree);
  appendLog(`ml-sharp lookAt: depth_focus=${depthFocusCv.toFixed(3)} (q=0.1, min=2.0)`);

  controls.enabled = true;
  controls.update();

  resize();
};

const clearPlyCamera = () => {
  activePlyCamera = null;
  camera.matrixAutoUpdate = true;
  controls.enabled = true;
  controls.dampingFactor = defaultControls.dampingFactor;
  controls.rotateSpeed = defaultControls.rotateSpeed;
  controls.zoomSpeed = defaultControls.zoomSpeed;
  controls.panSpeed = defaultControls.panSpeed;
  camera.fov = defaultCamera.fov;
  camera.near = defaultCamera.near;
  camera.far = defaultCamera.far;
  camera.updateProjectionMatrix();
  resize();
};

const updateInfo = ({ file, mesh, loadMs }) => {
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  splatCountEl.textContent = mesh?.packedSplats?.numSplats ?? "-";
  loadTimeEl.textContent = `${loadMs.toFixed(1)} ms`;
};

const removeCurrentMesh = () => {
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh = null;
  }
};

const loadSplatFile = async (file) => {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".ply")) {
    setStatus("只支持 .ply 3DGS 文件");
    return;
  }

  try {
    setStatus("读取本地文件...");
    const start = performance.now();
    const bytes = new Uint8Array(await file.arrayBuffer());

    let plyCamera = null;
    try {
      plyCamera = await readPlyCamera(bytes);
      if (plyCamera) {
        appendLog(
          `相机: fx=${plyCamera.intrinsics.fx.toFixed(1)}, fy=${plyCamera.intrinsics.fy.toFixed(1)}, ` +
            `cx=${plyCamera.intrinsics.cx.toFixed(1)}, cy=${plyCamera.intrinsics.cy.toFixed(1)}, ` +
            `img=${plyCamera.intrinsics.imageWidth}x${plyCamera.intrinsics.imageHeight}`,
        );
      }
    } catch (error) {
      appendLog(`相机参数解析失败，回退默认视角: ${error?.message ?? error}`);
    }

    setStatus("解析 PLY 并构建 splats...");
    const mesh = new SplatMesh({
      fileBytes: bytes,
      fileType: SplatFileType.PLY,
      fileName: file.name,
    });
    await mesh.initialized;

    removeCurrentMesh();
    currentMesh = mesh;
    viewerEl.classList.add("has-mesh");
    scene.add(mesh);

    clearPlyCamera();
    if (plyCamera) {
      applyPlyCamera(mesh, plyCamera);
    } else {
      fitViewToMesh(mesh);
    }
    spark.update({ scene });

    const loadMs = performance.now() - start;
    updateInfo({ file, mesh, loadMs });
    setStatus(
      plyCamera
        ? "加载完成（使用 PLY 相机：可拖拽旋转 / 滚轮缩放）"
        : "加载完成，拖拽鼠标旋转 / 滚轮缩放",
    );
    appendLog(
      `调试: splats=${mesh.packedSplats.numSplats}, bbox=${boundsEl.textContent}`,
    );
  } catch (error) {
    console.error(error);
    clearPlyCamera();
    setStatus("加载失败，请检查文件或控制台日志");
  }
};

// Drag + click handlers
const preventDefaults = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

["dragenter", "dragover"].forEach((eventName) => {
  viewerEl.addEventListener(eventName, (event) => {
    preventDefaults(event);
    viewerEl.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  viewerEl.addEventListener(eventName, (event) => {
    preventDefaults(event);
    if (eventName === "dragleave") {
      viewerEl.classList.remove("dragging");
    }
  });
});

viewerEl.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  viewerEl.classList.remove("dragging");
  loadSplatFile(file);
});

pickBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) {
    loadSplatFile(file);
    fileInput.value = "";
  }
});
