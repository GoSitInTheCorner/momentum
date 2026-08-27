// services/weather.js — Open-Meteo (free, keyless, CORS-open). Online-only widget;
// callers must treat a null return as "hide the widget gracefully", not an error.
import { fetchWithTimeout } from '../util.js';

const WEATHER_CODES = {
  0: { label: 'Clear sky', icon: '☀️' },
  1: { label: 'Mostly clear', icon: '🌤️' },
  2: { label: 'Partly cloudy', icon: '⛅' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Fog', icon: '🌫️' },
  48: { label: 'Fog', icon: '🌫️' },
  51: { label: 'Light drizzle', icon: '🌦️' },
  53: { label: 'Drizzle', icon: '🌦️' },
  55: { label: 'Heavy drizzle', icon: '🌦️' },
  56: { label: 'Freezing drizzle', icon: '🌦️' },
  57: { label: 'Freezing drizzle', icon: '🌦️' },
  61: { label: 'Light rain', icon: '🌧️' },
  63: { label: 'Rain', icon: '🌧️' },
  65: { label: 'Heavy rain', icon: '🌧️' },
  66: { label: 'Freezing rain', icon: '🌧️' },
  67: { label: 'Freezing rain', icon: '🌧️' },
  71: { label: 'Light snow', icon: '🌨️' },
  73: { label: 'Snow', icon: '🌨️' },
  75: { label: 'Heavy snow', icon: '🌨️' },
  77: { label: 'Snow grains', icon: '🌨️' },
  80: { label: 'Rain showers', icon: '🌦️' },
  81: { label: 'Rain showers', icon: '🌦️' },
  82: { label: 'Violent showers', icon: '🌧️' },
  85: { label: 'Snow showers', icon: '🌨️' },
  86: { label: 'Snow showers', icon: '🌨️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  96: { label: 'Thunderstorm w/ hail', icon: '⛈️' },
  99: { label: 'Thunderstorm w/ hail', icon: '⛈️' },
};

function describeCode(code) {
  return WEATHER_CODES[code] || { label: 'Weather', icon: '🌡️' };
}

function getPosition(timeout = 4000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('no geolocation')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
      { timeout, maximumAge: 10 * 60 * 1000 },
    );
  });
}

async function geocodeCity(city) {
  const res = await fetchWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
  if (!res.ok) throw new Error('geocode failed');
  const data = await res.json();
  const r = data?.results?.[0];
  if (!r) throw new Error('city not found');
  return { lat: r.latitude, lon: r.longitude, name: r.name };
}

// Flow: try one-time geolocation first; on denial/timeout/unsupported, fall back to
// geocoding settings.weatherCity; if neither works (or fetch fails/offline), return
// null so the caller collapses the widget with no error shown to the user.
export async function getWeather(settings) {
  let lat, lon, cityName = null;
  try {
    const coords = await getPosition();
    lat = coords.latitude;
    lon = coords.longitude;
  } catch {
    if (!settings.weatherCity) return null;
    try {
      const geo = await geocodeCity(settings.weatherCity);
      lat = geo.lat; lon = geo.lon; cityName = geo.name;
    } catch (err) {
      console.warn('weather: geocoding fallback failed', err);
      return null;
    }
  }

  try {
    const unit = settings.weatherUnits === 'C' ? 'celsius' : 'fahrenheit';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=${unit}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`forecast HTTP ${res.status}`);
    const data = await res.json();
    const cur = data?.current;
    if (!cur || typeof cur.temperature_2m !== 'number') return null;
    const desc = describeCode(cur.weather_code);
    return {
      temp: Math.round(cur.temperature_2m),
      unit: settings.weatherUnits === 'C' ? 'C' : 'F',
      label: desc.label,
      icon: desc.icon,
      city: cityName,
    };
  } catch (err) {
    console.warn('weather: forecast fetch failed', err);
    return null;
  }
}
