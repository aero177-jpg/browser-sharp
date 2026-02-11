/**
 * Slideshow controller module.
 * Auto-advance with pause/resume support for continuous animations.
 *
 * Pause captures camera position and remaining timer so resume can
 * glide back and continue where it left off without skipping assets.
 */

import { useStore } from "./store.js";
import { loadNextAsset } from "./fileLoader.js";
import { hasMultipleAssets } from "./assetManager.js";
import { cancelLoadZoomAnimation } from "./customAnimations.js";
import {
  cancelContinuousZoomAnimation,
  cancelContinuousDollyZoomAnimation,
  cancelContinuousOrbitAnimation,
  cancelContinuousVerticalOrbitAnimation,
  pauseContinuousAnimations,
  resumeContinuousAnimations,
  getActiveContinuousTween,
} from "./cameraAnimations.js";
import {
  continuousZoomSlideIn,
  continuousDollyZoomSlideIn,
  continuousOrbitSlideIn,
  continuousVerticalOrbitSlideIn,
} from "./continuousAnimations.js";
import { resolveSlideInOptions } from "./slideConfig.js";
import { camera, controls, requestRender, THREE } from "./viewer.js";
import gsap from "gsap";

const getStoreState = () => useStore.getState();

// ============================================================================
// Internal state
// ============================================================================

let isPlaying = false;
let holdTimeoutId = null;
let holdDeadline = 0;

/** Saved state captured on pause so we can resume seamlessly. */
let pauseSnapshot = null;

/** GSAP tween used for the glide-to-position on resume / fresh start. */
let glideTween = null;

const GLIDE_DURATION = 0.5; // seconds for camera glide on resume

// ============================================================================
// Public API
// ============================================================================

/**
 * Starts or resumes slideshow playback.
 * - Fresh start (no pauseSnapshot): glide to animation start then begin.
 * - Resume (has pauseSnapshot): glide back to saved camera, resume tween + timer.
 */
export const startSlideshow = () => {
  if (isPlaying) return;
  if (!hasMultipleAssets()) return;

  isPlaying = true;
  getStoreState().setSlideshowPlaying(true);

  if (pauseSnapshot) {
    resumeFromPause();
  } else {
    beginFreshPlayback();
  }
};

/**
 * Pauses slideshow playback.
 * Captures camera position, pauses continuous tween, and freezes the hold timer
 * so we can resume exactly where we left off.
 */
export const stopSlideshow = () => {
  if (!isPlaying) {
    // Already stopped  just make sure state is clean
    getStoreState().setSlideshowPlaying(false);
    return;
  }

  isPlaying = false;
  getStoreState().setSlideshowPlaying(false);

  // Kill any in-flight glide
  if (glideTween) {
    glideTween.kill();
    glideTween = null;
  }

  // Capture remaining hold time
  let remainingHoldMs = 0;
  if (holdTimeoutId != null) {
    if (holdDeadline) {
      remainingHoldMs = Math.max(0, holdDeadline - Date.now());
    }
    clearTimeout(holdTimeoutId);
    holdTimeoutId = null;
    holdDeadline = 0;
  }

  // Capture camera position before we pause the tween
  const savedPosition = camera?.position?.clone() ?? null;
  const savedTarget = controls?.target?.clone() ?? null;

  // Pause (not kill) the continuous animation so we can resume it
  pauseContinuousAnimations();

  // Save snapshot for resume (include asset index so we can detect stale snapshots)
  pauseSnapshot = {
    position: savedPosition,
    target: savedTarget,
    remainingHoldMs,
    hadActiveTween: !!getActiveContinuousTween(),
    assetIndex: getStoreState().currentAssetIndex,
  };

  console.log(`[Slideshow] Paused  remaining hold: ${(remainingHoldMs / 1000).toFixed(1)}s`);
};

/**
 * Toggles slideshow playback on/off.
 */
export const toggleSlideshow = () => {
  if (isPlaying) {
    stopSlideshow();
  } else {
    startSlideshow();
  }
};

/**
 * Returns whether slideshow is currently playing.
 */
export const isSlideshowPlaying = () => isPlaying;

/**
 * Restarts the hold timer (call after manual navigation during slideshow).
 */
export const resetSlideshowTimer = () => {
  if (isPlaying) {
    scheduleNextAdvance();
  }
};

/**
 * Hard-stops the slideshow and clears all saved state.
 * Call this when slideshow mode is turned off entirely (not just paused).
 */
export const resetSlideshow = () => {
  isPlaying = false;
  pauseSnapshot = null;

  cancelLoadZoomAnimation();
  cancelContinuousZoomAnimation();
  cancelContinuousDollyZoomAnimation();
  cancelContinuousOrbitAnimation();
  cancelContinuousVerticalOrbitAnimation();

  if (glideTween) {
    glideTween.kill();
    glideTween = null;
  }

  if (holdTimeoutId != null) {
    clearTimeout(holdTimeoutId);
    holdTimeoutId = null;
    holdDeadline = 0;
  }

  getStoreState().setSlideshowPlaying(false);
};

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Glides the camera from its current position to a target position/target
 * over GLIDE_DURATION seconds, then calls onComplete.
 */
