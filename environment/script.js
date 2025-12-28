const mirror = document.getElementById('mirror');
const videoElement = document.getElementById('input-video');
const statusText = document.getElementById('status-text');
const cameraDot = document.getElementById('camera-dot');
const controlButtons = Array.from(document.querySelectorAll('.control-btn'));
const editToggleBtn = document.querySelector('[data-action="toggle-edit"]');
const handCursor = document.getElementById('hand-cursor');
const tryon = document.getElementById('tryon');
const tryonVideo = document.getElementById('tryon-video');
const countdownEl = document.getElementById('countdown');
const photoContainer = document.getElementById('photo-container');
const photoPreview = document.getElementById('photo-preview');

const widgetElements = Array.from(document.querySelectorAll('.widget'));
const widgetState = {};

let draggingId = null;
let pinchActive = false;
let pinchMode = 'none'; // none | drag | button | idle
let editMode = false;
let lastButtonPress = 0;
const BUTTON_COOLDOWN_MS = 800;
const SNAP_SIZE = 16;
const ALIGN_THRESHOLD = 140;
const BUTTON_HIT_EXPAND = 24;
const SWIPE_THRESHOLD = 0.2;
const SWIPE_TIME_MAX = 900;
const SWIPE_COOLDOWN_MS = 900;
const GESTURE_COOLDOWN_MS = 1200;

let mode = 'mirror'; // mirror | tryon
let lastSwipeX = null;
let lastSwipeTime = 0;
let swipeStartX = null;
let swipeStartTime = 0;
let lastGestureTime = 0;
let isCountingDown = false;
let countdownTimer = null;
let photoReady = false;
let captureDataUrl = null;
const captureCanvas = document.createElement('canvas');
function setStatus(message, color) {
  statusText.textContent = message;
  const dotColors = {
    idle: '#f0b42d',
    ok: '#3bd97a',
    warn: '#f05a5a',
  };
  cameraDot.style.background = dotColors[color] || dotColors.idle;
  cameraDot.style.boxShadow = `0 0 12px ${cameraDot.style.background}`;
}

function initWidgetState() {
  widgetElements.forEach((el) => {
    const id = el.id;
    const existing = widgetState[id];
    const rect = el.getBoundingClientRect();
    const currentOffset = existing?.offset || { x: 0, y: 0 };
    const baseCenter = {
      x: rect.left + rect.width / 2 - currentOffset.x,
      y: rect.top + rect.height / 2 - currentOffset.y,
    };

    widgetState[id] = {
      el,
      baseCenter,
      offset: currentOffset,
    };

    if (currentOffset.x !== 0 || currentOffset.y !== 0) {
      el.style.transform = `translate(${currentOffset.x}px, ${currentOffset.y}px)`;
    }
  });
}

function getWidgetCenter(id) {
  const state = widgetState[id];
  return {
    x: state.baseCenter.x + state.offset.x,
    y: state.baseCenter.y + state.offset.y,
  };
}

function setWidgetPosition(id, x, y, smooth = false) {
  const state = widgetState[id];
  if (!state) return;
  if (!editMode) return;
  state.offset = {
    x: x - state.baseCenter.x,
    y: y - state.baseCenter.y,
  };
  state.el.style.transition = smooth ? 'transform 0.15s ease' : 'transform 0.05s linear';
  state.el.style.transform = `translate(${state.offset.x}px, ${state.offset.y}px)`;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function findNearestWidget(point) {
  let nearestId = null;
  let nearestDist = Infinity;
  widgetElements.forEach((el) => {
    const id = el.id;
    const center = getWidgetCenter(id);
    const d = distance(center, point);
    if (d < nearestDist) {
      nearestDist = d;
      nearestId = id;
    }
  });
  return nearestId;
}

function getRect(el) {
  const rect = el.getBoundingClientRect();
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
  };
}

function widgetUnderPoint(point) {
  let targetId = null;
  widgetElements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) {
      targetId = el.id;
    }
  });
  return targetId;
}

function setCursor(point) {
  if (!point) {
    handCursor.classList.remove('visible');
    return;
  }
  handCursor.classList.add('visible');
  handCursor.style.transform = `translate(${point.x - 16}px, ${point.y - 16}px)`;
}

