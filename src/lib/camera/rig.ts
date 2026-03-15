import { forward, makeCameraForMode, mulMat4Into, perspectiveInto, right, viewMatrixInto } from './math';
import { getCameraMathBackend, initCameraMathBackend } from './backend';
import type { CameraMode, CameraProfile } from './types';
import type { CameraState } from './math';

export type CameraRigOptions = {
  profile: CameraProfile;
  getCamera: () => CameraState;
  setCamera: (next: CameraState) => void;
  getMode: () => CameraMode;
  setMode: (mode: CameraMode) => void;
  onLockChange?: (locked: boolean) => void;
  moveSpeed?: number;
  rotateSpeed?: number;
  zoomSpeed?: number;
  toggleKey?: string;
};

export type CameraRigAttachOptions = {
  canvas: HTMLCanvasElement;
  keyTarget?: Window;
  pointerTarget?: Window;
  wheelTarget?: HTMLElement;
};

export type CameraRig = ReturnType<typeof createCameraRig>;

export function createCameraRig(options: CameraRigOptions) {
  void initCameraMathBackend();
  const allowed = options.profile.allowed?.length ? options.profile.allowed : [options.profile.default];
  const defaultMode = allowed.includes(options.profile.default)
    ? options.profile.default
    : allowed[0] ?? 'orbit';
  const toggleKey = (options.toggleKey ?? options.profile.toggleKey ?? 'c').toLowerCase();
  const rotateSpeed = options.rotateSpeed ?? options.profile.rotateSpeed ?? 0.004;
  const zoomSpeed = options.zoomSpeed ?? options.profile.zoomSpeed ?? 0.001;
  const moveSpeed = options.moveSpeed ?? options.profile.moveSpeed ?? 2.5;
  const invertY = options.profile.invertY ?? false;

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let locked = false;
  let flyActive = false;
  const keys = new Set<string>();

  const resolveMode = (mode: CameraMode): CameraMode => (allowed.includes(mode) ? mode : defaultMode);

  const syncCameraMode = (mode: CameraMode) => {
    const cam = options.getCamera();
    if (cam.mode !== mode) {
      options.setCamera(makeCameraForMode(mode));
    }
  };

  const setMode = (mode: CameraMode) => {
    const prevMode = resolveMode(options.getMode());
    const resolved = resolveMode(mode);
    options.setMode(resolved);
    syncCameraMode(resolved);
    if (resolved === 'fly') {
      flyActive = false;
      keys.clear();
    }
    if (prevMode === 'fly' && resolved !== 'fly' && document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    if (prevMode === 'fly' && resolved !== 'fly') {
      flyActive = false;
      keys.clear();
    }
  };

  const toggleMode = () => {
    const current = resolveMode(options.getMode());
    const idx = allowed.indexOf(current);
    const next = allowed[(idx + 1) % allowed.length] ?? defaultMode;
    setMode(next);
  };

  const translate = (dir: [number, number, number], amt: number) => {
    const cam = options.getCamera();
    if (cam.mode !== 'fly') return;
    cam.position = [
      cam.position[0] + dir[0] * amt,
      cam.position[1] + dir[1] * amt,
      cam.position[2] + dir[2] * amt
    ];
  };

  const handleKeyDown = (ev: KeyboardEvent) => {
    const key = ev.key.toLowerCase();
    if (key === toggleKey) {
      toggleMode();
      return;
    }
    if (options.getMode() === 'fly' && !flyActive) {
      return;
    }
    keys.add(key);
  };

  const handleKeyUp = (ev: KeyboardEvent) => {
    keys.delete(ev.key.toLowerCase());
  };

  const handlePointerDown = (ev: PointerEvent) => {
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (options.getMode() === 'fly') {
      flyActive = true;
      (ev.currentTarget as HTMLElement | null)?.requestPointerLock?.();
      return;
    }
    dragging = true;
  };

  const handlePointerUp = () => {
    dragging = false;
  };

  const handlePointerMove = (ev: PointerEvent) => {
    const dx = ev.movementX || ev.clientX - lastX;
    const dy = (ev.movementY || ev.clientY - lastY) * (invertY ? -1 : 1);
    lastX = ev.clientX;
    lastY = ev.clientY;

    const mode = options.getMode();
    const cam = options.getCamera();

    if (mode === 'fly') {
      if (!flyActive) return;
      cam.yaw += dx * rotateSpeed;
      cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + dy * rotateSpeed));
      return;
    }

    if (!dragging) return;
    cam.yaw += dx * rotateSpeed;
    cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + dy * rotateSpeed));
  };

  const handleWheel = (ev: WheelEvent) => {
    const cam = options.getCamera();
    if (cam.mode === 'orbit' || cam.mode === 'track') {
      cam.distance = Math.max(0.5, cam.distance * (1 + ev.deltaY * zoomSpeed));
    }
  };

  const handlePointerLockChange = () => {
    const isLocked = document.pointerLockElement != null;
    if (locked !== isLocked) {
      locked = isLocked;
      flyActive = locked;
      if (!locked) {
        keys.clear();
      }
      options.onLockChange?.(locked);
      if (!locked) dragging = false;
    }
  };

  const viewMat = new Float32Array(16);
  const projMat = new Float32Array(16);
  const viewProjMat = new Float32Array(16);

  const update = (dt: number) => {
    const cam = options.getCamera();
    if (cam.mode !== 'fly') return;
    const move = moveSpeed * dt;
    const f = forward(cam);
    const r = right(cam);
    if (keys.has('w')) translate(f, move);
    if (keys.has('s')) translate(f, -move);
    if (keys.has('a')) translate(r, -move);
    if (keys.has('d')) translate(r, move);
    if (keys.has('q') || keys.has('shift')) cam.position[1] -= move;
    if (keys.has('e') || keys.has(' ')) cam.position[1] += move;
  };

  const viewProj = (aspect: number, near: number, far: number, fovY = Math.PI / 3) => {
    const backend = getCameraMathBackend();
    if (backend) {
      return backend.viewProj(options.getCamera(), aspect, near, far, fovY, viewProjMat);
    }
    perspectiveInto(projMat, fovY, aspect, near, far);
    viewMatrixInto(viewMat, options.getCamera());
    return mulMat4Into(viewProjMat, projMat, viewMat);
  };

  const frame = (positions: Float32Array, targetIds?: number[], padding?: number) => {
    if (!positions.length) return;
    const useTargets = targetIds && targetIds.length > 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    if (useTargets) {
      for (const id of targetIds) {
        const idx = id * 3;
        if (idx + 2 >= positions.length) continue;
        const x = positions[idx];
        const y = positions[idx + 1];
        const z = positions[idx + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    } else {
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    if (!Number.isFinite(minX)) {
      return;
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    let radius = 0;
    if (useTargets) {
      for (const id of targetIds ?? []) {
        const idx = id * 3;
        if (idx + 2 >= positions.length) continue;
        const dx = positions[idx] - cx;
        const dy = positions[idx + 1] - cy;
        const dz = positions[idx + 2] - cz;
        radius = Math.max(radius, Math.hypot(dx, dy, dz));
      }
    } else {
      for (let i = 0; i < positions.length; i += 3) {
        const dx = positions[i] - cx;
        const dy = positions[i + 1] - cy;
        const dz = positions[i + 2] - cz;
        radius = Math.max(radius, Math.hypot(dx, dy, dz));
      }
    }
    const pad = padding ?? options.profile.autoFrame?.padding ?? 1.4;
    const distance = Math.max(0.5, radius * pad);
    const cam = options.getCamera();
    if (cam.mode === 'orbit' || cam.mode === 'track') {
      cam.target = [cx, cy, cz];
      cam.distance = distance;
    } else {
      cam.position = [cx, cy, cz + distance];
    }
  };

  const attach = ({ canvas, keyTarget = window, pointerTarget = window, wheelTarget = canvas }: CameraRigAttachOptions) => {
    keyTarget.addEventListener('keydown', handleKeyDown);
    keyTarget.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('pointerdown', handlePointerDown);
    pointerTarget.addEventListener('pointerup', handlePointerUp);
    pointerTarget.addEventListener('pointermove', handlePointerMove);
    wheelTarget.addEventListener('wheel', handleWheel, { passive: true });
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      keyTarget.removeEventListener('keydown', handleKeyDown);
      keyTarget.removeEventListener('keyup', handleKeyUp);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      pointerTarget.removeEventListener('pointerup', handlePointerUp);
      pointerTarget.removeEventListener('pointermove', handlePointerMove);
      wheelTarget.removeEventListener('wheel', handleWheel);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  };

  const currentMode = resolveMode(options.getMode());
  if (currentMode !== options.getMode()) {
    options.setMode(currentMode);
  }
  syncCameraMode(currentMode);

  return {
    setMode,
    toggleMode,
    handleKeyDown,
    handleKeyUp,
    handlePointerDown,
    handlePointerUp,
    handlePointerMove,
    handleWheel,
    handlePointerLockChange,
    update,
    viewProj,
    frame,
    attach
  };
}
