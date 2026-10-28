import { Agent } from "node:http";
import { defineConfig } from "vite";

// Tryb polaczony (?parkiet): Parkiet nie wystawia CORS, wiec przegladarka rozmawia z nim przez
// ten sam serwer. Adres Parkietu z PARKIET_URL, domyslnie kontener z parkiet/compose.yaml.
// klucz z ^ to wyrazenie regularne: sama sciezka /parkiet albo /parkiet/..., nie /parkiet.png
const parkiet = {
  "^/parkiet(/|$)": {
    target: process.env.PARKIET_URL ?? "http://localhost:8088",
    ws: true,
    // jedno polaczenie na wiele zadan: bez tego kazde zlecenie otwiera nowe TCP i proxy dlawi tempo
    agent: new Agent({ keepAlive: true }),
    rewrite: (path: string) => path.replace(/^\/parkiet/, ""),
  },
};

export default defineConfig({
  server: { proxy: parkiet },
  preview: { proxy: parkiet },
  // Wzgledne sciezki: paczka dziala z dowolnego katalogu na serwerze (np. sitekmikolaj.pl/hossa/).
  base: "./",
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
