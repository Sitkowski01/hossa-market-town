import * as THREE from "three";
import type { Model } from "./model.js";
import type { Stage } from "./stage.js";

/** Budynki spolek, gielda i pojazdy — kazdy ogladany osobno z pieciu stron. */
const MODELS = ["RUD", "STW", "MTK", "BPT", "KSZ", "GRS", "GIELDA", "statek", "ciezarowka_ruda", "ciezarowka_stal", "ciezarowka_maszyny", "pieszy_1"];

/** Ujecia, ktore widzi uzytkownik: start, rynek z gielda, port ze statkiem, kopalnia i huta. */
/** Warstwa kamery z izolowanym modelem, terenem i swiatlami. */
const ISOLATED = 1;
type Pose = readonly [number, number, number, number, number, number];
/** Ujecia poza startowym, ktore bierzemy ze sceny (w pionie jest inne). */
const SHOTS: Readonly<Record<string, Pose>> = {
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
  // izolacja przez warstwy kamery, nie przez visible: petla klatek co klatke przestawia visible
  // tabliczek, przechodniow i ciezarowek, a warstw nie rusza
  const lights: THREE.Light[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Light) lights.push(o);
  });
  let forced: THREE.Object3D | null = null;
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
        scene.traverse((o) => {
          o.layers.disable(ISOLATED);
        });
        if (forced) forced.visible = false;
        forced = null;
        const layer = name ? ISOLATED : 0;
        camera.layers.set(layer);
        // cienie tez tylko od widocznych obiektow — inaczej schowane domy rzucalyby cien na teren
        for (const l of lights) if (l instanceof THREE.DirectionalLight) l.shadow.camera.layers.set(layer);
        if (!name) return;
        const show = (o: THREE.Object3D) => {
          o.traverse((c) => {
            c.layers.enable(ISOLATED);
          });
        };
        for (const l of lights) l.layers.enable(ISOLATED);
        // terenu nie chowamy: model stoi na ziemi, z cieniem, jak na makiecie
        for (const ground of ["teren", "morze"]) show(model.node(ground));
        // nieznana nazwa = sam teren (skrypt szlifu robi tak kadr tla do porownania)
        const target = model.root.getObjectByName(name);
        if (!target) return;
        show(target);
        // wzorce ciezarowek i pieszego sa na makiecie schowane — na czas ogladania je pokazujemy
        if (!target.visible) {
          target.visible = true;
          forced = target;
        }
      },
      orbit: ({ target, azimuth, elevation }: { target: string | null; azimuth: number; elevation: number }) => {
        const sphere = new THREE.Box3().setFromObject(target ? model.node(target) : model.root).getBoundingSphere(new THREE.Sphere());
        const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)) * 1.15;
        const a = THREE.MathUtils.degToRad(azimuth);
        const e = THREE.MathUtils.degToRad(elevation);
        look(new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(dist).add(sphere.center), sphere.center);
      },
      shots: () => ["start", ...Object.keys(SHOTS)],
      shot: (name: string) => {
        const pose = SHOTS[name];
        if (!pose) {
          look(stage.start.position, stage.start.target);
          return;
        }
        const [x, y, z, tx, ty, tz] = pose;
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
