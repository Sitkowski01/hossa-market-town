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
 * w poswiacie. Tlo daje strona (grafit z portfolio pod przezroczystym canvasem).
 */
export function createSky(renderer: THREE.WebGLRenderer, scene: THREE.Scene, lowPower = false): SkyLight {

  const sun = new THREE.DirectionalLight(0xfff1dc, DAY_SUN);
  sun.castShadow = true;
  // mapa cieni obejmuje cala makiete; na telefonie 2048 px wystarcza, a pamieci i czasu GPU 4x mniej
  const shadowSize = lowPower ? 2048 : 4096;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
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
      // tlo strony jest prawie czarne, wiec noca makieta potrzebuje wiecej ksiezyca, zeby nie zlac sie z nim
      sky.intensity = 0.25 + 1.45 * (1 - light.day);
      moon.intensity = 1.6 * (1 - light.day);

      fog.color.copy(FOG_DAY).lerp(FOG_STORM, storm ? 1 : 0).lerp(NIGHT_BLUE, 1 - light.day);
      fog.near = storm ? 120 : 500;
      fog.far = storm ? 700 : 1500;

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

/**
 * Podest pod cokolem: tlo strony jest prawie czarnym grafitem z portfolio (canvas przezroczysty),
 * wiec czarny cien bylby niewidoczny, a makieta wisialaby w prozni. Pod spodem lezy plama
 * jasniejszego grafitu jak swiatlo na stole fotograficznym, ciemniejsza tuz przy krawedzi cokolu
 * (cien kontaktowy). Bez zapisu glebokosci — nie zaslania niczego i nie bierze udzialu w cieniach.
 */
export function createGroundShadow(root: THREE.Object3D): THREE.Mesh {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(64, 64, 18, 64, 64, 64);
  // kolory sRGB (tak jak na ekranie): jasny grafit pod makieta, gasnacy ku brzegom
  grad.addColorStop(0, "rgba(123,138,156,0.55)");
  grad.addColorStop(0.5, "rgba(96,112,132,0.4)");
  grad.addColorStop(1, "rgba(69,85,113,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 1.45, size.z * 1.6),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, fog: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set((box.min.x + box.max.x) / 2, box.min.y - 0.5, (box.min.z + box.max.z) / 2 + size.z * 0.04);
  shadow.renderOrder = -1;
  return shadow;
}
