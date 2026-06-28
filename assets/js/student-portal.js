import { db, auth } from './firebase-init.js';

// Import dynamic Firebase Auth and Firestore methods
const {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, orderBy, limit
} = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
const {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");

const SESSION_KEY = "dimabin_student_session";
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes security timeout
let inactivityTimer;
let currentStudentDoc = null;
let timelineSettings = { session: "2026/2027", semester: "First Semester" };
let officialCoursesList = [];

// Initialize Toast alert helper on window if not present
window.showToast = (message, type = "success") => {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast-alert ${type}`;
  
  let icon = "fa-circle-check";
  if (type === "error") icon = "fa-circle-xmark";
  else if (type === "info") icon = "fa-circle-info";

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <div class="toast-alert-text">${message}</div>
  `;
  container.appendChild(toast);

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.style.animation = "fadeOut 0.5s ease forwards";
    setTimeout(() => {
      if (toast.parentNode === container) {
        container.removeChild(toast);
      }
    }, 500);
  }, 4000);
};

// Reset inactivity security timer
function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY)) {
    inactivityTimer = setTimeout(() => {
      handleLogout("Session expired due to inactivity. Please sign in again.");
    }, INACTIVITY_LIMIT_MS);
  }
}

// Attach security activity listeners
['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, resetInactivityTimer);
});

// Main login process
const loginForm = document.getElementById("portalLoginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const studentIdInput = document.getElementById("studentId").value.trim();
    const passwordInput = document.getElementById("password").value;
    const rememberMe = document.getElementById("rememberMe").checked;

    const feedback = document.getElementById("loginFeedback");
    const feedbackText = document.getElementById("loginFeedbackText");
    const btnSubmit = document.getElementById("btnLoginSubmit");

    if (feedback && feedbackText) {
      feedback.style.display = "flex";
      feedbackText.textContent = "Authenticating student profile...";
    }
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      // 1. Search students collection by either studentId or matricNumber
      let studentDoc = null;
      const q1 = query(collection(db, "students"), where("studentId", "==", studentIdInput));
      const snap1 = await getDocs(q1);
      
      if (!snap1.empty) {
        studentDoc = { id: snap1.docs[0].id, ...snap1.docs[0].data() };
      } else {
        const q2 = query(collection(db, "students"), where("matricNumber", "==", studentIdInput));
        const snap2 = await getDocs(q2);
        if (!snap2.empty) {
          studentDoc = { id: snap2.docs[0].id, ...snap2.docs[0].data() };
        }
      }

      if (!studentDoc) {
        throw new Error("Student profile could not be found with that ID or Matric Number.");
      }

      const email = studentDoc.email;
      if (!email || email === "N/A") {
        throw new Error("Your student profile does not have a registered email address. Please contact the registrar desk.");
      }

      // 2. Perform Firebase Auth
      let authUserCredential = null;
      try {
        authUserCredential = await signInWithEmailAndPassword(auth, email, passwordInput);
      } catch (authErr) {
        // Fallback: If user is not found in Firebase Auth yet, verify if password matches Firestore temp credential
        if (authErr.code === "auth/user-not-found" || authErr.code === "auth/invalid-credential") {
          const expectedPassword = studentDoc.loginCredentials?.password;
          if (expectedPassword && expectedPassword === passwordInput) {
            // Provision the Firebase Auth user on-the-fly!
            try {
              authUserCredential = await createUserWithEmailAndPassword(auth, email, passwordInput);
              console.log("🌟 [Auto-Provisioning] Created Firebase Auth user for admitted student:", email);
            } catch (createErr) {
              // If creation fails because user already exists, let's raise the original wrong password error
              if (createErr.code === "auth/email-already-in-use") {
                throw new Error("Invalid login password credential.");
              }
              throw createErr;
            }
          } else {
            throw new Error("Invalid ID, Matric Number, or Password.");
          }
        } else {
          throw authErr;
        }
      }

      // Success - Load Session
      const sessionData = {
        matricNumber: studentDoc.matricNumber,
        studentId: studentDoc.studentId,
        fullName: studentDoc.fullName,
        email: studentDoc.email
      };

      if (rememberMe) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
      } else {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
      }

      window.showToast("Logged in successfully!", "success");
      enterDashboard(studentDoc);

    } catch (err) {
      console.error("❌ Login failed:", err);
      if (feedbackText) {
        feedbackText.innerHTML = `<strong>Sign In Error:</strong> ${err.message}`;
      }
      if (feedback) {
        feedback.className = "form-alert error";
        feedback.style.display = "flex";
      }
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });
}

