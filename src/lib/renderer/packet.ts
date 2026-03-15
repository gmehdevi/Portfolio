export const RENDER_PACKET_MAGIC = 0x52504b54; // 'RPKT'
export const RENDER_PACKET_VERSION = 2;
export const RENDER_PACKET_STRIDE = 4;
export const RENDER_PACKET_STRIDE_INSTANCED = 6;

export const CMD_LINES = 0;
export const CMD_SPHERES = 1;
export const CMD_POINTS = 2;
export const CMD_MESH = 3;
export const CMD_INSTANCED_MESH = 4;

export const BUFFER_POSITIONS = 0;
export const BUFFER_VELOCITIES = 1;
export const BUFFER_NORMALS = 2;
export const BUFFER_INDICES = 3;
export const BUFFER_UVS = 4;
export const BUFFER_COLORS = 5;
export const BUFFER_SPRING_POSITIONS = 6;
export const BUFFER_RENDER_PACKET = 100;

export type RenderPacket = Uint32Array;
export type RenderBuffer = Float32Array | Uint16Array | Uint32Array;
export type RenderBufferMap = Record<number, RenderBuffer>;
export type PacketMaterial = {
  shading?: number;
  lightDir?: [number, number, number];
  lightColor?: [number, number, number];
  texture?: WebGLTexture | null;
};

export type BufferLayout = {
  components: number;
  type: 'f32' | 'u16' | 'u32' | 'u16/u32';
};

export let BUFFER_LAYOUTS: Record<number, BufferLayout> = {
  [BUFFER_POSITIONS]: { components: 3, type: 'f32' },
  [BUFFER_VELOCITIES]: { components: 3, type: 'f32' },
  [BUFFER_NORMALS]: { components: 3, type: 'f32' },
  [BUFFER_INDICES]: { components: 1, type: 'u16/u32' },
  [BUFFER_UVS]: { components: 2, type: 'f32' },
  [BUFFER_COLORS]: { components: 4, type: 'f32' },
  [BUFFER_SPRING_POSITIONS]: { components: 3, type: 'f32' }
};

const floatBits = new Float32Array(1);
const uintBits = new Uint32Array(floatBits.buffer);

export function setBufferLayouts(layouts: Record<number, BufferLayout>) {
  Object.assign(BUFFER_LAYOUTS, layouts);
}

export function getBufferLayouts(): Record<number, BufferLayout> {
  return BUFFER_LAYOUTS;
}

export function floatFromBits(bits: number): number {
  uintBits[0] = bits >>> 0;
  return floatBits[0];
}

export function floatToBits(value: number): number {
  floatBits[0] = value;
  return uintBits[0];
}

export function packMeshAux(indicesId: number, normalsId: number): number {
  return ((normalsId & 0xffff) << 16) | (indicesId & 0xffff);
}

export function unpackMeshAux(aux: number): { indicesId: number; normalsId: number } {
  const indicesId = aux & 0xffff;
  const normalsId = (aux >>> 16) & 0xffff;
  return { indicesId, normalsId };
}

const resolveBaseStride = (packet: RenderPacket): number => {
  if (packet.length < 4) return RENDER_PACKET_STRIDE;
  if (packet[1] >= 2) {
    const stride = packet[3] || RENDER_PACKET_STRIDE;
    return stride;
  }
  return RENDER_PACKET_STRIDE;
};

export function getCommandStride(kind: number, baseStride: number): number {
  switch (kind) {
    case CMD_INSTANCED_MESH:
      return RENDER_PACKET_STRIDE_INSTANCED;
    case CMD_LINES:
    case CMD_SPHERES:
    case CMD_POINTS:
    case CMD_MESH:
      return RENDER_PACKET_STRIDE;
    default:
      return baseStride || RENDER_PACKET_STRIDE;
  }
}

export function forEachPacketCommand(
  packet: RenderPacket,
  handler: (packet: RenderPacket, offset: number, kind: number, bufferId: number, count: number, aux: number, stride: number) => void
) {
  if (!packet || packet.length < 4 || packet[0] !== RENDER_PACKET_MAGIC) {
    return;
  }
  const commandCount = packet[2] ?? 0;
  const baseStride = resolveBaseStride(packet);
  let offset = 4;
  for (let i = 0; i < commandCount && offset + 3 < packet.length; i++) {
    const kind = packet[offset];
    const stride = getCommandStride(kind, baseStride);
    if (offset + stride > packet.length) {
      break;
    }
    handler(packet, offset, kind, packet[offset + 1], packet[offset + 2], packet[offset + 3], stride);
    offset += stride;
  }
}