function hitTestButtons(point) {
  return controlButtons.find((btn) => {
    const styles = window.getComputedStyle(btn);
    if (
      styles.display === 'none' ||
      styles.visibility === 'hidden' ||
      styles.opacity === '0' ||
      styles.pointerEvents === 'none'
    ) {
      return false;
    }
    const rect = btn.getBoundingClientRect();
    const expanded = {
      left: rect.left - BUTTON_HIT_EXPAND,
      right: rect.right + BUTTON_HIT_EXPAND,
      top: rect.top - BUTTON_HIT_EXPAND,
      bottom: rect.bottom + BUTTON_HIT_EXPAND,
    };
    return point.x >= expanded.left && point.x <= expanded.right && point.y >= expanded.top && point.y <= expanded.bottom;
  });
}

function flashButton(btn) {
  btn.classList.add('active');
  setTimeout(() => btn.classList.toggle('active', btn.dataset.action === 'toggle-edit' ? editMode : false), 180);
}

function setEditMode(on) {
  editMode = on;
  editToggleBtn.classList.toggle('active', editMode);
  editToggleBtn.setAttribute('aria-pressed', String(editMode));
  setStatus(editMode ? 'Move mode on · Pinch to drag cards' : 'Move mode off · Pinch Change Panel Position to move', editMode ? 'ok' : 'idle');
  if (!editMode) {
    draggingId = null;
  }
}

function resetPanels() {
  Object.keys(widgetState).forEach((id) => {
    widgetState[id].offset = { x: 0, y: 0 };
    widgetState[id].el.style.transition = 'transform 0.15s ease';
    widgetState[id].el.style.transform = 'translate(0px, 0px)';
  });
  setTimeout(() => {
    widgetElements.forEach((el) => (el.style.transition = ''));
  }, 200);
  initWidgetState();
}

function runAction(action) {
  if (action === 'reset') {
    resetPanels();
  }
  if (action === 'toggle-edit') {
    setEditMode(!editMode);
  }
  if (action === 'shutter') {
    triggerShutter();
  }
}

function setMode(next) {
  if (mode === next) return;
  mode = next;
  document.body.classList.toggle('mode-tryon', mode === 'tryon');
  if (mode === 'tryon') {
    setEditMode(false);
    setStatus('Try-on mode · Swipe left to return', 'ok');
    hidePhotoPreview();
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      countdownEl.classList.add('hidden');
      isCountingDown = false;
    }
    lastSwipeX = null;
    swipeStartX = null;
    swipeStartTime = 0;
  } else {
    setStatus(editMode ? 'Move mode on' : 'Mirror mode', 'idle');
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownEl.classList.add('hidden');
    isCountingDown = false;
    hidePhotoPreview();
    lastSwipeX = null;
    swipeStartX = null;
    swipeStartTime = 0;
  }
}

function detectSwipes(hands) {
  const now = Date.now();
  hands.forEach((landmarks) => {
    const mirroredX = 1 - landmarks[8].x;
    if (swipeStartX === null) {
      swipeStartX = mirroredX;
      swipeStartTime = now;
      lastSwipeX = mirroredX;
      return;
    }

    const dx = mirroredX - swipeStartX;
    const dt = now - swipeStartTime;
    const sinceLast = now - lastSwipeTime;
    const moving = Math.abs(mirroredX - lastSwipeX) > 0.02;

    if (!pinchActive && sinceLast > SWIPE_COOLDOWN_MS && dt <= SWIPE_TIME_MAX) {
      if (dx > SWIPE_THRESHOLD && mode === 'mirror') {
        setMode('tryon');
        lastSwipeTime = now;
        swipeStartX = null;
        swipeStartTime = 0;
      } else if (dx < -SWIPE_THRESHOLD && mode === 'tryon') {
        setMode('mirror');
        lastSwipeTime = now;
        swipeStartX = null;
        swipeStartTime = 0;
      }
    }

    if (dt > SWIPE_TIME_MAX || (!moving && dt > 280)) {
      swipeStartX = mirroredX;
      swipeStartTime = now;
    }

    lastSwipeX = mirroredX;
  });
}