// Forgot Password Flow
const linkForgotPassword = document.getElementById("linkForgotPassword");
if (linkForgotPassword) {
  linkForgotPassword.addEventListener("click", async (e) => {
    e.preventDefault();
    const studentIdInput = document.getElementById("studentId").value.trim();
    if (!studentIdInput) {
      alert("Please enter your Student ID or Matric Number in the login form so we can find your registered email.");
      return;
    }

    try {
      window.showToast("Retrieving your student profile...", "info");
      let studentDoc = null;
      const q1 = query(collection(db, "students"), where("studentId", "==", studentIdInput));
      const snap1 = await getDocs(q1);
      
      if (!snap1.empty) {
        studentDoc = snap1.docs[0].data();
      } else {
        const q2 = query(collection(db, "students"), where("matricNumber", "==", studentIdInput));
        const snap2 = await getDocs(q2);
        if (!snap2.empty) {
          studentDoc = snap2.docs[0].data();
        }
      }

      if (!studentDoc || !studentDoc.email || studentDoc.email === "N/A") {
        throw new Error("Could not find a valid registered email address for this student ID.");
      }

      await sendPasswordResetEmail(auth, studentDoc.email);
      alert(`A secure password reset link has been dispatched to your registered email: ${studentDoc.email}. Please check your inbox and spam folders.`);
    } catch (err) {
      alert("Forgot password reset failed: " + err.message);
    }
  });
}

// Handle entering the authenticated dashboard state
function enterDashboard(studentDoc) {
  currentStudentDoc = studentDoc;
  
  // Hide anonymous login block, display authenticated main panel
  document.getElementById("anonymousView").style.display = "none";
  document.getElementById("authenticatedView").style.display = "block";

  // Populates Sidebar
  document.getElementById("studentNameDisplay").textContent = studentDoc.fullName;
  document.getElementById("studentStatusDisplay").textContent = `Status: ${studentDoc.status || "Active"}`;
  document.getElementById("studentIdDisplay").textContent = `ID: ${studentDoc.studentId}`;
  document.getElementById("matricNumberDisplay").textContent = `Matric: ${studentDoc.matricNumber}`;

  // Reset inactive timers
  resetInactivityTimer();

  // Load active modules
  loadTimelineAndTimelineConfigs();
  loadProfileTab(studentDoc);
  loadNotifications();
  loadResults();
}

// Logout workflow
function handleLogout(message = "Logged out successfully.") {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  signOut(auth).catch(() => {});
  
  document.getElementById("anonymousView").style.display = "block";
  document.getElementById("authenticatedView").style.display = "none";
  
  if (message) {
    window.showToast(message, "info");
  }
}

const btnLogout = document.getElementById("btnLogout");
if (btnLogout) {
  btnLogout.addEventListener("click", () => {
    handleLogout();
  });
}

// Side Navigation Tabs Controller
const navButtons = document.querySelectorAll(".sidebar-nav-btn");
navButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tabId = btn.getAttribute("data-tab");
    if (!tabId) return;

    // Remove active style from all sidebar buttons
    navButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    // Hide all tab contents
    const tabs = document.querySelectorAll(".tab-content");
    tabs.forEach(t => t.classList.remove("active"));

    // Show selected tab content
    const selectedTab = document.getElementById(`tab-${tabId}`);
    if (selectedTab) selectedTab.classList.add("active");
  });
});

// Shortcut dashboard cards
const cardRegCoursesBtn = document.getElementById("cardRegCoursesBtn");
if (cardRegCoursesBtn) {
  cardRegCoursesBtn.addEventListener("click", () => {
    const btn = document.querySelector('.sidebar-nav-btn[data-tab="courses"]');
    if (btn) btn.click();
  });
}
const cardResultsBtn = document.getElementById("cardResultsBtn");
if (cardResultsBtn) {
  cardResultsBtn.addEventListener("click", () => {
    const btn = document.querySelector('.sidebar-nav-btn[data-tab="results"]');
    if (btn) btn.click();
  });
}
const cardNotifBtn = document.getElementById("cardNotifBtn");
if (cardNotifBtn) {
  cardNotifBtn.addEventListener("click", () => {
    const btn = document.querySelector('.sidebar-nav-btn[data-tab="notifications"]');
    if (btn) btn.click();
  });
}

