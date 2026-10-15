// Minimal RFC 4180 CSV parser plus the Flightradar24 flight diary format.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const CODE_RE = /\(([A-Z0-9]{3})?\/([A-Z0-9]{4})?\)\s*$/;
const BARE_RE = /^[A-Z0-9]{3,4}$/;

/** "Stockholm / Arlanda (ARN/ESSA)" -> { iata: 'ARN', icao: 'ESSA', label } */
export function parseAirportField(value) {
  const v = (value || '').trim();
  const m = v.match(CODE_RE);
  if (m) return { iata: m[1] || '', icao: m[2] || '', label: v.replace(CODE_RE, '').trim() };
  const up = v.toUpperCase();
  if (BARE_RE.test(up)) return up.length === 3 ? { iata: up, icao: '', label: up } : { iata: '', icao: up, label: up };
  return { iata: '', icao: '', label: v };
}

/** "Scandinavian Airlines (SK/SAS)" -> "Scandinavian Airlines" */
const stripCodes = (v) => (v || '').replace(/\s*\([^)]*\)\s*$/, '').trim();

/**
 * Parses a myFlightradar24 export (or any CSV with Date/From/To columns).
 * Returns flights with raw airport references; resolution against the airport
 * database happens in the app.
 */
export function parseFlightCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => header.findIndex((h) => names.includes(h));
  const iDate = col('date');
  const iFrom = col('from', 'origin', 'departure');
  const iTo = col('to', 'destination', 'arrival');
  if (iFrom < 0 || iTo < 0) throw new Error('CSV needs "From" and "To" columns (myFlightradar24 export format).');
  const iNo = col('flight number', 'flight');
  const iAirline = col('airline');
  const iAircraft = col('aircraft');
  const iReg = col('registration');
  const iDep = col('dep time');
  const iDur = col('duration');

  return rows.slice(1).map((r) => ({
    date: iDate >= 0 ? (r[iDate] || '').trim() : '',
    flightNo: iNo >= 0 ? (r[iNo] || '').trim() : '',
    from: parseAirportField(r[iFrom]),
    to: parseAirportField(r[iTo]),
    airline: iAirline >= 0 ? stripCodes(r[iAirline]) : '',
    aircraft: iAircraft >= 0 ? stripCodes(r[iAircraft]) : '',
    registration: iReg >= 0 ? (r[iReg] || '').trim() : '',
    depTime: iDep >= 0 ? (r[iDep] || '').trim() : '',
    duration: iDur >= 0 ? (r[iDur] || '').trim() : '',
  }));
}
