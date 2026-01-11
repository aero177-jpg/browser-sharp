import { VRButton, XrHands } from "@sparkjsdev/spark";
import {
  renderer,
  camera,
  controls,
  scene,
  currentMesh,
  requestRender,
  suspendRenderLoop,
  resumeRenderLoop,
  THREE,
} from "./viewer.js";
import { useStore } from "./store.js";
import { restoreHomeView } from "./cameraUtils.js";
import { loadNextAsset, loadPrevAsset } from "./fileLoader.js";

let vrButton = null;
let xrHands = null;
let xrHandMesh = null;
let initialModelScale = null;
let initialModelPosition = null;
let initialModelQuaternion = null; // Store initial rotation
let keyListenerAttached = false;

// Quest controller button indices (xr-standard mapping, per controller)
const BTN_TRIGGER = 0;
const BTN_GRIP = 1;
const BTN_TOUCHPAD = 2; // placeholder on Quest
const BTN_THUMBSTICK = 3;
const BTN_A_OR_X = 4; // A on right, X on left
const BTN_B_OR_Y = 5; // B on right, Y on left

// Axes indices
const AXIS_THUMBSTICK_X = 2;
const AXIS_THUMBSTICK_Y = 3;

// Tuning constants
const SCALE_STEP = 1.5; // for button presses
const MIN_SCALE = 0.02;
const MAX_SCALE = 20.0;
const STICK_DEADZONE = 0.15;
const TRANSLATE_SPEED = 1.0; // units per second for panning (base speed)
const DEPTH_SPEED = 1.5; // units per second for push/pull
const ROTATION_SPEED = 0.6; // radians per second for model rotation
const AXIS_LOCK_THRESHOLD = 0.25; // minimum deflection to lock axis

// Axis locking state for rotation
let lockedRotationAxis = null; // 'x', 'y', or null

// Debounce tracking for button presses
const BUTTON_COOLDOWN_MS = 300;
let lastResetMs = 0;
let lastRotResetMs = 0;
let lastNextMs = 0;
let lastPrevMs = 0;
let lastScaleUpMs = 0;
let lastScaleDownMs = 0;

const scaleModel = (multiplier) => {
  const store = useStore.getState();
  if (!currentMesh || !initialModelScale) return;

  const prevScale = store.vrModelScale || 1;
  const nextScale = THREE.MathUtils.clamp(prevScale * multiplier, MIN_SCALE, MAX_SCALE);
  if (nextScale === prevScale) return;

  const ratio = nextScale / prevScale;
  currentMesh.scale.multiplyScalar(ratio);
  store.setVrModelScale(nextScale);
  requestRender();
};

const restoreModelTransform = () => {
  const store = useStore.getState();
  if (currentMesh && initialModelScale) {
    currentMesh.scale.copy(initialModelScale);
  }
  if (currentMesh && initialModelPosition) {
    currentMesh.position.copy(initialModelPosition);
  }
  if (currentMesh && initialModelQuaternion) {
    currentMesh.quaternion.copy(initialModelQuaternion);
  }
  store.setVrModelScale(1);
  initialModelScale = null;
  initialModelPosition = null;
  initialModelQuaternion = null;
};

const resetRotationOnly = () => {
  if (currentMesh && initialModelQuaternion) {
    currentMesh.quaternion.copy(initialModelQuaternion);
    requestRender();
  }
};

const handleScaleKeydown = (event) => {
  if (!useStore.getState().vrSessionActive) return;
  if (event.key === "+" || event.key === "=") {
    scaleModel(SCALE_STEP);
  } else if (event.key === "-" || event.key === "_") {
    scaleModel(1 / SCALE_STEP);
  }
};

const ensureHands = () => {
  if (!xrHands) {
    xrHands = new XrHands();
    xrHandMesh = xrHands.makeGhostMesh();
    if (xrHandMesh) {
      xrHandMesh.editable = false;
    }
  }

  if (xrHandMesh && !scene.children.includes(xrHandMesh)) {
    scene.add(xrHandMesh);
  }
};

const removeHands = () => {
  if (xrHandMesh && scene.children.includes(xrHandMesh)) {
    scene.remove(xrHandMesh);
  }
};

const setupVrAnimationLoop = () => {
  if (!renderer) return;
  let lastTime = performance.now();
  renderer.setAnimationLoop((time, xrFrame) => {
    const dt = Math.max(0.001, (time - lastTime) / 1000);
    lastTime = time;

    if (xrHands && xrHandMesh) {
      xrHands.update({ xr: renderer.xr, xrFrame });
    }

    handleVrGamepadInput(dt);

    renderer.render(scene, camera);
  });
};

const stopVrAnimationLoop = () => {
  if (!renderer) return;
  renderer.setAnimationLoop(null);
};

const performVrReset = () => {
  restoreHomeView();
  prepareVrCameraStart();
  if (initialModelPosition && currentMesh) {
    currentMesh.position.copy(initialModelPosition);
  }
  if (initialModelScale && currentMesh) {
    currentMesh.scale.copy(initialModelScale);
    useStore.getState().setVrModelScale(1);
  }
  if (initialModelQuaternion && currentMesh) {
    currentMesh.quaternion.copy(initialModelQuaternion);
  }
  requestRender();
};

