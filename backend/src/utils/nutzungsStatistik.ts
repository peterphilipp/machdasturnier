/**
 * Wie die App benutzt wird - und wen sie ueberhaupt erreicht.
 *
 * Zwei Sorten Zahlen, die bewusst getrennt bleiben:
 *
 *  - Was seit jeher in den Daten steckt: wann Konten entstanden sind, wer sich
 *    nie angemeldet hat, wer per Push erreichbar ist. Das laesst sich fuer die
 *    ganze Vergangenheit sagen.
 *  - Was ab der Einfuehrung mitgeschrieben wird: an welchen Tagen wie viele
 *    Leute da waren. `lastLoginAt` wird bei jedem Mal ueberschrieben, eine
 *    Anmeldekurve war daraus nie rekonstruierbar - auch nicht rueckwirkend.
 *
 * Reine Rechnung ohne Datenbankzugriff, damit sie testbar bleibt.
 */

export interface NutzungsKonto {
  id: number;
  createdAt: Date | string;
  lastLoginAt: Date | string | null;
  lastActivityAt: Date | string | null;
  ohneZugang: boolean;
  kontaktpersonId: number | null;
  pushSubscriptions: { id: number }[];
  webAuthnCredentials: { id: number }[];
}

export interface NutzungsZeile {
  userId: number;
  tag: string;
  anmeldungen: number;
}

export interface NutzungsTag {
  datum: string;
  /** Personen, die an diesem Tag in der App waren. */
  aktive: number;
  /** Echte Anmeldungen. Meist deutlich weniger - Sitzungen laufen 90 Tage. */
  anmeldungen: number;
  /** Neu entstandene Konten. */
  registrierungen: number;
  registrierungenKumuliert: number;
}

export interface NutzungsStatistik {
  eckdaten: {
    konten: number;
    mitZugang: number;
    ohneZugang: number;
    /** Helfer ohne Zugang UND ohne Kontaktperson - erreichbar durch niemanden. */
    unerreichbar: number;
    nieAngemeldet: number;
    aktivLetzte7Tage: number;
    aktivLetzte30Tage: number;
  };
  /** Wie viele Menschen eine Nachricht ueberhaupt erreichen kann. */
  erreichbarkeit: {
    perPush: number;
    /** Geraete insgesamt - wer Handy und Rechner angemeldet hat, zaehlt zweimal. */
    pushGeraete: number;
    /** Kein Push, aber ein Zugang: sieht die Nachricht beim naechsten Oeffnen. */
    nurInDerApp: number;
    /** Ueber die hinterlegte Kontaktperson. */
    ueberKontaktperson: number;
    garNicht: number;
  };
  anmeldeart: {
    mitPasskey: number;
    nurPasswort: number;
    nieAngemeldet: number;
  };
  /** Tagesreihe. Leer, solange nichts mitgeschrieben wurde. */
  tage: NutzungsTag[];
  /** Ab wann Nutzungstage vorliegen - vorher steht in der Reihe nur 0. */
  aufzeichnungAb: string | null;
}

const tagVon = (d: Date | string): string => new Date(d).toISOString().slice(0, 10);

function tageZwischen(vonISO: string, bisISO: string): string[] {
  const tage: string[] = [];
  const von = new Date(vonISO + 'T00:00:00.000Z');
  const bis = new Date(bisISO + 'T00:00:00.000Z');
  for (let d = von; d <= bis; d = new Date(d.getTime() + 86400000)) {
    tage.push(d.toISOString().slice(0, 10));
  }
  return tage;
}

export function berechneNutzungsStatistik(
  konten: NutzungsKonto[],
  nutzung: NutzungsZeile[],
  jetzt: Date = new Date()
): NutzungsStatistik {
  const grenze7 = jetzt.getTime() - 7 * 86400000;
  const grenze30 = jetzt.getTime() - 30 * 86400000;
  const aktivSeit = (k: NutzungsKonto, grenze: number) =>
    k.lastActivityAt != null && new Date(k.lastActivityAt).getTime() >= grenze;

  const mitZugang = konten.filter(k => !k.ohneZugang);
  const ohneZugang = konten.filter(k => k.ohneZugang);

  // Erreichbarkeit in sich ausschliessenden Gruppen, damit die Summe stimmt und
  // "gar nicht" wirklich heisst: von keinem Weg erfasst.
  const perPush = mitZugang.filter(k => k.pushSubscriptions.length > 0);
  const nurInDerApp = mitZugang.filter(k => k.pushSubscriptions.length === 0);
  const ueberKontaktperson = ohneZugang.filter(k => k.kontaktpersonId != null);
  const garNicht = ohneZugang.filter(k => k.kontaktpersonId == null);

  const eckdaten = {
    konten: konten.length,
    mitZugang: mitZugang.length,
    ohneZugang: ohneZugang.length,
    unerreichbar: garNicht.length,
    // Konten ohne Zugang melden sich nie an - sie hier mitzuzaehlen wuerde die
    // Zahl aufblaehen und etwas anderes behaupten, als sie aussagt.
    nieAngemeldet: mitZugang.filter(k => k.lastLoginAt == null).length,
    aktivLetzte7Tage: konten.filter(k => aktivSeit(k, grenze7)).length,
    aktivLetzte30Tage: konten.filter(k => aktivSeit(k, grenze30)).length
  };

  const anmeldeart = {
    mitPasskey: mitZugang.filter(k => k.webAuthnCredentials.length > 0).length,
    nurPasswort: mitZugang.filter(k => k.webAuthnCredentials.length === 0 && k.lastLoginAt != null).length,
    nieAngemeldet: eckdaten.nieAngemeldet
  };

  // --- Tagesreihe ---
  const registrierungenProTag = new Map<string, number>();
  for (const k of konten) {
    const t = tagVon(k.createdAt);
    registrierungenProTag.set(t, (registrierungenProTag.get(t) ?? 0) + 1);
  }

  const aktiveProTag = new Map<string, Set<number>>();
  const anmeldungenProTag = new Map<string, number>();
  for (const z of nutzung) {
    if (!aktiveProTag.has(z.tag)) aktiveProTag.set(z.tag, new Set());
    aktiveProTag.get(z.tag)!.add(z.userId);
    anmeldungenProTag.set(z.tag, (anmeldungenProTag.get(z.tag) ?? 0) + z.anmeldungen);
  }

  const alleTage = [...registrierungenProTag.keys(), ...aktiveProTag.keys()].sort();
  const aufzeichnungAb = [...aktiveProTag.keys()].sort()[0] ?? null;

  let summe = 0;
  const tage = alleTage.length === 0 ? [] :
    tageZwischen(alleTage[0], alleTage[alleTage.length - 1]).map(datum => {
      const r = registrierungenProTag.get(datum) ?? 0;
      summe += r;
      return {
        datum,
        aktive: aktiveProTag.get(datum)?.size ?? 0,
        anmeldungen: anmeldungenProTag.get(datum) ?? 0,
        registrierungen: r,
        registrierungenKumuliert: summe
      };
    });

  return { eckdaten, erreichbarkeit: {
    perPush: perPush.length,
    pushGeraete: perPush.reduce((s, k) => s + k.pushSubscriptions.length, 0),
    nurInDerApp: nurInDerApp.length,
    ueberKontaktperson: ueberKontaktperson.length,
    garNicht: garNicht.length
  }, anmeldeart, tage, aufzeichnungAb };
}
