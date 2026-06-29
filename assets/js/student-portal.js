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

    // Load CBT specific data
    if (tabId === "cbt") {
      renderStudentCbtDashboard();
    }
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
      if (r.status === "Draft") return; // Skip unpublished drafts!
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

// ==========================================
// STUDENT COMPUTER-BASED TEST (CBT) PORTAL
// ==========================================

let studentCbtExamsList = [];
let activeCbtExam = null;
let activeCbtQuestions = [];
let currentQuestionIndex = 0;
let studentAnswers = {};
let flaggedQuestions = new Set();
let cbtTimerInterval = null;
let cbtSecondsLeft = 0;

// Entrance / Tab Render handler
async function renderStudentCbtDashboard() {
  const container = document.getElementById("studentCbtExamsContainer");
  if (!container) return;

  if (!currentStudentDoc) {
    container.innerHTML = `<div style="text-align: center; padding: 2.5rem; color: var(--text-muted);"><i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: var(--danger-color);"></i> Please authenticate first to view assessments.</div>`;
    return;
  }

  container.innerHTML = `
    <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
      <i class="fa-solid fa-spinner fa-spin" style="font-size: 2.5rem; color: var(--primary); margin-bottom: 1rem;"></i>
      <p style="font-weight: 600;">Mapping curriculum course coordinates and checking scheduled CBT schedules...</p>
    </div>
  `;

  try {
    // 1. Fetch student's course registration slip for the current session/semester coordinates
    const regDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${timelineSettings.session.replace(/\//g, "-")}`;
    const regSnap = await getDoc(doc(db, "registrations", regDocId));

    if (!regSnap.exists()) {
      container.innerHTML = `
        <div style="text-align: center; padding: 3.5rem; background: white; border: 1.5px solid var(--border-color); border-radius: var(--border-radius-lg); max-width: 550px; margin: 2rem auto;">
          <i class="fa-solid fa-file-signature" style="font-size: 4rem; color: var(--accent); margin-bottom: 1.5rem;"></i>
          <h3 style="font-size: 1.25rem; font-weight: 800; color: var(--primary-dark); margin-bottom: 0.5rem;">Course Registration Required</h3>
          <p style="color: var(--text-muted); font-size: 0.9rem; line-height: 1.6; margin-bottom: 1.5rem;">You have not completed your official Course Registration slip for session <strong>${timelineSettings.session}</strong>, <strong>${timelineSettings.semester}</strong> yet.</p>
          <button class="btn" onclick="const btn = document.querySelector('.sidebar-nav-btn[data-tab=\\'courses\\']'); if(btn) btn.click();" style="background-color: var(--primary); color: white;"><i class="fa-solid fa-pen-to-square"></i> Go to Course Registration</button>
        </div>
      `;
      return;
    }

    const regData = regSnap.data();
    const registeredCourses = regData.registeredCourses || [];

    if (registeredCourses.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
          <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; margin-bottom: 1rem;"></i>
          <p>No courses registered on your approved Course Slip. Please register courses first.</p>
        </div>
      `;
      return;
    }

    // 2. Query all scheduled CBT examinations matching current session, semester, and published status
    const examSnap = await getDocs(query(
      collection(db, "cbtExams"), 
      where("academicSession", "==", timelineSettings.session),
      where("semester", "==", timelineSettings.semester)
    ));

    const rawExamsList = examSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Filter down only to exams that match the student's registered courses, and are Published and currently active
    studentCbtExamsList = rawExamsList.filter(ex => {
      return registeredCourses.includes(ex.courseCode);
    });

    if (studentCbtExamsList.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 4rem 2rem; color: var(--text-muted); background: white; border-radius: var(--border-radius-lg); border: 1.5px solid var(--border-color);">
          <i class="fa-solid fa-calendar-xmark" style="font-size: 3.5rem; opacity: 0.3; display: block; margin-bottom: 1rem; color: var(--primary);"></i>
          <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--primary-dark); margin-bottom: 0.25rem;">No CBT Assessments Scheduled</h3>
          <p style="font-size: 0.88rem; max-width: 420px; margin: 0 auto; line-height: 1.5;">There are no active or scheduled Computer-Based Tests configured for your registered course coordinates in this term.</p>
        </div>
      `;
      return;
    }

    // 3. Render matching scheduled exams list
    let html = "";
    
    for (const ex of studentCbtExamsList) {
      // Check if student has already completed this assessment
      const resDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${ex.id}`;
      const resSnap = await getDoc(doc(db, "cbtResults", resDocId));
      const hasCompleted = resSnap.exists();
      let completedData = hasCompleted ? resSnap.data() : null;

      // Determine active status based on open/close date coordinates
      const now = new Date();
      const startDate = new Date(ex.startDate);
      const endDate = new Date(ex.endDate);

      const isUpcoming = now < startDate;
      const isPast = now > endDate || ex.status === "Closed";
      const isOpen = !isUpcoming && !isPast && ex.status === "Published";

      let statusBadge = "";
      let actionButtonHtml = "";

      if (hasCompleted) {
        statusBadge = `<span class="status-badge cleared" style="background-color: rgba(40,167,69,0.1); color: #28a745; font-weight: 700;"><i class="fa-solid fa-circle-check"></i> COMPLETED</span>`;
        
        let scoreDetails = "";
        if (ex.showResultImmediately) {
          scoreDetails = `<div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.5rem;">Grade Scored: <strong>${completedData.score} / ${completedData.totalQuestions} (${completedData.percentage}%) - Grade [${completedData.grade}]</strong></div>`;
        } else {
          scoreDetails = `<div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.5rem; font-style: italic;">Grade: Logged for faculty review.</div>`;
        }

        actionButtonHtml = `
          <div style="text-align: right;">
            ${statusBadge}
            ${scoreDetails}
          </div>
        `;
      } else if (isUpcoming) {
        statusBadge = `<span class="status-badge pending" style="background-color: rgba(244,176,0,0.1); color: #F4B000; font-weight: 700;"><i class="fa-solid fa-clock"></i> UPCOMING</span>`;
        actionButtonHtml = `
          <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 0.35rem;">
            ${statusBadge}
            <div style="font-size: 0.72rem; color: var(--text-muted);">Starts: ${new Date(ex.startDate).toLocaleString()}</div>
            <button class="btn" disabled style="opacity: 0.5; background-color: var(--bg-slate); color: var(--text-muted); cursor: not-allowed; border: 1px solid var(--border-color); font-size: 0.8rem; padding: 0.4rem 0.85rem;"><i class="fa-solid fa-lock"></i> Locked</button>
          </div>
        `;
      } else if (isPast) {
        statusBadge = `<span class="status-badge" style="background-color: rgba(220,53,69,0.1); color: #dc3545; font-weight: 700;"><i class="fa-solid fa-circle-xmark"></i> CLOSED</span>`;
        actionButtonHtml = `
          <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 0.35rem;">
            ${statusBadge}
            <div style="font-size: 0.72rem; color: var(--text-muted);">Ended: ${new Date(ex.endDate).toLocaleString()}</div>
            <button class="btn" disabled style="opacity: 0.5; background-color: var(--bg-slate); color: var(--text-muted); cursor: not-allowed; border: 1px solid var(--border-color); font-size: 0.8rem; padding: 0.4rem 0.85rem;">Missed</button>
          </div>
        `;
      } else if (isOpen) {
        statusBadge = `<span class="status-badge cleared" style="background-color: rgba(40,167,69,0.1); color: #28a745; font-weight: 700; animation: blink 1.5s infinite;"><i class="fa-solid fa-circle-dot"></i> OPEN & ACTIVE</span>`;
        actionButtonHtml = `
          <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 0.35rem;">
            ${statusBadge}
            <div style="font-size: 0.72rem; color: var(--text-muted);">Deadline: ${new Date(ex.endDate).toLocaleString()}</div>
            <button class="btn btn-start-cbt-exam" data-id="${ex.id}" style="background-color: var(--primary); color: white; font-weight: 700; font-size: 0.85rem; padding: 0.45rem 1rem;"><i class="fa-solid fa-play"></i> Start Assessment</button>
          </div>
        `;
      }

      html += `
        <div class="portal-card" style="padding: 1.5rem; display: flex; justify-content: space-between; align-items: center; gap: 1.5rem; border-left: 4px solid ${hasCompleted ? '#28a745' : (isOpen ? 'var(--primary)' : 'var(--border-color)')};">
          <div style="flex-grow: 1;">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem;">
              <span style="font-size: 0.75rem; font-weight: 800; color: var(--primary); background-color: var(--bg-slate); padding: 0.2rem 0.5rem; border-radius: 4px;">${ex.courseCode}</span>
              <span style="font-size: 0.72rem; color: var(--text-muted);"><i class="fa-solid fa-hourglass-half"></i> ${ex.duration} Mins</span>
              <span style="font-size: 0.72rem; color: var(--text-muted);"><i class="fa-solid fa-circle-question"></i> ${ex.numQuestions} Questions</span>
            </div>
            <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--primary-dark); margin: 0 0 0.25rem 0;">${escapeHtml(ex.title)}</h3>
            <div style="font-size: 0.75rem; color: var(--text-muted);"><i class="fa-solid fa-calendar"></i> Period: ${new Date(ex.startDate).toLocaleDateString()} - ${new Date(ex.endDate).toLocaleDateString()}</div>
          </div>
          <div style="min-width: 160px; display: flex; justify-content: flex-end;">
            ${actionButtonHtml}
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    // Bind Start Exam button triggers
    document.querySelectorAll(".btn-start-cbt-exam").forEach(btn => {
      btn.addEventListener("click", () => {
        openExamInstructionsModal(btn.getAttribute("data-id"));
      });
    });

  } catch (err) {
    console.error("Render student CBT error:", err);
    container.innerHTML = `<div style="text-align: center; padding: 2.5rem; color: var(--danger-color);"><i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem;"></i> Fetch failed: ${err.message}</div>`;
  }
}

// Open Instructions Modal prior to launching full-screen exam loop
function openExamInstructionsModal(examId) {
  const exam = studentCbtExamsList.find(e => e.id === examId);
  if (!exam) return;

  activeCbtExam = exam;

  document.getElementById("cbtModalTitle").textContent = exam.title;
  document.getElementById("cbtModalCourseCode").textContent = exam.courseCode;
  document.getElementById("cbtModalDuration").textContent = `${exam.duration} minutes`;
  document.getElementById("cbtModalQuestions").textContent = `${exam.numQuestions} Multiple-Choice Questions`;

  const modal = document.getElementById("cbtInstructionsModal");
  if (modal) modal.style.display = "flex";
}

// Bind Modal controls
document.getElementById("btnCbtCloseModal")?.addEventListener("click", () => {
  const modal = document.getElementById("cbtInstructionsModal");
  if (modal) modal.style.display = "none";
  activeCbtExam = null;
});

document.getElementById("btnCbtConfirmStart")?.addEventListener("click", async () => {
  const modal = document.getElementById("cbtInstructionsModal");
  if (modal) modal.style.display = "none";

  if (activeCbtExam) {
    await initializeActiveExam();
  }
});

// Fetch and load questions, then launch full-screen focused interface
async function initializeActiveExam() {
  const container = document.getElementById("studentCbtExamsContainer");
  if (!container || !activeCbtExam) return;

  // 0. Security Checks
  const resDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;
  const resSnap = await getDoc(doc(db, "cbtResults", resDocId));
  if (resSnap.exists()) {
    alert("⚠️ Security Violation: You have already completed this examination. Re-entry is strictly prohibited.");
    toggleCbtFocusLayout(false);
    return;
  }

  const now = new Date();
  const startDate = new Date(activeCbtExam.startDate);
  const endDate = new Date(activeCbtExam.endDate);
  if (now < startDate || now > endDate || activeCbtExam.status !== "Published") {
    alert("⚠️ Security Violation: This examination is currently inactive, closed, or unpublished.");
    toggleCbtFocusLayout(false);
    return;
  }

  // 0.1 Log Attempt Record
  const attemptDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;
  try {
    await setDoc(doc(db, "cbtAttempts", attemptDocId), {
      studentId: currentStudentDoc.studentId,
      studentName: currentStudentDoc.fullName,
      examId: activeCbtExam.id,
      courseCode: activeCbtExam.courseCode,
      startedAt: new Date().toISOString(),
      status: "started"
    }, { merge: true });
  } catch (err) {
    console.error("Failed to log start attempt:", err);
  }

  window.showToast("Cataloging test questions from cloud bank...", "info");

  try {
    // 1. Fetch questions matching current exam criteria
    const qSnap = await getDocs(query(
      collection(db, "cbtQuestions"),
      where("courseCode", "==", activeCbtExam.courseCode),
      where("academicSession", "==", activeCbtExam.academicSession),
      where("semester", "==", activeCbtExam.semester)
    ));

    const rawQuestions = qSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (rawQuestions.length < activeCbtExam.numQuestions) {
      alert(`⚠️ Course Syllabus Question Deficit!\n\nThe examination demands ${activeCbtExam.numQuestions} questions, but only ${rawQuestions.length} questions exist in the course question bank.\n\nPlease contact your course lecturer or coordinator.`);
      return;
    }

    // 2. Select and configure active questions subset
    let chosenQuestions = [...rawQuestions];
    if (activeCbtExam.randomizeQuestions) {
      shuffleCbtArray(chosenQuestions);
    }
    activeCbtQuestions = chosenQuestions.slice(0, activeCbtExam.numQuestions);

    // 3. Setup temporary local/cloud answer cache if exists to support reconnect/resume
    studentAnswers = {};
    flaggedQuestions.clear();
    
    const answerDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;
    const ansSnap = await getDoc(doc(db, "cbtAnswers", answerDocId));
    if (ansSnap.exists()) {
      studentAnswers = ansSnap.data().answers || {};
      window.showToast("Resumed from cloud-saved progression.", "success");
    } else {
      const localCache = localStorage.getItem(`cbt_temp_answers_${activeCbtExam.id}`);
      if (localCache) {
        try {
          studentAnswers = JSON.parse(localCache);
        } catch (e) {
          studentAnswers = {};
        }
      }
    }

    currentQuestionIndex = 0;

    // 4. Set headers
    document.getElementById("activeExamCourseBadge").textContent = activeCbtExam.courseCode;
    document.getElementById("activeExamTitle").textContent = activeCbtExam.title;

    // 5. Setup Exam Countdown Timer
    cbtSecondsLeft = activeCbtExam.duration * 60;
    startCbtTimer();

    // 6. Enter Focus-Oriented full-screen layout (Hiding headers and side navigation)
    toggleCbtFocusLayout(true);

    // 7. Render initial question index and matrix grid
    renderCbtQuestionAndChoices();
    renderCbtMatrixGrid();

  } catch (err) {
    console.error("Initialize exam error:", err);
    window.showToast("Failed to compile examination data: " + err.message, "error");
  }
}

// Handles fullscreen layout switching to maximize focus
function toggleCbtFocusLayout(isFocusOn) {
  const sidebar = document.querySelector(".portal-sidebar");
  const header = document.querySelector(".portal-header");
  const cbtDashboard = document.getElementById("cbtDashboardView");
  const cbtActiveScreen = document.getElementById("cbtActiveExamScreen");

  if (isFocusOn) {
    if (sidebar) sidebar.style.display = "none";
    if (header) header.style.display = "none";
    if (cbtDashboard) cbtDashboard.style.display = "none";
    if (cbtActiveScreen) cbtActiveScreen.style.display = "block";
    
    // Set layout margin padding to fit screen
    const mainArea = document.querySelector(".portal-main");
    if (mainArea) {
      mainArea.style.marginLeft = "0";
      mainArea.style.padding = "1rem";
    }
  } else {
    if (sidebar) sidebar.style.display = "block";
    if (header) header.style.display = "flex";
    if (cbtDashboard) cbtDashboard.style.display = "block";
    if (cbtActiveScreen) cbtActiveScreen.style.display = "none";

    const mainArea = document.querySelector(".portal-main");
    if (mainArea) {
      mainArea.style.marginLeft = ""; // reset to CSS stylesheet default
      mainArea.style.padding = "";
    }
  }
}

// Timer management
function startCbtTimer() {
  if (cbtTimerInterval) clearInterval(cbtTimerInterval);
  updateCbtTimerDisplay();

  cbtTimerInterval = setInterval(() => {
    cbtSecondsLeft--;
    updateCbtTimerDisplay();

    // Warning at 5 minutes
    if (cbtSecondsLeft === 300) {
      alert("⚠️ Warning: Only 5 minutes remaining on your timer!");
    }

    if (cbtSecondsLeft <= 0) {
      clearInterval(cbtTimerInterval);
      alert("⏱️ Time is up! Your responses are being submitted automatically.");
      submitExamination(true);
    }
  }, 1000);
}

function updateCbtTimerDisplay() {
  const timerBox = document.getElementById("cbtExamTimer");
  if (!timerBox) return;

  const h = Math.floor(cbtSecondsLeft / 3600);
  const m = Math.floor((cbtSecondsLeft % 3600) / 60);
  const s = cbtSecondsLeft % 60;

  const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  timerBox.textContent = formatted;

  // Add red alert formatting if less than 2 minutes left
  if (cbtSecondsLeft < 120) {
    timerBox.style.color = "#DC3545";
    timerBox.style.animation = "blink 1s infinite";
  } else {
    timerBox.style.color = "var(--accent)";
    timerBox.style.animation = "none";
  }
}

// Render active question and options
function renderCbtQuestionAndChoices() {
  if (activeCbtQuestions.length === 0) return;

  const q = activeCbtQuestions[currentQuestionIndex];
  
  // Update index tracking headers
  document.getElementById("activeQuestionIndexText").textContent = `Question ${currentQuestionIndex + 1} of ${activeCbtQuestions.length}`;
  document.getElementById("activeQuestionMarksText").textContent = `${q.marks || 1} Marks`;
  document.getElementById("activeQuestionText").textContent = q.question;

  const container = document.getElementById("cbtOptionsContainer");
  if (!container) return;

  const currentSelection = studentAnswers[q.id] || "";
  const qType = q.qType || "MCQ";

  if (qType === "SA") {
    container.innerHTML = `
      <div style="width: 100%; padding: 0.5rem 0;">
        <label style="font-size: 0.75rem; font-weight: 700; color: var(--primary); text-transform: uppercase; display: block; margin-bottom: 0.5rem;">Your Answer Text (Exact string comparison):</label>
        <input type="text" id="cbt_sa_input" class="form-control" placeholder="Type your answer here..." value="${escapeHtml(currentSelection)}" style="width: 100%; padding: 1rem; font-family: 'Poppins'; font-size: 1rem; border-radius: 6px; border: 1.5px solid var(--border-color);">
      </div>
    `;

    const saInput = document.getElementById("cbt_sa_input");
    saInput.addEventListener("input", (e) => {
      studentAnswers[q.id] = e.target.value;
      syncStudentAnswers();
    });

  } else if (qType === "Essay") {
    container.innerHTML = `
      <div style="width: 100%; padding: 0.5rem 0;">
        <label style="font-size: 0.75rem; font-weight: 700; color: var(--primary); text-transform: uppercase; display: block; margin-bottom: 0.5rem;">Your Essay Response:</label>
        <textarea id="cbt_essay_input" class="form-control" rows="8" placeholder="Type your full structured answer text here..." style="width: 100%; padding: 1rem; font-family: 'Poppins'; font-size: 0.95rem; border-radius: 6px; border: 1.5px solid var(--border-color); resize: vertical;">${escapeHtml(currentSelection)}</textarea>
      </div>
    `;

    const essayInput = document.getElementById("cbt_essay_input");
    essayInput.addEventListener("input", (e) => {
      studentAnswers[q.id] = e.target.value;
      syncStudentAnswers();
    });

  } else {
    let choices = [];
    if (qType === "TF") {
      choices = [
        { key: "A", text: "True" },
        { key: "B", text: "False" }
      ];
    } else {
      choices = [
        { key: "A", text: q.optionA || "" },
        { key: "B", text: q.optionB || "" },
        { key: "C", text: q.optionC || "" },
        { key: "D", text: q.optionD || "" }
      ].filter(opt => opt.text !== "");

      if (activeCbtExam.randomizeOptions) {
        shuffleCbtArray(choices);
      }
    }

    container.innerHTML = choices.map(opt => {
      const isChecked = currentSelection === opt.key;
      return `
        <label class="cbt-option-card ${isChecked ? 'active' : ''}" style="display: flex; align-items: center; gap: 1rem; padding: 1rem 1.25rem; border: 1.5px solid ${isChecked ? 'var(--primary)' : 'var(--border-color)'}; background-color: ${isChecked ? 'rgba(31,59,130,0.04)' : 'transparent'}; border-radius: var(--border-radius-md); cursor: pointer; transition: all 0.2s; margin-bottom: 0.5rem;">
          <input type="radio" name="cbt_answer" value="${opt.key}" ${isChecked ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--primary);">
          <span style="font-weight: 700; color: ${isChecked ? 'white' : 'var(--primary)'}; font-size: 1rem; background-color: ${isChecked ? 'var(--primary)' : 'var(--bg-slate)'}; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%;">${opt.key}</span>
          <span style="font-size: 0.95rem; font-weight: 500; color: var(--text-dark);">${escapeHtml(opt.text)}</span>
        </label>
      `;
    }).join("");

    const inputs = container.querySelectorAll('input[name="cbt_answer"]');
    inputs.forEach(input => {
      input.addEventListener("change", (e) => {
        studentAnswers[q.id] = e.target.value;
        syncStudentAnswers();

        container.querySelectorAll(".cbt-option-card").forEach(lbl => {
          lbl.style.border = "1.5px solid var(--border-color)";
          lbl.style.backgroundColor = "transparent";
          lbl.classList.remove("active");
          const badge = lbl.querySelector("span:nth-of-type(1)");
          badge.style.backgroundColor = "var(--bg-slate)";
          badge.style.color = "var(--primary)";
        });

        const selectedLabel = e.target.closest(".cbt-option-card");
        if (selectedLabel) {
          selectedLabel.style.border = "1.5px solid var(--primary)";
          selectedLabel.style.backgroundColor = "rgba(31,59,130,0.04)";
          selectedLabel.classList.add("active");
          const badge = selectedLabel.querySelector("span:nth-of-type(1)");
          badge.style.backgroundColor = "var(--primary)";
          badge.style.color = "white";
        }
      });
    });
  }

  // Enable/Disable prev/next button keys based on boundaries
  document.getElementById("btnCbtPrev").disabled = currentQuestionIndex === 0;
  document.getElementById("btnCbtPrev").style.opacity = currentQuestionIndex === 0 ? "0.4" : "1";
  
  const isLast = currentQuestionIndex === activeCbtQuestions.length - 1;
  document.getElementById("btnCbtNext").innerHTML = isLast ? `Finish <i class="fa-solid fa-flag-checkered"></i>` : `Next <i class="fa-solid fa-circle-arrow-right"></i>`;
}

function syncStudentAnswers() {
  localStorage.setItem(`cbt_temp_answers_${activeCbtExam.id}`, JSON.stringify(studentAnswers));

  const answerDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;
  setDoc(doc(db, "cbtAnswers", answerDocId), {
    studentId: currentStudentDoc.studentId,
    examId: activeCbtExam.id,
    answers: studentAnswers,
    lastUpdated: new Date().toISOString()
  }, { merge: true }).catch(err => {
    console.error("Failed to sync answer to cloud:", err);
  });

  renderCbtMatrixGrid();
}

// Render matrix navigation elements
function renderCbtMatrixGrid() {
  const grid = document.getElementById("cbtMatrixGrid");
  if (!grid) return;

  grid.innerHTML = activeCbtQuestions.map((q, idx) => {
    const isAnswered = !!studentAnswers[q.id];
    const isFlagged = flaggedQuestions.has(idx);
    const isCurrent = idx === currentQuestionIndex;

    let bgColor = "var(--bg-slate)";
    let textColor = "var(--text-dark)";
    let borderColor = "var(--border-color)";

    if (isAnswered) {
      bgColor = "var(--primary)";
      textColor = "white";
      borderColor = "var(--primary)";
    }
    if (isFlagged) {
      bgColor = "#F4B000";
      textColor = "var(--primary-dark)";
      borderColor = "#F4B000";
    }
    if (isCurrent) {
      borderColor = "var(--accent)";
      // Add visual border outline
    }

    return `
      <button class="btn" data-idx="${idx}" style="background-color: ${bgColor}; color: ${textColor}; border: 2.5px solid ${borderColor}; height: 38px; width: 38px; padding: 0; font-weight: 800; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.82rem; cursor: pointer; transition: all 0.15s; outline: ${isCurrent ? '3px solid var(--accent)' : 'none'};">
        ${idx + 1}
      </button>
    `;
  }).join("");

  // Bind index buttons
  grid.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      jumpToQuestion(idx);
    });
  });
}

