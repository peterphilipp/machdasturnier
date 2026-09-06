/**
 * Das Aussehen der ausgehenden Mails.
 *
 * E-Mail ist nicht Web. Was hier nach Ruecksschritt aussieht, ist Absicht:
 *
 *  - **Tabellen statt Flexbox.** Outlook rendert mit der Word-Engine und
 *    kennt weder Flexbox noch Grid. Eine Tabelle ist das einzige Layout, das
 *    von Gmail bis Outlook 2016 gleich ankommt.
 *  - **Alle Stile inline.** Gmail entfernt `<style>`-Bloecke in vielen
 *    Ansichten, vor allem auf Android. Was nicht am Element steht, gilt nicht.
 *  - **Bilder ueber HTTPS, nie als `data:`.** Die Logos liegen in der
 *    Datenbank als `data:`-URL; Gmail rendert die in Mails nicht. Sie kommen
 *    deshalb ueber `/api/logo/...` - siehe logo.controller.ts.
 *  - **Immer eine Textfassung mitschicken.** Ohne sie stufen Spamfilter eine
 *    reine HTML-Mail schlechter ein, und wer Bilder blockiert, sieht sonst
 *    fast nichts.
 *
 * Nicht erreichbar ist das Absenderlogo neben dem Namen in Gmail. Das
 * verlangt BIMI: DMARC auf p=quarantine/reject plus ein Verified Mark
 * Certificate, das eine eingetragene Marke voraussetzt und jaehrlich rund
 * 1.000 Euro kostet. Das Logo steht deshalb im Mailkopf, wo es ohne
 * Zertifikat sichtbar ist.
 */

export interface LayoutOptionen {
  /** Ueberschrift im farbigen Kopf. */
  titel: string;
  /**
   * Kennzeichnung der Testumgebung, wenn diese Mail von dort kommt.
   *
   * Sitzt im Layout und nicht in den Vorlagen: So kann keine neue Vorlage sie
   * vergessen. Eine Testmail, die beim Empfaenger wie eine echte aussieht,
   * ist schlimmer als gar keine Kennzeichnung - in der App warnt ein Band,
   * in der Mail muesste er es raten.
   */
  testumgebung?: { bezeichnung: string } | null;
  /** Fertige HTML-Blöcke fuer den Inhalt (bereits maskiert). */
  inhalt: string;
  /** Optionaler Knopf unter dem Inhalt. */
  aktion?: { text: string; url: string } | null;
  /** Absolute HTTPS-Adresse des Vereinslogos. */
  logoUrl?: string | null;
  vereinsname: string;
  /** Akzentfarbe des Vereins, z.B. "#e43d10". */
  farbe: string;
  /** Steht klein unter dem Inhalt - etwa warum diese Mail kommt. */
  fusszeile: string;
}

