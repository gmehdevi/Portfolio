#version 300 es
precision highp float;
in vec3 vPos;
out vec4 outColor;
void main() {
  float g = clamp(vPos.y * 0.1 + 0.5, 0.0, 1.0);
  vec3 top = vec3(0.15, 0.25, 0.4);
  vec3 bottom = vec3(0.02, 0.05, 0.08);
  vec3 bg = mix(bottom, top, g);
  outColor = vec4(bg, 1.0);
}
