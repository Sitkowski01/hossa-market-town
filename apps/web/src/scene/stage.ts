import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/** Jasnosc (liniowa, przed tone mappingiem), od ktorej piksel swieci. */
export const BLOOM_THRESHOLD = 3;
const FOV = 40;
const WIDE = 1.3; // od tych proporcji w dol pole widzenia rosnie
const MAX_FOV = 62;

export interface Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** Telefon albo tablet: mniej pikseli i mniejsza mapa cieni, zeby makieta szla plynnie. */
  readonly lowPower: boolean;
  /** Ujecie startowe (inne w pionie i w poziomie) — przelot powitalny i petla szlifu wracaja do niego. */
  readonly start: { readonly position: THREE.Vector3; readonly target: THREE.Vector3 };
  render(): void;
}

/**
 * Renderer, kamera i postprocessing. Tone mapping ACES z ekspozycja ponizej 1, bo makieta
 * z jasnymi tynkami latwo sie przepala. Poswiata (bloom) ma prog 3 — powyzej tego, co daje
 * slonce na bialym tynku — wiec swieca tylko powierzchnie z celowo silna emisja: latarnie,
 * pas notowan, latarnia morska.
 */
export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  const lowPower = matchMedia("(pointer: coarse)").matches;
  // ekran telefonu ma gestosc 3; przy 1,5 makieta jest ostra, a GPU liczy czterokrotnie mniej pikseli
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);
  // telefon w pionie patrzy po przekatnej makiety (dluzszy bok idzie w glab ekranu)
  const portrait = canvas.clientWidth < canvas.clientHeight;
  if (portrait) camera.position.set(195, 290, 305);
  else camera.position.set(-110, 240, 300);

  const controls = new OrbitControls(camera, canvas);
  // cel blizej widza: makieta wjezdza wyzej i nie chowa sie pod notowaniami u dolu ekranu
  if (portrait) controls.target.set(35, 0, 70);
  else controls.target.set(10, 0, -10);
  const start = { position: camera.position.clone(), target: controls.target.clone() };
  controls.enableDamping = true;
  controls.minDistance = 40;
  controls.maxDistance = 520;
  controls.maxPolarAngle = Math.PI * 0.46; // nie zagladamy pod cokol makiety
  controls.screenSpacePanning = false;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.4, BLOOM_THRESHOLD);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    // na waskim ekranie (telefon w pionie) szersze pole widzenia, zeby makieta miescila sie wszerz
    camera.fov = Math.min(MAX_FOV, Math.max(FOV, (FOV * WIDE) / camera.aspect));
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    renderer,
    scene,
    camera,
    controls,
    lowPower,
    start,
    render: () => {
      controls.update();
      composer.render();
    },
  };
}
