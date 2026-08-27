// services/moon.js -- fully offline lunar ecliptic longitude -> zodiac sign, used to
// compute a natal Moon sign (see docs/SPEC.md v2.2 item 4). Same abbreviated lunar
// theory as the HA astro-orbital-lib.js's moonPos() (mean longitude + the largest
// periodic perturbation terms) -- accurate to a few tenths of a degree, plenty for a
// zodiac sign, not precise astrology. Reference read at
// C:\Users\User\AI\_build\astro-orbital-lib.js before writing this.
const D2R = Math.PI / 180;
function n360(x) { return ((x % 360) + 360) % 360; }
function toJulianDate(date) { return date.getTime() / 86400000 + 2440587.5; }

// Geocentric apparent ecliptic longitude of the Moon (degrees) for a given Date.
export function moonEclipticLongitude(date) {
  const T = (toJulianDate(date) - 2451545) / 36525;
  const Lp = n360(218.3164477 + 481267.88123421 * T);
  const Dd = n360(297.8501921 + 445267.1114034 * T);
  const M = n360(357.5291092 + 35999.0502909 * T);
  const Mp = n360(134.9633964 + 477198.8675055 * T);
  const Dr = Dd * D2R, Mr = M * D2R, Mpr = Mp * D2R;
  const lon = Lp
    + 6.288774 * Math.sin(Mpr)
    - 1.274294 * Math.sin(2 * Dr - Mpr)
    + 0.658314 * Math.sin(2 * Dr)
    - 0.185116 * Math.sin(Mr)
    - 0.059268 * Math.sin(2 * Mpr - 2 * Dr)
    - 0.057014 * Math.sin(Mpr + 2 * Dr - Mr)
    + 0.053110 * Math.sin(Mpr + 2 * Dr)
    + 0.045785 * Math.sin(2 * Dr - Mr)
    + 0.040718 * Math.sin(Mpr - Mr)
    - 0.034861 * Math.sin(Dr)
    - 0.030730 * Math.sin(Mpr + Mr);
  return n360(lon);
}

// Tropical zodiac, 0deg Aries at the vernal equinox, 30deg per sign -- standard
// ecliptic-longitude-to-sign mapping (matches ZS in astro-orbital-lib.js).
const ZODIAC_SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];
export function zodiacFromLongitude(lon) {
  return ZODIAC_SIGNS[Math.floor(n360(lon) / 30) % 12];
}

// Moon sign at birth. `birthTime` ('HH:MM', 24h) is optional -- without it we assume
// local noon. The Moon moves ~13deg/day (roughly one zodiac sign every 2-2.5 days), so
// a birth near a sign-change boundary can come out wrong without a real birth time --
// callers should surface this as "approximate" in the UI.
export function moonSignFor(birthDate, birthTime) {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  let hh = 12, mm = 0;
  if (birthTime) {
    const [h, mi] = birthTime.split(':').map(Number);
    if (!Number.isNaN(h)) hh = h;
    if (!Number.isNaN(mi)) mm = mi;
  }
  const dt = new Date(y, m - 1, d, hh, mm);
  return zodiacFromLongitude(moonEclipticLongitude(dt));
}