export function buildLineSpherePacket(
  count: number,
  radius: number,
  previous?: RenderPacket,
  options?: { lineBufferId?: number; sphereBufferId?: number }
): RenderPacket {
  const commandCount = 2;
  const length = 4 + commandCount * RENDER_PACKET_STRIDE;
  const packet = previous && previous.length === length ? previous : new Uint32Array(length);
  const lineBufferId = options?.lineBufferId ?? BUFFER_POSITIONS;
  const sphereBufferId = options?.sphereBufferId ?? BUFFER_POSITIONS;
  packet[0] = RENDER_PACKET_MAGIC;
  packet[1] = RENDER_PACKET_VERSION;
  packet[2] = commandCount;
  packet[3] = RENDER_PACKET_STRIDE;

  packet[4] = CMD_LINES;
  packet[5] = lineBufferId;
  packet[6] = count;
  packet[7] = 0;

  packet[8] = CMD_SPHERES;
  packet[9] = sphereBufferId;
  packet[10] = count;
  packet[11] = floatToBits(radius);

  return packet;
}

export function buildSpherePacket(count: number, radius: number, previous?: RenderPacket): RenderPacket {
  const commandCount = 1;
  const length = 4 + commandCount * RENDER_PACKET_STRIDE;
  const packet = previous && previous.length === length ? previous : new Uint32Array(length);
  packet[0] = RENDER_PACKET_MAGIC;
  packet[1] = RENDER_PACKET_VERSION;
  packet[2] = commandCount;
  packet[3] = RENDER_PACKET_STRIDE;

  packet[4] = CMD_SPHERES;
  packet[5] = BUFFER_POSITIONS;
  packet[6] = count;
  packet[7] = floatToBits(radius);

  return packet;
}

export function buildPointPacket(count: number, size: number, previous?: RenderPacket): RenderPacket {
  const commandCount = 1;
  const length = 4 + commandCount * RENDER_PACKET_STRIDE;
  const packet = previous && previous.length === length ? previous : new Uint32Array(length);
  packet[0] = RENDER_PACKET_MAGIC;
  packet[1] = RENDER_PACKET_VERSION;
  packet[2] = commandCount;
  packet[3] = RENDER_PACKET_STRIDE;

  packet[4] = CMD_POINTS;
  packet[5] = BUFFER_POSITIONS;
  packet[6] = count;
  packet[7] = floatToBits(size);

  return packet;
}

export function buildMeshPacket(
  indexCount: number,
  options?: {
    positionBufferId?: number;
    normalBufferId?: number;
    indexBufferId?: number;
    previous?: RenderPacket;
  }
): RenderPacket {
  const commandCount = 1;
  const length = 4 + commandCount * RENDER_PACKET_STRIDE;
  const packet = options?.previous && options.previous.length === length ? options.previous : new Uint32Array(length);
  const positionBufferId = options?.positionBufferId ?? BUFFER_POSITIONS;
  const normalBufferId = options?.normalBufferId ?? BUFFER_NORMALS;
  const indexBufferId = options?.indexBufferId ?? BUFFER_INDICES;

  packet[0] = RENDER_PACKET_MAGIC;
  packet[1] = RENDER_PACKET_VERSION;
  packet[2] = commandCount;
  packet[3] = RENDER_PACKET_STRIDE;

  packet[4] = CMD_MESH;
  packet[5] = positionBufferId;
  packet[6] = indexCount;
  packet[7] = packMeshAux(indexBufferId, normalBufferId);

  return packet;
}

export function buildInstancedMeshPacket(
  instanceCount: number,
  options: {
    meshPositionBufferId: number;
    meshNormalBufferId: number;
    meshIndexBufferId: number;
    instanceBufferId: number;
    uvBufferId?: number;
    previous?: RenderPacket;
  }
): RenderPacket {
  const commandCount = 1;
  const length = 4 + commandCount * RENDER_PACKET_STRIDE_INSTANCED;
  const packet = options.previous && options.previous.length === length ? options.previous : new Uint32Array(length);
  packet[0] = RENDER_PACKET_MAGIC;
  packet[1] = RENDER_PACKET_VERSION;
  packet[2] = commandCount;
  packet[3] = RENDER_PACKET_STRIDE_INSTANCED;

  packet[4] = CMD_INSTANCED_MESH;
  packet[5] = options.instanceBufferId;
  packet[6] = instanceCount;
  packet[7] = packMeshAux(options.meshIndexBufferId, options.meshNormalBufferId);
  packet[8] = options.meshPositionBufferId;
  packet[9] = options.uvBufferId ?? 0;

  return packet;
}
