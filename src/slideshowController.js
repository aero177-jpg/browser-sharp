/**
 * Slideshow controller module.
 * Simple auto-advance: uses existing transitions, holds after fade-in, then advances.
 */

import { useStore } from "./store.js";
import { loadNextAsset } from "./fileLoader.js";
import { hasMultipleAssets } from "./assetManager.js";
import { cancelLoadZoomAnimation } from "./customAnimations.js";
import { cancelContinuousZoomAnimation, cancelContinuousOrbitAnimation, cancelContinuousVerticalOrbitAnimation } from "./cameraAnimations.js";

const getStoreState = () => useStore.getState();

let isPlaying = false;
let holdTimeoutId = null;

/**
 * Starts slideshow playback.
 * Waits for hold duration, then advances to next asset.
 */
export const startSlideshow = () => {
  if (isPlaying) return;
  if (!hasMultipleAssets()) return;
  
  isPlaying = true;
  getStoreState().setSlideshowPlaying(true);
  
  // Immediately advance to the next asset, then start hold timer
  advanceToNextAndSchedule();
};

/**
 * Stops slideshow playback.
 */
export const stopSlideshow = () => {
  isPlaying = false;
  getStoreState().setSlideshowPlaying(false);

  cancelLoadZoomAnimation();
  cancelContinuousZoomAnimation();
  cancelContinuousOrbitAnimation();
  cancelContinuousVerticalOrbitAnimation();
  
  if (holdTimeoutId) {
    clearTimeout(holdTimeoutId);
    holdTimeoutId = null;
  }
};

/**
 * Schedules the next auto-advance after hold duration.
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

  if (holdTimeoutId) {
    clearTimeout(holdTimeoutId);
    holdTimeoutId = null;
  }

  console.log(`[Slideshow] Scheduling next advance in ${holdDuration}s`);

  holdTimeoutId = setTimeout(async () => {
    if (!isPlaying) return;

    console.log(`[Slideshow] Hold complete, advancing to next asset`);

    try {
      await loadNextAsset();

      // Schedule next advance after this one completes
      if (isPlaying) {
        scheduleNextAdvance();
      }
    } catch (err) {
      console.warn('Slideshow advance failed:', err);
      if (isPlaying) {
        scheduleNextAdvance();
      }
    }
  }, holdDuration * 1000);
};

/**
 * Advances immediately, then schedules the next auto-advance.
 */
const advanceToNextAndSchedule = async () => {
  if (!isPlaying) return;

  console.log('[Slideshow] Starting playback, advancing to next asset');

  try {
    await loadNextAsset();
  } catch (err) {
    console.warn('Slideshow initial advance failed:', err);
  }

  if (isPlaying) {
    scheduleNextAdvance();
  }
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