function jumpToQuestion(idx) {
  if (idx < 0 || idx >= activeCbtQuestions.length) return;
  currentQuestionIndex = idx;
  renderCbtQuestionAndChoices();
  renderCbtMatrixGrid();
}

// Bind navigation keys
document.getElementById("btnCbtPrev")?.addEventListener("click", () => {
  if (currentQuestionIndex > 0) {
    jumpToQuestion(currentQuestionIndex - 1);
  }
});

document.getElementById("btnCbtNext")?.addEventListener("click", () => {
  if (currentQuestionIndex < activeCbtQuestions.length - 1) {
    jumpToQuestion(currentQuestionIndex + 1);
  } else {
    // Last question - trigger final submission confirmation check
    triggerFinalSubmissionRequest();
  }
});

document.getElementById("btnCbtFlag")?.addEventListener("click", () => {
  if (flaggedQuestions.has(currentQuestionIndex)) {
    flaggedQuestions.delete(currentQuestionIndex);
    window.showToast("Question unflagged.", "info");
  } else {
    flaggedQuestions.add(currentQuestionIndex);
    window.showToast("Question flagged for review.", "warning");
  }
  renderCbtMatrixGrid();
});

// Final Submit Request Triggers
document.getElementById("btnCbtSubmitExam")?.addEventListener("click", () => {
  triggerFinalSubmissionRequest();
});

