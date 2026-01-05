#pragma once

#include <cmath>

struct Vec3 {
  float x = 0.0f;
  float y = 0.0f;
  float z = 0.0f;
};

inline Vec3 operator+(const Vec3& a, const Vec3& b) {
  return {a.x + b.x, a.y + b.y, a.z + b.z};
}

inline Vec3 operator-(const Vec3& a, const Vec3& b) {
  return {a.x - b.x, a.y - b.y, a.z - b.z};
}

inline Vec3 operator*(const Vec3& v, float s) {
  return {v.x * s, v.y * s, v.z * s};
}

inline Vec3 operator*(float s, const Vec3& v) {
  return v * s;
}

inline Vec3 operator/(const Vec3& v, float s) {
  return {v.x / s, v.y / s, v.z / s};
}

inline Vec3& operator+=(Vec3& a, const Vec3& b) {
  a.x += b.x;
  a.y += b.y;
  a.z += b.z;
  return a;
}

inline Vec3& operator-=(Vec3& a, const Vec3& b) {
  a.x -= b.x;
  a.y -= b.y;
  a.z -= b.z;
  return a;
}

inline float dot(const Vec3& a, const Vec3& b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

inline float length(const Vec3& v) {
  return std::sqrt(dot(v, v));
}

inline Vec3 normalize(const Vec3& v) {
  float len = length(v);
  if (len <= 1e-6f) {
    return {0.0f, 0.0f, 0.0f};
  }
  return v / len;
}