// Retrieve active timeline rollover configs
async function loadTimelineAndTimelineConfigs() {
  try {
    // 1. Fetch settings timeline configuration
    const settingsSnap = await getDoc(doc(db, "settings", "timeline_settings"));
    if (settingsSnap.exists()) {
      const data = settingsSnap.data();
      timelineSettings.session = data.session || timelineSettings.session;
      timelineSettings.semester = data.semester || timelineSettings.semester;
    }

    // 2. Fetch specific timeline parameters
    let timelineTitle = "Academic Session Calendar Status";
    let timelineDesc = "The theological academic study modules are active.";
    let regIsOpen = true;

    const timelineSnap = await getDoc(doc(db, "academicSessions", `${timelineSettings.session.replace(/\//g, "_")}_${timelineSettings.semester.replace(/\s+/g, "").toLowerCase()}`));
    
    if (timelineSnap.exists()) {
      const ts = timelineSnap.data();
      const now = new Date();
      const start = ts.registrationStart ? new Date(ts.registrationStart) : null;
      const end = ts.registrationEnd ? new Date(ts.registrationEnd) : null;

      if (start && end) {
        regIsOpen = now >= start && now <= end;
        const fmtStart = start.toLocaleDateString(undefined, {month: 'long', day: 'numeric', year: 'numeric'});
        const fmtEnd = end.toLocaleDateString(undefined, {month: 'long', day: 'numeric', year: 'numeric'});
        timelineTitle = `Registration Period: ${timelineSettings.session} - ${timelineSettings.semester}`;
        timelineDesc = `Course registrations are officially open from <strong>${fmtStart}</strong> until <strong>${fmtEnd}</strong>.`;
      }
    } else {
      timelineTitle = `Course Registration is OPEN: ${timelineSettings.session}`;
      timelineDesc = `Please select your first and second semester theological study outlines below to preserve your credit register records.`;
    }

    // Update Overview stats card
    const cardSession = document.getElementById("cardSessionName");
    if (cardSession) cardSession.textContent = `${timelineSettings.session} (${timelineSettings.semester})`;

    // Update registration panel timelines
    const elTitle = document.getElementById("courseRegStatusTitle");
    const elDesc = document.getElementById("courseRegStatusDesc");
    if (elTitle) elTitle.innerHTML = timelineTitle;
    if (elDesc) elDesc.innerHTML = timelineDesc;

    // Load Courses Catalog
    loadCoursesCatalog(regIsOpen);

  } catch (err) {
    console.error("❌ Timeline parameters load error:", err);
  }
}

// Populates profile fields
function loadProfileTab(studentDoc) {
  // Read-only
  document.getElementById("profileStudentId").textContent = studentDoc.studentId;
  document.getElementById("profileMatricNo").textContent = studentDoc.matricNumber;
  document.getElementById("profileFullName").textContent = studentDoc.fullName;
  document.getElementById("profileGender").textContent = studentDoc.gender;
  document.getElementById("profileDob").textContent = studentDoc.dateOfBirth;
  document.getElementById("profileProgramme").textContent = studentDoc.programme;
  document.getElementById("profileSession").textContent = studentDoc.academicSession || "2026/2027";
  document.getElementById("profileStatus").textContent = studentDoc.status || "Active";
  document.getElementById("profileChurchName").textContent = studentDoc.churchName || "N/A";
  document.getElementById("profilePastorName").textContent = studentDoc.pastorsName || "N/A";

  // Editable
  document.getElementById("editPhone").value = studentDoc.phone || "";
  document.getElementById("editEmail").value = studentDoc.email || "";
  document.getElementById("editAddress").value = studentDoc.address || "";

  // Overview sub-bar details
  const subDetails = document.getElementById("stuNavDetails");
  if (subDetails) {
    subDetails.textContent = `Student ID: ${studentDoc.studentId} | Matric: ${studentDoc.matricNumber} | Programme: ${studentDoc.programme} | Session: ${studentDoc.academicSession || "2026/2027"} (${studentDoc.semester || "First Semester"}) | Status: ${studentDoc.status || "Active"}`;
  }

  const welcomeMsg = document.getElementById("welcomeMessage");
  if (welcomeMsg) {
    welcomeMsg.textContent = `Welcome back, ${studentDoc.fullName}!`;
  }
}

