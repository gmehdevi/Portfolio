#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
out vec4 outColor;
uniform bool u_hasTex;
uniform sampler2D u_tex;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform int u_shading; // 0: unlit, 1: lambert, 2: phong
void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(u_lightDir);
  float ndl = clamp(dot(n, l), 0.0, 1.0);
  vec3 base = u_hasTex ? texture(u_tex, vUv).rgb : vec3(0.7, 0.7, 0.9);
  vec3 color = base;
  if (u_shading == 1) { // lambert
    color = base * (0.15 + ndl * u_lightColor);
  } else if (u_shading == 2) { // phong-ish
    vec3 v = normalize(vec3(0.0, 0.0, 1.0));
    vec3 h = normalize(l + v);
    float ndh = clamp(dot(n, h), 0.0, 1.0);
    float spec = pow(ndh, 32.0);
    color = base * (0.15 + ndl * u_lightColor) + spec * u_lightColor;
  }
  outColor = vec4(color, 1.0);
}
