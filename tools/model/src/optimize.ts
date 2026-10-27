/**
 * Odchudza GLB z Blendera do paczki dla przegladarki: tekstury do WebP (teren w pelnej
 * rozdzielczosci, kolory materialow 768 px, mapy normalnych i chropowatosci 512 px — z daleka
 * ich nie widac), wzorce drzew uproszczone o polowe (stoja w setkach kopii, a kazdy trojkat
 * rysuje sie dwa razy: w obrazie i w mapie cieni), siatki skwantyzowane i skompresowane meshopt. Nazw wezlow nie ruszamy — scena szuka po nich kominow i dzwigow.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, quantize, reorder, simplifyPrimitive, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { statSync } from "node:fs";
import sharp from "sharp";

const [input, output] = process.argv.slice(2);
if (input === undefined || output === undefined) {
  throw new Error("uzycie: node dist/optimize.js <wejscie.glb> <wyjscie.glb>");
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const document = await io.read(input);
await document.transform(
  dedup(),
  // puste wezly to punkty zaczepienia (komin, brama, tabliczka kursu) — musza zostac
  prune({ keepLeaves: true, keepAttributes: true }), // UV pasa notowan bez tekstury tez zostaja
  weld(),
  // korony drzew to kule z wielu scianek; z wysokosci kamery polowa trojkatow wyglada tak samo
  (doc) => {
    for (const node of doc.getRoot().listNodes()) {
      if (!/^drzewo_/.test(node.getName())) continue;
      node.traverse((n) => {
        for (const prim of n.getMesh()?.listPrimitives() ?? []) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.05 });
      });
    }
  },
  textureCompress({ encoder: sharp, targetFormat: "webp", pattern: /^teren/, quality: 85 }),
  textureCompress({ encoder: sharp, targetFormat: "webp", pattern: /^(?!teren)./, slots: /baseColor/, resize: [768, 768], quality: 80 }),
  textureCompress({ encoder: sharp, targetFormat: "webp", pattern: /^(?!teren)./, slots: /^(?!baseColor)/, resize: [512, 512], quality: 80 }),
  reorder({ encoder: MeshoptEncoder, target: "size" }),
  // Bez kwantyzacji pozycji: ta wpisuje przesuniecie i skale w wezly, wiec zuraw krecilby sie
  // wokol zlego punktu, a wzorce drzew w InstancedMesh wyszlyby kilka razy za male. Dlatego
  // nie uzywamy gotowego meshopt() z gltf-transform (kwantyzuje wszystko) i kompresje
  // wlaczamy sami.
  quantize({ pattern: /^(?!POSITION$)/ }),
);
document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(output, document);

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
console.log(`${input} (${mb(statSync(input).size)} MB) -> ${output} (${mb(statSync(output).size)} MB)`);
