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
   * Zeile unter der Ueberschrift - normalerweise der Turniername.
   *
   * Ohne Angabe steht dort der Vereinsname. Der Turniername ist der bessere
   * Wert, weil die App an derselben Stelle auch ihn zeigt: Wer die Mail neben
   * der App sieht, erkennt dieselbe Kopfzeile wieder.
   */
  unterzeile?: string | null;
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
  /** Basis-URL der App - fuer den Verweis in der Fusszeile. */
  appUrl?: string | null;
}

/**
 * Eine dunklere Variante der Vereinsfarbe.
 *
 * Rechnerisch und nicht als zweite Farbe im Datenmodell: Ein Verlauf im
 * Mailkopf ist in Outlook nicht darstellbar, zwei abgesetzte Flaechen schon.
 * Die zweite Farbe soll dabei nicht gepflegt werden muessen - sie ist immer
 * dieselbe Farbe, nur dunkler.
 */
export function dunkler(farbe: string, anteil = 0.22): string {
  const h = /^#?([0-9a-f]{6})$/i.exec(String(farbe).trim());
  // Bei allem, was nicht wie ein Sechser-Hex aussieht (z.B. "rebeccapurple"
  // oder rgb()), lieber die Ausgangsfarbe zurueckgeben als Schwarz.
  if (!h) return farbe;
  const n = parseInt(h[1], 16);
  const kanal = (v: number) => Math.max(0, Math.round(v * (1 - anteil)));
  const r = kanal((n >> 16) & 255);
  const g = kanal((n >> 8) & 255);
  const b = kanal(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
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
          <div style="text-align:center;font-size:26px;font-weight:800;color:${farbe};line-height:1.1;">${maskiere(k.wert)}</div>
          <div style="text-align:center;font-size:12px;color:#475569;margin-top:4px;">${maskiere(k.label)}</div>
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

/**
 * Eine Sternereihe zum Anklicken - fuer die Bewertung direkt aus der Mail.
 *
 * Fuenf einzelne Links, jeder mit seinem Wert. Als Text-Sterne und nicht als
 * Bilder: Wer Bilder blockiert (Standard in Outlook und bei vielen
 * Gmail-Konten), saehe sonst fuenf leere Rahmen statt einer Frage.
 *
 * Jeder Link fuehrt auf die Bewertungsseite, nicht direkt in die Datenbank -
 * Mailprogramme und Sicherheitsscanner rufen Links teilweise von sich aus ab,
 * und ein schreibender Link waere damit abgegeben, bevor der Empfaenger die
 * Mail geoeffnet hat.
 */
export function sterneReihe(o: {
  frage: string;
  hinweis: string;
  basisUrl: string;
  feld: string;
  /**
   * Die fuenf Symbole - dieselben wie in der App (RATING_FRAGEN im Frontend).
   * Eine Mail, die andere Symbole zeigt als die Seite, auf der man landet,
   * sieht nach zwei verschiedenen Fragen aus.
   */
  symbole: string[];
  /** Beschriftung fuer 1 und 5 - "wenig zu tun" bis "zu viel". */
  skala: [string, string];
  farbe: string;
}): string {
  const sterne = [1, 2, 3, 4, 5].map(n => `
    <td align="center" style="padding:0 3px;">
      <a href="${maskiere(`${o.basisUrl}&${o.feld}=${n}`)}"
         title="${maskiere(String(n))}"
         style="display:block;width:46px;line-height:46px;text-align:center;text-decoration:none;
                font-size:22px;color:${o.farbe};background:#ffffff;border:2px solid #e2e8f0;
                border-radius:10px;font-weight:700;">${maskiere(o.symbole[n - 1] ?? String(n))}</a>
    </td>`).join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:0 0 18px;">
      <tr><td style="padding-bottom:6px;">
        <div style="font-size:14px;font-weight:700;color:#0f172a;">${maskiere(o.frage)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">${maskiere(o.hinweis)}</div>
      </td></tr>
      <tr><td>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${sterne}</tr></table>
      </td></tr>
      <tr><td style="padding-top:6px;">
        <table role="presentation" width="260" cellpadding="0" cellspacing="0" border="0" style="width:260px;">
          <tr>
            <td align="left" style="font-size:11px;color:#94a3b8;">${maskiere(o.skala[0])}</td>
            <td align="right" style="font-size:11px;color:#94a3b8;">${maskiere(o.skala[1])}</td>
          </tr>
        </table>
      </td></tr>
    </table>`;
}

/**
 * Eine Liste von Schichten mit je einem Knopf - fuer den Helferaufruf.
 *
 * Jede Zeile ist eine eigene Tabelle und kein `<li>`: Outlook setzt
 * Listenabstaende unberechenbar, und ein Knopf in einem Listenpunkt rutscht
 * dort unter den Text. Zeile fuer Zeile ist laenger geschrieben, sieht aber
 * ueberall gleich aus.
 */
export function schichtListe(
  zeilen: { icon: string; bereich: string; wann: string; hinweis?: string; url: string }[],
  farbe: string,
  knopf = 'Übernehmen'
): string {
  if (zeilen.length === 0) return '';
  const inhalt = zeilen.map(z => `
    <tr><td style="padding:0 0 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;">
        <tr>
          <td width="34" valign="top" style="padding:12px 0 12px 12px;font-size:19px;line-height:1.2;">
            ${maskiere(z.icon)}
          </td>
          <td valign="top" style="padding:12px 8px;">
            <div style="font-size:14px;font-weight:700;color:#0f172a;line-height:1.3;">
              ${maskiere(z.bereich)}
            </div>
            <div style="font-size:12px;color:#475569;margin-top:2px;">${maskiere(z.wann)}</div>
            ${z.hinweis
              ? `<div style="font-size:12px;font-weight:700;color:${farbe};margin-top:2px;">
                   ${maskiere(z.hinweis)}
                 </div>`
              : ''}
          </td>
          <td valign="middle" align="right" style="padding:12px 12px 12px 4px;white-space:nowrap;">
            <a href="${maskiere(z.url)}"
               style="display:inline-block;padding:9px 14px;font-size:13px;font-weight:700;
                      color:#ffffff;background:${farbe};border-radius:8px;text-decoration:none;">
              ${maskiere(knopf)}
            </a>
          </td>
        </tr>
      </table>
    </td></tr>`).join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="margin:4px 0 14px;">${inhalt}</table>`;
}

/**
 * Ein farbiger Streifen mit grossem Symbol - der Aufmacher der Dankesmail.
 *
 * Emoji und nicht ein Bild: Ein Bild braucht eine Datei, die ausgeliefert und
 * mitgepflegt werden muss, und wird in Outlook und vielen Gmail-Konten
 * standardmaessig blockiert. Dann waere der Aufmacher der Dankesmail genau
 * das, was fehlt. Emoji sind Text und kommen immer an.
 */
export function jubelBand(o: { symbole: string; text: string; farbe: string }): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:0 0 20px;border-radius:14px;
                  background:${o.farbe};
                  background-image:linear-gradient(135deg, ${o.farbe} 0%, ${dunkler(o.farbe, 0.3)} 100%);">
      <tr><td align="center" bgcolor="${o.farbe}" style="padding:22px 18px;border-radius:14px;
              background:${o.farbe};
              background-image:linear-gradient(135deg, ${o.farbe} 0%, ${dunkler(o.farbe, 0.3)} 100%);">
        <!--
          text-align:center auf JEDEM div, nicht nur align="center" auf der
          Zelle: Ein <div> ist ein Blockelement und fuellt seinen Container
          automatisch auf volle Breite - das zentriert die Zelle dann selbst
          nicht mehr sichtbar (der Div fuellt sie ja schon), aber der TEXT
          darin bleibt ohne eigene Ausrichtung linksbuendig. Auf dem Handy war
          das gut sichtbar: die Emoji-Zeile klebte links, obwohl die Box um sie
          herum die volle Breite hatte.
        -->
        <div style="text-align:center;font-size:34px;line-height:1.2;letter-spacing:4px;">${maskiere(o.symbole)}</div>
        <div style="text-align:center;font-size:19px;font-weight:800;color:#ffffff;line-height:1.3;margin-top:8px;">
          ${maskiere(o.text)}
        </div>
      </td></tr>
    </table>`;
}

/** Ein abgesetzter Kasten - hebt einen Block vom Fliesstext ab. */
export function kasten(inhalt: string, farbe: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="margin:0 0 18px;background:#f8fafc;border-left:4px solid ${farbe};
                        border-radius:0 10px 10px 0;">
            <tr><td style="padding:16px 18px;">${inhalt}</td></tr>
          </table>`;
}

/** Setzt Kopf, Inhalt und Fuss zu einer versandfertigen Mail zusammen. */
export function baueMail(o: LayoutOptionen): string {
  // 30% dunkler - dieselbe Abstufung wie shadeColor(clubPrimary, -30) im
  // App-Header, damit der Verlauf in Mail und App gleich aussieht.
  const akzent = dunkler(o.farbe, 0.3);

  /**
   * Der Knopf - mit sichtbarer Ausweichadresse darunter.
   *
   * Die ausgeschriebene URL ist kein Schoenheitsfehler, sondern der Grund,
   * warum die Mail funktioniert, wenn der Knopf es nicht tut: In manchen
   * Firmen-Mailclients werden gestylte Links abgeschnitten oder umgeschrieben,
   * und dann steht der Empfaenger vor einer Mail ohne Ausweg.
   */
  const knopf = o.aktion
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
              style="margin:4px 0 6px;">
         <tr><td align="center">
           <table role="presentation" cellpadding="0" cellspacing="0" border="0">
             <tr><td align="center" bgcolor="${o.farbe}" style="border-radius:10px;">
               <a href="${maskiere(o.aktion.url)}"
                  style="display:inline-block;padding:15px 34px;font-size:16px;font-weight:700;
                         color:#ffffff;text-decoration:none;border-radius:10px;
                         border-bottom:3px solid ${akzent};">
                 ${maskiere(o.aktion.text)}
               </a>
             </td></tr>
           </table>
         </td></tr>
         <tr><td align="center" style="padding:10px 0 16px;">
           <div style="text-align:center;font-size:11px;line-height:1.5;color:#94a3b8;word-break:break-all;">
             Falls der Knopf nicht funktioniert:<br />${maskiere(o.aktion.url)}
           </div>
         </td></tr>
       </table>`
    : '';

  /**
   * Das Logo in einer weissen Kachel.
   *
   * Masse aus der App uebernommen (.selfservice-header-logo-wrapper: 56px,
   * radius 8px, 4px Innenabstand). Das war der sichtbarste Unterschied
   * zwischen App und Mail - und wo eine Mail nicht wie die App aussieht,
   * wirkt sie wie von jemand anderem.
   *
   * Die weisse Flaeche ist kein Schmuck: Vereinslogos sind fuer weissen Grund
   * gemacht, ein dunkles Logo auf dunkler Vereinsfarbe verschwindet.
   */
  const logo = o.logoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
              style="background:#ffffff;border-radius:8px;">
         <tr><td align="center" width="56" height="56"
                 style="width:56px;height:56px;padding:4px;">
           <img src="${maskiere(o.logoUrl)}" alt="${maskiere(o.vereinsname)}" width="48"
                style="display:block;border:0;width:48px;height:auto;" />
         </td></tr>
       </table>`
    // Ohne Logo bleibt der Kopf trotzdem erkennbar - eine leere Zelle sieht
    // nach Fehler aus.
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
              style="background:#ffffff;border-radius:8px;">
         <tr><td align="center" width="56" height="56"
                 style="width:56px;height:56px;font-size:30px;line-height:56px;">🏆</td></tr>
       </table>`;

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
<tr><td align="center" style="padding:28px 12px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
         style="width:600px;max-width:100%;background:#ffffff;border-radius:20px;overflow:hidden;
                border:1px solid #dfe6f0;
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

    ${testband}

    <!--
      Kopf wie in der App (.selfservice-header): Verlauf 135deg von der
      Vereinsfarbe zu 30% dunkler, 16px/20px Innenabstand, Titel 20px/700,
      Unterzeile 14px mit 85% Deckkraft.

      Der Verlauf steht als background-image UND es gibt ein bgcolor mit der
      einfachen Farbe: Gmail und Apple Mail zeigen den Verlauf, Outlook
      (Word-Engine) ignoriert ihn und behaelt die Flaeche. Beides ist richtig -
      falsch waere nur ein weisser Kopf.

      In der App traegt der Titel den Turniernamen und die Unterzeile die
      Begruessung. In der Mail ist es umgekehrt: Die Ueberschrift ist der
      Betreff, weil der Empfaenger wissen muss, worum es in DIESER Mail geht;
      das Turnier steht darunter.
    -->
    <tr><td bgcolor="${o.farbe}" style="background:${o.farbe};
            background-image:linear-gradient(135deg, ${o.farbe} 0%, ${akzent} 100%);
            padding:16px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="72" valign="middle" style="padding-right:16px;">${logo}</td>
        <td valign="middle">
          <div style="font-size:20px;font-weight:700;color:#ffffff;line-height:1.2;">
            ${maskiere(o.titel)}
          </div>
          <div style="font-size:14px;color:#ffffff;opacity:0.85;margin-top:4px;">
            ${maskiere(o.unterzeile || o.vereinsname)}
          </div>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:24px 24px 8px;">
      ${o.inhalt}
      ${knopf}
    </td></tr>

    <tr><td style="padding:0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td bgcolor="#e9eef5" height="1" style="background:#e9eef5;height:1px;
                font-size:0;line-height:1px;">&nbsp;</td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:18px 24px 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="top">
          <div style="font-size:12px;font-weight:700;color:#475569;">🏆 Mach das Turnier!</div>
          <div style="font-size:11px;line-height:1.6;color:#8a95a5;margin-top:4px;">
            ${maskiere(o.fusszeile)}
          </div>
        </td>
        ${o.appUrl
          ? `<td valign="top" align="right" style="padding-left:14px;white-space:nowrap;">
               <a href="${maskiere(o.appUrl)}"
                  style="font-size:11px;font-weight:700;color:${o.farbe};text-decoration:none;">
                 App öffnen →
               </a>
             </td>`
          : ''}
      </tr></table>
    </td></tr>

  </table>

  <div style="font-size:10px;color:#a3adbb;margin-top:14px;
              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    ${maskiere(o.vereinsname)}
  </div>

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
