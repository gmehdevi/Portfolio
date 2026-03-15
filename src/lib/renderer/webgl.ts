import lineVS from './shaders/line.vert.glsl?raw';
import lineFS from './shaders/line.frag.glsl?raw';
import meshVS from './shaders/mesh.vert.glsl?raw';
import meshFS from './shaders/mesh.frag.glsl?raw';
import instancedVS from './shaders/instanced_mesh.vert.glsl?raw';
import pointsVS from './shaders/points.vert.glsl?raw';
import pointsFS from './shaders/points.frag.glsl?raw';
import { makeSphere } from './mesh';
import {
  BUFFER_UVS,
  CMD_LINES,
  CMD_INSTANCED_MESH,
  CMD_MESH,
  CMD_POINTS,
  CMD_SPHERES,
  RENDER_PACKET_MAGIC,
  floatFromBits,
  forEachPacketCommand,
  type PacketMaterial,
  type RenderBufferMap,
  type RenderPacket,
  unpackMeshAux
} from './packet';

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

type MeshPipeline = {
  draw: (options: {
    positions: Float32Array;
    normals?: Float32Array;
    indices: Uint16Array | Uint32Array;
    count?: number;
    viewProj: Float32Array;
    material?: PacketMaterial;
    uvs?: Float32Array;
  }) => void;
  dispose: () => void;
};

