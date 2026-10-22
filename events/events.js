// The events themselves are written into the page by Jekyll (from _data/events.yml),
// so search engines and AI tools can read them. This script only keeps the page current
// for visitors: on every load it compares each event's date with today's date and moves
// the event into "Upcoming" or "Past", then sorts both lists.

(function () {
  'use strict';

  function startOfToday() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // Reads "YYYY-MM-DD" as a local date (avoids time-zone shifts).
  function parseDate(text) {
    var p = String(text).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function titleOf(card) {
    var h = card.querySelector('h3');
    return h ? h.textContent.trim() : '';
  }

  function sortEvents() {
    var upcomingEl = document.getElementById('upcoming-events');
    var pastEl = document.getElementById('past-events');
    if (!upcomingEl || !pastEl) return;

    var today = startOfToday();
    var cards = Array.prototype.slice.call(
      document.querySelectorAll('#upcoming-events .event, #past-events .event')
    );

    var dated = [];
    var undated = [];
    var past = [];

    cards.forEach(function (card) {
      var date = parseDate(card.getAttribute('data-date'));
      var hasDateTime = card.getAttribute('data-has-datetime') === 'true' && !isNaN(date);

      if (!hasDateTime) {
        // Missing date or time: treated as upcoming.
        undated.push(card);
      } else if (date >= today) {
        dated.push({ card: card, date: date });
      } else {
        past.push({ card: card, date: date });
      }
    });

    // Upcoming: dated events chronologically, then undated ones alphabetically.
    dated.sort(function (a, b) { return a.date - b.date; });
    undated.sort(function (a, b) { return titleOf(a).localeCompare(titleOf(b)); });
    // Past: most recent first.
    past.sort(function (a, b) { return b.date - a.date; });

    var emptyMsg = upcomingEl.querySelector('.no-upcoming');
    if (emptyMsg) emptyMsg.parentNode.removeChild(emptyMsg);

    dated.forEach(function (x) { upcomingEl.appendChild(x.card); });
    undated.forEach(function (card) { upcomingEl.appendChild(card); });
    past.forEach(function (x) { pastEl.appendChild(x.card); });

    if (!upcomingEl.querySelector('.event')) {
      var p = document.createElement('p');
      p.className = 'no-upcoming';
      p.textContent = 'No upcoming events at the moment. Please check back soon.';
      upcomingEl.appendChild(p);
    }
  }

  function togglePastEvents() {
    document.getElementById('past-events').classList.toggle('hidden');
  }

  document.addEventListener('DOMContentLoaded', function () {
    sortEvents();

    var btn = document.getElementById('toggle-past-btn');
    if (btn) btn.addEventListener('click', togglePastEvents);
  });
})();
