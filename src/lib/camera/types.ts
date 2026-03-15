export type CameraMode = 'orbit' | 'fly' | 'track';

export type CameraProfile = {
  default: CameraMode;
  allowed: CameraMode[];
  targetIds?: number[];
  moveSpeed?: number;
  rotateSpeed?: number;
  zoomSpeed?: number;
  invertY?: boolean;
  toggleKey?: string;
  autoFrame?: {
    enabled?: boolean;
    padding?: number;
  };
};
