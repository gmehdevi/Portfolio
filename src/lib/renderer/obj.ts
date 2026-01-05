export type ObjData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
};

/**
  * Tolerant OBJ parser (positions, normals, uvs, triangulated).
  * Ignores malformed lines; computes default normals/uvs if missing.
  */
export function parseOBJ(text: string): ObjData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const faces: Array<[number, number, number][]> = [];

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    const op = parts[0];
    if (op === 'v' && parts.length >= 4) {
      positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (op === 'vn' && parts.length >= 4) {
      normals.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (op === 'vt' && parts.length >= 3) {
      uvs.push(parseFloat(parts[1]), parseFloat(parts[2]));
    } else if (op === 'f' && parts.length >= 4) {
      const face: [number, number, number][] = [];
      for (let i = 1; i < parts.length; i++) {
        const comps = parts[i].split('/');
        const vi = (parseInt(comps[0], 10) || 0) - 1;
        const ti = comps[1] ? (parseInt(comps[1], 10) || 0) - 1 : -1;
        const ni = comps[2] ? (parseInt(comps[2], 10) || 0) - 1 : -1;
        face.push([vi, ti, ni]);
      }
      // triangulate fan
      for (let i = 1; i + 1 < face.length; i++) {
        faces.push([face[0], face[i], face[i + 1]]);
      }
    }
  }

  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const outUVs: number[] = [];
  const outIndices: number[] = [];

  const posCount = positions.length / 3;
  const hasNormals = normals.length > 0;
  const hasUVs = uvs.length > 0;

  for (let fi = 0; fi < faces.length; fi++) {
    const tri = faces[fi];
    const idxBase = outPositions.length / 3;
    let faceNormal: [number, number, number] = [0, 0, 1];

    if (!hasNormals && tri.length === 3) {
      const [a, b, c] = tri;
      const ax = positions[a[0] * 3 + 0];
      const ay = positions[a[0] * 3 + 1];
      const az = positions[a[0] * 3 + 2];
      const bx = positions[b[0] * 3 + 0];
      const by = positions[b[0] * 3 + 1];
      const bz = positions[b[0] * 3 + 2];
      const cx = positions[c[0] * 3 + 0];
      const cy = positions[c[0] * 3 + 1];
      const cz = positions[c[0] * 3 + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      faceNormal = [nx / len, ny / len, nz / len];
    }

    for (const v of tri) {
      const [vi, ti, ni] = v;
      if (vi < 0 || vi >= posCount) continue;
      outPositions.push(positions[vi * 3 + 0], positions[vi * 3 + 1], positions[vi * 3 + 2]);
      if (hasNormals && ni >= 0 && ni * 3 + 2 < normals.length) {
        outNormals.push(normals[ni * 3 + 0], normals[ni * 3 + 1], normals[ni * 3 + 2]);
      } else {
        outNormals.push(faceNormal[0], faceNormal[1], faceNormal[2]);
      }
      if (hasUVs && ti >= 0 && ti * 2 + 1 < uvs.length) {
        outUVs.push(uvs[ti * 2 + 0], uvs[ti * 2 + 1]);
      } else {
        outUVs.push(0, 0);
      }
    }
    outIndices.push(idxBase, idxBase + 1, idxBase + 2);
  }

  const use32 = outPositions.length / 3 > 65535;
  return {
    positions: new Float32Array(outPositions),
    normals: new Float32Array(outNormals),
    uvs: new Float32Array(outUVs),
    indices: use32 ? new Uint32Array(outIndices) : new Uint16Array(outIndices)
  };
}