const handleVrGamepadInput = (dt) => {
  const session = renderer?.xr?.getSession?.();
  if (!session) return;

  const now = performance.now();

  // Get camera vectors for movement relative to view
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  camera.getWorldDirection(forward).normalize();
  right.crossVectors(forward, up).normalize();

  for (const source of session.inputSources) {
    const gp = source?.gamepad;
    const hand = source?.handedness || "unknown";
    if (!gp) continue;

    const axes = gp.axes || [];
    const buttons = gp.buttons || [];

    // Get thumbstick values (axes 2 and 3 for xr-standard)
    const stickX = axes[AXIS_THUMBSTICK_X] ?? 0;
    const stickY = axes[AXIS_THUMBSTICK_Y] ?? 0;

    // Button helpers
    const isPressed = (idx) => buttons[idx]?.pressed ?? false;

    // ===== RIGHT CONTROLLER =====
    if (hand === "right") {
      // Scale pan speed based on model scale - smaller models need slower panning
      const currentScale = useStore.getState().vrModelScale || 1;
      const scaledTranslateSpeed = TRANSLATE_SPEED * currentScale;

      // Right thumbstick: pan model (inverted for intuitive "drag" feel)
      if (currentMesh) {
        const delta = new THREE.Vector3();
        let moved = false;

        if (Math.abs(stickX) > STICK_DEADZONE) {
          // Invert: stick right moves model left for intuitive feel
          delta.addScaledVector(right, -stickX * scaledTranslateSpeed * dt);
          moved = true;
        }
        if (Math.abs(stickY) > STICK_DEADZONE) {
          // Invert: stick up moves model down for intuitive feel
          delta.addScaledVector(up, stickY * scaledTranslateSpeed * dt);
          moved = true;
        }

        if (moved) {
          currentMesh.position.add(delta);
          requestRender();
        }
      }

      // Right thumbstick click: reset camera and model
      if (isPressed(BTN_THUMBSTICK)) {
        if (now - lastResetMs > BUTTON_COOLDOWN_MS) {
          performVrReset();
          lastResetMs = now;
        }
      }

      // B button: next image
      if (isPressed(BTN_B_OR_Y)) {
        if (now - lastNextMs > BUTTON_COOLDOWN_MS) {
          loadNextAsset();
          lastNextMs = now;
        }
      }

      // A button: previous image
      if (isPressed(BTN_A_OR_X)) {
        if (now - lastPrevMs > BUTTON_COOLDOWN_MS) {
          loadPrevAsset();
          lastPrevMs = now;
        }
      }
    }

    // ===== TRIGGERS FOR DEPTH (both controllers) =====
    // Trigger pulls model closer, so we sum both triggers
    const triggerValue = buttons[BTN_TRIGGER]?.value ?? 0;
    if (currentMesh && triggerValue > 0.1) {
      const currentScale = useStore.getState().vrModelScale || 1;
      const scaledDepthSpeed = DEPTH_SPEED * currentScale;
      // Pull model toward camera when trigger pressed
      const depthDelta = -triggerValue * scaledDepthSpeed * dt;
      currentMesh.position.addScaledVector(forward, depthDelta);
      requestRender();
    }

    // Grip pushes model away
    const gripValue = buttons[BTN_GRIP]?.value ?? 0;
    if (currentMesh && gripValue > 0.1) {
      const currentScale = useStore.getState().vrModelScale || 1;
      const scaledDepthSpeed = DEPTH_SPEED * currentScale;
      // Push model away from camera when grip pressed
      const depthDelta = gripValue * scaledDepthSpeed * dt;
      currentMesh.position.addScaledVector(forward, depthDelta);
      requestRender();
    }

    // ===== LEFT CONTROLLER =====
    if (hand === "left") {
      if (currentMesh) {
        // Get rotation pivot point (use model center or controls target)
        const pivot = controls?.target?.clone() ?? currentMesh.position.clone();

        const absX = Math.abs(stickX);
        const absY = Math.abs(stickY);
        const stickMagnitude = Math.sqrt(stickX * stickX + stickY * stickY);

        // Determine axis lock when stick first deflects past threshold
        if (stickMagnitude < STICK_DEADZONE) {
          // Stick returned to center, release lock
          lockedRotationAxis = null;
        } else if (lockedRotationAxis === null && stickMagnitude > AXIS_LOCK_THRESHOLD) {
          // Lock to whichever axis has greater deflection
          lockedRotationAxis = absX > absY ? 'x' : 'y';
        }

        // Left thumbstick X: rotate model around world Y axis (horizontal spin)
        // Flipped: Stick right = rotate counter-clockwise, stick left = clockwise
        if (lockedRotationAxis === 'x' && absX > STICK_DEADZONE) {
          const rotationAmount = stickX * ROTATION_SPEED * dt; // flipped direction
          
          // Rotate model around the pivot on world Y axis
          const offset = currentMesh.position.clone().sub(pivot);
          offset.applyAxisAngle(up, rotationAmount);
          currentMesh.position.copy(pivot).add(offset);
          
          // Also rotate the model itself so it spins in place relative to pivot
          currentMesh.rotateOnWorldAxis(up, rotationAmount);
          
          requestRender();
        }

        // Left thumbstick Y: rotate model around right axis (vertical tilt/pitch)
        // Flipped: Stick forward = tilt backward, stick back = tilt forward
        if (lockedRotationAxis === 'y' && absY > STICK_DEADZONE) {
          const rotationAmount = -stickY * ROTATION_SPEED * dt; // flipped direction
          
          // Rotate model around the pivot on the right axis (pitch)
          const offset = currentMesh.position.clone().sub(pivot);
          offset.applyAxisAngle(right, rotationAmount);
          currentMesh.position.copy(pivot).add(offset);
          
          // Also rotate the model itself
          currentMesh.rotateOnWorldAxis(right, rotationAmount);
          
          requestRender();
        }
      }

      // Left thumbstick click: reset rotation only
      if (isPressed(BTN_THUMBSTICK)) {
        if (now - lastRotResetMs > BUTTON_COOLDOWN_MS) {
          resetRotationOnly();
          lastRotResetMs = now;
        }
      }

      // Y button (BTN_B_OR_Y on left = Y): scale up
      if (isPressed(BTN_B_OR_Y)) {
        if (now - lastScaleUpMs > BUTTON_COOLDOWN_MS) {
          scaleModel(SCALE_STEP);
          lastScaleUpMs = now;
        }
      }

      // X button (BTN_A_OR_X on left = X): scale down
      if (isPressed(BTN_A_OR_X)) {
        if (now - lastScaleDownMs > BUTTON_COOLDOWN_MS) {
          scaleModel(1 / SCALE_STEP);
          lastScaleDownMs = now;
        }
      }
    }
  }
};

