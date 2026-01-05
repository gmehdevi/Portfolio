export function makeSphere(segments = 24): {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
} {
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
