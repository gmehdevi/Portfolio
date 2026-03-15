export type MeshData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
};

export function makeSphere(segments = 24): MeshData {
  const lat = segments;
  const lon = segments * 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= lat; i++) {
    const v = i / lat;
    const theta = v * Math.PI;
    for (let j = 0; j <= lon; j++) {
      const u = j / lon;
      const phi = u * Math.PI * 2;
      const x = Math.sin(theta) * Math.cos(phi);
      const y = Math.cos(theta);
      const z = Math.sin(theta) * Math.sin(phi);
      positions.push(x, y, z);
      normals.push(x, y, z);
      uvs.push(u, v);
    }
  }
  const vertsPerRow = lon + 1;
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = i * vertsPerRow + j;
      const b = a + vertsPerRow;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, d, b, c);
    }
  }
  const use32 = positions.length / 3 > 65535;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: use32 ? new Uint32Array(indices) : new Uint16Array(indices)
  };
}

export function makeBox(size = 1): MeshData {
  const h = size * 0.5;
  const positions = [
    // +X
    h, -h, -h, h, -h, h, h, h, h, h, h, -h,
    // -X
    -h, -h, h, -h, -h, -h, -h, h, -h, -h, h, h,
    // +Y
    -h, h, -h, h, h, -h, h, h, h, -h, h, h,
    // -Y
    -h, -h, h, h, -h, h, h, -h, -h, -h, -h, -h,
    // +Z
    -h, -h, h, -h, h, h, h, h, h, h, -h, h,
    // -Z
    h, -h, -h, h, h, -h, -h, h, -h, -h, -h, -h
  ];
  const normals = [
    // +X
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    // -X
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    // +Y
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    // -Y
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    // +Z
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    // -Z
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1
  ];
  const uvs = [
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1
  ];
  const indices: number[] = [];
  for (let face = 0; face < 6; face++) {
    const offset = face * 4;
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices)
  };
}

export function makePlane(size = 1, segments = 1): MeshData {
  const div = Math.max(1, Math.floor(segments));
  const half = size * 0.5;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let z = 0; z <= div; z++) {
    const v = z / div;
    const zz = -half + v * size;
    for (let x = 0; x <= div; x++) {
      const u = x / div;
      const xx = -half + u * size;
      positions.push(xx, 0, zz);
      normals.push(0, 1, 0);
      uvs.push(u, v);
    }
  }
  const row = div + 1;
  for (let z = 0; z < div; z++) {
    for (let x = 0; x < div; x++) {
      const a = z * row + x;
      const b = a + row;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, d, b, c);
    }
  }
  const use32 = positions.length / 3 > 65535;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: use32 ? new Uint32Array(indices) : new Uint16Array(indices)
  };
}

export function makeCylinder(segments = 24, height = 1, radius = 0.5): MeshData {
  const seg = Math.max(3, Math.floor(segments));
  const half = height * 0.5;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Side surface
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = t * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    positions.push(x, -half, z, x, half, z);
    normals.push(x / radius, 0, z / radius, x / radius, 0, z / radius);
    uvs.push(t, 0, t, 1);
  }
  for (let i = 0; i < seg; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  const topCenterIndex = positions.length / 3;
  positions.push(0, half, 0);
  normals.push(0, 1, 0);
  uvs.push(0.5, 0.5);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = t * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    positions.push(x, half, z);
    normals.push(0, 1, 0);
    uvs.push(0.5 + x / (2 * radius), 0.5 + z / (2 * radius));
  }
  for (let i = 0; i < seg; i++) {
    indices.push(topCenterIndex, topCenterIndex + i + 1, topCenterIndex + i + 2);
  }

  const bottomCenterIndex = positions.length / 3;
  positions.push(0, -half, 0);
  normals.push(0, -1, 0);
  uvs.push(0.5, 0.5);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = t * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    positions.push(x, -half, z);
    normals.push(0, -1, 0);
    uvs.push(0.5 + x / (2 * radius), 0.5 + z / (2 * radius));
  }
  for (let i = 0; i < seg; i++) {
    indices.push(bottomCenterIndex, bottomCenterIndex + i + 2, bottomCenterIndex + i + 1);
  }

  const use32 = positions.length / 3 > 65535;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: use32 ? new Uint32Array(indices) : new Uint16Array(indices)
  };
}

export function makeTorus(segments = 24, tubeSegments = 12, radius = 1, tubeRadius = 0.3): MeshData {
  const ring = Math.max(3, Math.floor(segments));
  const tube = Math.max(3, Math.floor(tubeSegments));
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= ring; i++) {
    const u = (i / ring) * Math.PI * 2;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let j = 0; j <= tube; j++) {
      const v = (j / tube) * Math.PI * 2;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      const x = (radius + tubeRadius * cv) * cu;
      const y = tubeRadius * sv;
      const z = (radius + tubeRadius * cv) * su;
      const nx = cu * cv;
      const ny = sv;
      const nz = su * cv;
      positions.push(x, y, z);
      normals.push(nx, ny, nz);
      uvs.push(i / ring, j / tube);
    }
  }

  const row = tube + 1;
  for (let i = 0; i < ring; i++) {
    for (let j = 0; j < tube; j++) {
      const a = i * row + j;
      const b = a + row;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, d, b, c);
    }
  }

  const use32 = positions.length / 3 > 65535;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: use32 ? new Uint32Array(indices) : new Uint16Array(indices)
  };
}
