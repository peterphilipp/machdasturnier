import { describe, it, expect } from 'vitest';
import { aktuelleSchichtzeit } from '../src/utils/schichtzeit.js';

/**
 * Der Fehler, der das ausgeloest hat: Eine Mail zeigte "10:30-14:30" fuer eine
 * Schicht, die im Dashboard schon "12:30-16:30" zeigte. Ursache war ein
 * geaendertes Tagesraster (DaySlot) - die App berechnet die Zeit bei jedem
 * Rendern neu aus der Schicht, die Mail las die beim Einplanen gespeicherte
 * Kopie (volunteer_shifts.slot), die dabei nicht mitgezogen wurde.
 */
describe('aktuelleSchichtzeit', () => {
  it('berechnet aus der eigenen Zeit der Schicht, nicht aus der Kopie', () => {
    const schicht = { startMin: 750, endMin: 990, daySlot: null }; // 12:30-16:30
    expect(aktuelleSchichtzeit(schicht, '10:30-14:30')).toBe('12:30-16:30');
  });

  it('faellt auf das Tagesraster zurueck, wenn die Schicht keine eigene Zeit hat', () => {
    const schicht = { startMin: null, endMin: null, daySlot: { startMin: 480, endMin: 720 } };
    expect(aktuelleSchichtzeit(schicht, 'alte-kopie')).toBe('08:00-12:00');
  });

  // Genau der Fall aus dem Bug: das Tagesraster hat sich verschoben, seit die
  // Kopie geschrieben wurde.
  it('zeigt die aktuelle Zeit, auch wenn die gespeicherte Kopie veraltet ist', () => {
    const schicht = { startMin: null, endMin: null, daySlot: { startMin: 750, endMin: 990 } };
    expect(aktuelleSchichtzeit(schicht, '10:30-14:30')).toBe('12:30-16:30');
  });

  it('faellt auf die Kopie zurueck, wenn die Schicht selbst keine Zeit mehr hat', () => {
    const schicht = { startMin: null, endMin: null, daySlot: null };
    expect(aktuelleSchichtzeit(schicht, '10:30-14:30')).toBe('10:30-14:30');
  });

  it('faellt auf die Kopie zurueck, wenn die Schicht (z.B. geloescht) gar nicht mehr da ist', () => {
    expect(aktuelleSchichtzeit(null, '10:30-14:30')).toBe('10:30-14:30');
    expect(aktuelleSchichtzeit(undefined, '10:30-14:30')).toBe('10:30-14:30');
  });
});