const glideCamera = (toPosition, toTarget, onComplete) => {
  if (!camera || !controls) {
    onComplete?.();
    return;
  }

  const startPos = camera.position.clone();
  const startTgt = controls.target.clone();
  const proxy = { t: 0 };

  glideTween = gsap.to(proxy, {
    t: 1,
    duration: GLIDE_DURATION,
    ease: "power2.inOut",
    onUpdate: () => {
      camera.position.lerpVectors(startPos, toPosition, proxy.t);
      controls.target.lerpVectors(startTgt, toTarget, proxy.t);
      controls.update();
      requestRender();
    },
    onComplete: () => {
      glideTween = null;
      onComplete?.();
    },
  });
};

/**
 * Resumes playback from a pause snapshot.
 * Glides back to saved camera position, resumes the continuous tween,
 * and restarts the hold timer with the remaining time.
 */
const resumeFromPause = () => {
  const snap = pauseSnapshot;
  pauseSnapshot = null;

  if (!snap?.position || !snap?.target) {
    // No valid snapshot  fall through to fresh playback
    beginFreshPlayback();
    return;
  }
  // If the user navigated to a different asset while paused, snapshot is stale
  const currentIndex = getStoreState().currentAssetIndex;
  if (snap.assetIndex !== undefined && snap.assetIndex !== currentIndex) {
    console.log('[Slideshow] Snapshot stale (asset changed) — starting fresh');
    beginFreshPlayback();
    return;
  }
  console.log(`[Slideshow] Resuming  gliding back, then ${(snap.remainingHoldMs / 1000).toFixed(1)}s remaining`);

  glideCamera(snap.position, snap.target, () => {
    if (!isPlaying) return;

    // Resume the continuous tween from where it was paused
    if (snap.hadActiveTween) {
      resumeContinuousAnimations();
    }

    // Resume the hold timer with remaining time
    if (snap.remainingHoldMs > 0) {
      scheduleNextAdvanceMs(snap.remainingHoldMs);
    } else {
      // Timer already expired while paused  advance now
      advanceAndSchedule();
    }
  });
};

/**
 * Begins playback from scratch on the current asset.
 * If in continuous mode, starts the continuous animation then schedules the timer.
 * Otherwise just schedules the hold timer.
 */
const beginFreshPlayback = () => {
  console.log('[Slideshow] Starting fresh playback on current asset');
  startContinuousForCurrentMode();
  scheduleNextAdvance();
};

/**
 * Determines the current continuous mode (if any) and starts the
 * appropriate continuous animation on the current asset.
 */
const startContinuousForCurrentMode = () => {
  const store = getStoreState();
  if (!store.slideshowContinuousMode) return;

  const baseSlideMode = store.slideMode ?? 'horizontal';
  if (baseSlideMode === 'fade') return;

  const mode =
    baseSlideMode === 'horizontal' ? 'continuous-orbit' :
    baseSlideMode === 'vertical'   ? 'continuous-orbit-vertical' :
    baseSlideMode === 'zoom'
      ? (store.continuousDollyZoom ? 'continuous-dolly-zoom' : 'continuous-zoom')
      : null;
    null;
  if (!mode) return;

  const { duration, amount } = resolveSlideInOptions(mode, { preset: 'transition' });
  const opts = { glideDuration: GLIDE_DURATION };
  console.log(`[Slideshow] Starting continuous ${mode} animation (glide ${GLIDE_DURATION}s)`);

  if (mode === 'continuous-zoom')                continuousZoomSlideIn(duration, amount, opts);
  else if (mode === 'continuous-dolly-zoom')     continuousDollyZoomSlideIn(duration, amount, opts);
  else if (mode === 'continuous-orbit')          continuousOrbitSlideIn(duration, amount, opts);
  else if (mode === 'continuous-orbit-vertical') continuousVerticalOrbitSlideIn(duration, amount, opts);
};

/**
 * Schedules the next auto-advance after hold duration (reads from store).
 */
const scheduleNextAdvance = () => {
  if (!isPlaying) return;

  const store = getStoreState();
  const isContinuous = store.slideshowContinuousMode && store.slideMode !== 'fade';
  const continuousDuration = store.continuousMotionDuration ?? 10;
  const slideInOffsetSec = isContinuous ? 2.5 : 0;
  const holdDuration = isContinuous
    ? Math.max(0, continuousDuration - slideInOffsetSec)
    : (store.slideshowDuration ?? 3);

  scheduleNextAdvanceMs(holdDuration * 1000);
};

/**
 * Schedules the next auto-advance after a specific number of milliseconds.
 * Stores the deadline on the timeout so pause can compute remaining time.
 */
const scheduleNextAdvanceMs = (ms) => {
  if (holdTimeoutId != null) {
    clearTimeout(holdTimeoutId);
    holdTimeoutId = null;
  }

  console.log(`[Slideshow] Scheduling next advance in ${(ms / 1000).toFixed(1)}s`);

  holdDeadline = Date.now() + ms;
  holdTimeoutId = setTimeout(() => {
    if (!isPlaying) return;
    advanceAndSchedule();
  }, ms);
};

/**
 * Advances to the next asset then schedules another advance.
 */
const advanceAndSchedule = async () => {
  if (!isPlaying) return;

  // Clear snapshot  we're moving to a new asset
  pauseSnapshot = null;

  console.log('[Slideshow] Advancing to next asset');

  try {
    await loadNextAsset();

    if (isPlaying) {
      scheduleNextAdvance();
    }
  } catch (err) {
    console.warn('Slideshow advance failed:', err);
    if (isPlaying) {
      scheduleNextAdvance();
    }
  }
};