const prepareVrCameraStart = () => {
  if (!camera) return;
  const target = controls?.target?.clone?.() ?? new THREE.Vector3();
  const offset = new THREE.Vector3().subVectors(camera.position, target);
  const baseDist = offset.length() || 1;
  const dir = offset.normalize();
  const startDist = baseDist * 1.2 + 0.5;
  camera.position.copy(target).addScaledVector(dir, startDist);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
};

const handleSessionStart = () => {
  const store = useStore.getState();
  store.setVrSessionActive(true);

  suspendRenderLoop();
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType?.("local-floor");
  if (controls) controls.enabled = false;

  prepareVrCameraStart();
  initialModelScale = currentMesh?.scale?.clone() ?? null;
  initialModelPosition = currentMesh?.position?.clone() ?? null;
  initialModelQuaternion = currentMesh?.quaternion?.clone() ?? null; // Store initial rotation
  store.setVrModelScale(1);
  ensureHands();
  setupVrAnimationLoop();

  if (!keyListenerAttached) {
    window.addEventListener("keydown", handleScaleKeydown);
    keyListenerAttached = true;
  }
};

const handleSessionEnd = () => {
  const store = useStore.getState();

  stopVrAnimationLoop();
  renderer.xr.enabled = false;
  if (controls) controls.enabled = true;
  restoreModelTransform();
  removeHands();
  if (keyListenerAttached) {
    window.removeEventListener("keydown", handleScaleKeydown);
    keyListenerAttached = false;
  }
  resumeRenderLoop();
  requestRender();
  store.setVrSessionActive(false);
};

const attachSessionListeners = () => {
  if (!renderer || !renderer.xr) return;
  renderer.xr.removeEventListener?.("sessionstart", handleSessionStart);
  renderer.xr.removeEventListener?.("sessionend", handleSessionEnd);
  renderer.xr.addEventListener?.("sessionstart", handleSessionStart);
  renderer.xr.addEventListener?.("sessionend", handleSessionEnd);
};

export const initVrSupport = (containerEl) => {
  const store = useStore.getState();

  if (!renderer || vrButton) return vrButton;
  if (!navigator?.xr) {
    store.setVrSupported(false);
    return null;
  }

  try {
    vrButton = VRButton.createButton(renderer, {
      optionalFeatures: ["hand-tracking"],
    });
  } catch (err) {
    console.warn("VR button creation failed:", err);
    store.setVrSupported(false);
    return null;
  }

  if (!vrButton) {
    store.setVrSupported(false);
    return null;
  }

  vrButton.style.display = "none";
  (containerEl ?? document.body)?.appendChild(vrButton);
  attachSessionListeners();
  store.setVrSupported(true);
  return vrButton;
};

export const enterVrSession = () => {
  const store = useStore.getState();
  const button = vrButton || initVrSupport(document.getElementById("viewer"));
  if (!button) {
    store.addLog?.("VR not available on this device");
    return false;
  }

  try {
    button.click();
    return true;
  } catch (err) {
    store.addLog?.("Failed to start VR session");
    console.warn("VR start failed:", err);
    return false;
  }
};