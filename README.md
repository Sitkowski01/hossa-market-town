# Hossa: miasteczko na giełdzie

Żywa makieta gospodarki połączona z giełdą. Miasteczko w 3D — kopalnia, huta, fabryka, port,
sieć sklepów i bank — produkuje i handluje samo, a każda z tych firm jest notowana na giełdzie
w centrum. Kursy nie są losowane: powstają w prawdziwym arkuszu zleceń, w którym boty
inwestorów reagują na to, co dzieje się na makiecie (strajk, sztorm, wyniki kwartalne,
decyzja banku centralnego).

**▶ [Demo w przeglądarce](https://sitekmikolaj.pl/hossa/)** — całość liczy się u Ciebie, bez serwera; `?seed=79&spolka=RUD` otwiera od razu strajk w kopalni

![Wczytanie makiety, przelot kamery i panel kopalni w dniu strajku](docs/hossa.gif)

```
packages/engine    arkusz zleceń (port Parkietu)          zero zależności
packages/economy   gospodarka miasteczka, zdarzenia, wieści  zero zależności
packages/market    giełda: arkusze sześciu spółek + boty    engine + economy
apps/sesja         sesja w terminalu                        market
apps/web           scena three.js + giełda w Web Workerze   market (tylko w workerze)
blender/           makieta 3D budowana skryptami Pythona    Blender 5.1
tools/model        optymalizacja GLB + testy kontraktu      gltf-transform
```

## Architektura

```mermaid
flowchart LR
  subgraph worker[Web Worker]
    eco[economy<br/>firmy, łańcuch dostaw,<br/>zdarzenia, wycena]
    mkt[market<br/>6 arkuszy + boty]
    eng[engine<br/>arkusz zleceń<br/>port Parkietu]
    eco -- wieści, wartość godziwa --> mkt
    mkt --> eng
  end
  subgraph page[Strona]
    sim[src/sim<br/>zegar, migawki]
    world[src/world<br/>czysta logika:<br/>trasy, tłum, wykres, kamera]
    scene[src/scene<br/>three.js]
    ui[src/ui<br/>panel, notowania, wieści]
  end
  blender[blender/<br/>skrypty Pythona] -- GLB --> model[tools/model<br/>WebP, meshopt] -- makieta.glb --> scene
  worker -- migawka co 100 ms --> sim
  sim --> scene & ui
  world --> scene & ui
  ui -- tempo, otwarta spółka --> worker
```

Granice pilnuje dependency-cruiser: tylko `src/sim` importuje rynek, z gospodarki scena bierze
wyłącznie typy, a `src/world` nie zna ani three.js, ani DOM-u — dlatego cała logika sceny ma
testy jednostkowe i mutacyjne.

## Gospodarka miasteczka (`packages/economy`)

Sześć spółek w jednym łańcuchu dostaw. Kopalnia Rudawa (RUD) wydobywa rudę, którą ciężarówki
wożą do Huty Stalwar (STW). Stal jedzie do Fabryki Motorek (MTK) i do Bałtportu (BPT), skąd
co kilka dni statek zabiera eksport. Pensje z całego miasta wracają do Sieci Koszyk (KSZ),
a Bank Grosz (GRS) pożycza wszystkim i płaci odsetki od lokat mieszkańców.

- **Księga podwójnego zapisu.** Każdy przepływ pieniędzy to przelew między dwoma kontami
  (spółki, mieszkańcy, reszta świata), więc suma wszystkich sald jest stała co do grosza —
  test sprawdza to po każdym dniu na losowych ziarnach.
- **Zysk memoriałowy.** Sprzedaż eksportowa liczy się w chwili wysyłki do portu; sztorm
  opóźnia pieniądze, ale nie kasuje sprzedaży (za to port płaci za postój statków).
- **Wycena** = roczny zysk (średnia z ~30 dni) × 1 / (stopa procentowa + premia za ryzyko)
  ÷ liczba akcji. Podwyżka stóp obniża mnożnik od razu, a wyższe odsetki — zyski z czasem.
  Straty jednorazowe (odpis złych kredytów) obniżają majątek, nie przyszłe zyski.
- **Zdarzenia** z zadanym prawdopodobieństwem dziennym: strajk, wypadek, nowe złoże, drogi
  węgiel, duży kontrakt, awaria, sztorm, spadek nastrojów, złe długi; do tego posiedzenia banku
  centralnego co 45 dni, sezon świąteczny i wyniki kwartalne. Każde zdarzenie trafia do
  wiadomości z wydźwiękiem dla każdej spółki, której dotyczy — także dla odbiorców
  w łańcuchu dostaw (strajk w kopalni to też zła wiadomość dla huty).

## Rynek (`packages/market`)

Każda spółka ma własny arkusz z silnika i ośmiu graczy: animatora rynku, trzech inwestorów
fundamentalnych (różne opóźnienia i poglądy), gracza na newsach, gracza momentum i dwóch
losowych. Kurs powstaje z ich zleceń.

- Gracz na newsach reaguje od razu i często przesadza; fundamentalni dociągają cenę do wyceny
  z opóźnieniem — stąd przestrzelenia i korekty.
- Animator poszerza spread i wycofuje się, gdy rynek robi się nerwowy — płynność znika wtedy,
  kiedy jest najbardziej potrzebna.
- Każda transakcja przenosi akcje i gotówkę między dwoma graczami: suma pozycji i suma
  gotówki wszystkich graczy to zawsze zero.

### Testy kontrfaktyczne

Jak sprawdzić, że „strajk obniża kurs”, skoro rynek i tak ciągle się rusza? Ta sama sesja
(to samo ziarno) uruchamiana jest dwa razy: bez zdarzenia i z ręcznie wstrzykniętym. Gospodarka
losuje zawsze tyle samo razy dziennie, a każdy bot ma własny generator, więc oba przebiegi
różnią się wyłącznie skutkami tego jednego zdarzenia. Testy sprawdzają m.in., że strajk
w kopalni obniża kurs kopalni, a potem huty; że podwyżka stóp obniża indeks; że dobra
wiadomość podnosi kurs tego samego dnia, zanim zmienią się zyski.

```bash
pnpm sesja --seed 42 --dni 180
```

## Silnik giełdy (`packages/engine`)

Arkusz zleceń z kojarzeniem według ceny, a potem czasu (price-time priority) — port domeny
silnika [Parkiet](https://github.com/Sitkowski01/parkiet-exchange) z Javy do TypeScriptu,
żeby giełda działała w przeglądarce bez serwera.

- Zlecenia `LIMIT` i `MARKET`, anulowanie, głębokość arkusza, migawka.
- Zdarzenia `RESTED`, `TRADE`, `CANCELLED` — te same co w Parkiecie, co do pola.
- Ceny w groszach jako liczby całkowite, nigdy ułamki.
- Deterministyczny: ta sama sekwencja zleceń zawsze daje te same zdarzenia.
- Zero zależności — działa w Node, w przeglądarce i w Web Workerze.
- Arkusz sam waliduje każde zlecenie: w przeglądarce zlecenia przychodzą też z JSON-a i z workera,
  gdzie typy TypeScriptu już nie istnieją.

Różnice względem Parkietu, świadome:

- Maksymalna wielkość zlecenia to milion akcji, nie miliard. Java liczy na `long`, a JavaScript
  na `number`, dokładnym tylko do 2^53 — przy tym limicie obrót zlecenia zawsze jest dokładny.
- Port obejmuje kojarzenie, anulowanie, głębokość i migawkę. Odbudowy arkusza z dziennika zdarzeń
  (event sourcing po restarcie serwera) w przeglądarce nie potrzeba, więc jej nie przeniesiono.

### Jak sprawdzamy, że port jest wierny

| Test | Co sprawdza |
|---|---|
| jednostkowe | każde zachowanie arkusza osobno |
| różnicowy (fast-check) | setki losowych scenariuszy: wynik identyczny z naiwnym arkuszem, którego poprawność widać gołym okiem |
| niezmienniki (fast-check) | arkusz nigdy skrzyżowany, ilość zlecenia = transakcje + reszta, LIMIT nie handluje gorzej niż jego cena |
| zgodność z Parkietem | ~3000 poleceń nagranych z silnika w Javie (`tools/golden/GoldenVectors.java`) — port musi dać identyczne zdarzenia |
| mutacyjne (Stryker) | czy testy łapią celowo wprowadzone błędy; próg 90% |

## Makieta 3D (`blender/`)

Makieta nie jest klikana ręcznie w Blenderze. Powstaje w całości ze skryptów Pythona
(`blender/hossa/`), więc da się ją odtworzyć jedną komendą i przejrzeć w diffie:

- `layout.json` to jedno źródło prawdy o układzie: gdzie stoją firmy, gdzie biegną drogi
  i którędy jeżdżą ciężarówki. Czyta go skrypt makiety i będzie go czytać scena w przeglądarce.
- Tekstury PBR pochodzą z [Poly Haven](https://polyhaven.com) (CC0) i są pobierane przy
  pierwszym budowaniu. Teren dostaje jedną teksturę złożoną w numpy z trawy, ziemi przy
  zakładach, plaży i skał, bo glTF nie przenosi mieszania materiałów z węzłów Blendera.
- Każdy budynek to jedna siatka (`kit.Builder`), żeby przeglądarka rysowała mniej obiektów.
  Ruchome części są osobno: koła wyciągowe, dźwigi, statek, zwały rudy i pas notowań na
  giełdzie. Puste węzły oznaczają punkty zaczepienia, np. szczyty kominów (dym) i bramy
  zakładów (ciężarówki).
- Drzewa, latarnie i auta trafiają do GLB jako kilka wzorców plus lista pozycji
  w `makieta.json`. Przeglądarka rysuje je instancjami.
- `tools/model` odchudza GLB z ~35 MB do ~6,8 MB: tekstury WebP (kolory materiałów 768 px),
  wzorce drzew uproszczone meshoptimizerem (stoją w ~580 kopiach), siatki skwantyzowane
  i skompresowane meshopt.

Testy kontraktu (`tools/model`) sprawdzają gotową paczkę:

- czy w GLB są obiekty i punkty zaczepienia, po których scena szuka kominów i dźwigów,
- czy każda trasa ciężarówki jedzie po istniejących drogach i zaczyna się przy bramie
  nadawcy, a kończy przy bramie odbiorcy,
- czy drzewa nie rosną na jezdni,
- czy paczka mieści się w budżecie 15 MB.

Pierwsze uruchomienie tych testów złapało hutę obróconą tyłem do drogi: jej brama wypadała
56 m od trasy ciężarówek.

```bash
# Blender 5.1 bez okna (~30 s): buduje makietę i eksportuje surowy GLB
blender -b --factory-startup --python-expr "p = r'<repo>/blender/run.py'; exec(compile(open(p, encoding='utf-8').read(), p, 'exec'), {'__file__': p})"
# w repo: optymalizacja do apps/web/public/makieta.glb
pnpm model
```

## Scena w przeglądarce (`apps/web`)

![Makieta w przeglądarce](docs/scena.jpg)

Giełda i gospodarka liczą się w Web Workerze, więc boty składające zlecenia nie przycinają
rysowania. Co 100 ms worker wysyła scenie migawkę: ceny, dzisiejsze wysyłki, zapełnienie
placów, fazę statku, zdarzenia i wiadomości. Scena nie zna silnika — reguła
dependency-cruiser zabrania importu rynku poza katalogiem `src/sim`.

Na makiecie widać to, co dzieje się w gospodarce:

- ciężarówki wożą rudę, stal i maszyny trasami z `layout.json` (tymi samymi, po których
  makietę zbudował Blender); kolumna dnia wynika z ilości towaru,
- dym z kominów zależy od produkcji, koła wyciągowe kręcą się w tempie wydobycia,
  zwały rudy i stosy w porcie rosną z zapasami,
- statek odpływa po załadunku, a w sztorm czeka na redzie; pada deszcz, błyska latarnia,
- w strajku zakład naprawdę stoi (zero produkcji, brak dymu), a przed bramą stoi pikieta,
- nad spółkami tabliczki z kursem, a na fasadzie giełdy przewija się pas notowań,
- na rynku spacerują przechodnie: w dzień tłum, w nocy kilku spacerowiczów, w sztorm prawie
  nikt; za dnia ich liczba idzie za popytem w Sieci Koszyk,
- jeden dzień gospodarki to doba na makiecie: słońce, noc z oknami i latarniami, a tło za
  makietą to studyjna winieta w kolorze nieba danej pory i pogody.

Czas płynie w tempie 1×, 4× albo 16×; między migawkami scena ekstrapoluje go, żeby
ciężarówki jechały płynnie, ale nie wchodzi w dzień, którego worker jeszcze nie policzył.

**Panel spółki.** Klik w zakład, w tabliczkę z kursem, w notowanie z tablicy albo w wiadomość
otwiera panel spółki, a kamera podlatuje do budynku. Obraz przesuwa się (`setViewOffset`)
tak, żeby zakład stał na środku tej części ekranu, której panel nie zasłania. Panel pokazuje:

- wykres świecowy z ostatnich trzech dni (świeca = jeden krok giełdy) z linią wartości godziwej,
  do której ciągną gracze fundamentalni,
- arkusz zleceń: osiem poziomów po każdej stronie z paskami wielkości i spreadem,
- taśmę transakcji ze stroną agresora,
- fundamenty z ksiąg gospodarki: kapitalizacja, C/Z, roczny zysk w obecnym tempie, ostatni
  kwartał, gotówka, dług, kurs względem wyceny,
- wiadomości o spółce z wydźwiękiem dla niej (strajk w kopalni to dla kopalni −0,8, dla fabryki −0,1).

Worker liczy te szczegóły tylko dla otwartej spółki (wiadomość `focus`), więc zamknięty panel
nic nie kosztuje. UI niczego nie liczy: formatowanie i układ wykresu to czyste funkcje
w `src/world` (testy i mutacje), a DOM jest aktualizowany w miejscu — te same węzły, zmienia się
tylko tekst, więc 10 migawek na sekundę nie gubi zaznaczenia ani miejsca czytnika ekranu.
Na telefonie panel wysuwa się od dołu, a tablica notowań mieści wszystkie sześć spółek pod kciukiem.

**Pierwsze 10 sekund.** Makieta waży ~6,8 MB, więc ekran ładowania pokazuje postęp pobierania
(albo pasek nieokreślony, gdy serwer nie poda rozmiaru), a shadery kompilują się jeszcze pod
zasłoną. Potem kamera przelatuje do ujęcia startowego i makieta obraca się do widza
(pomijane przy `prefers-reduced-motion`). Najechanie na budynek albo tabliczkę podświetla
wiersz spółki w notowaniach, a najechanie na wiersz powiększa tabliczkę na makiecie.
Tabliczki gasną, gdy wchodzą pod panel albo za krawędź ekranu.

**Wydajność.** ~600 tys. trójkątów i ~460 wywołań rysowania na klatkę (razem z mapą cieni);
60 kl./s na komputerze, ~50 kl./s przy procesorze spowolnionym 4×. Na ekranach dotykowych
gęstość pikseli najwyżej 1,5 i mapa cieni 2048 px zamiast 4096.

Adres strony odtwarza sesję: `?seed=42` (ta sama sesja co do transakcji), `?tempo=16`,
`?godzina=12` (zatrzymana pora dnia), `?kamera=x,y,z,celX,celY,celZ` i `?spolka=RUD`
(otwarty panel spółki — np. `?seed=79&spolka=RUD` to strajk w kopalni drugiego dnia).

**Światło.** Poprzednia makieta była przepalona, więc tu pilnuje tego test: ACES z ekspozycją
0,75, jedno słońce z cieniami, otoczenie z fizycznego nieba o ograniczonej sile, a poświata
dopiero powyżej jasności 3 (świecą latarnie i pas LED, nie biały tynk w słońcu). Test e2e
robi zrzut w południe i w nocy i liczy przepalone piksele.

| Test | Co sprawdza |
|---|---|
| jednostkowe + fast-check | trasy (łuki, prawy pas, brak skoków), kolumny ciężarówek, faza statku bez przeskoków między dniami, pora dnia, migawka z prawdziwej sesji (strajk, sztorm, wypadek), szczegóły spółki (świece, arkusz, taśma, fundamenty, wiadomości), układ wykresu (każda świeca mieści się w polu), przelot kamery i przelot powitalny, tłum na rynku (liczba, pętle spacerów), gaszenie tabliczek pod panelami, podpisy osi pod plakietkami, parametry adresu |
| mutacyjne (Stryker) | logika `src/sim` i `src/world`, próg 90% |
| e2e (Playwright) | scena bez błędów konsoli, tempo i pauza, to samo ziarno = ten sam indeks, ekspozycja w dzień i w nocy, panel z notowania, z kliknięcia w budynek i z adresu (strajk), Escape i powrót fokusu, pasek wiadomości, panel od dołu na telefonie |

## Uruchomienie

Wymaga Node 24 i pnpm.

```bash
pnpm install
pnpm check      # build, typy, lint, reguły architektury, testy z pokryciem
pnpm mutation   # testy mutacyjne
pnpm --filter @hossa/web dev   # makieta w przeglądarce (Vite)
pnpm --filter @hossa/web e2e   # testy e2e (po pnpm build)
```

Ponowne nagranie przebiegów z Parkietu (Java 21, klasy po `./gradlew classes` w repo Parkietu):

```bash
java -cp <parkiet>/build/classes/java/main tools/golden/GoldenVectors.java \
  > packages/engine/src/test/parkiet-golden.json
```

## Licencja

MIT