function triggerFinalSubmissionRequest() {
  const total = activeCbtQuestions.length;
  const answered = Object.keys(studentAnswers).length;
  const unanswered = total - answered;

  let promptMsg = `⚠️ Submit Assessment Check\n\nYou have answered ${answered} out of ${total} questions.\n`;
  if (unanswered > 0) {
    promptMsg += `🚨 Notice: You have ${unanswered} UNANSWERED questions.\n`;
  }
  promptMsg += `\nAre you sure you want to finalize this exam submission? This action is absolute, and no re-takes are permitted.`;

  if (confirm(promptMsg)) {
    submitExamination(false);
  }
}

// Compile responses, calculate grade score, and commit to Firestore
async function submitExamination(isAutoTimeUp = false) {
  if (cbtTimerInterval) clearInterval(cbtTimerInterval);
  
  toggleCbtFocusLayout(false); // Restore sidebar layout

  const activeScreen = document.getElementById("cbtActiveExamScreen");
  if (activeScreen) activeScreen.style.display = "none";

  const resultPanel = document.getElementById("cbtResultReportPanel");
  if (resultPanel) {
    resultPanel.style.display = "block";
    resultPanel.innerHTML = `
      <div class="portal-card" style="padding: 3rem; text-align: center;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 3rem; color: var(--primary); margin-bottom: 1.5rem;"></i>
        <h2>Committing Grade Report...</h2>
        <p style="color: var(--text-muted);">Please do not refresh. Your assessment scores are being synchronized securely in the central academic database.</p>
      </div>
    `;
  }

  // Calculate grading details
  let score = 0;
  let totalPossibleMarks = 0;

  activeCbtQuestions.forEach(q => {
    const qMarks = q.marks || 1;
    totalPossibleMarks += qMarks;
    const selected = studentAnswers[q.id];
    if (selected) {
      if (q.qType === "SA") {
        const correctNorm = String(q.correctAnswer).trim().toLowerCase();
        const studentNorm = String(selected).trim().toLowerCase();
        if (correctNorm === studentNorm) {
          score += qMarks;
        }
      } else if (q.qType === "Essay") {
        // Essay is graded manually, default 0 score points
      } else {
        if (selected === q.correctAnswer) {
          score += qMarks;
        } else if (activeCbtExam.negativeMarking) {
          score -= 0.25;
        }
      }
    }
  });

  if (score < 0) score = 0;
  // Round score to 2 decimal places in case of fractional negative marking
  score = Math.round(score * 100) / 100;

  const percentage = totalPossibleMarks > 0 ? Math.round((score / totalPossibleMarks) * 100) : 0;
  
  // Grade classification mapping
  let grade = "F";
  if (percentage >= 70) grade = "A";
  else if (percentage >= 60) grade = "B";
  else if (percentage >= 50) grade = "C";
  else if (percentage >= 45) grade = "D";

  const passed = percentage >= 45;

  const resultDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;

  try {
    const resultRef = doc(db, "cbtResults", resultDocId);
    await setDoc(resultRef, {
      examId: activeCbtExam.id,
      courseCode: activeCbtExam.courseCode,
      title: activeCbtExam.title,
      studentId: currentStudentDoc.studentId,
      studentName: currentStudentDoc.fullName,
      studentMatric: currentStudentDoc.matricNumber,
      score: score,
      totalPossibleMarks: totalPossibleMarks,
      totalQuestions: activeCbtQuestions.length,
      percentage: percentage,
      grade: grade,
      passed: passed,
      submittedAt: new Date().toISOString()
    });

    // Update Attempt Record status
    const attemptDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;
    await setDoc(doc(db, "cbtAttempts", attemptDocId), {
      status: "submitted",
      submittedAt: new Date().toISOString()
    }, { merge: true });

    // Clean up cache
    localStorage.removeItem(`cbt_temp_answers_${activeCbtExam.id}`);

    // Render results panel
    if (resultPanel) {
      const sealBgColor = passed ? 'rgba(40,167,69,0.1)' : 'rgba(220,53,69,0.1)';
      const sealIconColor = passed ? '#28a745' : '#dc3545';
      const statusBadgeBg = passed ? '#28A745' : '#DC3545';
      const statusText = passed ? 'EXCELLENT (PASS)' : 'FAIL';
      const showScore = activeCbtExam.showResultImmediately;

      resultPanel.innerHTML = `
        <div class="portal-card" style="padding: 3rem; border-top: 6px solid ${passed ? '#28A745' : '#DC3545'}; position: relative; overflow: hidden;">
          <!-- Graphic feedback seal -->
          <div style="position: absolute; top: -15px; right: -15px; width: 100px; height: 100px; background-color: ${sealBgColor}; border-radius: 50%; display: flex; align-items: center; justify-content: center; transform: rotate(15deg);">
            <i class="fa-solid ${passed ? 'fa-award' : 'fa-circle-xmark'}" style="font-size: 3rem; color: ${sealIconColor}; opacity: 0.25;"></i>
          </div>

          <i class="fa-solid ${passed ? 'fa-circle-check' : 'fa-circle-exclamation'}" style="font-size: 4rem; color: ${passed ? '#28A745' : '#DC3545'}; margin-bottom: 1.5rem;"></i>
          <h2 style="font-size: 1.75rem; font-weight: 800; color: var(--primary-dark); margin-bottom: 0.25rem;">${isAutoTimeUp ? 'Assessment Terminated!' : 'Assessment Logged Successfully!'}</h2>
          <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 2rem;">Your responses have been successfully committed to the DIMABIN Central Registry.</p>

          ${showScore ? `
          <!-- Scoring Card -->
          <div style="background-color: var(--bg-slate); border: 1.5px solid var(--border-color); padding: 2rem; border-radius: var(--border-radius-lg); margin-bottom: 2.5rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; align-items: center;">
            <div style="border-right: 1px solid var(--border-color); padding-right: 1rem;">
              <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Your Grade Score</span>
              <div style="font-size: 2.5rem; font-weight: 900; color: var(--primary); margin: 0.25rem 0;">${score} / ${totalPossibleMarks}</div>
              <span style="font-size: 0.95rem; font-weight: 800; color: var(--accent);">${percentage}% Correct</span>
            </div>
            <div>
              <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Performance Class</span>
              <div style="font-size: 2.5rem; font-weight: 900; color: var(--accent); margin: 0.25rem 0;">${grade}</div>
              <span style="display: inline-block; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 800; font-size: 0.75rem; background-color: ${statusBadgeBg}; color: white;">${statusText}</span>
            </div>
          </div>
          ` : `
          <div style="background-color: var(--bg-slate); border: 1.5px solid var(--border-color); padding: 2rem; border-radius: var(--border-radius-lg); margin-bottom: 2.5rem; text-align: center; color: var(--text-dark); font-weight: 700;">
            <i class="fa-solid fa-lock" style="font-size: 1.5rem; color: var(--accent); margin-bottom: 0.5rem; display: block;"></i>
            Score Released Post-Moderation: Your answers have been safely received. Grades will be accessible once finalized by the Department.
          </div>
          `}

          <div style="display: flex; flex-direction: column; gap: 0.75rem; text-align: left; background-color: #fcf8e3; border: 1px solid #fbeed5; padding: 1rem; border-radius: var(--border-radius-md); font-size: 0.8rem; color: #c09853; line-height: 1.5; margin-bottom: 2rem;">
            <div><i class="fa-solid fa-info-circle"></i> <strong>Note:</strong> Under active academic policy rules, this immediate assessment score is subject to final lecturer audit and general moderation parameters before appearing on official registration transcripts.</div>
          </div>

          <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
            <button class="btn" id="btnCbtResultPrint" style="background-color: #28A745; color: white; min-width: 180px;"><i class="fa-solid fa-print"></i> Print Result Slip</button>
            <button class="btn" id="btnCbtResultExit" style="background-color: var(--primary); color: white; min-width: 180px;"><i class="fa-solid fa-house-user"></i> Exit to Dashboard</button>
          </div>
        </div>
      `;

      // Bind Exit button
      document.getElementById("btnCbtResultExit")?.addEventListener("click", () => {
        resultPanel.style.display = "none";
        renderStudentCbtDashboard();
      });

      // Bind Print button
      document.getElementById("btnCbtResultPrint")?.addEventListener("click", () => {
        const printWindow = window.open('', '_blank');
        const remark = passed ? "PASS" : "FAIL";
        printWindow.document.write(`
          <html>
            <head>
              <title>CBT Result Slip - ${activeCbtExam.courseCode}</title>
              <style>
                body { font-family: 'Poppins', sans-serif; padding: 30px; text-align: center; color: #333; }
                .slip-container { border: 2px solid #1F3B82; padding: 40px; border-radius: 8px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .logo { font-size: 24px; font-weight: 800; color: #1F3B82; text-transform: uppercase; margin-bottom: 5px; }
                .subtitle { font-size: 14px; color: #666; margin-bottom: 30px; }
                .header { border-bottom: 1px solid #ddd; padding-bottom: 15px; margin-bottom: 20px; text-align: left; }
                .row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 15px; }
                .label { font-weight: 600; color: #555; }
                .val { font-weight: 700; color: #111; }
                .score-box { background-color: #F5F7FA; border: 1.5px solid #1F3B82; padding: 20px; border-radius: 6px; margin: 30px 0; display: flex; justify-content: space-around; align-items: center; }
                .score-item { text-align: center; }
                .score-val { font-size: 28px; font-weight: 900; color: #1F3B82; }
                .score-lbl { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #666; margin-top: 5px; }
                .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 800; color: white; }
                .badge-pass { background-color: #28A745; }
                .badge-fail { background-color: #DC3545; }
                .footer { font-size: 12px; color: #888; margin-top: 40px; font-style: italic; }
              </style>
            </head>
            <body>
              <div class="slip-container">
                <div class="logo">DIMABIN CBT ENGINE</div>
                <div class="subtitle">Official Computer-Based Test Result Slip</div>
                
                <div class="header">
                  <div class="row"><span class="label">Candidate Name:</span><span class="val">${currentStudentDoc.fullName}</span></div>
                  <div class="row"><span class="label">Matric Number:</span><span class="val">${currentStudentDoc.matricNumber}</span></div>
                  <div class="row"><span class="label">Course Code:</span><span class="val">${activeCbtExam.courseCode}</span></div>
                  <div class="row"><span class="label">Examination:</span><span class="val">${activeCbtExam.title}</span></div>
                  <div class="row"><span class="label">Session / Semester:</span><span class="val">${activeCbtExam.academicSession} / ${activeCbtExam.semester}</span></div>
                  <div class="row"><span class="label">Date Submitted:</span><span class="val">${new Date().toLocaleString()}</span></div>
                </div>

                ${showScore ? `
                <div class="score-box">
                  <div class="score-item">
                    <div class="score-val">${score} / ${totalPossibleMarks}</div>
                    <div class="score-lbl">Total Score</div>
                  </div>
                  <div class="score-item">
                    <div class="score-val">${percentage}%</div>
                    <div class="score-lbl">Percentage</div>
                  </div>
                  <div class="score-item">
                    <div class="score-val">${grade}</div>
                    <div class="score-lbl">Grade</div>
                  </div>
                  <div class="score-item">
                    <span class="badge ${passed ? 'badge-pass' : 'badge-fail'}">${remark}</span>
                    <div class="score-lbl">Standing</div>
                  </div>
                </div>
                ` : `
                <div style="background-color: #F5F7FA; border: 1.5px dashed #F4B000; padding: 25px; border-radius: 6px; margin: 30px 0; font-weight: 700;">
                  <div style="font-size: 16px; color: #1F3B82; margin-bottom: 5px;">Result Pending Departmental Release</div>
                  <div style="font-size: 12px; color: #666; font-weight: normal;">Your exam coordinates have been securely saved. Scores are hidden until published by your lecturer.</div>
                </div>
                `}

                <div class="footer">
                  This slip was generated automatically from the DIMABIN Central Academic Registry. Verification Key: ${resultDocId}
                </div>
              </div>
              <script>
                window.onload = function() { window.print(); }
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();
      });
    }

    window.showToast("CBT score reported and finalized.", "success");

  } catch (err) {
    console.error("Firestore result commit failed:", err);
    alert(`⚠️ Critical Error!\n\nYour score is calculated: ${score}/${totalPossibleMarks} (${percentage}%), but we failed to synchronize it with the cloud database: ${err.message}.\n\nPlease do NOT close this window. Take a screenshot of this page immediately and submit it to your coordinator.`);
  }
}

// Custom simple shuffle utility
function shuffleCbtArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function escapeHtml(text) {
  if (!text) return "";
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Export hook dynamically
window.renderStudentCbtDashboard = renderStudentCbtDashboard;

