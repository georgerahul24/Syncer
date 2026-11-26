/**
 * Turns pages from the mouse wheel or a trackpad swipe in paginated mode.
 *
 * Paginated mode has nothing to scroll, so before this a wheel or two-finger
 * swipe did nothing at all. That left desktop readers without a touch screen
 * (the Mac app especially) only the arrow keys and the click zones.
 *
 * The tricky part is that one gesture is many events. A macOS trackpad flick
 * keeps sending momentum events for a second or more after the fingers lift,
 * and a spun mouse wheel sends a burst. So a gesture turns one page, and the
 * rest of that stream is ignored until it goes quiet. A clearly new flick
 * (a sharp jump in size while the old one is still decaying) is let through,
 * so two quick swipes still turn two pages.
 *
 * Down or right means next page. Up or left means previous.
 */
export type WheelPager = {
  onWheel: (e: WheelEvent) => void;
  dispose: () => void;
};

const TURN_PX = 30; // travel within one gesture that turns the page
const QUIET_MS = 180; // a gap this long ends the gesture
const MIN_REPEAT_MS = 350; // never turn twice faster than this
const NEW_FLICK_RATIO = 2.5; // jump in size that marks a fresh flick mid-momentum
const NEW_FLICK_MIN_PX = 20;

export function createWheelPager(turn: (direction: 1 | -1) => void): WheelPager {
  let acc = 0;
  let dir: 0 | 1 | -1 = 0;
  let events = 0;
  let locked = false;
  let lastMag = 0;
  let lastTurnAt = 0;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;

  function doTurn(direction: 1 | -1) {
    locked = true;
    lastTurnAt = performance.now();
    turn(direction);
  }

  function endGesture() {
    // A single slow notch of a Mac mouse wheel can be only a few pixels.
    // One or two lone events that never reached the threshold were a
    // deliberate click of the wheel, not a trackpad drifting, so turn.
    if (!locked && dir !== 0 && events <= 2 && acc > 0 && performance.now() - lastTurnAt >= MIN_REPEAT_MS) {
      turn(dir);
      lastTurnAt = performance.now();
    }
    acc = 0;
    dir = 0;
    events = 0;
    locked = false;
    lastMag = 0;
  }

  function onWheel(e: WheelEvent) {
    // Pinch-to-zoom on a trackpad arrives as a wheel event with ctrlKey set.
    if (e.ctrlKey) return;
    const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (raw === 0) return;
    // deltaMode 1 = lines (Firefox with a mouse wheel), 2 = pages.
    const mag = Math.abs(raw) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const direction: 1 | -1 = raw > 0 ? 1 : -1;

    clearTimeout(quietTimer);
    quietTimer = setTimeout(endGesture, QUIET_MS);

    const now = performance.now();
    if (locked) {
      const freshFlick =
        mag >= NEW_FLICK_MIN_PX && mag > lastMag * NEW_FLICK_RATIO && now - lastTurnAt >= MIN_REPEAT_MS;
      lastMag = mag;
      if (!freshFlick) return;
      doTurn(direction);
      acc = 0;
      dir = direction;
      events = 0;
      return;
    }
    lastMag = mag;

    if (direction !== dir) {
      acc = 0;
      events = 0;
      dir = direction;
    }
    acc += mag;
    events += 1;
    if (acc >= TURN_PX && now - lastTurnAt >= MIN_REPEAT_MS) doTurn(direction);
  }

  return {
    onWheel,
    dispose: () => clearTimeout(quietTimer),
  };
}
