import * as THREE from "three";
import type { Model } from "./model.js";
import type { Stage } from "./stage.js";

/** Budynki spolek, gielda i pojazdy — kazdy ogladany osobno z pieciu stron. */
const MODELS = ["RUD", "STW", "MTK", "BPT", "KSZ", "GRS", "GIELDA", "statek", "ciezarowka_ruda", "ciezarowka_stal", "ciezarowka_maszyny", "pieszy_1"];

/** Ujecia, ktore widzi uzytkownik: start, rynek z gielda, port ze statkiem, kopalnia i huta. */
type Pose = readonly [number, number, number, number, number, number];
const START: Pose = [-110, 240, 300, 10, 0, -10];
const SHOTS: Readonly<Record<string, Pose>> = {
  start: START,
  rynek: [10, 45, 30, 0, 0, -40],
  port: [150, 70, 160, 80, 0, 100],
  kopalnia: [-60, 80, -20, -140, 10, -106],
  huta: [-60, 60, 60, -140, 10, -8],
};

/**
 * Hak dla petli szlifu (`window.__szlif3d`), tylko z parametrem ?szlif w adresie: izoluje model,
 * ustawia kamere dookola niego albo w nazwanym ujeciu i podaje statystyki renderera.
 */
export function installSzlifHook(stage: Stage, model: Model): void {
  if (!new URLSearchParams(location.search).has("szlif")) return;
  const { scene, camera, controls, renderer } = stage;
  const visibility = new Map<THREE.Object3D, boolean>();
  for (const o of scene.children) visibility.set(o, o.visible);
  for (const o of model.root.children) visibility.set(o, o.visible);
  // ciezarowke czy przechodnia oglada sie z kilku metrow; uzytkownik ma limit 40 m
  controls.minDistance = 1;
  const look = (position: THREE.Vector3, target: THREE.Vector3) => {
    controls.enableDamping = false;
    camera.position.copy(position);
    controls.target.copy(target);
    controls.update();
  };

  Object.assign(window, {
    __szlif3d: {
      ready: () => Promise.resolve(),
      models: () => [...MODELS],
      isolate: (name: string | null) => {
        // swiatla i makieta zostaja; ciezarowki, przechodnie i tabliczki znikaja razem z reszta
        for (const [o, visible] of visibility) o.visible = name ? o instanceof THREE.Light || o === model.root : visible;
        if (!name) return;
        for (const o of model.root.children) o.visible = false;
        // nieznana nazwa = sam teren (skrypt szlifu robi tak kadr tla do porownania)
        const target = model.root.getObjectByName(name);
        if (target) target.visible = true;
        // terenu nie chowamy: model stoi na ziemi, z cieniem, jak na makiecie
        for (const ground of ["teren", "morze"]) model.node(ground).visible = true;
      },
      orbit: ({ target, azimuth, elevation }: { target: string | null; azimuth: number; elevation: number }) => {
        const sphere = new THREE.Box3().setFromObject(target ? model.node(target) : model.root).getBoundingSphere(new THREE.Sphere());
        const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)) * 1.15;
        const a = THREE.MathUtils.degToRad(azimuth);
        const e = THREE.MathUtils.degToRad(elevation);
        look(new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(dist).add(sphere.center), sphere.center);
      },
      shots: () => Object.keys(SHOTS),
      shot: (name: string) => {
        const [x, y, z, tx, ty, tz] = SHOTS[name] ?? START;
        look(new THREE.Vector3(x, y, z), new THREE.Vector3(tx, ty, tz));
      },
      stats: () => {
        // jedna klatka samej sceny: composer liczy tylko ostatni przebieg (1 trojkat)
        renderer.info.autoReset = false;
        renderer.info.reset();
        renderer.render(scene, camera);
        renderer.info.autoReset = true;
        return {
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
        };
      },
      render: () => {
        stage.render();
      },
    },
  });
}
