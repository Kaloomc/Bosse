// Dates et semaines, toujours à l'heure de Paris. Les dates sont des chaînes "AAAA-MM-JJ".
const FUSEAU = 'Europe/Paris';

// Le jour d'aujourd'hui à Paris, quel que soit le fuseau du serveur : "2026-11-07".
const aujourdhui = (date = new Date()) => date.toLocaleDateString('sv-SE', { timeZone: FUSEAU });

// Numéro du jour depuis 1970 (minuit UTC : pas d'heure d'été, donc des jours toujours entiers).
const numeroJour = (iso) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 864e5);

// Nombre de jours de a à b (positif si b est après a).
const joursEntre = (a, b) => numeroJour(b) - numeroJour(a);

const ajouterJours = (iso, n) => new Date((numeroJour(iso) + n) * 864e5).toISOString().slice(0, 10);

// Lundi = 0 … dimanche = 6.
const indiceJourSemaine = (iso) => (new Date(iso.slice(0, 10) + 'T12:00:00Z').getUTCDay() + 6) % 7;

const debutSemaine = (iso) => ajouterJours(iso, -indiceJourSemaine(iso));

// Date et heure avec le fuseau de Paris, en ISO 8601 : "2026-11-04T21:30:00+01:00".
function isoParis(date) {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const decalage = (p.timeZoneName || '').replace('GMT', '') || '+00:00';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${decalage}`;
}

// Le jour (à Paris) d'une date Notion : "2026-11-06" tel quel, ou une date avec heure convertie à l'heure de Paris.
const jourDe = (iso) => (iso.includes('T') ? aujourdhui(new Date(iso)) : iso.slice(0, 10));

module.exports = { FUSEAU, aujourdhui, joursEntre, ajouterJours, indiceJourSemaine, debutSemaine, isoParis, jourDe };
