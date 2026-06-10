// header.js — hamburger menu + dropdown toggle

(function () {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.main-nav');

  if (toggle && nav) {
    // Hamburger open/close
    toggle.addEventListener('click', function () {
      const isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen);
      toggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    });

    // Close mobile nav when a non-dropdown link is clicked
    nav.querySelectorAll('a').forEach(function (link) {
      // Skip the dropdown toggle — it should open the submenu, not close the nav
      if (link.classList.contains('nav-dropdown-toggle')) return;

      link.addEventListener('click', function () {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
      });
    });
  }

  // Dropdown toggle
  const dropdowns = document.querySelectorAll('.nav-dropdown');

  dropdowns.forEach(function (dropdown) {
    const dropToggle = dropdown.querySelector('.nav-dropdown-toggle');
    const menu = dropdown.querySelector('.nav-dropdown-menu');

    // Mobile: tap to toggle
    dropToggle.addEventListener('click', function (e) {
      if (window.innerWidth <= 800) {
        e.preventDefault();
        e.stopPropagation(); // prevent triggering the outside-click handler
        const isOpen = dropdown.classList.toggle('is-open');
        dropToggle.setAttribute('aria-expanded', isOpen);
      }
    });

    // Keyboard support
    dropToggle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const isOpen = dropdown.classList.toggle('is-open');
        dropToggle.setAttribute('aria-expanded', isOpen);
      }
      if (e.key === 'Escape') {
        dropdown.classList.remove('is-open');
        dropToggle.setAttribute('aria-expanded', 'false');
        dropToggle.focus();
      }
    });
  });

  // Close dropdowns when clicking outside (desktop)
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-dropdown')) {
      dropdowns.forEach(function (dropdown) {
        dropdown.classList.remove('is-open');
        const dt = dropdown.querySelector('.nav-dropdown-toggle');
        if (dt) dt.setAttribute('aria-expanded', 'false');
      });
    }
  });
})();
