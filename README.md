# Notabene

En mobile-first notes-app med sticky note-look og dark mode som standard. Den er bygget som en web-app (vanilla JS, ingen framework) og pakket til Android med Capacitor.

## Hent APK'en
Hver gang der pushes til `main`, bygger GitHub Actions en signeret APK:
**Releases → seneste version → `Notabene-1.0.X.apk`**. Åbn filen på telefonen og tillad installation fra ukendte kilder første gang. Nye builds installeres oven på den gamle, og dine noter bliver liggende.

## Hvad virker
- **Noter som sticky notes:** 7 farver, tape på fastgjorte noter, gitter- eller listevisning
- **Editor:** H1–H3, fed/kursiv/understreg/gennemstreg, lister, tjeklister, citater, kode, links, billeder, filer (op til 8 MB), tabeller, farver og fremhævning. Den har sit eget undo/redo, autosave, ordtælling og læsetid.
- **Markdown-genveje:** `#`, `-`, `1.`, `[]`, `>`, ```` ``` ````, `---`, `**fed**`, `*kursiv*`, `` `kode` ``, `==markering==`
- **Blokke og links:** `/` åbner blok-menuen og `[[` linker til en anden note. Henvisninger (backlinks) og relaterede noter (TF-IDF) vises i bunden af noten.
- **Organisering:** mapper (også i flere niveauer), tags, favoritter, fastgjorte noter, smarte samlinger, arkiv og papirkurv med automatisk tømning
- **Søgning:** øjeblikkelig fuldtekstsøgning der tåler stavefejl, `#tag`-filtre, filter-chips og "Søg efter betydning" (AI)
- **Opgaver:** alle tjeklister på tværs af noter samles ét sted med forfaldsdatoer, og datoer forstås på dansk ("fredag", "i morgen", "14/11"). Opgaver kan sendes til Google Kalender.
- **Planlægning:** vaner med streaks, dagens note, skabeloner (møde, dagbog, projekt, ugeplan, idé, læsenoter og dine egne) og hurtig optagelse fra forsiden
- **AI med din egen Anthropic-nøgle:** opsummér, forbedr, ret grammatik, forkort, udvid, handlingspunkter, til tjekliste, mødenotat, udtræk nøgleinfo, fortsæt skrivning, foreslå tags, find forbindelser, auto-organisering og en assistent, der søger i og læser dine noter
- **Data:** offline-first (IndexedDB), versionshistorik pr. note, automatisk daglig backup (de seneste 7 kan gendannes), backup som JSON og eksport som Markdown-zip. Import virker fra Markdown, TXT, HTML, Evernote (.enex) og Notabene-backup.
- **Påmindelser:** Android-notifikationer for opgaver med dato, kl. 09:00 som standard. Tidspunktet kan ændres i Indstillinger, og et tryk på notifikationen åbner noten.
- **Android:** tilbageknap, haptik, del-ark til eksport og adaptivt ikon

## Ikke i v1
- **Cloud-sync mellem enheder i APK'en:** den kræver en backend (fx Supabase). Sync-laget (`src/js/02-sync.js`) er bygget med konflikthåndtering og bruges allerede, når appen kører som claude.ai-artifact.

## Udvikling
```bash
npm ci
npm run build          # src/ → www/index.html (én selvstændig fil)
npx cap sync android
cd android && ./gradlew assembleRelease
python3 test/full.py   # 31 Playwright-tests (editor, organisering, søgning, opgaver, AI-mock, Android-bro-mock, layout)
python3 test/gestures.py  # swipe, kant-swipe, langt tryk, træk-for-at-lukke
```

Kode: `src/js/00-util` → `01-store` (IndexedDB) → `02-sync` → `03-md` (Markdown/sanitizer) → `04-search` → `05-ui` (navigation, sheets) → `06-home` → `07-notes` → `08-editor` → `09-tasks` → `10-ai` → `11-settings` → `99-main`.

Signeringsnøglen i `android/app/` er en sideload-nøgle. Før en udgivelse på Google Play skal den erstattes med en privat nøgle i GitHub Secrets.