/** Damit Nutzertext nichts am Layout kaputtmacht - und kein HTML einschmuggelt. */
export function maskiere(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Freitext in Absaetze - Leerzeilen trennen, einfache Umbrueche bleiben. */
export function alsAbsaetze(text: string, farbe = '#334155'): string {
  return text
    .split(/\n{2,}/)
    .map(a => a.trim())
    .filter(Boolean)
    .map(a =>
      `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${farbe};">`
      + maskiere(a).replace(/\n/g, '<br />')
      + '</p>')
    .join('');
}

/**
 * Eine Kennzahl als Kaestchen - fuer die Dankesmail mit Statistik.
 * Zwei je Reihe, damit es auf einem Handy nicht bricht.
 */
export function kennzahlen(werte: { wert: string; label: string }[], farbe: string): string {
  if (werte.length === 0) return '';
  const zellen = werte.map(k => `
    <td width="50%" style="padding:6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
        <tr><td align="center" style="padding:14px 8px;">
          <div style="font-size:26px;font-weight:800;color:${farbe};line-height:1.1;">${maskiere(k.wert)}</div>
          <div style="font-size:12px;color:#475569;margin-top:4px;">${maskiere(k.label)}</div>
        </td></tr>
      </table>
    </td>`);

  const reihen: string[] = [];
  for (let i = 0; i < zellen.length; i += 2) {
    // Fehlt die zweite Zelle, muss eine leere stehen - sonst zieht sich die
    // vorhandene auf die ganze Breite und die Reihe sieht anders aus als die
    // darueber.
    const zweite = zellen[i + 1] ?? '<td width="50%"></td>';
    reihen.push(`<tr>${zellen[i]}${zweite}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="margin:4px 0 18px;">${reihen.join('')}</table>`;
}

/** Setzt Kopf, Inhalt und Fuss zu einer versandfertigen Mail zusammen. */
export function baueMail(o: LayoutOptionen): string {
  const knopf = o.aktion
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 18px;">
         <tr><td align="center" bgcolor="${o.farbe}" style="border-radius:8px;">
           <a href="${maskiere(o.aktion.url)}"
              style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;
                     color:#ffffff;text-decoration:none;border-radius:8px;">
             ${maskiere(o.aktion.text)}
           </a>
         </td></tr>
       </table>`
    : '';

  const logo = o.logoUrl
    ? `<img src="${maskiere(o.logoUrl)}" alt="${maskiere(o.vereinsname)}" width="56"
            style="display:block;border:0;width:56px;height:auto;border-radius:8px;" />`
    // Ohne Logo bleibt der Kopf trotzdem erkennbar - eine leere Zelle sieht
    // nach Fehler aus.
    : `<div style="font-size:30px;line-height:1;">🏆</div>`;

  /**
   * Das Testband. In der App ist es ein Streifenmuster; hier ist es eine
   * einfarbige Flaeche, weil CSS-Gradienten in Outlook (Word-Engine) und in
   * mehreren Webmailern nicht ankommen - dort blieb ein weisser Balken uebrig,
   * also genau kein Warnhinweis. Dieselbe Farbfamilie, damit es wiedererkannt
   * wird, und schwarz-gelb statt rot: Die Testumgebung ist nicht kaputt, sie
   * ist die falsche.
   */
  const testband = o.testumgebung
    ? `<tr><td bgcolor="#BA7517" style="background:#BA7517;padding:10px 24px;">
         <div style="font-size:13px;font-weight:700;color:#2b1800;line-height:1.4;">
           ⚠️ ${maskiere(o.testumgebung.bezeichnung.toUpperCase())} – diese Mail stammt aus einer
           Spielwiese. Die Daten darin sind nicht echt, und nichts davon zählt für ein Turnier.
         </div>
       </td></tr>`
    : '';

  return `<!doctype html>
<html lang="de"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${maskiere(o.titel)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;">
<!-- Vorschautext: steht in der Inbox-Liste hinter dem Betreff und wird sonst
     mit dem ersten Fliesstext gefuellt, was oft "Hallo," ergibt. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${maskiere(o.titel)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7;">
<tr><td align="center" style="padding:24px 12px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
         style="width:600px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

    ${testband}

    <tr><td style="background:${o.farbe};padding:18px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="64" valign="middle" style="padding-right:12px;">${logo}</td>
        <td valign="middle">
          <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.85);
                      text-transform:uppercase;letter-spacing:0.6px;">${maskiere(o.vereinsname)}</div>
          <div style="font-size:20px;font-weight:800;color:#ffffff;line-height:1.25;margin-top:2px;">
            ${maskiere(o.titel)}
          </div>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:24px;">
      ${o.inhalt}
      ${knopf}
    </td></tr>

    <tr><td style="padding:16px 24px 22px;border-top:1px solid #e9eef5;">
      <div style="font-size:11px;line-height:1.6;color:#7c8797;">${maskiere(o.fusszeile)}</div>
    </td></tr>

  </table>

</td></tr>
</table>
</body></html>`;
}

/**
 * Die Textfassung derselben Mail.
 *
 * Bewusst nicht aus dem HTML zurueckgerechnet - das ergibt regelmaessig
 * Kauderwelsch mit halben Tags. Der Aufrufer liefert den Text, den er meint.
 */
export function baueText(o: {
  titel: string; absaetze: string[]; aktion?: { text: string; url: string } | null; fusszeile: string;
  testumgebung?: { bezeichnung: string } | null;
}): string {
  const teile: string[] = [];
  // Auch in der Textfassung zuerst - wer HTML abgeschaltet hat, braucht die
  // Warnung genauso.
  if (o.testumgebung) {
    teile.push(
      `*** ${o.testumgebung.bezeichnung.toUpperCase()} - diese Mail stammt aus einer Spielwiese. ***`,
      '*** Die Daten darin sind nicht echt, und nichts davon zaehlt fuer ein Turnier. ***',
      ''
    );
  }
  teile.push(o.titel, ''.padEnd(o.titel.length, '='), '', ...o.absaetze);
  if (o.aktion) teile.push('', `${o.aktion.text}: ${o.aktion.url}`);
  teile.push('', '--', o.fusszeile);
  return teile.join('\n');
}

/**
 * Der Betreff, wie er in der Inbox stehen soll.
 *
 * Aus der Testumgebung mit Praefix: Der Betreff ist das Einzige, was man in
 * der Liste sieht, bevor man die Mail oeffnet - dort muss die Kennzeichnung
 * stehen, nicht erst im Text.
 */
export function baueBetreff(titel: string, testumgebung?: { bezeichnung: string } | null): string {
  return testumgebung ? `[TEST] ${titel}` : titel;
}
