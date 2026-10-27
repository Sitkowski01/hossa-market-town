import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/** Pozycje wzorcow z makieta.json (osie Blendera: x na wschod, y na polnoc, z w gore). */
interface Instances {
  readonly drzewa: Readonly<Record<string, readonly (readonly [number, number, number, number, number])[]>>;
  readonly latarnie: readonly (readonly [number, number, number])[];
  readonly auta: readonly (readonly [number, number, number, string])[];
}

export interface Model {
  readonly root: THREE.Object3D;
  /** Obiekt makiety po nazwie z Blendera (budynki, czesci ruchome, punkty zaczepienia, wzorce). */
  node(name: string): THREE.Object3D;
  /** Polozenie punktu zaczepienia w swiecie. */
  anchor(name: string): THREE.Vector3;
  material(name: string): THREE.MeshStandardMaterial;
}

/** Wzorce, ktore scena uzywa sama (ciezarowki, piesi) albo rysuje instancjami — nie stoja na makiecie. */
const PROTOTYPE = /^(drzewo_|latarnia$|auto_|ciezarowka_|pieszy_)/;
const UP = new THREE.Vector3(0, 1, 0);
const ROAD_HEIGHT = 0.06; // latarnie i auta stoja na plaskich ulicach miasta

/** `onProgress` dostaje ulamek pobranej makiety (0..1) albo null, gdy serwer nie podal rozmiaru. */
export async function loadModel(base: string, onProgress?: (fraction: number | null) => void): Promise<Model> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [gltf, instances] = await Promise.all([
    loader.loadAsync(`${base}makieta.glb`, // przy kompresji (gzip, brotli) Content-Length to rozmiar spakowany, a loaded — rozpakowany
    (e) => onProgress?.(e.lengthComputable && e.total > 0 ? Math.min(1, e.loaded / e.total) : null)),
    fetch(`${base}makieta.json`).then((r) => r.json() as Promise<Instances>),
  ]);
  const root = gltf.scene;
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const flat = new Set(["teren", "morze", "drogi"]); // plaskie: przyjmuja cienie, ale ich nie rzucaja
  for (const top of root.children) {
    top.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = !flat.has(top.name);
      o.receiveShadow = true;
      const m = o.material as THREE.MeshStandardMaterial;
      materials.set(m.name, m);
    });
  }

  const node = (name: string): THREE.Object3D => {
    const found = root.getObjectByName(name);
    if (!found) throw new Error(`Brak obiektu ${name} w makieta.glb`);
    return found;
  };
  for (const o of [...root.children]) if (PROTOTYPE.test(o.name)) o.visible = false;

  // Blender (x, y, z w gore, obrot wokol z) -> three.js (x, z w gore -> y, -y -> z, obrot wokol y)
  const place = (x: number, y: number, z: number, deg: number, s: number) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, z, -y), new THREE.Quaternion().setFromAxisAngle(UP, (deg * Math.PI) / 180), new THREE.Vector3(s, s, s));
  const groups = new Map<string, THREE.Matrix4[]>();
  const add = (proto: string, m: THREE.Matrix4) => groups.set(proto, [...(groups.get(proto) ?? []), m]);
  for (const [proto, items] of Object.entries(instances.drzewa)) for (const [x, y, z, r, s] of items) add(proto, place(x, y, z, r, s));
  for (const [x, y, r] of instances.latarnie) add("latarnia", place(x, y, ROAD_HEIGHT, r, 1));
  for (const [x, y, r, colour] of instances.auta) add(`auto_${colour}`, place(x, y, ROAD_HEIGHT, r, 1));
  for (const [proto, matrices] of groups) root.add(instanced(node(proto), matrices));

  return {
    root,
    node,
    anchor: (name) => node(name).getWorldPosition(new THREE.Vector3()),
    material: (name) => {
      const m = materials.get(name);
      if (!m) throw new Error(`Brak materialu ${name} w makieta.glb`);
      return m;
    },
  };
}

/** Jeden wzorzec (moze miec kilka siatek, np. pien i korona) jako InstancedMesh na siatke. */
function instanced(proto: THREE.Object3D, matrices: readonly THREE.Matrix4[]): THREE.Group {
  const group = new THREE.Group();
  group.name = `${proto.name}_instancje`;
  proto.updateWorldMatrix(true, true);
  proto.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    // siatka wzgledem wzorca (np. korona nad pniem) skladana z polozeniem kazdej instancji
    const local = new THREE.Matrix4().copy(proto.matrixWorld).invert().multiply(o.matrixWorld);
    const mesh = new THREE.InstancedMesh(o.geometry, o.material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(m, local)));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return group;
}
