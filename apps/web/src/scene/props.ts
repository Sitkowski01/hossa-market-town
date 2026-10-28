import * as THREE from "three";
import type { Snapshot } from "../sim/protocol.js";
import type { Daylight } from "../world/daylight.js";
import { portActivity, shipOffset } from "../world/traffic.js";
import { BLOOM_THRESHOLD } from "./stage.js";
import type { Model } from "./model.js";

const ROADSTEAD = 30; // tyle metrow od nabrzeza do redy (dalej konczy sie morze na cokole)
const WHEEL_SPEED = 2.4; // rad/s kola wyciagowego przy pelnym wydobyciu
const LAMP = new THREE.Color(0xffc477);
const WINDOW = new THREE.Color(0xffb35c);

export interface Props {
  update(snapshot: Snapshot, dayFraction: number, light: Daylight, storm: boolean, dt: number, now: number): void;
}

/**
 * Czesci ruchome makiety sterowane gospodarka: kola wyciagowe kreca sie, kiedy kopalnia
 * wydobywa; zwaly rosna i maleja z zapasami; dzwigi pracuja przy statku; statek odplywa
 * na rede; noca swieca latarnie, okna i latarnia morska.
 */
export function createProps(model: Model, scene: THREE.Scene): Props {
  const wheels = ["RUD_kolo_1", "RUD_kolo_2"].map((n) => model.node(n));
  const cranes = ["BPT_dzwig_1_obrot", "BPT_dzwig_2_obrot", "BPT_dzwig_3_obrot"].map((n) => model.node(n));
  const gantry = model.node("STW_suwnica");
  const gantryHome = gantry.position.x;
  const ship = model.node("statek");
  const shipHome = ship.position.z;
  const heaps = {
    mine: model.node("RUD_halda"),
    millOre: model.node("STW_ruda"),
    factory: model.node("MTK_wyroby"),
    portSteel: model.node("BPT_stal"),
    portMachines: model.node("BPT_maszyny"),
  };

  // biala farba z albedo 0,78 w pelnym sloncu przekracza prog poswiaty (sciana statku robila sie
  // biala plama); po ACES albedo ~0,5 dalej wyglada na biale
  const whites = new Set<THREE.MeshStandardMaterial>();
  model.root.traverse((o) => {
    if (o instanceof THREE.Mesh && (o.material as THREE.Material).name === "bialy") whites.add(o.material as THREE.MeshStandardMaterial);
  });
  for (const m of whites) m.color.multiplyScalar(0.65);

  const lamp = model.material("lampa");
  lamp.emissive.copy(LAMP);
  const windows = model.material("okna");
  // noca morze na prawie czarnym tle strony bylo czarna dziura: slaba granatowa poswiata jak odbity ksiezyc
  let seaMaterial: THREE.MeshStandardMaterial | undefined;
  model.node("morze").traverse((o) => {
    if (!seaMaterial && o instanceof THREE.Mesh) seaMaterial = o.material as THREE.MeshStandardMaterial;
  });
  const sea = seaMaterial as THREE.MeshStandardMaterial;
  sea.emissive.set(0x1b3a5c);
  windows.emissive.copy(WINDOW);
  windows.emissiveMap = windows.map;

  const beacon = new THREE.PointLight(0xffe2a8, 0, 90, 1.8);
  beacon.position.copy(model.anchor("BPT_latarnia"));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2a8).multiplyScalar(BLOOM_THRESHOLD * 2) }));
  glow.position.copy(beacon.position);
  scene.add(beacon, glow);

  let wheelAngle = 0;
  /** Czas pracy maszyn (ms symulacji przy tempie 1x). */
  let work = 0;
  return {
    update(snapshot, dayFraction, light, storm, dt, now) {
      wheelAngle += WHEEL_SPEED * snapshot.companies.RUD.output * dt;
      for (const w of wheels) w.rotation.z = wheelAngle;

      const port = portActivity(snapshot.ship, dayFraction);
      // maszyny w zakladach pracuja w czasie symulacji: w pauzie stoja jak dym i kolo wyciagowe
      work += dt * 1000;
      // zwal nigdy nie znika calkiem: kopalnia codziennie wysyla prawie cale wydobycie, wiec
      // zwykly dzien to niska halda, a wysoka rosnie dopiero, gdy huta nie odbiera rudy
      for (const [key, heap] of Object.entries(heaps)) {
        const floor = key === "mine" ? 0.55 : 0.25;
        // w dniu zaladunku stosy w porcie znikaja do 0,3 dnia — dzwigi przenosza je na statek
        const loading = key === "portSteel" || key === "portMachines" ? port.left : 1;
        heap.scale.y = floor + (1 - floor) * snapshot.yards[key as keyof typeof heaps] * loading;
      }

      const working = port.docked && snapshot.yards.portSteel + snapshot.yards.portMachines > 0.02;
      cranes.forEach((c, i) => {
        c.rotation.y = working ? 0.5 * Math.sin(work / 2600 + i * 1.7) : c.rotation.y * 0.98;
      });
      gantry.position.x = gantryHome - (snapshot.companies.STW.output > 0 ? 7 + 6 * Math.sin(work / 3800) : 0);
      ship.position.z = shipHome + ROADSTEAD * shipOffset(snapshot.ship, dayFraction);

      const night = light.lampsOn ? 1 - light.day : 0;
      lamp.emissiveIntensity = night * BLOOM_THRESHOLD * 2.2;
      windows.emissiveIntensity = night * 0.9;
      sea.emissiveIntensity = night * 0.55;
      const blink = (light.lampsOn || storm) && Math.floor(now / 1000) % 4 === 0 ? 1 : 0;
      // blysk ma byc widac na wodzie, ale nie jako plama wieksza niz port (z bliska na telefonie
      // przy 350 i zasiegu 140 bialy rozblysk zakrywal pol nabrzeza)
      beacon.intensity = 180 * blink;
      glow.visible = blink === 1;
    },
  };
}