function detectThumbGestures(hands) {
  const now = Date.now();
  if (now - lastGestureTime < GESTURE_COOLDOWN_MS) return;
  const folded = (tip, pip) => tip.y > pip.y + 0.02;

  for (const landmarks of hands) {
    const thumbTip = landmarks[4];
    const thumbMcp = landmarks[2];
    const wrist = landmarks[0];
    const fingersFolded =
      folded(landmarks[8], landmarks[6]) &&
      folded(landmarks[12], landmarks[10]) &&
      folded(landmarks[16], landmarks[14]) &&
      folded(landmarks[20], landmarks[18]);

    if (!fingersFolded) continue;

    if (thumbTip.y < thumbMcp.y - 0.04 && thumbTip.y < wrist.y - 0.02) {
      lastGestureTime = now;
      savePhoto();
      return;
    }
    if (thumbTip.y > thumbMcp.y + 0.04 && thumbTip.y > wrist.y + 0.02) {
      lastGestureTime = now;
      retakePhoto();
      return;
    }
  }
}

function hidePhotoPreview() {
  photoReady = false;
  captureDataUrl = null;
  photoContainer.classList.add('hidden');
  photoPreview.src = '';
  countdownEl.classList.add('hidden');
}

function triggerShutter() {
  if (mode !== 'tryon' || isCountingDown) return;
  hidePhotoPreview();
  countdownEl.classList.remove('hidden');
  let counter = 3;
  countdownEl.textContent = counter;
  isCountingDown = true;
  setStatus('Photo in 3... hold still', 'ok');
  countdownTimer = setInterval(() => {
    counter -= 1;
    if (counter <= 0) {
      clearInterval(countdownTimer);
      countdownEl.classList.add('hidden');
      isCountingDown = false;
      capturePhoto();
    } else {
      countdownEl.textContent = counter;
    }
  }, 1000);
}

function capturePhoto() {
  const video = tryonVideo || videoElement;
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  captureCanvas.width = width;
  captureCanvas.height = height;
  const ctx = captureCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);
  captureDataUrl = captureCanvas.toDataURL('image/png');
  photoPreview.src = captureDataUrl;
  photoContainer.classList.remove('hidden');
  photoReady = true;
  setStatus('Photo ready · Thumbs up to save · Thumbs down to retake', 'ok');
}

function savePhoto() {
  if (!photoReady || !captureDataUrl) return;
  const link = document.createElement('a');
  link.href = captureDataUrl;
  link.download = 'smart-mirror-capture.png';
  link.click();
  setStatus('Photo saved locally (downloaded)', 'ok');
}

function retakePhoto() {
  hidePhotoPreview();
  triggerShutter();
}

function snapWidget(id) {
  const state = widgetState[id];
  if (!state) return;
  const selfRect = getRect(state.el);
  const others = widgetElements.filter((el) => el.id !== id).map(getRect);

  let deltaX = 0;
  let deltaY = 0;
  let bestX = ALIGN_THRESHOLD + 1;
  let bestY = ALIGN_THRESHOLD + 1;

  others.forEach((r) => {
    const candidatesX = [
      { dist: Math.abs(selfRect.left - r.left), delta: r.left - selfRect.left },
      { dist: Math.abs(selfRect.centerX - r.centerX), delta: r.centerX - selfRect.centerX },
      { dist: Math.abs(selfRect.right - r.right), delta: r.right - selfRect.right },
    ];
    candidatesX.forEach((c) => {
      if (c.dist < bestX && c.dist <= ALIGN_THRESHOLD) {
        bestX = c.dist;
        deltaX = c.delta;
      }
    });

    const candidatesY = [
      { dist: Math.abs(selfRect.top - r.top), delta: r.top - selfRect.top },
      { dist: Math.abs(selfRect.centerY - r.centerY), delta: r.centerY - selfRect.centerY },
      { dist: Math.abs(selfRect.bottom - r.bottom), delta: r.bottom - selfRect.bottom },
    ];
    candidatesY.forEach((c) => {
      if (c.dist < bestY && c.dist <= ALIGN_THRESHOLD) {
        bestY = c.dist;
        deltaY = c.delta;
      }
    });
  });

  const snap = (v) => Math.round(v / SNAP_SIZE) * SNAP_SIZE;

  state.offset = {
    x: snap(state.offset.x + deltaX),
    y: snap(state.offset.y + deltaY),
  };

  state.el.style.transition = 'transform 0.18s ease';
  state.el.style.transform = `translate(${state.offset.x}px, ${state.offset.y}px)`;
  setTimeout(() => {
    state.el.style.transition = '';
  }, 200);
}