function createMeshPipeline(gl: WebGL2RenderingContext, program: WebGLProgram): MeshPipeline {
  const posBuffer = gl.createBuffer();
  const normalBuffer = gl.createBuffer();
  const uvBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bindVertexArray(null);

  const viewProjLoc = gl.getUniformLocation(program, 'u_viewProj');
  const hasTexLoc = gl.getUniformLocation(program, 'u_hasTex');
  const texLoc = gl.getUniformLocation(program, 'u_tex');
  const lightDirLoc = gl.getUniformLocation(program, 'u_lightDir');
  const lightColorLoc = gl.getUniformLocation(program, 'u_lightColor');
  const shadingLoc = gl.getUniformLocation(program, 'u_shading');

  const draw = ({ positions, normals, indices, count, viewProj, material, uvs }: {
    positions: Float32Array;
    normals?: Float32Array;
    indices: Uint16Array | Uint32Array;
    count?: number;
    viewProj: Float32Array;
    material?: PacketMaterial;
    uvs?: Float32Array;
  }) => {
    if (!indices.length) return;
    gl.useProgram(program);
    gl.uniformMatrix4fv(viewProjLoc, false, viewProj);
    const shading = material?.shading ?? 1;
    const lightDir = material?.lightDir ?? [0.2, 0.9, 0.3];
    const lightColor = material?.lightColor ?? [1, 1, 1];
    gl.uniform3fv(lightDirLoc, lightDir);
    gl.uniform3fv(lightColorLoc, lightColor);
    gl.uniform1i(shadingLoc, shading);
    if (material?.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, material.texture);
      gl.uniform1i(texLoc, 0);
      gl.uniform1i(hasTexLoc, 1);
    } else {
      gl.uniform1i(hasTexLoc, 0);
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);

    if (normals && normals.length >= positions.length) {
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
    } else {
      gl.disableVertexAttribArray(1);
      gl.vertexAttrib3f(1, 0, 1, 0);
    }

    if (uvs && uvs.length / 2 >= positions.length / 3) {
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
    } else {
      gl.disableVertexAttribArray(2);
      gl.vertexAttrib2f(2, 0, 0);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
    const drawCount = count ?? indices.length;
    gl.drawElements(gl.TRIANGLES, drawCount, indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  };

  const dispose = () => {
    gl.deleteBuffer(posBuffer);
    gl.deleteBuffer(normalBuffer);
    gl.deleteBuffer(uvBuffer);
    gl.deleteBuffer(indexBuffer);
    gl.deleteVertexArray(vao);
  };

  return { draw, dispose };
}


export function initPacketRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('WebGL2 not supported');

  const lineProg = createProgram(gl, lineVS, lineFS);
  const sphereProg = createProgram(gl, instancedVS, meshFS);
  const pointProg = createProgram(gl, pointsVS, pointsFS);
  const meshProg = createProgram(gl, meshVS, meshFS);

  const linePos = gl.createBuffer();
  const lineIdx = gl.createBuffer();
  const lineVao = gl.createVertexArray();
  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, linePos);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIdx);
  gl.bindVertexArray(null);

  const baseSphere = makeSphere(16);
  const spherePos = gl.createBuffer();
  const sphereNorm = gl.createBuffer();
  const sphereUv = gl.createBuffer();
  const sphereIdx = gl.createBuffer();
  const sphereInstance = gl.createBuffer();
  const sphereVao = gl.createVertexArray();
  gl.bindVertexArray(sphereVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, spherePos);
  gl.bufferData(gl.ARRAY_BUFFER, baseSphere.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, sphereNorm);
  gl.bufferData(gl.ARRAY_BUFFER, baseSphere.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, sphereUv);
  gl.bufferData(gl.ARRAY_BUFFER, baseSphere.uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, sphereInstance);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereIdx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, baseSphere.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const pointPos = gl.createBuffer();
  const pointVao = gl.createVertexArray();
  gl.bindVertexArray(pointVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, pointPos);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const instancedMeshPos = gl.createBuffer();
  const instancedMeshNorm = gl.createBuffer();
  const instancedMeshUv = gl.createBuffer();
  const instancedMeshIdx = gl.createBuffer();
  const instancedMeshInstance = gl.createBuffer();
  const instancedMeshVao = gl.createVertexArray();
  gl.bindVertexArray(instancedMeshVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, instancedMeshPos);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instancedMeshNorm);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instancedMeshUv);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instancedMeshInstance);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, instancedMeshIdx);
  gl.bindVertexArray(null);

  const meshPipeline = createMeshPipeline(gl, meshProg.program);

  const lineViewProjLoc = gl.getUniformLocation(lineProg.program, 'u_viewProj');
  const sphereViewProjLoc = gl.getUniformLocation(sphereProg.program, 'u_viewProj');
  const sphereRadiusLoc = gl.getUniformLocation(sphereProg.program, 'u_radius');
  const sphereLightDirLoc = gl.getUniformLocation(sphereProg.program, 'u_lightDir');
  const sphereLightColorLoc = gl.getUniformLocation(sphereProg.program, 'u_lightColor');
  const sphereShadingLoc = gl.getUniformLocation(sphereProg.program, 'u_shading');
  const sphereHasTexLoc = gl.getUniformLocation(sphereProg.program, 'u_hasTex');
  const sphereTexLoc = gl.getUniformLocation(sphereProg.program, 'u_tex');
  const pointViewProjLoc = gl.getUniformLocation(pointProg.program, 'u_viewProj');
  const pointSizeLoc = gl.getUniformLocation(pointProg.program, 'u_pointSize');
  const pointColorLoc = gl.getUniformLocation(pointProg.program, 'u_color');

  const sphereIndexType = baseSphere.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  const sphereIndexCount = baseSphere.indices.length;

  let lineIndexCacheCount = 0;
  let lineIndexArray: Uint16Array | Uint32Array = new Uint16Array(0);
  let lineIndexType = gl.UNSIGNED_SHORT;

  const ensureLineIndices = (count: number) => {
    const segments = Math.max(0, count - 1);
    const use32 = count > 65535;
    const needNew = count !== lineIndexCacheCount || (use32 && !(lineIndexArray instanceof Uint32Array)) || (!use32 && !(lineIndexArray instanceof Uint16Array));
    if (!needNew) return;
    lineIndexCacheCount = count;
    lineIndexType = use32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    lineIndexArray = use32 ? new Uint32Array(segments * 2) : new Uint16Array(segments * 2);
    for (let i = 0; i < segments; i++) {
      lineIndexArray[i * 2 + 0] = i;
      lineIndexArray[i * 2 + 1] = i + 1;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIndexArray, gl.STATIC_DRAW);
  };

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

  const drawLines = (positions: Float32Array, count: number, viewProj: Float32Array) => {
    if (count < 2) return;
    ensureLineIndices(count);
    gl.lineWidth(2);
    gl.useProgram(lineProg.program);
    gl.uniformMatrix4fv(lineViewProjLoc, false, viewProj);
    gl.bindVertexArray(lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, linePos);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.LINES, (count - 1) * 2, lineIndexType, 0);
    gl.bindVertexArray(null);
  };

  const drawSpheres = (positions: Float32Array, count: number, radius: number, viewProj: Float32Array) => {
    if (count <= 0) return;
    gl.useProgram(sphereProg.program);
    gl.uniformMatrix4fv(sphereViewProjLoc, false, viewProj);
    gl.uniform1f(sphereRadiusLoc, radius);
    gl.uniform3fv(sphereLightDirLoc, [0.2, 0.9, 0.3]);
    gl.uniform3fv(sphereLightColorLoc, [1, 1, 1]);
    gl.uniform1i(sphereShadingLoc, 1);
    gl.uniform1i(sphereHasTexLoc, 0);
    gl.bindVertexArray(sphereVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, sphereInstance);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.drawElementsInstanced(gl.TRIANGLES, sphereIndexCount, sphereIndexType, 0, count);
    gl.bindVertexArray(null);
  };

  const drawPoints = (positions: Float32Array, count: number, size: number, viewProj: Float32Array) => {
    if (count <= 0) return;
    gl.useProgram(pointProg.program);
    gl.uniformMatrix4fv(pointViewProjLoc, false, viewProj);
    gl.uniform1f(pointSizeLoc, size);
    gl.uniform3fv(pointColorLoc, [0.6, 0.8, 1.0]);
    gl.bindVertexArray(pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointPos);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
  };

  const drawMesh = (
    positions: Float32Array,
    normals: Float32Array | undefined,
    indices: Uint16Array | Uint32Array,
    count: number,
    viewProj: Float32Array,
    material?: PacketMaterial,
    uvs?: Float32Array
  ) => {
    if (count <= 0) return;
    meshPipeline.draw({
      positions,
      normals,
      indices,
      count,
      viewProj,
      material,
      uvs
    });
  };

  const drawInstancedMesh = (
    basePositions: Float32Array,
    baseNormals: Float32Array | undefined,
    baseIndices: Uint16Array | Uint32Array,
    baseUvs: Float32Array | undefined,
    instancePositions: Float32Array,
    instanceCount: number,
    viewProj: Float32Array,
    material?: PacketMaterial
  ) => {
    if (instanceCount <= 0 || baseIndices.length === 0) return;
    gl.useProgram(sphereProg.program);
    gl.uniformMatrix4fv(sphereViewProjLoc, false, viewProj);
    gl.uniform1f(sphereRadiusLoc, 1.0);
    const shading = material?.shading ?? 1;
    const lightDir = material?.lightDir ?? [0.2, 0.9, 0.3];
    const lightColor = material?.lightColor ?? [1, 1, 1];
    gl.uniform3fv(sphereLightDirLoc, lightDir);
    gl.uniform3fv(sphereLightColorLoc, lightColor);
    gl.uniform1i(sphereShadingLoc, shading);
    if (material?.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, material.texture);
      gl.uniform1i(sphereHasTexLoc, 1);
      gl.uniform1i(sphereTexLoc, 0);
    } else {
      gl.uniform1i(sphereHasTexLoc, 0);
    }
    gl.bindVertexArray(instancedMeshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instancedMeshPos);
    gl.bufferData(gl.ARRAY_BUFFER, basePositions, gl.DYNAMIC_DRAW);
    if (baseNormals && baseNormals.length >= basePositions.length) {
      gl.bindBuffer(gl.ARRAY_BUFFER, instancedMeshNorm);
      gl.bufferData(gl.ARRAY_BUFFER, baseNormals, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
    } else {
      gl.disableVertexAttribArray(1);
      gl.vertexAttrib3f(1, 0, 1, 0);
    }
    if (baseUvs && baseUvs.length / 2 >= basePositions.length / 3) {
      gl.bindBuffer(gl.ARRAY_BUFFER, instancedMeshUv);
      gl.bufferData(gl.ARRAY_BUFFER, baseUvs, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
    } else {
      gl.disableVertexAttribArray(2);
      gl.vertexAttrib2f(2, 0, 0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, instancedMeshInstance);
    gl.bufferData(gl.ARRAY_BUFFER, instancePositions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, instancedMeshIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, baseIndices, gl.DYNAMIC_DRAW);
    gl.drawElementsInstanced(gl.TRIANGLES, baseIndices.length, baseIndices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0, instanceCount);
    gl.bindVertexArray(null);
  };

  const render = (packet: RenderPacket, buffers: RenderBufferMap, viewProj: Float32Array, material?: PacketMaterial) => {
    gl.clearColor(0.02, 0.03, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    if (!packet || packet.length < 4 || packet[0] !== RENDER_PACKET_MAGIC) {
      return;
    }
    forEachPacketCommand(packet, (packetView, offset, kind, bufferId, cmdCount, aux, stride) => {
      const positions = buffers[bufferId];
      if (!positions || !(positions instanceof Float32Array)) {
        return;
      }
      const count = cmdCount > 0 ? cmdCount : Math.floor(positions.length / 3);
      if (kind === CMD_LINES) {
        drawLines(positions, count, viewProj);
      } else if (kind === CMD_SPHERES) {
        const radius = aux ? floatFromBits(aux) : 0.15;
        drawSpheres(positions, count, radius, viewProj);
      } else if (kind === CMD_POINTS) {
        const size = aux ? floatFromBits(aux) : 6.0;
        drawPoints(positions, count, size, viewProj);
      } else if (kind === CMD_MESH) {
        const { indicesId, normalsId } = unpackMeshAux(aux);
        const normals = buffers[normalsId];
        const indices = buffers[indicesId];
        const uvBuffer = buffers[BUFFER_UVS];
        if (!indices || !(indices instanceof Uint16Array || indices instanceof Uint32Array)) {
          return;
        }
        const indexCount = cmdCount > 0 ? cmdCount : indices.length;
        drawMesh(
          positions,
          normals instanceof Float32Array ? normals : undefined,
          indices,
          indexCount,
          viewProj,
          material,
          uvBuffer instanceof Float32Array ? uvBuffer : undefined
        );
      } else if (kind === CMD_INSTANCED_MESH) {
        if (stride < 6) {
          return;
        }
        const { indicesId, normalsId } = unpackMeshAux(aux);
        const meshPosId = packetView[offset + 4];
        const uvId = packetView[offset + 5];
        const basePositions = buffers[meshPosId];
        const baseNormals = buffers[normalsId];
        const baseIndices = buffers[indicesId];
        const baseUvs = buffers[uvId];
        if (!basePositions || !(basePositions instanceof Float32Array)) {
          return;
        }
        if (!baseIndices || !(baseIndices instanceof Uint16Array || baseIndices instanceof Uint32Array)) {
          return;
        }
        const instanceCount = cmdCount > 0 ? cmdCount : Math.floor(positions.length / 3);
        drawInstancedMesh(
          basePositions,
          baseNormals instanceof Float32Array ? baseNormals : undefined,
          baseIndices,
          baseUvs instanceof Float32Array ? baseUvs : undefined,
          positions,
          instanceCount,
          viewProj,
          material
        );
      }
    });
  };

  const dispose = () => {
    window.removeEventListener('resize', resize);
    gl.deleteBuffer(linePos);
    gl.deleteBuffer(lineIdx);
    gl.deleteBuffer(spherePos);
    gl.deleteBuffer(sphereNorm);
    gl.deleteBuffer(sphereUv);
    gl.deleteBuffer(sphereIdx);
    gl.deleteBuffer(sphereInstance);
    gl.deleteBuffer(pointPos);
    gl.deleteBuffer(instancedMeshPos);
    gl.deleteBuffer(instancedMeshNorm);
    gl.deleteBuffer(instancedMeshUv);
    gl.deleteBuffer(instancedMeshIdx);
    gl.deleteBuffer(instancedMeshInstance);
    gl.deleteVertexArray(lineVao);
    gl.deleteVertexArray(sphereVao);
    gl.deleteVertexArray(pointVao);
    gl.deleteVertexArray(instancedMeshVao);
    meshPipeline.dispose();
    gl.deleteProgram(lineProg.program);
    gl.deleteProgram(sphereProg.program);
    gl.deleteProgram(pointProg.program);
    gl.deleteProgram(meshProg.program);
    gl.deleteShader(lineProg.vs);
    gl.deleteShader(lineProg.fs);
    gl.deleteShader(sphereProg.vs);
    gl.deleteShader(sphereProg.fs);
    gl.deleteShader(pointProg.vs);
    gl.deleteShader(pointProg.fs);
    gl.deleteShader(meshProg.vs);
    gl.deleteShader(meshProg.fs);
  };

  return { render, dispose, resize, gl };
}
