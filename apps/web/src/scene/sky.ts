import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import type { Daylight } from "../world/daylight.js";

const SUN_DISTANCE = 400;
const ENV_EVERY_MS = 1000;
const DAY_SUN = 3.2;
const NIGHT_BLUE = new THREE.Color(0x13213a);
const FOG_DAY = new THREE.Color(0xb8c7d6);
const FOG_STORM = new THREE.Color(0x56606b);

export interface SkyLight {
  update(light: Daylight, storm: boolean): void;
}

/** Ustawia niebo: slonce w danym kierunku, w sztorm mgliste i szare. */
function configure(sky: Sky, sun: THREE.Vector3, storm: boolean): void {
  const u = sky.material.uniforms as Record<"sunPosition" | "turbidity" | "rayleigh" | "mieCoefficient" | "mieDirectionalG", THREE.IUniform>;
  (u.sunPosition.value as THREE.Vector3).copy(sun);
  u.turbidity.value = storm ? 14 : 4;
  u.rayleigh.value = storm ? 3.5 : 1.2;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.8;
}

/**
 * Slonce, mgla i tlo. Jedno slonce rzuca cienie; otoczenie (odbicia i swiatlo rozproszone)
 * pochodzi z fizycznego nieba (Sky), przeliczanego do mapy otoczenia tylko wtedy, gdy slonce
 * przesunie sie zauwazalnie — i z ograniczona sila, zeby jasne tynki sie nie przepalaly.
 * Samego nieba nie widac: jest o rzedy wielkosci jasniejsze niz makieta i rozlewaloby sie
 * w poswiacie. Tlo to studyjna winieta w kolorze mgly: jasniej za makieta, ciemniej przy brzegach
 * ekranu — jak makieta sfotografowana na stole.
 */
export function createSky(renderer: THREE.WebGLRenderer, scene: THREE.Scene): SkyLight {

  const sun = new THREE.DirectionalLight(0xfff1dc, DAY_SUN);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  Object.assign(sun.shadow.camera, { left: -240, right: 240, top: 200, bottom: -200, near: 50, far: 900 });
  scene.add(sun, sun.target);

  // noca miasto oswietla ksiezyc: chlodne swiatlo z gory i slaby kierunkowy blask, zeby bryly
  // budynkow dalo sie odroznic; makieta ma byc widoczna takze w nocy
  const sky = new THREE.HemisphereLight(0x8fa8d8, 0x1a2230, 0);
  const moon = new THREE.DirectionalLight(0x9db4e0, 0);
  moon.position.set(-150, 260, -120);
  scene.add(sky, moon);
  const fog = new THREE.Fog(FOG_DAY, 500, 1500);
  scene.fog = fog;
  const backdrop = createBackdrop();
  scene.background = backdrop.texture;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  envScene.add(envSky);
  let env: { target: THREE.WebGLRenderTarget; sun: THREE.Vector3; storm: boolean; at: number } | undefined;

  return {
    update(light, storm) {
      const dir = new THREE.Vector3(...light.sun);

      sun.position.copy(dir).multiplyScalar(SUN_DISTANCE);
      sun.intensity = DAY_SUN * light.day * (storm ? 0.2 : 1);
      sun.visible = light.elevation > -2;
      sky.intensity = 0.25 + 1.1 * (1 - light.day);
      moon.intensity = 1.2 * (1 - light.day);

      fog.color.copy(FOG_DAY).lerp(FOG_STORM, storm ? 1 : 0).lerp(NIGHT_BLUE, 1 - light.day);
      fog.near = storm ? 120 : 500;
      fog.far = storm ? 700 : 1500;
      backdrop.paint(fog.color);

      // mapa otoczenia: przeliczana, gdy slonce przesunie sie o ~2° albo zmieni sie pogoda, ale
      // najwyzej raz na sekunde — przy 16× slonce rusza sie o 2° w kazdej klatce
      const now = performance.now();
      const moved = env && dir.angleTo(env.sun) > 0.035 && now - env.at > ENV_EVERY_MS;
      if (!env || moved || env.storm !== storm) {
        configure(envSky, dir, storm);
        env?.target.dispose();
        env = { target: pmrem.fromScene(envScene, 0, 0.1, 100, { size: 128 }), sun: dir, storm, at: now };
        scene.environment = env.target.texture;
      }
      scene.environmentIntensity = 0.1 + 0.25 * light.day * (storm ? 0.6 : 1);
    },
  };
}

/** Tlo ekranu: gradient promienisty z kolorow mgly, odmalowywany tylko przy zmianie koloru. */
function createBackdrop(): { texture: THREE.CanvasTexture; paint(colour: THREE.Color): void } {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  const light = new THREE.Color();
  const dark = new THREE.Color();
  const black = new THREE.Color(0x000000);
  const white = new THREE.Color(0xffffff);
  let painted = "";
  return {
    texture,
    paint(colour) {
      const key = colour.getHexString();
      if (key === painted) return;
      painted = key;
      light.copy(colour).lerp(white, 0.1);
      dark.copy(colour).lerp(black, 0.22);
      // srodek nieco nad srodkiem ekranu — tam zwykle stoi makieta
      const grad = g.createRadialGradient(128, 100, 10, 128, 100, 200);
      grad.addColorStop(0, `#${light.getHexString(THREE.SRGBColorSpace)}`);
      grad.addColorStop(0.55, `#${colour.getHexString(THREE.SRGBColorSpace)}`);
      grad.addColorStop(1, `#${dark.getHexString(THREE.SRGBColorSpace)}`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      texture.needsUpdate = true;
    },
  };
}