// Update profile editable coordinates
const profileEditForm = document.getElementById("profileEditForm");
if (profileEditForm) {
  profileEditForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentStudentDoc) return;

    const phoneVal = document.getElementById("editPhone").value.trim();
    const emailVal = document.getElementById("editEmail").value.trim();
    const addressVal = document.getElementById("editAddress").value.trim();

    const btnSubmit = document.getElementById("btnUpdateProfile");
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      const docId = currentStudentDoc.matricNumber.replace(/\//g, "-");
      const ref = doc(db, "students", docId);
      
      await updateDoc(ref, {
        phone: phoneVal,
        email: emailVal,
        address: addressVal
      });

      // Update current reference state
      currentStudentDoc.phone = phoneVal;
      currentStudentDoc.email = emailVal;
      currentStudentDoc.address = addressVal;

      window.showToast("Your contact details were successfully updated!", "success");
      loadProfileTab(currentStudentDoc);

    } catch (err) {
      console.error("❌ Profile update failed:", err);
      window.showToast("Update failed: " + err.message, "error");
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });
}

// Courses Registration Catalog loading and checkoffs
async function loadCoursesCatalog(regIsOpen) {
  const firstList = document.getElementById("firstSemesterCoursesList");
  const secondList = document.getElementById("secondSemesterCoursesList");
  if (!firstList || !secondList) return;

  firstList.innerHTML = "<div class='text-center py-3' style='color:var(--text-muted);'><i class='fa-solid fa-spinner fa-spin'></i> Cataloging courses...</div>";
  secondList.innerHTML = "<div class='text-center py-3' style='color:var(--text-muted);'><i class='fa-solid fa-spinner fa-spin'></i> Cataloging courses...</div>";

  try {
    // 1. Fetch courses
    const coursesSnap = await getDocs(collection(db, "courses"));
    officialCoursesList = [];
    coursesSnap.forEach(cs => {
      officialCoursesList.push(cs.data());
    });

    // 2. Fetch student course registration slip if existing
    const regDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${timelineSettings.session.replace(/\//g, "-")}`;
    const regSnap = await getDoc(doc(db, "registrations", regDocId));
    let existingReg = null;

    if (regSnap.exists()) {
      existingReg = regSnap.data();
    }

    // Populate registration count badge
    const countBadge = document.getElementById("cardRegCoursesCount");
    const statusContainer = document.getElementById("courseRegStatusBadgeContainer");

    if (existingReg) {
      if (countBadge) countBadge.textContent = existingReg.registeredCourses.length;
      if (statusContainer) {
        statusContainer.innerHTML = `<span class="status-badge cleared"><i class="fa-solid fa-circle-check"></i> Registration Completed</span>`;
      }

      // Render Receipt Slip
      document.getElementById("courseRegFormArea").style.display = "none";
      document.getElementById("courseRegTimelineCard").style.display = "none";
      document.getElementById("courseRegReceiptArea").style.display = "block";

      renderRegistrationReceipt(existingReg);
    } else {
      if (countBadge) countBadge.textContent = "0";
      if (statusContainer) {
        if (regIsOpen) {
          statusContainer.innerHTML = `<span class="status-badge pending"><i class="fa-solid fa-clock"></i> Registration Open</span>`;
        } else {
          statusContainer.innerHTML = `<span class="status-badge" style="background-color:rgba(220,53,69,0.1); color:#dc3545;"><i class="fa-solid fa-lock"></i> Registration Closed</span>`;
        }
      }

      document.getElementById("courseRegFormArea").style.display = "block";
      document.getElementById("courseRegTimelineCard").style.display = "block";
      document.getElementById("courseRegReceiptArea").style.display = "none";

      renderRegistrationCheckboxes(regIsOpen);
    }

  } catch (err) {
    console.error("❌ Error loading courses:", err);
    firstList.innerHTML = `<div style="color:red; font-size:0.85rem;"><i class="fa-solid fa-triangle-exclamation"></i> Load failed</div>`;
    secondList.innerHTML = `<div style="color:red; font-size:0.85rem;"><i class="fa-solid fa-triangle-exclamation"></i> Load failed</div>`;
  }
}

// Generate checkboxes for registration
function renderRegistrationCheckboxes(regIsOpen) {
  const firstList = document.getElementById("firstSemesterCoursesList");
  const secondList = document.getElementById("secondSemesterCoursesList");
  
  firstList.innerHTML = "";
  secondList.innerHTML = "";

  const firstCourses = officialCoursesList.filter(c => c.semester === "First Semester");
  const secondCourses = officialCoursesList.filter(c => c.semester === "Second Semester");

  const buildRow = (course) => {
    return `
      <label style="display:flex; align-items:flex-start; gap:1rem; padding:0.85rem 1rem; background-color:var(--bg-slate); border-radius:var(--border-radius-md); border:1px solid var(--border-color); cursor:${regIsOpen ? 'pointer' : 'not-allowed'}; font-size:0.92rem; width:100%; transition:var(--transition);">
        <input type="checkbox" name="selectedCourse" value="${course.courseCode}" data-credits="${course.creditUnit}" ${regIsOpen ? "" : "disabled"} style="margin-top:0.25rem; width:18px; height:18px; cursor:inherit;">
        <div style="flex-grow:1;">
          <strong style="color:var(--primary); font-size:0.95rem;">${course.courseCode}: ${course.courseTitle}</strong>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.15rem;">Credits: ${course.creditUnit} Units</div>
        </div>
      </label>
    `;
  };

  if (firstCourses.length === 0) {
    firstList.innerHTML = "<div style='color:var(--text-muted); font-size:0.9rem;'>No curriculum courses available for first semester.</div>";
  } else {
    firstCourses.forEach(c => {
      firstList.insertAdjacentHTML("beforeend", buildRow(c));
    });
  }

  if (secondCourses.length === 0) {
    secondList.innerHTML = "<div style='color:var(--text-muted); font-size:0.9rem;'>No curriculum courses available for second semester.</div>";
  } else {
    secondCourses.forEach(c => {
      secondList.insertAdjacentHTML("beforeend", buildRow(c));
    });
  }

  // Setup Select All buttons
  const btnFirst = document.getElementById("selectAllFirst");
  const btnSecond = document.getElementById("selectAllSecond");

  if (btnFirst) {
    btnFirst.disabled = !regIsOpen;
    btnFirst.onclick = () => {
      const boxes = firstList.querySelectorAll('input[type="checkbox"]');
      const allChecked = Array.from(boxes).every(b => b.checked);
      boxes.forEach(b => b.checked = !allChecked);
    };
  }

  if (btnSecond) {
    btnSecond.disabled = !regIsOpen;
    btnSecond.onclick = () => {
      const boxes = secondList.querySelectorAll('input[type="checkbox"]');
      const allChecked = Array.from(boxes).every(b => b.checked);
      boxes.forEach(b => b.checked = !allChecked);
    };
  }

  const btnSubmit = document.getElementById("btnSubmitCourseReg");
  if (btnSubmit) {
    btnSubmit.disabled = !regIsOpen;
    if (!regIsOpen) {
      btnSubmit.style.opacity = "0.5";
      btnSubmit.style.cursor = "not-allowed";
    } else {
      btnSubmit.style.opacity = "1";
      btnSubmit.style.cursor = "pointer";
    }
  }
}

// Render registered courses receipt slip
function renderRegistrationReceipt(regData) {
  document.getElementById("receiptRegDate").textContent = `Registration Completed On: ${new Date(regData.registeredAt).toLocaleDateString(undefined, {month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'})}`;
  document.getElementById("receiptStudentName").textContent = regData.fullName;
  document.getElementById("receiptStudentId").textContent = regData.studentId;
  document.getElementById("receiptMatricNo").textContent = regData.matricNumber;
  document.getElementById("receiptProgramme").textContent = currentStudentDoc.programme;
  document.getElementById("receiptTerm").textContent = regData.academicSession;

  const tbody = document.getElementById("receiptCourseList");
  tbody.innerHTML = "";

  let totalCredits = 0;
  regData.registeredCourses.forEach(code => {
    const matched = officialCoursesList.find(c => c.courseCode === code);
    const title = matched ? matched.courseTitle : "Unknown curriculum course";
    const sem = matched ? matched.semester : "-";
    const cred = matched ? matched.creditUnit : 0;
    
    totalCredits += cred;

    const row = `
      <tr>
        <td><strong>${code}</strong></td>
        <td>${title}</td>
        <td>${sem}</td>
        <td style="text-align:right; font-weight:700;">${cred} Units</td>
      </tr>
    `;
    tbody.insertAdjacentHTML("beforeend", row);
  });

  // Append totals row
  tbody.insertAdjacentHTML("beforeend", `
    <tr style="background-color:rgba(31,59,130,0.04); font-weight:700;">
      <td colspan="3" style="text-align:right;">Total Credit Units Weighting:</td>
      <td style="text-align:right; color:var(--primary); font-size:1.05rem;">${totalCredits} Units</td>
    </tr>
  `);
}

// Handle submitting registration
const courseRegForm = document.getElementById("courseRegForm");
if (courseRegForm) {
  courseRegForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentStudentDoc) return;

    const checkboxes = courseRegForm.querySelectorAll('input[name="selectedCourse"]:checked');
    if (checkboxes.length === 0) {
      window.showToast("Please select at least one theological course for registration.", "error");
      return;
    }

    if (!confirm(`Register the selected ${checkboxes.length} theological course outline(s) for the current session? This record is final once logged.`)) return;

    const btnSubmit = document.getElementById("btnSubmitCourseReg");
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      const selectedCodes = Array.from(checkboxes).map(cb => cb.value);
      let totalUnits = 0;
      checkboxes.forEach(cb => {
        totalUnits += parseInt(cb.getAttribute("data-credits") || "0", 10);
      });

      const regDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${timelineSettings.session.replace(/\//g, "-")}`;
      
      const payload = {
        studentId: currentStudentDoc.studentId,
        matricNumber: currentStudentDoc.matricNumber,
        fullName: currentStudentDoc.fullName,
        academicSession: timelineSettings.session,
        registeredCourses: selectedCodes,
        totalCreditUnits: totalUnits,
        registeredAt: new Date().toISOString()
      };

      await setDoc(doc(db, "registrations", regDocId), payload);
      window.showToast("Your Course Registration was successfully completed!", "success");

      // Reload courses
      loadCoursesCatalog(true);

    } catch (err) {
      console.error("❌ Registration submission failed:", err);
      window.showToast("Submit failed: " + err.message, "error");
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });
}

// Print Course Slip helper
const btnPrintRegSlip = document.getElementById("btnPrintRegSlip");
if (btnPrintRegSlip) {
  btnPrintRegSlip.addEventListener("click", () => {
    window.print();
  });
}

// Fetch and render student cumulative results report
async function loadResults() {
  const tbody = document.getElementById("resultsTableBody");
  const emptyMsg = document.getElementById("resultsEmptyMessage");
  const summaryRow = document.getElementById("resultsSummaryRow");

  if (!tbody) return;

  tbody.innerHTML = "<tr><td colspan='6' class='text-center py-4' style='color:var(--text-muted);'><i class='fa-solid fa-spinner fa-spin'></i> Compiling results rosters...</td></tr>";

  try {
    // 1. Fetch courses to map titles
    if (officialCoursesList.length === 0) {
      const coursesSnap = await getDocs(collection(db, "courses"));
      coursesSnap.forEach(cs => {
        officialCoursesList.push(cs.data());
      });
    }

    // 2. Fetch specific student results
    const qResults = query(collection(db, "results"), where("studentId", "==", currentStudentDoc.studentId));
    const snapResults = await getDocs(qResults);
    
    const countBadge = document.getElementById("cardResultsCount");

    if (snapResults.empty) {
      tbody.innerHTML = "";
      if (emptyMsg) emptyMsg.style.display = "block";
      if (summaryRow) summaryRow.style.display = "none";
      if (countBadge) countBadge.textContent = "0";
      return;
    }

    if (emptyMsg) emptyMsg.style.display = "none";
    if (summaryRow) summaryRow.style.display = "grid";
    if (countBadge) countBadge.textContent = snapResults.size;

    tbody.innerHTML = "";
    let passed = 0;
    let attempted = 0;
    let qualityPointsTotal = 0;
    let totalCredits = 0;

    snapResults.forEach(docSnap => {
      const r = docSnap.data();
      const code = r.courseCode;
      const matched = officialCoursesList.find(c => c.courseCode === code);
      const title = matched ? matched.courseTitle : "Theology Course Record";
      const credits = matched ? matched.creditUnit : 3;

      attempted++;
      if (r.grade !== "F") passed++;

      // Compute GPA weightings (A=4, B=3, C=2, D=1, F=0)
      let gpaPoint = 0;
      switch (r.grade) {
        case "A": gpaPoint = 4; break;
        case "B": gpaPoint = 3; break;
        case "C": gpaPoint = 2; break;
        case "D": gpaPoint = 1; break;
        default: gpaPoint = 0; break;
      }

      qualityPointsTotal += (gpaPoint * credits);
      totalCredits += credits;

      const row = `
        <tr>
          <td><strong>${code}</strong></td>
          <td>${title}</td>
          <td>${r.semester || "First Semester"}</td>
          <td>${r.academicSession || "2026/2027"}</td>
          <td style="text-align:right; font-weight:700; color:var(--primary);">${r.score}</td>
          <td style="text-align:center;">
            <span class="status-badge ${r.grade === 'F' ? '' : 'cleared'}" style="padding:0.3rem 0.8rem; font-weight:800;">${r.grade}</span>
          </td>
        </tr>
      `;
      tbody.insertAdjacentHTML("beforeend", row);
    });

    const calculatedGPA = totalCredits > 0 ? (qualityPointsTotal / totalCredits).toFixed(2) : "0.00";

    // Update cumulative summary elements
    document.getElementById("resultsGPA").textContent = calculatedGPA;
    document.getElementById("resultsPassed").textContent = passed;
    document.getElementById("resultsAttempted").textContent = attempted;

    // Build print values
    const printBio = document.getElementById("printResultsBio");
    if (printBio) {
      printBio.innerHTML = `
        <div><strong>Student Name:</strong> ${currentStudentDoc.fullName}</div>
        <div><strong>Student ID:</strong> ${currentStudentDoc.studentId}</div>
        <div><strong>Matric Number:</strong> ${currentStudentDoc.matricNumber}</div>
        <div><strong>GPA Average:</strong> ${calculatedGPA} (${passed}/${attempted} Courses Passed)</div>
        <div><strong>Programme:</strong> ${currentStudentDoc.programme}</div>
        <div><strong>Academic Standing:</strong> ${currentStudentDoc.status || "Active"}</div>
      `;
    }

  } catch (err) {
    console.error("❌ Results load failed:", err);
    tbody.innerHTML = "<tr><td colspan='6' class='text-center py-3' style='color:red;'><i class='fa-solid fa-triangle-exclamation'></i> Failed to load cumulative results.</td></tr>";
  }
}

const btnPrintTranscript = document.getElementById("btnPrintTranscript");
if (btnPrintTranscript) {
  btnPrintTranscript.addEventListener("click", () => {
    window.print();
  });
}

// Fetch announcements board
async function loadNotifications() {
  const feed = document.getElementById("notificationsFeed");
  const emptyMsg = document.getElementById("notificationsEmptyMessage");
  if (!feed) return;

  feed.innerHTML = "<div class='text-center py-4' style='color:var(--text-muted);'><i class='fa-solid fa-spinner fa-spin'></i> Sourcing announcements...</div>";

  try {
    const qNotifs = query(collection(db, "notifications"), orderBy("createdAt", "desc"));
    const snapNotifs = await getDocs(qNotifs);

    const countBadge = document.getElementById("cardNotifCount");

    if (snapNotifs.empty) {
      feed.innerHTML = "";
      if (emptyMsg) emptyMsg.style.display = "block";
      if (countBadge) countBadge.textContent = "0";
      return;
    }

    if (emptyMsg) emptyMsg.style.display = "none";
    
    // Counter for dynamic unread badges or general overview
    let count = 0;
    feed.innerHTML = "";

    snapNotifs.forEach(docSnap => {
      const n = docSnap.data();
      const audience = (n.audience || n.target || "All").toLowerCase();
      
      // Filter appropriate audience target
      if (audience === "all" || audience === "students") {
        count++;
        const formattedDate = new Date(n.createdAt).toLocaleDateString(undefined, {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        // Determine badge style
        let icon = "fa-bullhorn";
        let color = "var(--primary)";
        if (n.type === "Admission") {
          icon = "fa-graduation-cap";
          color = "#28a745";
        } else if (n.type === "Exam") {
          icon = "fa-file-signature";
          color = "#dc3545";
        }

        const item = `
          <div style="background-color:var(--bg-white); border-radius:var(--border-radius-lg); border:1px solid var(--border-color); padding:2rem; box-shadow:var(--shadow-sm); display:flex; gap:1.5rem; align-items:flex-start;">
            <div style="width:48px; height:48px; border-radius:50%; background-color:rgba(31,59,130,0.06); color:${color}; display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0;">
              <i class="fa-solid ${icon}"></i>
            </div>
            <div style="flex-grow:1;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; flex-wrap:wrap; margin-bottom:0.5rem;">
                <h4 class="font-display" style="color:var(--primary); margin-bottom:0; font-size:1.1rem; font-weight:700;">${n.title}</h4>
                <span style="font-size:0.78rem; color:var(--text-muted); font-weight:600;"><i class="fa-regular fa-clock"></i> ${formattedDate}</span>
              </div>
              <p style="color:var(--text-dark); font-size:0.92rem; line-height:1.6; margin-bottom:0;">${n.message}</p>
            </div>
          </div>
        `;
        feed.insertAdjacentHTML("beforeend", item);
      }
    });

    if (countBadge) countBadge.textContent = count;
    if (count === 0) {
      if (emptyMsg) emptyMsg.style.display = "block";
    }

  } catch (err) {
    console.error("❌ Notifications failed:", err);
    feed.innerHTML = "<div class='text-center py-3' style='color:red;'><i class='fa-solid fa-triangle-exclamation'></i> Sourcing announcement feeds failed.</div>";
  }
}

// Security password changing logic
const passwordChangeForm = document.getElementById("passwordChangeForm");
if (passwordChangeForm) {
  passwordChangeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById("newPassword").value;
    const confirmNewPassword = document.getElementById("confirmNewPassword").value;

    if (newPassword !== confirmNewPassword) {
      window.showToast("Your entered passwords do not match. Please verify.", "error");
      return;
    }

    if (newPassword.length < 6) {
      window.showToast("Security guidelines require passwords to be at least 6 characters in length.", "error");
      return;
    }

    const btnSubmit = document.getElementById("btnUpdatePassword");
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error("No authenticated Firebase session was detected. Please log out and sign in again.");
      }

      // Update in Firebase Auth
      await updatePassword(user, newPassword);

      // Save updated password inside students collection credentials index
      if (currentStudentDoc) {
        const docId = currentStudentDoc.matricNumber.replace(/\//g, "-");
        const ref = doc(db, "students", docId);
        await updateDoc(ref, {
          "loginCredentials.password": newPassword
        });
        currentStudentDoc.loginCredentials.password = newPassword;
      }

      window.showToast("Your portal security password was updated successfully!", "success");
      passwordChangeForm.reset();

    } catch (err) {
      console.error("❌ Password change error:", err);
      window.showToast("Security update failed: " + err.message, "error");
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });
}

// Auto-Login Session Recovery Check on Load
window.addEventListener("DOMContentLoaded", async () => {
  let savedSession = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
  if (savedSession) {
    try {
      const parsed = JSON.parse(savedSession);
      // Fetch fresh document from Firestore to ensure integrity and updated profile values
      const ref = doc(db, "students", parsed.matricNumber.replace(/\//g, "-"));
      const docSnap = await getDoc(ref);
      
      if (docSnap.exists()) {
        const studentDoc = { id: docSnap.id, ...docSnap.data() };
        
        // Wait briefly for Firebase Auth state to sync up
        onAuthStateChanged(auth, (user) => {
          enterDashboard(studentDoc);
        });
      } else {
        handleLogout(null);
      }
    } catch (err) {
      console.warn("⚠️ Failed to recover saved portal session:", err);
      handleLogout(null);
    }
  }
});
