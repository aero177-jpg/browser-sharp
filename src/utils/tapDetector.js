/**
 * Tap detector utility.
 * Normalizes pointer/touch/mouse taps with movement + duration thresholds.
 */

const getPointFromEvent = (event) =>
  event?.touches?.[0]
  || event?.changedTouches?.[0]
  || event;

export const registerTapListener = (target, {
  onTap,
  shouldIgnore,
  maxDurationMs = 250,
  maxMovePx = 12,
  ignoreMouseAfterTouchMs = 500,
} = {}) => {
  if (!target || typeof onTap !== 'function') return () => {};

  let tapStart = null;
  let lastTouchTime = 0;
  const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;

  const isIgnored = (event) => Boolean(shouldIgnore?.(event));

  const recordStart = (event) => {
    if (event?.button != null && event.button !== 0) return;
    if (isIgnored(event)) return;

    const point = getPointFromEvent(event);
    tapStart = {
      time: performance.now(),
      x: point?.clientX ?? 0,
      y: point?.clientY ?? 0,
    };
  };

  const handleEnd = (event) => {
    if (!tapStart) return;
    if (isIgnored(event)) {
      tapStart = null;
      return;
    }

    const point = getPointFromEvent(event);
    const dt = performance.now() - tapStart.time;
    const dx = (point?.clientX ?? 0) - tapStart.x;
    const dy = (point?.clientY ?? 0) - tapStart.y;
    const dist = Math.hypot(dx, dy);
    tapStart = null;

    if (dt > maxDurationMs || dist > maxMovePx) return;
    onTap(event);
  };

  const handleCancel = () => {
    tapStart = null;
  };

  const handleTouchStart = (event) => {
    lastTouchTime = Date.now();
    recordStart(event);
  };

  const handleTouchEnd = (event) => {
    lastTouchTime = Date.now();
    handleEnd(event);
  };

  const handleMouseDown = (event) => {
    if (Date.now() - lastTouchTime < ignoreMouseAfterTouchMs) return;
    recordStart(event);
  };

  const handleMouseUp = (event) => {
    if (Date.now() - lastTouchTime < ignoreMouseAfterTouchMs) return;
    handleEnd(event);
  };

  if (supportsPointer) {
    target.addEventListener('pointerdown', recordStart);
    target.addEventListener('pointerup', handleEnd);
    target.addEventListener('pointercancel', handleCancel);
  } else {
    target.addEventListener('mousedown', handleMouseDown);
    target.addEventListener('mouseup', handleMouseUp);
    target.addEventListener('touchstart', handleTouchStart, { passive: true });
    target.addEventListener('touchend', handleTouchEnd);
  }

  return () => {
    if (supportsPointer) {
      target.removeEventListener('pointerdown', recordStart);
      target.removeEventListener('pointerup', handleEnd);
      target.removeEventListener('pointercancel', handleCancel);
    } else {
      target.removeEventListener('mousedown', handleMouseDown);
      target.removeEventListener('mouseup', handleMouseUp);
      target.removeEventListener('touchstart', handleTouchStart);
      target.removeEventListener('touchend', handleTouchEnd);
    }
  };
};
