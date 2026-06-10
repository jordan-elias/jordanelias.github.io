// header.js — hamburger menu + dropdown toggle
// Place in /js/header.js and add <script src="/js/header.js"></script>
// before </body> on every page (or in your Jekyll layout)

(function () {
  // Hamburger toggle
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.main-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      const isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen);
      toggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    });

    // Close mobile nav when a link is clicked
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
      });
    });
  }

  // Dropdown toggle (touch/keyboard — hover handles desktop mouse)
  const dropdowns = document.querySelectorAll('.nav-dropdown');

  dropdowns.forEach(function (dropdown) {
    const dropToggle = dropdown.querySelector('.nav-dropdown-toggle');

    // On mobile, tap the toggle to open/close
    dropToggle.addEventListener('click', function (e) {
      // Only intercept click on mobile (hamburger nav visible)
      if (window.innerWidth <= 800) {
        e.preventDefault();
        const isOpen = dropdown.classList.toggle('is-open');
        dropToggle.setAttribute('aria-expanded', isOpen);
        const menu = dropdown.querySelector('.nav-dropdown-menu');
        if (menu) {
          menu.style.display = isOpen ? 'block' : 'none';
        }
      }
    });

    // Keyboard: open on Enter/Space, close on Escape
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

  // Close dropdowns when clicking outside
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
