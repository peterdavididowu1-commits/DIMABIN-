// His Grace School - Shared Interaction Logic

document.addEventListener('DOMContentLoaded', () => {
  // Mobile Nav Toggle
  const mobileToggle = document.getElementById('mobileToggle');
  const mobileMenu = document.getElementById('mobileMenuOverlay');

  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener('click', () => {
      mobileMenu.classList.toggle('active');
      mobileToggle.classList.toggle('open');
      
      // Toggle Hamburger to simple X icon
      const spans = mobileToggle.querySelectorAll('span');
      if (mobileToggle.classList.contains('open')) {
        spans[0].style.transform = 'rotate(45deg) translate(6px, 6px)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'rotate(-45deg) translate(6px, -6px)';
      } else {
        spans[0].style.transform = 'none';
        spans[1].style.opacity = '1';
        spans[2].style.transform = 'none';
      }
    });

    // Close mobile menu on clicking any link
    const mobileLinks = mobileMenu.querySelectorAll('a');
    mobileLinks.forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('active');
        mobileToggle.classList.remove('open');
        const spans = mobileToggle.querySelectorAll('span');
        spans[0].style.transform = 'none';
        spans[1].style.opacity = '1';
        spans[2].style.transform = 'none';
      });
    });
  }

  // Active Link Highlight
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Lightbox Modal for Gallery
  const galleryItems = document.querySelectorAll('.gallery-item');
  const lightbox = document.getElementById('lightboxDialog');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxTitle = document.getElementById('lightboxTitle');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxDesc = document.getElementById('lightboxDesc');

  if (galleryItems.length > 0 && lightbox) {
    galleryItems.forEach(item => {
      item.addEventListener('click', () => {
        const titleText = item.getAttribute('data-title');
        const imgSrc = item.getAttribute('data-img');
        const descText = item.getAttribute('data-desc');

        lightboxTitle.textContent = titleText;
        lightboxImg.src = imgSrc;
        lightboxImg.alt = titleText;
        lightboxDesc.textContent = descText;

        lightbox.classList.add('active');
      });
    });

    lightboxClose.addEventListener('click', () => {
      lightbox.classList.remove('active');
    });

    // Close on overlay background click
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) {
        lightbox.classList.remove('active');
      }
    });
  }

  // Form Submissions
  const admissionForm = document.getElementById('admissionForm');
  const contactForm = document.getElementById('contactForm');
  const loginForm = document.getElementById('loginForm');

  if (admissionForm) {
    admissionForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const submitBtn = admissionForm.querySelector('button[type="submit"]');
      const origText = submitBtn.textContent;
      
      submitBtn.disabled = true;
      submitBtn.textContent = 'Processing Admission Request...';

      // Simulate network request
      setTimeout(() => {
        const alertSuccess = document.getElementById('successAlert');
        if (alertSuccess) {
          alertSuccess.style.display = 'block';
          alertSuccess.textContent = 'Congratulations! Your Admission enrollment request has been submitted successfully. Our Admin team will contact you shortly.';
          admissionForm.reset();
          window.scrollTo({ top: alertSuccess.offsetTop - 100, behavior: 'smooth' });
        }
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
      }, 1500);
    });
  }

  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const submitBtn = contactForm.querySelector('button[type="submit"]');
      const origText = submitBtn.textContent;
      
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending Message...';

      setTimeout(() => {
        const alertSuccess = document.getElementById('successAlert');
        if (alertSuccess) {
          alertSuccess.style.display = 'block';
          alertSuccess.textContent = 'Thank you! Your inquiry has been sent successfully. We will follow up via your email or phone call within 24 business hours.';
          contactForm.reset();
          window.scrollTo({ top: alertSuccess.offsetTop - 100, behavior: 'smooth' });
        }
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
      }, 1200);
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      const origText = submitBtn.textContent;
      
      submitBtn.disabled = true;
      submitBtn.textContent = 'Authenticating Secure Student Portal...';

      setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
        alert('Authentication success! In this cloud-preview environment, Student Portal is simulated with read-only dashboard access.');
      }, 1500);
    });
  }
});
