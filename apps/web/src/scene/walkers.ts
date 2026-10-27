import * as THREE from "three";
import type { Snapshot } from "../sim/protocol.js";
import { MAX_WALKERS, PLAZA_LOOPS, crowdSize, walked, walkers } from "../world/crowd.js";
import type { Daylight } from "../world/daylight.js";
import { densify, polyline, sampleAt, type Polyline, type Vec3 } from "../world/path.js";
import type { Model } from "./model.js";

const STEP = 0.6; // dlugosc kroku w metrach — co tyle przechodzien podskakuje
const BOB = 0.06;
/** Wzorce bez transparentu (pieszy_3 to strajkujacy) i material ich kurtki w makieta.glb. */
const LOOKS = [
  ["pieszy_1", "granat_grs"],
  ["pieszy_2", "czerwony"],
] as const;
/** Kurtki przechodniow — stonowane, zeby tlum nie przekrzykiwal tabliczek kursow. */
const COATS = [0x2f4a6d, 0x9a3b34, 0xc9a24a, 0x6f7f6a, 0xb8ad9a, 0x4d4d57, 0x3f7a7a, 0x8a5a7a];

export interface Walkers {
  update(snapshot: Snapshot, light: Daylight, storm: boolean, dt: number): void;
}

/**
 * Przechodnie na rynku: spaceruja petlami wokol fontanny, alejka i od drzwi Koszyka do banku.
 * W dzien jest ich wiecej, w nocy kilku, w sztorm prawie nikt; w dzien liczba idzie za popytem
 * w Koszyku. W pauzie stoja — jak dym i ciezarowki.
 */
export function createWalkers(model: Model, scene: THREE.Scene): Walkers {
  const coats = COATS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
  const centre = model.anchor("rynek");
  const plaza = model.node("rynek");
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const heightAt = (x: number, z: number): number => {
    ray.set(new THREE.Vector3(x, 200, z), down);
    return ray.intersectObject(plaza, true)[0]?.point.y ?? centre.y;
  };

  const lines: Polyline[] = PLAZA_LOOPS.map((loop) =>
    polyline(densify(loop, 2).map(([dx, dz]): Vec3 => {
      const x = centre.x + dx;
      const z = centre.z + dz;
      return [x, heightAt(x, z), z];
    })),
  );
  const people = walkers(MAX_WALKERS, lines.length, LOOKS.length).map((w, i) => {
    const [proto, jacket] = LOOKS[w.look] as (typeof LOOKS)[number];
    const body = model.node(proto).clone();
    body.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material as THREE.Material).name === jacket) o.material = coats[i % coats.length];
    });
    body.visible = false;
    scene.add(body);
    return { w, body };
  });

  let seconds = 0;
  return {
    update(snapshot, light, storm, dt) {
      if (snapshot.speed > 0) seconds += dt;
      const shown = crowdSize(light.day, snapshot.companies.KSZ.output, storm);
      people.forEach(({ w, body }, i) => {
        body.visible = i < shown;
        if (!body.visible) return;
        const line = lines[w.loop] as Polyline;
        const s = walked(w, line.length, seconds);
        const { position, direction } = sampleAt(line, s);
        const sign = Math.sign(w.speed);
        body.position.set(position[0], position[1] + Math.abs(Math.sin((Math.PI * s) / STEP)) * BOB, position[2]);
        // wzorzec patrzy w +z; obrot ustawia go przodem do kierunku marszu
        body.rotation.y = Math.atan2(direction[0] * sign, direction[1] * sign);
      });
    },
  };
}
