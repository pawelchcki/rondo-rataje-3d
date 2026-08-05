# Rondo Rataje · 200 m

Samodzielna, statyczna mapa Three.js obejmująca obszar w promieniu 200 m wokół ronda Rataje w Poznaniu. Środek sceny ma współrzędne WGS84 `16.950278, 52.395556` / EPSG:2180 `360578.516, 505268.464`. Model używa metrów i domyślnie zachowuje prawidłową skalę pionową 1×.

Dołączony do repozytorium zestaw danych zawiera:

- wycinek terenu 401 × 401 komórek o rozdzielczości 1 m, w układzie wysokościowym PL-EVRF2007-NH, pochodzący z NMT GUGiK;
- przycięte drogi, ciągi piesze i rowerowe, torowiska oraz pokrycie terenu z BDOT10k GUGiK;
- 571 drzew odczytanych z publicznego modelu roślinności 3D GEOPOZ wraz z położeniem, identyfikatorem, gatunkiem, statusem, metodą pomiaru i wysokością;
- 15 obrysów budynków BDOT10k oraz 11 oficjalnych punktów przystanków transportu zbiorowego;
- autorską, deterministyczną symulację samochodów, autobusów i tramwajów z płynną interpolacją ruchu, kolejkami oraz bezpiecznymi fazami sygnalizacji;
- etykiety nad każdym pojazdem pokazujące czas obecności na planszy i szacunkową liczbę pasażerów, a dla tramwajów także liczbę oraz łączny czas postojów na światłach.

## Uruchomienie lokalne

Wymagany jest Node.js 20 lub nowszy.

```sh
npm install
npm run dev
```

Otwórz adres podany przez Vite. Przeciągnięcie obraca kamerę, kółko myszy zmienia przybliżenie, a wskazanie drzewa, budynku, przystanku lub elementu sieci transportowej pokazuje dane źródłowe. Panel pozwala przełączać widok z góry i ukośny, włączać warstwy, sterować ruchem oraz opcjonalnie zwiększyć rzeźbę terenu do 3×. Przełącznik priorytetu tramwajowego porównuje bezwzględne, konfliktowo bezpieczne otwarcie obu punktów kontrolnych z trybem zwykłym, w którym tramwaj osobno uzyskuje zgodę przed rondem i na jego tarczy. Zmiana trybu uruchamia ten sam scenariusz od tego samego ziarna, dzięki czemu czasy można porównywać bez zmiany popytu. Domyślny widok zachowuje prawidłową skalę 1×.

Polecenia produkcyjne i weryfikacyjne:

```sh
npm run typecheck
npm test
npm run build
npm run test:smoke
```

Test przeglądarkowy wymaga Chromium dla Playwrighta. Na nowym komputerze należy jednorazowo wykonać `npx playwright install chromium`.

## Publikacja w GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` buduje aplikację i publikuje katalog `dist` po każdej zmianie wysłanej do gałęzi `main`. Można go również uruchomić ręcznie w karcie **Actions**. Konfiguracja Vite używa względnej ścieżki bazowej, dlatego aplikacja działa zarówno w domenie użytkownika, jak i pod ścieżką repozytorium projektu.

## Odświeżenie danych pomiarowych

```sh
npm run data:refresh
```

Odświeżenie wymaga dostępu do internetu oraz polecenia `unzip`. Skrypt:

1. sprawdza od najnowszych roczniki usługi WFS GUGiK EVRF2007 i wybiera najnowszy pojedynczy rocznik, którego siatki 1 m wypełniają wszystkie próbki wyniku;
2. odnajduje aktualny poznański pakiet Shapefile BDOT10k przez oficjalną usługę WMS, rozpakowuje w katalogu tymczasowym wyłącznie potrzebne warstwy transportu, pokrycia terenu, budynków i przystanków, po czym przycina je i przelicza na lokalne metry;
3. przechodzi przez publiczny zestaw kafli roślinności GEOPOZ, pobiera kafle przecinające obszar sceny, rekursywnie odczytuje instancje CMPT/I3DM, przelicza skwantowane pozycje ECEF i ogranicza wynik do promienia 200 m;
4. zapisuje wyłącznie `public/data/scene.json` oraz `public/data/terrain.f32`.

Archiwa źródłowe pozostają w katalogu tymczasowym systemu operacyjnego i są usuwane po zakończeniu. Manifest zapisuje adresy źródeł, datę pobrania, roczniki, układy współrzędnych i wysokości, sumy SHA-256, środek, promień i atrybucję. Indeksy usług mogą się zmieniać, dlatego późniejsze odświeżenie może wskazać nowszy rocznik niż dane obecnie zapisane w repozytorium.

## Dokładność i wygląd

Położenia, wysokości terenu, szerokości dostępne w BDOT10k, obrysy i liczby kondygnacji budynków, położenia przystanków oraz wysokości drzew pochodzą z wymienionych publicznych zbiorów. Renderowanie jest celowo stylizowane: korony low-poly, proporcje pni, kolory, oświetlenie, wygląd torowiska i wartości zastępcze dla brakujących szerokości są decyzjami kartograficznymi.

Bryły budynków powstają z oficjalnych obrysów i liczby kondygnacji przy założeniu 3,2 m na kondygnację; nie są pomiarowymi modelami dachów. Położenia przystanków są oficjalne, natomiast wiaty, ławki, znaki i wyświetlacze są reprezentatywnymi modelami low-poly ustawionymi względem najbliższej drogi lub torowiska. Dwa rekordy dworca autobusowego definiują jeden model terminalu z sześcioma równoległymi, półprzezroczystymi dachami kolebkowymi, ciemnoniebieskimi ramami, zatokami, peronami i zadaszonym przejściem poprzecznym.

Niewielkie przesunięcia wysokości warstw i funkcja `polygonOffset` zapobiegają migotaniu współpłaszczyznowych powierzchni bez zmiany danych źródłowych ani terenu. Geometria pasów, oznakowanie, sygnalizacja, program ruchu i liczby pasażerów są autorską nakładką symulacyjną opartą na rzucie BDOT10k. Liczby pasażerów są deterministycznymi szacunkami z zakresów 1–4 dla samochodu, 12–80 dla autobusu i 35–180 dla tramwaju; nie są pomiarem rzeczywistego napełnienia. Zakresy zweryfikowano względem pojemności poznańskiego taboru podawanych przez MPK: [80 miejsc w Solarisie Urbino 12 hydrogen](https://www.mpk.poznan.pl/tabor/solaris-urbino-12-hydrogen/) oraz [240 miejsc w Moderusie Gamma LF04](https://www.mpk.poznan.pl/tabor/moderus-gamma-lf04-ac-bd/). Model nie jest obrazem ruchu na żywo ani odwzorowaniem miejskiego sterownika sygnalizacji. BDOT10k jest źródłem topograficznym i pozostaje bardziej uogólniony niż dokumentacja inżynierii ruchu.

Atrybucja danych: Główny Urząd Geodezji i Kartografii (GUGiK); Zarząd Geodezji i Katastru Miejskiego GEOPOZ / Miasto Poznań.
