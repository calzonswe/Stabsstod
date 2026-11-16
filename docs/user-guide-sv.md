# Användarhandbok — Stabsstöd (svenska)

Stabsstöd är ett stödsystem för en insatsstab. Allt du skriver sparas lokalt i
bläddraren först och synkas till servern när du är uppkopplad. Det går bra att
arbeta helt offline.

## Kom igång

1. Gå till webbadressen som din administratör har delat (t.ex.
   `https://stabsstod.exempel.se/`).
2. Logga in med ditt användarnamn och ditt lösenord.
3. Om du är ny användare eller nyligen fått ett tillfälligt lösenord: du blir
   ombedd att byta lösenord direkt. Det nya lösenordet måste vara minst 12
   tecken, innehålla både bokstav och siffra, och får inte vara detsamma som
   ditt användarnamn.

## Skapa en insats

1. Klicka på **Insatser** i toppmenyn.
2. Klicka på **Skapa insats**.
3. Fyll i insatsens namn, typ och starttid. Välj vilka funktioner som ska
   finnas med från början.
4. Klicka **Skapa insats**. Du kommer till insatsens arbetsyta.

## Arbetsytans flikar

- **Läge** — lägesbild, fakta (verifierade / antaganden / informationsbehov).
- **Inriktning** — uppdrag och inriktning (skrivs av stabschef / ställföreträdare).
- **Samordning** — beslut och beslutsförslag.
- **Logg** — händelser och noteringar under insatsen.
- **Karta** — ritade kartobjekt (punkt, linje, polygon, cirkel).
- **Stab** — medlemmar, pass, resurser, aktörer.
- **Rapporter** — (kommer senare).

## Läge — fakta

I fliken Läge kan du skapa fakta och markera dem som verifierade, antaganden
eller informationsbehov. Varje ändring skapar en ny version; gammal version
behålls. Om två personer redigerar samma fakt samtidigt visas en konflikt —
välj vilken version som ska gälla.

## Karta — rita objekt

1. Klicka på **Karta**.
2. Välj ritläge i verktygsfältet: **Punkt**, **Linje**, **Polygon** eller
   **Cirkel** (eller **Välj** för att markera befintliga).
3. Klicka på kartan för att rita.
4. Fyll i namn, lager, allvarlighetsgrad, giltighet och beskrivning.
5. Klicka **Spara objekt**.

Lager som du inte vill se kan du dölja i listan nere till höger på kartan.
Objekt som återkallas visas fortfarande i historiken men döljs från kartan.

## Logg

Skriv händelser i loggen under fliken **Logg**. Välj kategori (händelse,
information, beslut, kontakt, övrigt) och ange händelsetid. Loggposter som
återkallas visas genomstrukna.

Observera: loggen kan delas utanför stabsrummet. Skriv sakligt och undvik
känsliga uppgifter.

## Arbete offline

- Rubriken visar "Offline" när du inte har uppkoppling.
- Du kan fortfarande skapa och redigera inlägg, fakta, kartobjekt osv. Allt
  sparas lokalt och kös för uppladdning.
- När du får uppkoppling igen synkas dina ändringar automatiskt, och ändringar
  från andra i staben hämtas hem.
- Om två personer har ändrat samma sak medan en var offline visas en konflikt
  som du kan lösa.

## PWA (installera appen)

Om din enhet litar på serverns CA-certifikat kan du installera appen som en
Progressive Web App (PWA). Då finns den på hemskärmen och öppnas även utan
uppkoppling. Fråga din administratör om CA-certifikatet om offline-läget inte
fungerar.

## Språk

Välj svenska eller engelska med språkknappen i toppmenyn.
