async function loadEvents() {
  try {
    const response = await fetch('/events/events.json');
    const data = await response.json();

    const upcomingContainer = document.getElementById('upcoming-events');
    const pastContainer = document.getElementById('past-events');
    const today = new Date();

    const upcomingEvents = [];
    const pastEvents = [];

    data.events.forEach(event => {
      const hasDateTime = event.date && event.time;
      if (hasDateTime) {
        const eventDate = new Date(event.date);
        if (eventDate >= today) {
          upcomingEvents.push({ ...event, _hasDateTime: true });
        } else {
          pastEvents.push(event);
        }
      } else {
        // Missing date or time → treat as upcoming
        upcomingEvents.push({ ...event, _hasDateTime: false });
      }
    });

    // Upcoming: dated events chronologically, then undated alphabetically
    const eventsWithDateTime = upcomingEvents
      .filter(e => e._hasDateTime)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const eventsWithoutDateTime = upcomingEvents
      .filter(e => !e._hasDateTime)
      .sort((a, b) => a.title.localeCompare(b.title));

    const sortedUpcoming = [...eventsWithDateTime, ...eventsWithoutDateTime];

    // Past: reverse chronological
    pastEvents.sort((a, b) => new Date(b.date) - new Date(a.date));

    function renderEvents(container, eventsArray) {
      container.innerHTML = '';
      eventsArray.forEach(event => {
        const eventDateText = event.date
          ? new Date(event.date).toLocaleDateString('en-GB', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })
          : 'Date TBA';
        const eventTimeText = event.time || 'TBA';

        let descriptionHTML = event.description
          .split('\n')
          .map(line => line.trim())
          .map(line => line.startsWith('- ') ? `<li>${line.slice(2)}</li>` : line)
          .join('\n');

        if (descriptionHTML.includes('<li>')) {
          descriptionHTML = `<ul>${descriptionHTML}</ul>`;
        }

        container.innerHTML += `
          <div class="event">
            <div class="event-date">${eventDateText}</div>
            <h3>${event.title}</h3>
            <p><strong>Time:</strong> ${eventTimeText}</p>
            <p><strong>Location:</strong> ${event.location || 'TBA'}</p>
            <p>${descriptionHTML}</p>
            ${event.link ? `<p><a href="${event.link}" target="_blank" rel="noopener noreferrer">Register Here</a></p>` : ''}
          </div>
        `;
      });
    }

    renderEvents(upcomingContainer, sortedUpcoming);
    renderEvents(pastContainer, pastEvents);

    if (!sortedUpcoming.length) {
      upcomingContainer.innerHTML = '<p>No upcoming events at the moment. Please check back soon.</p>';
    }

  } catch (error) {
    console.error('Error loading events:', error);
  }
}

function togglePastEvents() {
  document.getElementById('past-events').classList.toggle('hidden');
}

document.addEventListener('DOMContentLoaded', function () {
  loadEvents();

  document.getElementById('toggle-past-btn')
    .addEventListener('click', togglePastEvents);
});
