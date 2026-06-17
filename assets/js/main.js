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
    admissionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = admissionForm.querySelector('button[type="submit"]');
      const origText = submitBtn.innerHTML;
      
      try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Directing Enrolment Registry...';

        const studentName = document.getElementById('studentName').value.trim();
        const studentDob = document.getElementById('studentDob').value;
        const studentGender = document.getElementById('studentGender').value;
        const gradeApplying = document.getElementById('gradeApplying').value;
        const parentName = document.getElementById('parentName').value.trim();
        const parentPhone = document.getElementById('parentPhone').value.trim();
        const parentEmail = document.getElementById('parentEmail').value.trim();
        const homeAddress = document.getElementById('homeAddress').value.trim();
        const medicalNote = document.getElementById('medicalNote').value.trim();

        // Dynamically import database helper
        const { saveAdmission } = await import('./firebase-core.js');

        const record = {
          studentName,
          studentDob,
          studentGender,
          gradeApplying,
          parentName,
          parentPhone,
          parentEmail,
          homeAddress,
          medicalNote,
          status: 'Pending'
        };

        const result = await saveAdmission(record);

        if (result.success) {
          const alertSuccess = document.getElementById('successAlert');
          if (alertSuccess) {
            alertSuccess.style.cssText = 'display: block; background-color: #dcfce7; color: #14532d; border: 1px solid #bbf7d0; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;';
            alertSuccess.innerHTML = `
              <strong>Congratulations!</strong> Your Admission enrollment request has been logged successfully under reference <strong>HGS-${result.id.slice(-5).toUpperCase()}</strong>.<br>
              A coordinator will call <strong>${parentPhone}</strong> within 24 business hours to finalize grade assessments and schedule a campus meeting.
            `;
            admissionForm.reset();
            window.scrollTo({ top: alertSuccess.offsetTop - 120, behavior: 'smooth' });
          }
        }
      } catch (err) {
        alert("Enrolment registry encountered an error: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origText;
      }
    });
  }

  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = contactForm.querySelector('button[type="submit"]');
      const origText = submitBtn.innerHTML;
      
      try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Delivering Message...';

        const contactName = document.getElementById('contactName').value.trim();
        const contactPhone = document.getElementById('contactPhone').value.trim();
        const contactEmail = document.getElementById('contactEmail').value.trim();
        const contactSubject = document.getElementById('contactSubject').value;
        const contactMessage = document.getElementById('contactMessage').value.trim();

        const { saveContactMessage } = await import('./firebase-core.js');

        const record = {
          contactName,
          contactPhone,
          contactEmail,
          contactSubject,
          contactMessage
        };

        const result = await saveContactMessage(record);

        if (result.success) {
          const alertSuccess = document.getElementById('successAlert');
          if (alertSuccess) {
            alertSuccess.style.cssText = 'display: block; background-color: #dcfce7; color: #14532d; border: 1px solid #bbf7d0; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;';
            alertSuccess.innerHTML = `
              <strong>Thank you, ${contactName}!</strong> Your message (Subject: ${contactSubject}) has been catalogued in our desk inbox.<br>
              The administrative division will respond via <strong>${contactEmail}</strong> or telephone shortly.
            `;
            contactForm.reset();
            window.scrollTo({ top: alertSuccess.offsetTop - 120, behavior: 'smooth' });
          }
        }
      } catch (err) {
        alert("Delivering message encountered an error: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origText;
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      const origText = submitBtn.innerHTML;
      
      const role = document.getElementById('portalRole').value;
      const portalIdStr = document.getElementById('portalId').value.trim();
      const portalPassword = document.getElementById('portalPassword').value;

      if (role === 'Teacher') {
        alert("Welcome Instructor! Redirecting you to the secure Administrative Center login portal...");
        window.location.href = 'admin-login.html';
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating secure student portal...';

        const { loginStudent } = await import('./firebase-core.js');
        const res = await loginStudent(portalIdStr, portalPassword);

        if (res.success) {
          window.location.href = 'student-portal.html';
        }
      } catch (err) {
        alert("Authentication error: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origText;
      }
    });
  }
});