function processPinch(landmarks) {
  const mirrorRect = mirror.getBoundingClientRect();

  const thumb = landmarks[4];
  const index = landmarks[8];
  const palm = landmarks[0];

  const pinchStrength = distance(thumb, index);
  const handSpan = distance(palm, landmarks[9]);
  const threshold = Math.max(handSpan * 0.7, 0.05);

  const mirroredX = mode === 'tryon' ? index.x : 1 - index.x;
  const pinchPointMirror = {
    x: mirrorRect.left + mirroredX * mirrorRect.width,
    y: mirrorRect.top + index.y * mirrorRect.height,
  };

  const pinchPointUI = {
    x: mirroredX * window.innerWidth,
    y: index.y * window.innerHeight,
  };

  setCursor(pinchPointMirror);

  const isPinching = pinchStrength < threshold;

  if (!isPinching) {
    return false;
  }

  // Pinch started
  if (!pinchActive) {
    pinchActive = true;
    pinchMode = 'idle';

    const now = Date.now();
    const btn = hitTestButtons(pinchPointUI);
    if (btn && now - lastButtonPress > BUTTON_COOLDOWN_MS) {
      runAction(btn.dataset.action);
      flashButton(btn);
      lastButtonPress = now;
      pinchMode = 'button';
      return true;
    }

    if (editMode && mode === 'mirror') {
      const target = widgetUnderPoint(pinchPointMirror);
      if (target) {
        draggingId = target;
        pinchMode = 'drag';
      } else {
        pinchMode = 'idle';
      }
    }
  }

  if (pinchMode === 'drag' && draggingId && editMode && mode === 'mirror') {
    setWidgetPosition(draggingId, pinchPointMirror.x, pinchPointMirror.y);
  }

  return true;
}

function onResults(results) {
  const hands = results.multiHandLandmarks || [];

  if (!hands.length) {
    pinchActive = false;
    pinchMode = 'none';
    draggingId = null;
    setCursor(null);
    lastSwipeX = null;
    swipeStartX = null;
    swipeStartTime = 0;
    const idleMessage =
      mode === 'tryon'
        ? 'Swipe left to go back · Pinch shutter to take a photo'
        : editMode
          ? 'Show your hand to reposition cards'
          : 'Pinch Change Panel Position to enable moving';
    setStatus(idleMessage, 'idle');
    return;
  }

  setStatus(
    mode === 'tryon'
      ? 'Tracking hands · Swipe left to exit · Pinch shutter to shoot'
      : editMode
        ? 'Tracking hands · Move mode on'
        : 'Tracking hands · Move mode off',
    'ok',
  );
  let anyPinch = false;
  hands.forEach((landmarks) => {
    if (processPinch(landmarks)) {
      anyPinch = true;
    }
  });

  if (!anyPinch && pinchActive) {
    if (draggingId && editMode) {
      snapWidget(draggingId);
    }
    pinchActive = false;
    draggingId = null;
    pinchMode = 'none';
  }

  detectSwipes(hands);
  if (mode === 'tryon' && photoReady && !isCountingDown) {
    detectThumbGestures(hands);
  }
}

async function initCamera() {
  initWidgetState();

  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  hands.onResults(onResults);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    videoElement.srcObject = stream;
    tryonVideo.srcObject = stream;
    await videoElement.play();
    await tryonVideo.play();
    setStatus('Camera on · Ready to track', 'ok');
  } catch (err) {
    setStatus('Camera blocked. Allow access to move widgets.', 'warn');
    console.error(err);
    return;
  }

  const camera = new Camera(videoElement, {
    onFrame: async () => {
      await hands.send({ image: videoElement });
    },
    width: 1280,
    height: 720,
  });
  camera.start();
}

window.addEventListener('resize', () => {
  initWidgetState();
});

document.addEventListener('DOMContentLoaded', () => {
  setStatus('Waiting for camera...', 'idle');
  controlButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      runAction(btn.dataset.action);
      flashButton(btn);
    });
  });
  setEditMode(false);
  setMode('mirror');
  initCamera();
});
