// components/homecalendar.js — Home's month-grid calendar. Days with any activity get
// a dot; tapping a day reuses journal.js's exported day-detail sheet (no duplicated
// markup). Month state lives inside the component instance (prev/next nav).
import { getActivityDatesInRange, todayStr } from '../store.js';
import { openDayDetail } from '../views/journal.js';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function createHomeCalendar({ settings }) {
  const wrap = document.createElement('div');
  wrap.className = 'home-cal';
  let cursor = new Date();
  cursor.setDate(1);

  async function render() {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const startDate = fmt(new Date(year, month, 1));
    const endDate = fmt(new Date(year, month, daysInMonth));
    const activeDates = await getActivityDatesInRange(startDate, endDate);
    const today = todayStr();

    let cells = '';
    for (let i = 0; i < startWeekday; i++) cells += `<div class="home-cal__cell home-cal__cell--empty" aria-hidden="true"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = fmt(new Date(year, month, d));
      const isToday = dateStr === today;
      const hasActivity = activeDates.has(dateStr);
      cells += `
        <button type="button" class="home-cal__cell ${isToday ? 'is-today' : ''} ${hasActivity ? 'has-activity' : ''}" data-date="${dateStr}" aria-label="${dateStr}${hasActivity ? ', has activity' : ''}">
          <span class="home-cal__daynum">${d}</span>
          ${hasActivity ? '<span class="home-cal__dot"></span>' : ''}
        </button>
      `;
    }

    wrap.innerHTML = `
      <div class="home-cal__header">
        <button type="button" class="home-cal__nav" id="hc-prev" aria-label="Previous month">&#8249;</button>
        <div class="home-cal__month">${monthLabel}</div>
        <button type="button" class="home-cal__nav" id="hc-next" aria-label="Next month">&#8250;</button>
      </div>
      <div class="home-cal__weekdays">${WEEKDAY_LABELS.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="home-cal__grid">${cells}</div>
    `;

    wrap.querySelector('#hc-prev').addEventListener('click', () => {
      cursor = new Date(year, month - 1, 1);
      render();
    });
    wrap.querySelector('#hc-next').addEventListener('click', () => {
      cursor = new Date(year, month + 1, 1);
      render();
    });
    wrap.querySelectorAll('.home-cal__cell[data-date]').forEach((cell) => {
      cell.addEventListener('click', () => openDayDetail(cell.dataset.date, settings));
    });
  }

  render();
  return wrap;
}
