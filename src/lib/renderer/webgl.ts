import lineVS from './shaders/line.vert.glsl?raw';
import lineFS from './shaders/line.frag.glsl?raw';
import meshVS from './shaders/mesh.vert.glsl?raw';
import meshFS from './shaders/mesh.frag.glsl?raw';
import { makeSphere } from './mesh';

function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed');
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed');
  }
  return { program, vs, fs };
}

export function initLineRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('WebGL2 not supported');

  const { program, vs, fs } = createProgram(gl, lineVS, lineFS);
  gl.useProgram(program);
  const posBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const viewProjLoc = gl.getUniformLocation(program, 'u_viewProj');

  // Reference geometry: axes + horizon ring.
  const refPositions: number[] = [
    -5, 0, 0, 5, 0, 0,
    0, -5, 0, 0, 5, 0,
    0, 0, -5, 0, 0, 5
  ];
  const refIndices: number[] = [0, 1, 2, 3, 4, 5];
  const ringSegments = 32;
  const ringStart = refPositions.length / 3;
  for (let i = 0; i < ringSegments; i++) {
    const a = (i / ringSegments) * Math.PI * 2;
    refPositions.push(Math.cos(a) * 3.5, 0, Math.sin(a) * 3.5);
    if (i > 0) refIndices.push(ringStart + i - 1, ringStart + i);
  }
  refIndices.push(ringStart + ringSegments - 1, ringStart);

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(canvas.clientWidth * dpr);
    const height = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();
  window.addEventListener('resize', resize);

  const render = (positions: Float32Array, indices: Uint16Array | Uint32Array, viewProj: Float32Array) => {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniformMatrix4fv(viewProjLoc, false, viewProj);

    const mergedPositions = new Float32Array((positions.length / 3 + refPositions.length / 3) * 3);
    mergedPositions.set(refPositions, 0);
    mergedPositions.set(positions, refPositions.length);

    const use32 = mergedPositions.length / 3 > 65535 || indices instanceof Uint32Array;
    const mergedIndices = use32 ? new Uint32Array(refIndices.length + indices.length) : new Uint16Array(refIndices.length + indices.length);
    const refArray = use32 ? new Uint32Array(refIndices) : new Uint16Array(refIndices);
    mergedIndices.set(refArray, 0);
    const offset = refPositions.length / 3;
    for (let i = 0; i < indices.length; i++) {
      mergedIndices[refArray.length + i] = (indices[i] as number) + offset;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mergedPositions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mergedIndices, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.LINES, mergedIndices.length, use32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
  };

  const dispose = () => {
    window.removeEventListener('resize', resize);
    gl.deleteBuffer(posBuffer);
    gl.deleteBuffer(indexBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  };

  return { render, dispose, resize, gl };
}

export function initMeshRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('WebGL2 not supported');
  const { program, vs, fs } = createProgram(gl, meshVS, meshFS);
  gl.useProgram(program);
  const posBuffer = gl.createBuffer();
  const normalBuffer = gl.createBuffer();
  const uvBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  const viewProjLoc = gl.getUniformLocation(program, 'u_viewProj');
  const hasTexLoc = gl.getUniformLocation(program, 'u_hasTex');
  const texLoc = gl.getUniformLocation(program, 'u_tex');
  const lightDirLoc = gl.getUniformLocation(program, 'u_lightDir');
  const lightColorLoc = gl.getUniformLocation(program, 'u_lightColor');
  const shadingLoc = gl.getUniformLocation(program, 'u_shading');

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(canvas.clientWidth * dpr);
    const height = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();
  window.addEventListener('resize', resize);

  const render = (positions: Float32Array, normals: Float32Array, indices: Uint16Array | Uint32Array, viewProj: Float32Array, uvs?: Float32Array, texture?: WebGLTexture | null, shading = 1, lightDir: [number, number, number] = [0.2, 0.9, 0.3], lightColor: [number, number, number] = [1, 1, 1]) => {
    gl.clearColor(0.02, 0.03, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniformMatrix4fv(viewProjLoc, false, viewProj);
    gl.enable(gl.DEPTH_TEST);
    gl.uniform3fv(lightDirLoc, lightDir);
    gl.uniform3fv(lightColorLoc, lightColor);
    gl.uniform1i(shadingLoc, shading);
    gl.uniform1i(hasTexLoc, texture ? 1 : 0);
    if (texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(texLoc, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.DYNAMIC_DRAW);
    if (uvs) {
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.DYNAMIC_DRAW);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, indices.length, indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
  };

  const dispose = () => {
    window.removeEventListener('resize', resize);
    gl.deleteBuffer(posBuffer);
    gl.deleteBuffer(normalBuffer);
    gl.deleteBuffer(uvBuffer);
    gl.deleteBuffer(indexBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  };

  return { render, dispose, resize, gl };
}

export function initPendulumRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('WebGL2 not supported');

  // Programs
  const lineProg = createProgram(gl, lineVS, lineFS);
  const meshProg = createProgram(gl, meshVS, meshFS);

  // Line buffers
  const linePos = gl.createBuffer();
  const lineIdx = gl.createBuffer();
  // Mesh buffers
  const meshPos = gl.createBuffer();
  const meshNorm = gl.createBuffer();
  const meshIdx = gl.createBuffer();

  // Attribute setup
  gl.useProgram(lineProg.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, linePos);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const lineViewProj = gl.getUniformLocation(lineProg.program, 'u_viewProj');

  gl.useProgram(meshProg.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshPos);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshNorm);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  const meshViewProj = gl.getUniformLocation(meshProg.program, 'u_viewProj');

  // Reference geometry
  const refPositions: number[] = [
    -5, 0, 0, 5, 0, 0,
    0, -5, 0, 0, 5, 0,
    0, 0, -5, 0, 0, 5
  ];
  const refIndices: number[] = [0, 1, 2, 3, 4, 5];
  const ringSegments = 32;
  const ringStart = refPositions.length / 3;
  for (let i = 0; i < ringSegments; i++) {
    const a = (i / ringSegments) * Math.PI * 2;
    refPositions.push(Math.cos(a) * 3.5, 0, Math.sin(a) * 3.5);
    if (i > 0) refIndices.push(ringStart + i - 1, ringStart + i);
  }
  refIndices.push(ringStart + ringSegments - 1, ringStart);

  // Base sphere mesh
  const baseSphere = makeSphere(16);

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(canvas.clientWidth * dpr);
    const height = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();
  window.addEventListener('resize', resize);

  const render = (positions: Float32Array, viewProj: Float32Array) => {
    gl.clearColor(0.02, 0.03, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const count = positions.length / 3;

    // Lines: reference + pendulum shafts
    const shaftCount = Math.max(0, count - 1);
    const linePosArr = new Float32Array(refPositions.length + positions.length);
    linePosArr.set(refPositions, 0);
    linePosArr.set(positions, refPositions.length);

    const useLine32 = (refPositions.length / 3 + count) > 65535;
    const lineIdxArr = useLine32 ? new Uint32Array(refIndices.length + shaftCount * 2) : new Uint16Array(refIndices.length + shaftCount * 2);
    const refIdxArr = useLine32 ? new Uint32Array(refIndices) : new Uint16Array(refIndices);
    lineIdxArr.set(refIdxArr, 0);
    let idx = refIdxArr.length;
    const offset = refPositions.length / 3;
    for (let i = 0; i < shaftCount; i++) {
      lineIdxArr[idx++] = offset + i;
      lineIdxArr[idx++] = offset + i + 1;
    }

    gl.useProgram(lineProg.program);
    gl.uniformMatrix4fv(lineViewProj, false, viewProj);
    gl.bindBuffer(gl.ARRAY_BUFFER, linePos);
    gl.bufferData(gl.ARRAY_BUFFER, linePosArr, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIdxArr, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.LINES, lineIdxArr.length, useLine32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);

    // Spheres per particle (simple duplication)
    const vertsPerSphere = baseSphere.positions.length / 3;
    const idxPerSphere = baseSphere.indices.length;
    const totalVerts = vertsPerSphere * count;
    const totalIdx = idxPerSphere * count;
    const useMesh32 = totalVerts > 65535 || baseSphere.indices instanceof Uint32Array;
    const spherePositions = new Float32Array(totalVerts * 3);
    const sphereNormals = new Float32Array(totalVerts * 3);
    const sphereIndices = useMesh32 ? new Uint32Array(totalIdx) : new Uint16Array(totalIdx);

    for (let i = 0; i < count; i++) {
      const px = positions[i * 3 + 0];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const posOffset = i * vertsPerSphere * 3;
      const idxOffset = i * idxPerSphere;
      // translate sphere
      for (let v = 0; v < vertsPerSphere; v++) {
        spherePositions[posOffset + v * 3 + 0] = baseSphere.positions[v * 3 + 0] * 0.15 + px;
        spherePositions[posOffset + v * 3 + 1] = baseSphere.positions[v * 3 + 1] * 0.15 + py;
        spherePositions[posOffset + v * 3 + 2] = baseSphere.positions[v * 3 + 2] * 0.15 + pz;
        sphereNormals[posOffset + v * 3 + 0] = baseSphere.normals[v * 3 + 0];
        sphereNormals[posOffset + v * 3 + 1] = baseSphere.normals[v * 3 + 1];
        sphereNormals[posOffset + v * 3 + 2] = baseSphere.normals[v * 3 + 2];
      }
      for (let k = 0; k < idxPerSphere; k++) {
        sphereIndices[idxOffset + k] = (baseSphere.indices[k] as number) + i * vertsPerSphere;
      }
    }

    gl.useProgram(meshProg.program);
    gl.uniformMatrix4fv(meshViewProj, false, viewProj);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshPos);
    gl.bufferData(gl.ARRAY_BUFFER, spherePositions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshNorm);
    gl.bufferData(gl.ARRAY_BUFFER, sphereNormals, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphereIndices, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, sphereIndices.length, useMesh32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
  };

  const dispose = () => {
    window.removeEventListener('resize', resize);
    gl.deleteBuffer(linePos);
    gl.deleteBuffer(lineIdx);
    gl.deleteBuffer(meshPos);
    gl.deleteBuffer(meshNorm);
    gl.deleteBuffer(meshIdx);
    gl.deleteProgram(lineProg.program);
    gl.deleteProgram(meshProg.program);
    gl.deleteShader(lineProg.vs);
    gl.deleteShader(lineProg.fs);
    gl.deleteShader(meshProg.vs);
    gl.deleteShader(meshProg.fs);
  };

  return { render, dispose, resize, gl };
}
