import * as THREE from "three";

const PARTICLES = 90;
const LIFE = 9; // sekundy zycia klebu przy tempie 1×
const RISE = 4; // m/s
const WIND = new THREE.Vector3(2.2, 0, 1.2); // wiatr od morza na lad, m/s

export interface Smoke {
  /** `rate` 0..1: produkcja zakladu (0 = komin nie dymi); `dt` w sekundach. */
  update(rate: number, dt: number, light: number): void;
}

const vertex = /* glsl */ `
  attribute float age;
  uniform float size;
  uniform float screen;
  varying float vAge;
  varying float vNear;
  void main() {
    vAge = age;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (1.0 + 3.0 * age) / -mv.z;
    // klab tuz przy kamerze (zblizenie na zaklad) zajmowalby pol ekranu, a kilka takich daje biala
    // plame — gasnie, gdy urosnie ponad ok. dziesiata czesc wysokosci obrazu (niezaleznie od ujecia)
    vNear = 1.0 - smoothstep(0.04, 0.1, gl_PointSize / screen);
    gl_Position = projectionMatrix * mv;
  }
`;
const fragment = /* glsl */ `
  uniform vec3 color;
  varying float vAge;
  varying float vNear;
  void main() {
    if (vAge >= 1.0) discard;
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = smoothstep(1.0, 0.2, d) * (1.0 - vAge) * min(1.0, vAge * 6.0) * 0.45 * vNear;
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Dym z komina: kleby wznosza sie, rosna, znosi je wiatr i zanikaja. Ile ich leci, zalezy od
 * produkcji zakladu — w strajku komin przestaje dymic. Jeden obiekt Points na komin, stala pula
 * czastek bez alokacji w trakcie animacji.
 */
export function createSmoke(scene: THREE.Scene, origin: THREE.Vector3, pixelRatio: number, size = 5200): Smoke {
  const positions = new Float32Array(PARTICLES * 3);
  const ages = new Float32Array(PARTICLES).fill(1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("age", new THREE.BufferAttribute(ages, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { size: { value: size * pixelRatio }, screen: { value: 1 }, color: { value: new THREE.Color() } },
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  let next = 0;
  let debt = 0;
  return {
    update(rate, dt, light) {
      (material.uniforms.color as THREE.IUniform<THREE.Color>).value.setScalar(0.05 + 0.6 * light);
      // wysokosc obrazu w pikselach bufora (w nich liczy sie gl_PointSize)
      (material.uniforms.screen as THREE.IUniform<number>).value = window.innerHeight * pixelRatio;
      debt += (rate * PARTICLES * dt) / LIFE;
      while (debt >= 1) {
        debt -= 1;
        positions[next * 3] = origin.x + Math.random() - 0.5;
        positions[next * 3 + 1] = origin.y;
        positions[next * 3 + 2] = origin.z + Math.random() - 0.5;
        ages[next] = 0;
        next = (next + 1) % PARTICLES;
      }
      for (let i = 0; i < PARTICLES; i++) {
        const age = ages[i] as number;
        if (age >= 1) continue;
        const k = i * 3;
        positions[k] = (positions[k] as number) + WIND.x * dt;
        positions[k + 1] = (positions[k + 1] as number) + RISE * (1 - age * 0.6) * dt;
        positions[k + 2] = (positions[k + 2] as number) + WIND.z * dt;
        ages[i] = Math.min(1, age + dt / LIFE);
      }
      (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (geometry.getAttribute("age") as THREE.BufferAttribute).needsUpdate = true;
    },
  };
}
