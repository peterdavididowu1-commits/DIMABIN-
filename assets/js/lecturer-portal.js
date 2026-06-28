// DIMABIN Management System - Lecturer Portal Logic
// Built strictly to official specifications using modern Firebase Modular SDK.

import { db, auth } from './firebase-init.js';
import { prepareAndLogEmail } from './emailjs-config.js';

// Import Firestore methods dynamically
const {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, orderBy, limit
} = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

// Import Auth methods dynamically
const {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  reauthenticateWithCredential,
  EmailAuthProvider
} = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");

// Constants and Session Coordinates
const SESSION_KEY = "dimabin_lecturer_session";
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes security timeout
let inactivityTimer;
let currentLecturerDoc = null;
let timelineSettings = { session: "2026/2027", semester: "First Semester" };
let officialCoursesList = [];
let allStudentsList = [];
let assignedCoursesData = [];

// Initialize Window Toast if not present
if (!window.showToast) {
  window.showToast = (message, type = "success") => {
    const container = document.getElementById("toastContainer");
    if (!container) {
      alert(`[${type.toUpperCase()}] ${message}`);
      return;
    }
    const toast = document.createElement("div");
    toast.className = `toast-alert ${type}`;
    
    let icon = "fa-circle-check";
    if (type === "error") icon = "fa-triangle-exclamation";
    if (type === "info") icon = "fa-circle-info";
    if (type === "warning") icon = "fa-circle-exclamation";

    toast.innerHTML = `
      <i class="fa-solid ${icon}"></i>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = "slideOutRight 0.3s ease forwards";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  };
}

// Inactivity security countdown management
function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY)) {
    inactivityTimer = setTimeout(() => {
      handleLogout("Your faculty session expired due to inactivity. Please sign in again.");
    }, INACTIVITY_LIMIT_MS);
  }
}

// Attach inactivity triggers
['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, resetInactivityTimer);
});

// Load App Initial State
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // 1. Fetch Timeline coordinates
    const settingsSnap = await getDoc(doc(db, "settings", "timeline_settings"));
    if (settingsSnap.exists()) {
      const data = settingsSnap.data();
      timelineSettings.session = data.session || timelineSettings.session;
      timelineSettings.semester = data.semester || timelineSettings.semester;
    }
    
    const sessDisp = document.getElementById("currentSessionDisplay");
    const semDisp = document.getElementById("currentSemesterDisplay");
    if (sessDisp) sessDisp.textContent = timelineSettings.session;
    if (semDisp) semDisp.textContent = timelineSettings.semester;

    // 2. Fetch Catalog of all Theology courses
    const coursesSnap = await getDocs(collection(db, "courses"));
    coursesSnap.forEach(cs => {
      officialCoursesList.push({ id: cs.id, ...cs.data() });
    });

    // 3. Setup tabs listeners
    setupTabNavigation();

    // 4. Check for active session
    await checkActiveSession();

  } catch (err) {
    console.error("Initialization failed:", err);
  }
});

// Tab navigation handler
function setupTabNavigation() {
  const tabButtons = document.querySelectorAll(".sidebar-nav-btn[data-tab]");
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      switchTab(targetTab);
    });
  });
}

function switchTab(tabId) {
  // Update sidebar active buttons
  const tabButtons = document.querySelectorAll(".sidebar-nav-btn[data-tab]");
  tabButtons.forEach(btn => {
    if (btn.getAttribute("data-tab") === tabId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Toggle active CSS views
  const contents = document.querySelectorAll(".tab-content");
  contents.forEach(content => {
    if (content.id === `tab-${tabId}`) {
      content.classList.add("active");
      content.style.display = "block";
    } else {
      content.classList.remove("active");
      content.style.display = "none";
    }
  });

  // Re-fetch tab specific data if required
  if (tabId === "courses") renderCoursesTab();
  if (tabId === "students") renderStudentsTab();
  if (tabId === "results") renderResultUploadTab();
  if (tabId === "notifications") renderAnnouncementsTab();
  if (tabId === "cbt-management") renderCbtManagementTab();
  if (tabId === "attendance") renderAttendanceTab();
  if (tabId === "learning-materials") renderLearningMaterialsTab();
  if (tabId === "timetable") renderTimetableTab();
  if (tabId === "performance-analytics") renderPerformanceAnalyticsTab();
}

// Session Validator
async function checkActiveSession() {
  const sessionDataStr = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (sessionDataStr) {
    try {
      const sessionData = JSON.parse(sessionDataStr);
      // Fetch fresh record from Firestore
      const q = query(collection(db, "lecturers"), where("lecturerId", "==", sessionData.lecturerId));
      const snap = await getDocs(q);
      
      if (!snap.empty) {
        currentLecturerDoc = { id: snap.docs[0].id, ...snap.docs[0].data() };
        enterDashboard();
      } else {
        handleLogout("Session invalid. Lecturer record not found.");
      }
    } catch (e) {
      console.error("Session parse failed:", e);
      handleLogout();
    }
  } else {
    // Show clean login panel
    document.getElementById("anonymousView").style.display = "block";
    document.getElementById("authenticatedView").style.display = "none";
    const feedback = document.getElementById("loginFeedback");
    if (feedback) feedback.style.display = "none";
  }
}

// Handle Login Submission
const loginForm = document.getElementById("lecturerLoginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const staffIdInput = document.getElementById("staffId").value.trim();
    const passwordInput = document.getElementById("password").value;
    const rememberMe = document.getElementById("rememberMe").checked;

    const feedback = document.getElementById("loginFeedback");
    const feedbackText = document.getElementById("loginFeedbackText");
    const btnSubmit = document.getElementById("btnLoginSubmit");

    if (feedback && feedbackText) {
      feedback.style.display = "flex";
      feedbackText.textContent = "Validating staff profile coordinates...";
    }
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      // 1. Search lecturer record
      const q = query(collection(db, "lecturers"), where("lecturerId", "==", staffIdInput));
      const snap = await getDocs(q);

      if (snap.empty) {
        throw new Error("No facilitator profile discovered with that Staff ID.");
      }

      const lecDoc = { id: snap.docs[0].id, ...snap.docs[0].data() };
      const email = lecDoc.email;

      if (!email || email === "N/A" || email.trim() === "") {
        throw new Error("Facilitator record lacks an institutional email address. Contact Registrars desk.");
      }

      // 2. Authenticate with Firebase Authentication
      let authCredential = null;
      try {
        authCredential = await signInWithEmailAndPassword(auth, email, passwordInput);
      } catch (authErr) {
        // Fallback Auto-Provisioning of the Lecturer Auth user
        if (authErr.code === "auth/user-not-found" || authErr.code === "auth/invalid-credential") {
          const expectedPassword = lecDoc.password || lecDoc.loginCredentials?.password || lecDoc.tempPassword || "dimabin123";
          
          if (expectedPassword === passwordInput) {
            try {
              authCredential = await createUserWithEmailAndPassword(auth, email, passwordInput);
              console.log("🌟 [Auto-Provisioning] Created Firebase Auth account for lecturer:", email);
            } catch (createErr) {
              if (createErr.code === "auth/email-already-in-use") {
                throw new Error("Incorrect login password credential.");
              }
              throw createErr;
            }
          } else {
            throw new Error("Incorrect Staff ID or Password credentials.");
          }
        } else {
          throw authErr;
        }
      }

      // Success - Save Session
      currentLecturerDoc = lecDoc;
      const sessionData = {
        lecturerId: lecDoc.lecturerId,
        fullName: lecDoc.fullName,
        email: lecDoc.email
      };

      if (rememberMe) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
      } else {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
      }

      // Show welcome toast
      window.showToast("Logged in successfully. Welcome back, Educator!", "success");
      enterDashboard();

    } catch (err) {
      console.error("Login attempt failed:", err);
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

// Reset Password Link Request
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
if (forgotPasswordBtn) {
  forgotPasswordBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const staffIdInput = document.getElementById("staffId").value.trim();
    if (!staffIdInput) {
      window.showToast("Please enter your Staff ID in the login field first.", "warning");
      return;
    }

    try {
      window.showToast("Searching institutional roster...", "info");
      const q = query(collection(db, "lecturers"), where("lecturerId", "==", staffIdInput));
      const snap = await getDocs(q);

      if (snap.empty) {
        throw new Error("Staff ID not registered on this campus.");
      }

      const lecData = snap.docs[0].data();
      const email = lecData.email;

      if (!email || email === "N/A" || email.trim() === "") {
        throw new Error("No active email link mapped on your facilitator profile.");
      }

      await sendPasswordResetEmail(auth, email);
      window.showToast(`A secure cryptographic reset link has been dispatched to ${email}`, "success");

    } catch (err) {
      window.showToast(err.message, "error");
    }
  });
}

// Enter Dashboard Core
async function enterDashboard() {
  document.getElementById("anonymousView").style.display = "none";
  document.getElementById("authenticatedView").style.display = "block";
  resetInactivityTimer();

  // Load name and credentials on sidebar
  const lecNameDisp = document.getElementById("lecturerNameDisplay");
  const lecIdDisp = document.getElementById("lecturerIdDisplay");
  const lecDeptDisp = document.getElementById("lecturerDeptDisplay");
  
  if (lecNameDisp) lecNameDisp.textContent = currentLecturerDoc.fullName;
  if (lecIdDisp) lecIdDisp.textContent = currentLecturerDoc.lecturerId;
  if (lecDeptDisp) lecDeptDisp.textContent = currentLecturerDoc.department || "Theology";

  const welcomeMsg = document.getElementById("welcomeMessage");
  if (welcomeMsg) {
    welcomeMsg.textContent = `Welcome back, ${currentLecturerDoc.fullName}!`;
  }

  // Populate dynamic filters dropdowns
  populateFilterDropdowns();

  // Initialize general data
  await loadCoreDashboardMetrics();
  switchTab("overview");
}

// Load stats badges and metrics
async function loadCoreDashboardMetrics() {
  try {
    const assignedCodes = currentLecturerDoc.coursesAssigned || [];
    
    // 1. Assigned Courses Count
    const assignedCountElement = document.getElementById("cardAssignedCoursesCount");
    if (assignedCountElement) {
      assignedCountElement.textContent = assignedCodes.length;
    }

    // 2. Fetch all registered students for those courses
    const regSnap = await getDocs(collection(db, "registrations"));
    let enrolledCount = 0;
    allStudentsList = []; // Clean roster

    regSnap.forEach(docSnap => {
      const reg = docSnap.data();
      if (reg.academicSession === timelineSettings.session) {
        const studentCourses = reg.registeredCourses || [];
        // Check if there is intersection
        const intersecting = studentCourses.filter(c => assignedCodes.includes(c));
        if (intersecting.length > 0) {
          enrolledCount++;
          intersecting.forEach(code => {
            allStudentsList.push({
              id: reg.studentId,
              fullName: reg.fullName,
              matricNumber: reg.matricNumber,
              courseCode: code,
              programme: reg.programme || "Diploma in Theology",
              academicSession: reg.academicSession
            });
          });
        }
      }
    });

    const registeredCountElement = document.getElementById("cardRegisteredStudentsCount");
    if (registeredCountElement) {
      registeredCountElement.textContent = enrolledCount;
    }

    // 3. Uploaded results count
    const resultsSnap = await getDocs(query(collection(db, "results"), where("academicSession", "==", timelineSettings.session)));
    let uploadedCount = 0;
    resultsSnap.forEach(docSnap => {
      const r = docSnap.data();
      if (assignedCodes.includes(r.courseCode)) {
        uploadedCount++;
      }
    });

    const resultsCountElement = document.getElementById("cardUploadedResultsCount");
    if (resultsCountElement) {
      resultsCountElement.textContent = uploadedCount;
    }

    // 4. Announcements / Notifications count (Unread only)
    const readStorageKey = `read_notif_${currentLecturerDoc.lecturerId}`;
    let readNotifIds = [];
    try {
      readNotifIds = JSON.parse(localStorage.getItem(readStorageKey)) || [];
    } catch (e) {
      readNotifIds = [];
    }

    const notifSnap = await getDocs(collection(db, "notifications"));
    let unreadCount = 0;
    notifSnap.forEach(docSnap => {
      const audience = docSnap.data().audience || "all";
      if (audience === "all" || audience === "lecturers") {
        if (!readNotifIds.includes(docSnap.id)) {
          unreadCount++;
        }
      }
    });

    const notificationsCountElement = document.getElementById("cardNotificationsCount");
    if (notificationsCountElement) {
      notificationsCountElement.textContent = unreadCount;
    }

  } catch (err) {
    console.error("Failed loading dashboard metrics:", err);
  }
}

// Populate session & courses selection selectors
function populateFilterDropdowns() {
  const sessions = ["2026/2027", "2027/2028", "2025/2026"];
  const assignedCodes = currentLecturerDoc.coursesAssigned || [];

  // Course Selector for students and results tabs
  const studentCourseFilter = document.getElementById("studentsCourseFilter");
  const resultCourseSelector = document.getElementById("resultsCourseSelector");
  const studentEmailSelector = document.getElementById("noticeStudentSelector");

  if (studentCourseFilter) {
    studentCourseFilter.innerHTML = '<option value="all">All Assigned Courses</option>';
    assignedCodes.forEach(code => {
      studentCourseFilter.insertAdjacentHTML("beforeend", `<option value="${code}">${code}</option>`);
    });
  }

  if (resultCourseSelector) {
    resultCourseSelector.innerHTML = '<option value="">-- Choose Assigned Course --</option>';
    assignedCodes.forEach(code => {
      resultCourseSelector.insertAdjacentHTML("beforeend", `<option value="${code}">${code}</option>`);
    });
  }

  // Session Selector for assigned courses & students
  const coursesSessionFilter = document.getElementById("coursesSessionFilter");
  const studentsSessionFilter = document.getElementById("studentsSessionFilter");

  if (coursesSessionFilter) {
    coursesSessionFilter.innerHTML = "";
    sessions.forEach(s => {
      const isSel = s === timelineSettings.session ? "selected" : "";
      coursesSessionFilter.insertAdjacentHTML("beforeend", `<option value="${s}" ${isSel}>${s}</option>`);
    });
    // Add change triggers
    coursesSessionFilter.onchange = () => renderCoursesTab();
  }

  if (studentsSessionFilter) {
    studentsSessionFilter.innerHTML = "";
    sessions.forEach(s => {
      const isSel = s === timelineSettings.session ? "selected" : "";
      studentsSessionFilter.insertAdjacentHTML("beforeend", `<option value="${s}" ${isSel}>${s}</option>`);
    });
    // Add change triggers
    studentsSessionFilter.onchange = () => renderStudentsTab();
  }
}

// Tab 2: Profile Load & Edit
const profileForm = document.getElementById("lecturerProfileForm");
if (profileForm) {
  // Pre-populate read-only details
  switchTab("overview"); // Initialize tabs
  
  // Set values on overview profiles too
  document.getElementById("profileLecturerId").textContent = currentLecturerDoc.lecturerId || "N/A";
  document.getElementById("profileFullName").textContent = currentLecturerDoc.fullName || "N/A";
  document.getElementById("profileDepartment").textContent = currentLecturerDoc.department || "N/A";
  document.getElementById("profileQualification").textContent = currentLecturerDoc.qualification || "N/A";
  document.getElementById("profileEmploymentStatus").textContent = currentLecturerDoc.status || "Active";
  document.getElementById("profileDateJoined").textContent = currentLecturerDoc.employmentDate || "N/A";
  
  const profilePic = document.getElementById("profilePassportPhoto");
  if (profilePic) {
    profilePic.src = currentLecturerDoc.passportPhoto || "../assets/images/logo.jpg";
  }
  
  const assigned = currentLecturerDoc.coursesAssigned || [];
  document.getElementById("profileAssignedCourses").textContent = assigned.join(", ") || "None";

  // Pre-fill fields
  document.getElementById("profilePhone").value = currentLecturerDoc.phone || "";
  document.getElementById("profileEmail").value = currentLecturerDoc.email || "";

  // Handle Photo Upload
  const photoInput = document.getElementById("profilePhotoInput");
  if (photoInput) {
    // Avoid double binding by clearing existing handler if any
    photoInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 1024 * 1024) { // 1MB limit for Firestore document safety
        window.showToast("Photo must be smaller than 1MB to ensure rapid secure synchronization.", "error");
        return;
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64String = event.target.result;
        try {
          window.showToast("Uploading and securing new profile photo...", "info");
          const docRef = doc(db, "lecturers", currentLecturerDoc.id);
          await updateDoc(docRef, { passportPhoto: base64String });
          
          currentLecturerDoc.passportPhoto = base64String;
          if (profilePic) {
            profilePic.src = base64String;
          }
          window.showToast("Profile passport photo updated successfully!", "success");
        } catch (err) {
          console.error("Photo upload failed:", err);
          window.showToast("Photo upload failed: " + err.message, "error");
        }
      };
      reader.readAsDataURL(file);
    };
  }

  // Edit Submission
  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const phone = document.getElementById("profilePhone").value.trim();
    const email = document.getElementById("profileEmail").value.trim();
    const btnSave = document.getElementById("btnSaveProfile");

    if (btnSave) btnSave.disabled = true;

    try {
      const docRef = doc(db, "lecturers", currentLecturerDoc.id);
      await updateDoc(docRef, { phone, email });

      // Update active session memory
      currentLecturerDoc.phone = phone;
      currentLecturerDoc.email = email;

      window.showToast("Your contact coordinates have been updated successfully.", "success");
      enterDashboard();

    } catch (err) {
      console.error("Profile update failed:", err);
      window.showToast("Profile update failed: " + err.message, "error");
    } finally {
      if (btnSave) btnSave.disabled = false;
    }
  });
}

// Tab 3: Render Assigned Courses Tab
async function renderCoursesTab() {
  const sessionFilterVal = document.getElementById("coursesSessionFilter")?.value || timelineSettings.session;
  const assignedCodes = currentLecturerDoc.coursesAssigned || [];
  
  const tbodyFirst = document.getElementById("firstSemesterCoursesTableBody");
  const tbodySecond = document.getElementById("secondSemesterCoursesTableBody");

  tbodyFirst.innerHTML = `<tr><td colspan="4" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Retrieving first semester records...</td></tr>`;
  tbodySecond.innerHTML = `<tr><td colspan="4" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Retrieving second semester records...</td></tr>`;

  if (assignedCodes.length === 0) {
    const emptyHtml = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); font-weight: 600; padding: 2.5rem 0;"><i class="fa-solid fa-circle-info" style="color: var(--accent); margin-right: 0.5rem;"></i> No assigned courses</td></tr>`;
    tbodyFirst.innerHTML = emptyHtml;
    tbodySecond.innerHTML = emptyHtml;
    return;
  }

  try {
    // Read registrations for student counting
    const regSnap = await getDocs(collection(db, "registrations"));
    const courseStats = {};
    assignedCodes.forEach(c => { courseStats[c] = 0; });

    regSnap.forEach(docSnap => {
      const reg = docSnap.data();
      if (reg.academicSession === sessionFilterVal) {
        const studentCourses = reg.registeredCourses || [];
        studentCourses.forEach(code => {
          if (assignedCodes.includes(code)) {
            courseStats[code] = (courseStats[code] || 0) + 1;
          }
        });
      }
    });

    // Populate semester tables
    let firstCount = 0;
    let secondCount = 0;
    let htmlFirst = "";
    let htmlSecond = "";

    officialCoursesList.forEach(course => {
      if (assignedCodes.includes(course.courseCode)) {
        const studentCount = courseStats[course.courseCode] || 0;
        const row = `
          <tr class="clickable-course-row" data-course-code="${course.courseCode}" style="cursor: pointer; transition: background-color 0.2s;">
            <td><strong>${course.courseCode}</strong></td>
            <td>${course.courseTitle}</td>
            <td>${course.creditUnit || course.creditUnits || 3} Units</td>
            <td>
              <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span class="status-badge cleared" style="padding: 0.25rem 0.75rem; font-weight: 700;">
                  <i class="fa-solid fa-users"></i> ${studentCount} Registered
                </span>
                <button class="btn btn-view-course-details" data-course-code="${course.courseCode}" style="background-color: var(--primary); color: white; padding: 0.3rem 0.7rem; font-size: 0.8rem; border-radius: var(--border-radius-md); border: none; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;">
                  <i class="fa-solid fa-eye"></i> Details
                </button>
              </div>
            </td>
          </tr>
        `;

        if (course.semester === "First Semester") {
          htmlFirst += row;
          firstCount++;
        } else {
          htmlSecond += row;
          secondCount++;
        }
      }
    });

    tbodyFirst.innerHTML = firstCount > 0 ? htmlFirst : `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No First Semester courses assigned for session ${sessionFilterVal}.</td></tr>`;
    tbodySecond.innerHTML = secondCount > 0 ? htmlSecond : `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No Second Semester courses assigned for session ${sessionFilterVal}.</td></tr>`;

    // Setup detail modal triggers
    const openDetails = (courseCode) => {
      const course = officialCoursesList.find(c => c.courseCode === courseCode);
      if (!course) return;

      document.getElementById("courseDetailTitle").textContent = course.courseTitle || course.name;
      document.getElementById("courseDetailCode").textContent = course.courseCode;
      document.getElementById("courseDetailUnits").textContent = `${course.creditUnit || course.creditUnits || 3} Units`;
      document.getElementById("courseDetailSemester").textContent = course.semester || "N/A";
      document.getElementById("courseDetailDept").textContent = course.department || "N/A";
      document.getElementById("courseDetailSession").textContent = sessionFilterVal;
      document.getElementById("courseDetailStatus").innerHTML = `<span class="status-badge ${course.status === 'Active' ? 'cleared' : 'pending'}">${course.status || 'Active'}</span>`;
      document.getElementById("courseDetailDesc").textContent = course.description || "No description provided.";

      document.getElementById("courseDetailModal").style.display = "flex";
    };

    document.querySelectorAll(".clickable-course-row").forEach(row => {
      row.addEventListener("click", (e) => {
        // Prevent click if button was clicked
        if (e.target.closest(".btn-view-course-details")) return;
        const code = row.getAttribute("data-course-code");
        openDetails(code);
      });
    });

    document.querySelectorAll(".btn-view-course-details").forEach(btn => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-course-code");
        openDetails(code);
      });
    });

    // Setup close modal handlers
    const closeModal = () => {
      document.getElementById("courseDetailModal").style.display = "none";
    };

    document.getElementById("btnCloseCourseDetailModal")?.addEventListener("click", closeModal);
    document.getElementById("btnExitCourseDetailModal")?.addEventListener("click", closeModal);
    
    // Also close on background click
    document.getElementById("courseDetailModal")?.addEventListener("click", (e) => {
      if (e.target === document.getElementById("courseDetailModal")) closeModal();
    });

  } catch (err) {
    console.error("Error cataloging assigned courses:", err);
    tbodyFirst.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red;">Query error occurred.</td></tr>`;
    tbodySecond.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red;">Query error occurred.</td></tr>`;
  }
}

// Tab 4: Render Registered Students Tab
async function renderStudentsTab() {
  const sessionVal = document.getElementById("studentsSessionFilter")?.value || timelineSettings.session;
  const courseFilterVal = document.getElementById("studentsCourseFilter")?.value || "all";
  const searchVal = document.getElementById("studentsSearchInput")?.value.trim().toLowerCase() || "";

  const tbody = document.getElementById("registeredStudentsTableBody");
  tbody.innerHTML = `<tr><td colspan="6" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Filtering enrolled students...</td></tr>`;

  try {
    const assignedCodes = currentLecturerDoc.coursesAssigned || [];
    const regSnap = await getDocs(collection(db, "registrations"));
    
    let rowsHTML = "";
    let filteredCount = 0;
    const recipientDropdown = document.getElementById("noticeStudentSelector");
    const uniqueStudentsForNotice = {};

    regSnap.forEach(docSnap => {
      const reg = docSnap.data();
      if (reg.academicSession === sessionVal) {
        const studentCourses = reg.registeredCourses || [];
        // Intersection of student courses with assigned courses
        let targetCourses = studentCourses.filter(c => assignedCodes.includes(c));
        
        // Apply course filter
        if (courseFilterVal !== "all") {
          targetCourses = targetCourses.filter(c => c === courseFilterVal);
        }

        if (targetCourses.length > 0) {
          // Keep unique student for notices alert selection
          uniqueStudentsForNotice[reg.studentId] = { fullName: reg.fullName, email: reg.email || "N/A" };

          targetCourses.forEach(course => {
            // Apply text searching
            const matchesSearch = 
              reg.fullName.toLowerCase().includes(searchVal) ||
              reg.studentId.toLowerCase().includes(searchVal) ||
              reg.matricNumber.toLowerCase().includes(searchVal);

            if (searchVal === "" || matchesSearch) {
              const studentDept = reg.programme || reg.department || "Diploma in Theology";
              const registrationStatus = reg.status || "Approved";
              rowsHTML += `
                <tr class="clickable-student-row" data-student-id="${reg.studentId}" style="cursor: pointer; transition: background-color 0.2s;">
                  <td><code>${reg.studentId}</code></td>
                  <td><code style="background-color: var(--bg-slate); padding: 0.2rem 0.5rem; border-radius: 4px; color: var(--primary); font-family: 'Poppins', sans-serif;">${reg.matricNumber}</code></td>
                  <td><strong>${reg.fullName}</strong></td>
                  <td>
                    ${studentDept}
                    <span style="font-size: 0.75rem; color: var(--text-muted); display: block;"><i class="fa-solid fa-book-open"></i> Course: <strong>${course}</strong></span>
                  </td>
                  <td>${reg.academicSession}</td>
                  <td>
                    <span class="status-badge cleared" style="font-weight: 700; padding: 0.25rem 0.75rem;">
                      <i class="fa-solid fa-circle-check"></i> ${registrationStatus}
                    </span>
                  </td>
                </tr>
              `;
              filteredCount++;
            }
          });
        }
      }
    });

    tbody.innerHTML = filteredCount > 0 ? rowsHTML : `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2.5rem 0;">No enrolled students match current criteria.</td></tr>`;

    // Hook clickable rows
    document.querySelectorAll(".clickable-student-row").forEach(row => {
      row.addEventListener("click", async () => {
        const studentId = row.getAttribute("data-student-id");
        window.showToast("Retrieving student registry parameters...", "info");
        try {
          const qReg = query(collection(db, "registrations"), where("studentId", "==", studentId));
          const rSnap = await getDocs(qReg);
          let regData = {};
          if (!rSnap.empty) {
            regData = rSnap.docs[0].data();
          }

          const qStud = query(collection(db, "students"), where("studentId", "==", studentId));
          const sSnap = await getDocs(qStud);
          let studData = {};
          if (!sSnap.empty) {
            studData = sSnap.docs[0].data();
          }

          const fullName = regData.fullName || studData.fullName || "N/A";
          const matricNumber = regData.matricNumber || studData.matricNumber || "N/A";
          const department = regData.programme || studData.programme || studData.department || "Diploma in Theology";
          const session = regData.academicSession || "N/A";
          const status = regData.status || "Approved";
          const photo = studData.passportPhoto || studData.profileImage || regData.passportPhoto || "../assets/images/logo.jpg";
          const registeredCourses = regData.registeredCourses || [];

          document.getElementById("studentDetailName").textContent = fullName;
          document.getElementById("studentDetailId").textContent = studentId;
          document.getElementById("studentDetailMatric").textContent = matricNumber;
          document.getElementById("studentDetailDept").textContent = department;
          document.getElementById("studentDetailSession").textContent = session;
          document.getElementById("studentDetailStatus").innerHTML = `<span class="status-badge cleared">${status}</span>`;
          document.getElementById("studentDetailPhoto").src = photo;

          const coursesContainer = document.getElementById("studentDetailCourses");
          coursesContainer.innerHTML = "";
          if (registeredCourses.length === 0) {
            coursesContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 0.85rem;">No courses registered</span>`;
          } else {
            registeredCourses.forEach(code => {
              coursesContainer.insertAdjacentHTML("beforeend", `
                <span class="status-badge" style="background-color: var(--primary); color: white; padding: 0.3rem 0.75rem; border-radius: 4px; font-weight: 600; font-size: 0.8rem; display: flex; align-items: center; gap: 0.3rem;">
                  <i class="fa-solid fa-book"></i> ${code}
                </span>
              `);
            });
          }

          document.getElementById("studentDetailModal").style.display = "flex";
        } catch (err) {
          console.error("Error loading student profile:", err);
          window.showToast("Failed to load student profile: " + err.message, "error");
        }
      });
    });

    // Close handlers for studentDetailModal
    const closeStudentModal = () => {
      document.getElementById("studentDetailModal").style.display = "none";
    };
    
    document.getElementById("btnCloseStudentDetailModal")?.addEventListener("click", closeStudentModal);
    document.getElementById("btnExitStudentDetailModal")?.addEventListener("click", closeStudentModal);
    document.getElementById("studentDetailModal")?.addEventListener("click", (e) => {
      if (e.target === document.getElementById("studentDetailModal")) closeStudentModal();
    });

    // Populate Recipient selector under EmailJS
    if (recipientDropdown) {
      recipientDropdown.innerHTML = `<option value="">-- Choose Enrolled Student --</option>`;
      Object.keys(uniqueStudentsForNotice).forEach(id => {
        const s = uniqueStudentsForNotice[id];
        recipientDropdown.insertAdjacentHTML("beforeend", `<option value="${id}" data-email="${s.email}" data-name="${s.fullName}">${s.fullName} (${id})</option>`);
      });
    }

  } catch (err) {
    console.error("Error filtering student list:", err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: red;">Search error occurred.</td></tr>`;
  }
}

// Add real-time trigger for students searching
const searchInput = document.getElementById("studentsSearchInput");
if (searchInput) {
  searchInput.addEventListener("input", () => renderStudentsTab());
}
const courseFilter = document.getElementById("studentsCourseFilter");
if (courseFilter) {
  courseFilter.addEventListener("change", () => renderStudentsTab());
}

// Tab 5: Score Matrix & Result Upload Workspace
let activeCourseGradingList = [];
let activeExistingResultsMap = {};

async function renderResultUploadTab() {
  const selector = document.getElementById("resultsCourseSelector");
  if (!selector) return;

  // Clear sheet workspace on load
  document.getElementById("gradeSheetWorkspace").style.display = "none";
  document.getElementById("noCourseSelectedAlert").style.display = "block";
  document.getElementById("resultsStatusIndicator").style.display = "none";

  selector.onchange = async () => {
    const code = selector.value;
    if (!code) {
      document.getElementById("gradeSheetWorkspace").style.display = "none";
      document.getElementById("noCourseSelectedAlert").style.display = "block";
      document.getElementById("resultsStatusIndicator").style.display = "none";
      return;
    }

    document.getElementById("noCourseSelectedAlert").style.display = "none";
    const workspace = document.getElementById("gradeSheetWorkspace");
    const tbody = document.getElementById("gradingWorkspaceTableBody");

    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 3rem 0;"><i class="fa-solid fa-spinner fa-spin"></i> Initializing Grading Sheet Workspace...</td></tr>`;
    workspace.style.display = "block";

    try {
      // 1. Fetch existing results
      activeExistingResultsMap = {};
      const resultsQuery = query(
        collection(db, "results"),
        where("courseCode", "==", code),
        where("academicSession", "==", timelineSettings.session)
      );
      const resSnap = await getDocs(resultsQuery);
      let publishedCount = 0;
      let draftCount = 0;

      resSnap.forEach(docSnap => {
        const data = docSnap.data();
        activeExistingResultsMap[data.studentId] = { id: docSnap.id, ...data };
        if (data.status === "Published") publishedCount++;
        else draftCount++;
      });

      // Update status banner indicator
      const statusInd = document.getElementById("resultsStatusIndicator");
      if (statusInd) {
        statusInd.style.display = "inline-block";
        if (publishedCount > 0 && draftCount === 0) {
          statusInd.className = "status-badge cleared";
          statusInd.innerHTML = `<i class="fa-solid fa-circle-check"></i> Published`;
        } else if (draftCount > 0) {
          statusInd.className = "status-badge pending";
          statusInd.innerHTML = `<i class="fa-solid fa-file-pen"></i> Draft Version Active`;
        } else {
          statusInd.className = "status-badge info";
          statusInd.innerHTML = `<i class="fa-solid fa-circle-info"></i> Pending Evaluation`;
        }
      }

      // 2. Fetch enrolled students
      const regSnap = await getDocs(collection(db, "registrations"));
      activeCourseGradingList = [];
      
      regSnap.forEach(docSnap => {
        const reg = docSnap.data();
        if (reg.academicSession === timelineSettings.session) {
          const registered = reg.registeredCourses || [];
          if (registered.includes(code)) {
            activeCourseGradingList.push({
              studentId: reg.studentId,
              fullName: reg.fullName,
              matricNumber: reg.matricNumber,
              courseCode: code,
              semester: timelineSettings.semester,
              academicSession: timelineSettings.session
            });
          }
        }
      });

      if (activeCourseGradingList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 3rem 0;">No enrolled student found registered in ${code} for this session.</td></tr>`;
        return;
      }

      // Render workspace rows
      tbody.innerHTML = "";
      activeCourseGradingList.forEach(student => {
        const exist = activeExistingResultsMap[student.studentId] || {};
        const caVal = exist.caScore !== undefined ? exist.caScore : "";
        const examVal = exist.examScore !== undefined ? exist.examScore : "";
        const totalVal = exist.score !== undefined ? exist.score : "-";
        const gradeVal = exist.grade !== undefined ? exist.grade : "-";
        const statusText = exist.status || "Draft";
        const isPub = statusText === "Published";

        const row = `
          <tr data-student-id="${student.studentId}">
            <td><strong>${student.fullName}</strong></td>
            <td><code>${student.matricNumber}</code></td>
            <td>
              <input type="number" class="form-control ca-input" min="0" max="30" placeholder="CA (0-30)" value="${caVal}" style="width: 100%; text-align: center; padding: 0.4rem; background-color: var(--bg-slate); border: 1px solid var(--border-color); border-radius: 4px;" ${isPub ? 'disabled' : ''}>
            </td>
            <td>
              <input type="number" class="form-control exam-input" min="0" max="70" placeholder="Exam (0-70)" value="${examVal}" style="width: 100%; text-align: center; padding: 0.4rem; background-color: var(--bg-slate); border: 1px solid var(--border-color); border-radius: 4px;" ${isPub ? 'disabled' : ''}>
            </td>
            <td style="text-align: center; font-weight: 700; color: var(--primary);" class="row-total-score">${totalVal}</td>
            <td style="text-align: center;" class="row-grade">
              <span class="status-badge ${gradeVal === 'F' ? '' : 'cleared'}" style="padding: 0.2rem 0.6rem; font-size: 0.85rem; font-weight: 800;">${gradeVal}</span>
            </td>
            <td style="text-align: center;" class="row-result-pass-fail">-</td>
            <td style="text-align: center;">
              <span class="status-badge ${isPub ? 'cleared' : 'pending'}" style="padding: 0.2rem 0.6rem; font-size: 0.85rem; font-weight: 700;" class="row-workflow-status">
                ${statusText}
              </span>
            </td>
          </tr>
        `;
        tbody.insertAdjacentHTML("beforeend", row);
      });

      // Bind dynamic auto-calculation listeners to the input fields
      setupGradingCalculationTriggers();

    } catch (err) {
      console.error("Grading load failed:", err);
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: red;">Workspace compilation error occurred.</td></tr>`;
    }
  };
}

// Interactive Matrix calculation logic (CA + Exam)
function setupGradingCalculationTriggers() {
  const tbody = document.getElementById("gradingWorkspaceTableBody");
  const rows = tbody.querySelectorAll("tr[data-student-id]");

  rows.forEach(row => {
    const caInput = row.querySelector(".ca-input");
    const examInput = row.querySelector(".exam-input");
    const totalScoreCell = row.querySelector(".row-total-score");
    const gradeCell = row.querySelector(".row-grade");
    const passFailCell = row.querySelector(".row-result-pass-fail");

    function calculate() {
      const ca = parseFloat(caInput.value) || 0;
      const exam = parseFloat(examInput.value) || 0;

      // Ensure valid boundaries
      if (caInput.value !== "" && (ca < 0 || ca > 30)) {
        window.showToast("Continuous Assessment scores must range between 0 and 30.", "warning");
        caInput.value = Math.max(0, Math.min(30, ca));
        return;
      }
      if (examInput.value !== "" && (exam < 0 || exam > 70)) {
        window.showToast("Semester Examination scores must range between 0 and 70.", "warning");
        examInput.value = Math.max(0, Math.min(70, exam));
        return;
      }

      if (caInput.value === "" && examInput.value === "") {
        totalScoreCell.textContent = "-";
        gradeCell.innerHTML = `<span class="status-badge" style="padding: 0.2rem 0.6rem; font-size: 0.85rem; font-weight: 800;">-</span>`;
        passFailCell.innerHTML = `-`;
        return;
      }

      const total = Math.min(100, Math.round(ca + exam));
      totalScoreCell.textContent = total;

      // Grade Determination (A-F Matrix)
      let grade = "F";
      let isPass = false;
      if (total >= 70) { grade = "A"; isPass = true; }
      else if (total >= 60) { grade = "B"; isPass = true; }
      else if (total >= 50) { grade = "C"; isPass = true; }
      else if (total >= 40) { grade = "D"; isPass = true; }

      // Update cells
      gradeCell.innerHTML = `
        <span class="status-badge ${grade === 'F' ? '' : 'cleared'}" style="padding: 0.2rem 0.6rem; font-size: 0.85rem; font-weight: 800;">
          ${grade}
        </span>
      `;

      passFailCell.innerHTML = `
        <span class="status-badge ${isPass ? 'cleared' : ''}" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; font-weight: 700;">
          ${isPass ? 'PASS' : 'FAIL'}
        </span>
      `;
    }

    caInput.addEventListener("input", calculate);
    examInput.addEventListener("input", calculate);
    
    // Initial compute on load
    calculate();
  });
}

// Bulk Actions: Save Draft and Publish
const btnSaveDraft = document.getElementById("btnSaveDraftResults");
const btnPublish = document.getElementById("btnPublishResults");

if (btnSaveDraft) {
  btnSaveDraft.addEventListener("click", () => handleResultSubmissionFlow("Draft"));
}
if (btnPublish) {
  btnPublish.addEventListener("click", () => handleResultSubmissionFlow("Published"));
}

async function handleResultSubmissionFlow(targetStatus) {
  const courseCode = document.getElementById("resultsCourseSelector").value;
  if (!courseCode) {
    window.showToast("Select a course to submit results.", "warning");
    return;
  }

  const assignedCodes = currentLecturerDoc.coursesAssigned || [];
  if (!assignedCodes.includes(courseCode)) {
    window.showToast("Security Access Denied: You cannot upload results for courses not assigned to you.", "error");
    return;
  }

  if (targetStatus === "Published") {
    const confirmPub = confirm("Are you sure you want to PUBLISH these results?\nOnce published, they are permanently locked and made visible to all student portals instantly.");
    if (!confirmPub) return;
  }

  const tbody = document.getElementById("gradingWorkspaceTableBody");
  const rows = tbody.querySelectorAll("tr[data-student-id]");
  let successfulSaves = 0;

  if (btnSaveDraft) btnSaveDraft.disabled = true;
  if (btnPublish) btnPublish.disabled = true;

  window.showToast(`Processing academic grades matrix (${targetStatus})...`, "info");

  try {
    for (let row of rows) {
      const studentId = row.getAttribute("data-student-id");
      const caInput = row.querySelector(".ca-input");
      const examInput = row.querySelector(".exam-input");

      // Skip empty inputs
      if (caInput.value === "" && examInput.value === "") continue;

      // Skip already published records to prevent overwrites
      const existing = activeExistingResultsMap[studentId] || {};
      if (existing.status === "Published") continue;

      const ca = parseFloat(caInput.value) || 0;
      const exam = parseFloat(examInput.value) || 0;
      const total = Math.min(100, Math.round(ca + exam));

      let grade = "F";
      if (total >= 70) grade = "A";
      else if (total >= 60) grade = "B";
      else if (total >= 50) grade = "C";
      else if (total >= 40) grade = "D";

      let remark = "Fail";
      if (grade === "A") remark = "Excellent";
      else if (grade === "B") remark = "Very Good";
      else if (grade === "C") remark = "Good";
      else if (grade === "D") remark = "Pass";

      // Result document schema
      const docId = `${studentId.replace(/\//g, "-")}_${courseCode}_${timelineSettings.session.replace(/\//g, "-")}`;
      const payload = {
        studentId: studentId,
        courseCode: courseCode,
        caScore: ca,
        examScore: exam,
        score: total,
        grade: grade,
        remark: remark,
        semester: timelineSettings.semester,
        academicSession: timelineSettings.session,
        status: targetStatus,
        uploadedBy: currentLecturerDoc.lecturerId,
        uploadedAt: new Date().toISOString()
      };

      await setDoc(doc(db, "results", docId), payload);
      successfulSaves++;
    }

    window.showToast(`Successfully registered ${successfulSaves} student grades.`, "success");
    // Reload active selector workspace
    document.getElementById("resultsCourseSelector").dispatchEvent(new Event("change"));

  } catch (err) {
    console.error("Grades matrix dispatch failed:", err);
    window.showToast("Matrix storage error: " + err.message, "error");
  } finally {
    if (btnSaveDraft) btnSaveDraft.disabled = false;
    if (btnPublish) btnPublish.disabled = false;
  }
}

// Tab 6: Announcements List and EmailJS student dispatcher
async function renderAnnouncementsTab() {
  const container = document.getElementById("lecturerAnnouncementsContainer");
  if (!container) return;

  container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 2rem 0;"><i class="fa-solid fa-spinner fa-spin"></i> Retrieving institutional notice logs...</p>`;

  try {
    const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    let html = "";
    let count = 0;

    const readStorageKey = `read_notif_${currentLecturerDoc.lecturerId}`;
    let readNotifIds = [];
    try {
      readNotifIds = JSON.parse(localStorage.getItem(readStorageKey)) || [];
    } catch (e) {
      readNotifIds = [];
    }

    snap.forEach(docSnap => {
      const n = docSnap.data();
      const aud = n.audience || "all";
      const notifId = docSnap.id;

      if (aud === "all" || aud === "lecturers") {
        const isRead = readNotifIds.includes(notifId);
        const dateStr = n.createdAt ? new Date(n.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : "Active";
        
        html += `
          <div style="border-left: 4px solid ${isRead ? 'var(--border-color)' : 'var(--accent)'}; padding: 1.25rem; background-color: var(--bg-slate); border-radius: 4px; border: 1px solid var(--border-color); border-left-width: 4px; margin-bottom: 1rem; opacity: ${isRead ? 0.75 : 1}; position: relative; transition: all 0.3s;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.85rem; color: var(--text-muted);">
              <strong><i class="fa-solid fa-calendar-day"></i> Published: ${dateStr}</strong>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="status-badge cleared" style="font-size: 0.75rem; padding: 0.1rem 0.5rem;">${aud.toUpperCase()}</span>
                ${isRead ? 
                  `<span class="status-badge info" style="font-size: 0.75rem; padding: 0.1rem 0.5rem;"><i class="fa-solid fa-envelope-open"></i> Read</span>` : 
                  `<button class="btn btn-mark-notif-read" data-id="${notifId}" style="background-color: var(--primary); color: white; border: none; font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 3px; cursor: pointer; font-weight: 700;"><i class="fa-solid fa-check"></i> Mark Read</button>`
                }
              </div>
            </div>
            <h4 class="font-display" style="color: var(--primary); font-size: 1.05rem; margin-top: 0; margin-bottom: 0.5rem;">${n.title || "Announcement Notice"}</h4>
            <p style="margin: 0; font-size: 0.9rem; line-height: 1.5; color: var(--text-dark);">${n.message}</p>
          </div>
        `;
        count++;
      }
    });

    container.innerHTML = count > 0 ? html : `<p style="text-align: center; color: var(--text-muted); padding: 2rem 0;">No active campus notices available today.</p>`;

    // Set up click handlers for Mark Read buttons
    document.querySelectorAll(".btn-mark-notif-read").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const notifId = btn.getAttribute("data-id");
        if (!readNotifIds.includes(notifId)) {
          readNotifIds.push(notifId);
          localStorage.setItem(readStorageKey, JSON.stringify(readNotifIds));
          window.showToast("Notice marked as read.", "success");
          renderAnnouncementsTab();
          loadCoreDashboardMetrics(); // refresh notifications badge count!
        }
      });
    });

  } catch (err) {
    console.error("Announcement logs fetch failure:", err);
    container.innerHTML = `<p style="text-align: center; color: red; padding: 2rem 0;"><i class="fa-solid fa-triangle-exclamation"></i> Notices lookup failed.</p>`;
  }
}

// EmailJS Form alert dispatcher
const emailAlertForm = document.getElementById("studentEmailAlertForm");
if (emailAlertForm) {
  emailAlertForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const selector = document.getElementById("noticeStudentSelector");
    const option = selector.options[selector.selectedIndex];

    if (!selector.value) {
      window.showToast("Please choose an enrolled student as recipient.", "warning");
      return;
    }

    const recipientName = option.getAttribute("data-name");
    const recipientEmail = option.getAttribute("data-email");
    const subject = document.getElementById("noticeSubject").value.trim();
    const message = document.getElementById("noticeMessage").value.trim();
    const btnSend = document.getElementById("btnSendStudentEmail");

    if (btnSend) btnSend.disabled = true;
    window.showToast("Compiling EmailJS transaction payload...", "info");

    try {
      if (!recipientEmail || recipientEmail === "N/A" || recipientEmail.trim() === "") {
        throw new Error("Target student has no registered email coordinates.");
      }

      // Payload parameters mapped to EmailJS student notice
      const templateParams = {
        subject: subject,
        message: message,
        lecturer_name: currentLecturerDoc.fullName,
        lecturer_id: currentLecturerDoc.lecturerId,
        lecturer_department: currentLecturerDoc.department || "Theology Dept"
      };

      const result = await prepareAndLogEmail("student", recipientName, recipientEmail, templateParams);
      
      if (result.success) {
        if (result.mode === "simulation") {
          window.showToast("Simulation Active: Notice logged to system console successfully.", "info");
        } else {
          window.showToast("Institutional notice successfully dispatched through EmailJS APIs.", "success");
        }
        // Clear inputs
        document.getElementById("noticeSubject").value = "";
        document.getElementById("noticeMessage").value = "";
        selector.value = "";
      } else {
        throw new Error(result.error);
      }

    } catch (err) {
      console.error("EmailJS submission failure:", err);
      window.showToast(err.message, "error");
    } finally {
      if (btnSend) btnSend.disabled = false;
    }
  });
}

// Tab 7: Change Password
const changePasswordForm = document.getElementById("changeLecturerPasswordForm");
if (changePasswordForm) {
  changePasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPass = document.getElementById("securityCurrentPassword").value;
    const newPass = document.getElementById("securityNewPassword").value;
    const confirmPass = document.getElementById("securityConfirmPassword").value;
    const btnUpdate = document.getElementById("btnUpdatePassword");

    if (newPass !== confirmPass) {
      window.showToast("New passwords do not match.", "warning");
      return;
    }

    if (newPass.length < 6) {
      window.showToast("Passwords must contain at least 6 characters.", "warning");
      return;
    }

    if (btnUpdate) btnUpdate.disabled = true;
    window.showToast("Authenticating current cryptograph credentials...", "info");

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error("No active Firebase Authentication context discovered. Re-login.");
      }

      // Re-authenticate user context safely
      const credential = EmailAuthProvider.credential(user.email, currentPass);
      await reauthenticateWithCredential(user, credential);

      // Commit update in Auth
      await updatePassword(user, newPass);

      // Commit update in Firestore to keep loginCredentials/tempPassword synced for future fallback logins
      const docRef = doc(db, "lecturers", currentLecturerDoc.id);
      await updateDoc(docRef, {
        password: newPass,
        "loginCredentials.password": newPass,
        tempPassword: newPass
      });

      // Clear fields
      document.getElementById("securityCurrentPassword").value = "";
      document.getElementById("securityNewPassword").value = "";
      document.getElementById("securityConfirmPassword").value = "";

      window.showToast("Your cryptographic password credentials have been updated successfully.", "success");

    } catch (err) {
      console.error("Credentials update failure:", err);
      window.showToast("Credential updating error: " + err.message, "error");
    } finally {
      if (btnUpdate) btnUpdate.disabled = false;
    }
  });
}

// Tab 7-2: Recovery Email Setup
const recoveryEmailForm = document.getElementById("updateRecoveryEmailForm");
if (recoveryEmailForm) {
  // Pre-fill recovery email
  setTimeout(() => {
    const recInput = document.getElementById("securityRecoveryEmail");
    if (recInput && currentLecturerDoc) {
      recInput.value = currentLecturerDoc.recoveryEmail || currentLecturerDoc.email || "";
    }
  }, 1000);

  recoveryEmailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newRecoveryEmail = document.getElementById("securityRecoveryEmail").value.trim();
    const btnUpdateRec = document.getElementById("btnUpdateRecoveryEmail");

    if (btnUpdateRec) btnUpdateRec.disabled = true;
    window.showToast("Updating secure recovery parameters...", "info");

    try {
      const docRef = doc(db, "lecturers", currentLecturerDoc.id);
      await updateDoc(docRef, { recoveryEmail: newRecoveryEmail });

      currentLecturerDoc.recoveryEmail = newRecoveryEmail;
      window.showToast("Recovery email coordinates updated successfully.", "success");
    } catch (err) {
      console.error("Recovery email update failed:", err);
      window.showToast("Recovery email update error: " + err.message, "error");
    } finally {
      if (btnUpdateRec) btnUpdateRec.disabled = false;
    }
  });
}

// Tab 7-3: Remember Me & Sign out all devices
const rememberMeToggle = document.getElementById("securityRememberMeToggle");
if (rememberMeToggle) {
  // Check if session is stored in localStorage
  const hasLocal = localStorage.getItem(SESSION_KEY) !== null;
  rememberMeToggle.checked = hasLocal;

  rememberMeToggle.addEventListener("change", () => {
    const sessionDataStr = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (!sessionDataStr) return;

    if (rememberMeToggle.checked) {
      localStorage.setItem(SESSION_KEY, sessionDataStr);
      sessionStorage.removeItem(SESSION_KEY);
      window.showToast("Permanent 'Remember Me' authentication enabled.", "success");
    } else {
      sessionStorage.setItem(SESSION_KEY, sessionDataStr);
      localStorage.removeItem(SESSION_KEY);
      window.showToast("'Remember Me' disabled. Session will expire on tab closure.", "info");
    }
  });
}

const btnSignoutAllDevices = document.getElementById("btnSignoutAllDevices");
if (btnSignoutAllDevices) {
  btnSignoutAllDevices.addEventListener("click", async () => {
    const confirmLogout = confirm("Are you sure you want to log out from all active devices?");
    if (!confirmLogout) return;

    window.showToast("Terminating active terminal authorization keys globally...", "info");
    try {
      await window.handleLogout("Logged out from all devices successfully.");
    } catch (err) {
      console.error("Global logout failed:", err);
      window.showToast("Global logout failed: " + err.message, "error");
    }
  });
}

// Sign Out Procedure
window.handleLogout = async (customMessage = null) => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("Auth signOut failed:", err);
  }

  // Wipe storage coordinates
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  currentLecturerDoc = null;

  // Clear timer
  clearTimeout(inactivityTimer);

  // Restore login views
  document.getElementById("anonymousView").style.display = "block";
  document.getElementById("authenticatedView").style.display = "none";

  // Hide indicator on login
  const feedback = document.getElementById("loginFeedback");
  if (feedback) feedback.style.display = "none";

  // Clear inputs
  if (loginForm) loginForm.reset();

  if (customMessage) {
    alert(customMessage);
  } else {
    window.showToast("Signed out successfully.", "success");
  }
};

// Bind Signout UI buttons
const btnLogout = document.getElementById("btnLogout");
if (btnLogout) {
  btnLogout.addEventListener("click", () => window.handleLogout());
}

// ==========================================
// COMPUTER-BASED TEST (CBT) MANAGEMENT MODULE
// ==========================================

let activeCbtSubtab = "question-bank";
let questionBankData = [];
let examinationsData = [];

// Entry point when CBT Management Tab is clicked
async function renderCbtManagementTab() {
  if (!currentLecturerDoc) {
    window.showToast("Authenticate first to access CBT module.", "error");
    return;
  }

  // Set default values for session and semester in forms
  const qSession = document.getElementById("qSession");
  if (qSession) qSession.value = timelineSettings.session;
  
  const examSession = document.getElementById("examSession");
  if (examSession) examSession.value = timelineSettings.session;

  const qSemester = document.getElementById("qSemester");
  if (qSemester) qSemester.value = timelineSettings.semester;

  const examSemester = document.getElementById("examSemester");
  if (examSemester) examSemester.value = timelineSettings.semester;

  // Populate course dropdown selectors
  populateCbtCourseSelectors();

  // Setup Sub-tabs navigation
  setupCbtSubtabs();

  // Load Question Bank & Exams
  await loadQuestionBank();
  await loadExaminations();

  // Initial rendering of current sub-tab
  switchCbtSubtab(activeCbtSubtab);
}

// Populate selectors with lecturer's assigned courses
function populateCbtCourseSelectors() {
  const assigned = currentLecturerDoc.coursesAssigned || [];
  const qCourseSelect = document.getElementById("qCourseSelect");
  const examCourse = document.getElementById("examCourse");
  const filterQCourse = document.getElementById("filterQCourse");

  let optionsHtml = assigned.map(c => `<option value="${c}">${c}</option>`).join("");
  
  if (assigned.length === 0) {
    optionsHtml = `<option value="">No assigned courses</option>`;
  }

  if (qCourseSelect) qCourseSelect.innerHTML = optionsHtml;
  if (examCourse) examCourse.innerHTML = optionsHtml;
  
  if (filterQCourse) {
    filterQCourse.innerHTML = `<option value="all">All My Courses</option>` + 
      assigned.map(c => `<option value="${c}">${c}</option>`).join("");
  }
}

// Setup Sub-tabs navigation and listeners
function setupCbtSubtabs() {
  const btns = document.querySelectorAll(".cbt-sub-tab-btn");
  btns.forEach(btn => {
    // Avoid double binding
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener("click", () => {
      const subtab = newBtn.getAttribute("data-subtab");
      switchCbtSubtab(subtab);
    });
  });
}

// Switch and render sub-tab views
function switchCbtSubtab(subtabId) {
  activeCbtSubtab = subtabId;
  
  // Style pill buttons
  const btns = document.querySelectorAll(".cbt-sub-tab-btn");
  btns.forEach(btn => {
    if (btn.getAttribute("data-subtab") === subtabId) {
      btn.style.backgroundColor = "#1F3B82";
      btn.style.color = "white";
      btn.style.border = "none";
      btn.classList.add("active");
    } else {
      btn.style.backgroundColor = "transparent";
      btn.style.color = "var(--text-muted)";
      btn.style.border = "1.5px solid var(--border-color)";
      btn.classList.remove("active");
    }
  });

  // Toggle sub-tab content blocks
  const contents = document.querySelectorAll(".cbt-subtab-content");
  contents.forEach(content => {
    if (content.id === `cbt-subtab-${subtabId}`) {
      content.style.display = "block";
    } else {
      content.style.display = "none";
    }
  });

  // Load sub-tab specific data / lists
  if (subtabId === "question-bank") {
    renderQuestionBankList();
  } else if (subtabId === "scheduled-exams") {
    renderScheduledExamsList();
  } else if (subtabId === "results-stats") {
    populateResultsExamDropdown();
  }
}

// ==========================================
// SECTION A: QUESTION BANK OPERATIONS
// ==========================================

async function loadQuestionBank() {
  try {
    const qSnap = await getDocs(query(collection(db, "questionBank"), where("lecturerId", "==", currentLecturerDoc.lecturerId)));
    questionBankData = qSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.error("Failed to load question bank:", err);
  }
}

function renderQuestionBankList() {
  const tableBody = document.getElementById("qBankTableBody");
  if (!tableBody) return;

  const filterCourse = document.getElementById("filterQCourse")?.value || "all";
  const searchText = document.getElementById("searchQText")?.value.toLowerCase() || "";

  let filtered = questionBankData;
  if (filterCourse !== "all") {
    filtered = filtered.filter(q => q.courseCode === filterCourse);
  }
  if (searchText) {
    filtered = filtered.filter(q => q.question.toLowerCase().includes(searchText));
  }

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2.5rem; color: var(--text-muted);"><i class="fa-solid fa-face-meh" style="font-size: 2rem; opacity: 0.3; display: block; margin-bottom: 0.5rem;"></i> No questions matching this filter criteria.</td></tr>`;
    return;
  }

  tableBody.innerHTML = filtered.map(q => `
    <tr style="border-bottom: 1px solid var(--border-color); hover:background-color:var(--bg-slate);">
      <td style="padding: 0.85rem; font-weight: 700; color: var(--primary); vertical-align: top;">${q.courseCode}</td>
      <td style="padding: 0.85rem; vertical-align: top;">
        <div style="font-weight: 600; color: var(--text-dark); margin-bottom: 0.5rem;">${escapeHtml(q.question)}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem 1rem; font-size: 0.78rem; color: var(--text-muted); padding-left: 0.5rem; border-left: 2px solid var(--border-color);">
          <div><strong style="color: ${q.correctAnswer === 'A' ? 'green' : 'inherit'}">A:</strong> ${escapeHtml(q.optionA)}</div>
          <div><strong style="color: ${q.correctAnswer === 'B' ? 'green' : 'inherit'}">B:</strong> ${escapeHtml(q.optionB)}</div>
          <div><strong style="color: ${q.correctAnswer === 'C' ? 'green' : 'inherit'}">C:</strong> ${escapeHtml(q.optionC)}</div>
          <div><strong style="color: ${q.correctAnswer === 'D' ? 'green' : 'inherit'}">D:</strong> ${escapeHtml(q.optionD)}</div>
        </div>
        ${q.explanation ? `<div style="font-size: 0.72rem; color: var(--accent); margin-top: 0.5rem; font-style: italic;"><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</div>` : ''}
      </td>
      <td style="padding: 0.85rem; text-align: center; vertical-align: top; font-weight: 700; color: var(--primary);">${q.marks}</td>
      <td style="padding: 0.85rem; text-align: center; vertical-align: top;">
        <div style="display: flex; gap: 0.5rem; justify-content: center;">
          <button class="btn btn-edit-question" data-id="${q.id}" title="Edit Question" style="background-color: var(--primary); color: white; border: none; width: 32px; height: 32px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-pen-to-square"></i></button>
          <button class="btn btn-preview-question" data-id="${q.id}" title="Preview" style="background-color: #F4B000; color: var(--primary-dark); border: none; width: 32px; height: 32px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-eye"></i></button>
          <button class="btn btn-delete-question" data-id="${q.id}" title="Delete" style="background-color: var(--danger-color, #DC3545); color: white; border: none; width: 32px; height: 32px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join("");

  // Bind Question bank actions
  document.querySelectorAll(".btn-edit-question").forEach(btn => {
    btn.addEventListener("click", () => editQuestion(btn.getAttribute("data-id")));
  });

  document.querySelectorAll(".btn-preview-question").forEach(btn => {
    btn.addEventListener("click", () => previewQuestion(btn.getAttribute("data-id")));
  });

  document.querySelectorAll(".btn-delete-question").forEach(btn => {
    btn.addEventListener("click", () => deleteQuestion(btn.getAttribute("data-id")));
  });
}

// Question Bank CRUD handlers
const qBankForm = document.getElementById("qBankForm");
if (qBankForm) {
  qBankForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentLecturerDoc) return;

    const qIdVal = document.getElementById("qId").value;
    const data = {
      courseCode: document.getElementById("qCourseSelect").value,
      academicSession: document.getElementById("qSession").value,
      semester: document.getElementById("qSemester").value,
      question: document.getElementById("qText").value.trim(),
      optionA: document.getElementById("qOptA").value.trim(),
      optionB: document.getElementById("qOptB").value.trim(),
      optionC: document.getElementById("qOptC").value.trim(),
      optionD: document.getElementById("qOptD").value.trim(),
      correctAnswer: document.getElementById("qCorrectAnswer").value,
      marks: parseInt(document.getElementById("qMarks").value) || 1,
      explanation: document.getElementById("qExplanation").value.trim(),
      lecturerId: currentLecturerDoc.lecturerId,
      updatedAt: new Date().toISOString()
    };

    try {
      const qRef = qIdVal ? doc(db, "questionBank", qIdVal) : doc(collection(db, "questionBank"));
      if (!qIdVal) {
        data.createdAt = new Date().toISOString();
      }
      
      await setDoc(qRef, data, { merge: true });
      window.showToast("Question successfully saved to Syllabus Bank.", "success");
      
      resetQuestionForm();
      await loadQuestionBank();
      renderQuestionBankList();
    } catch (err) {
      console.error("Save question error:", err);
      window.showToast("Failed to commit question parameters: " + err.message, "error");
    }
  });
}

document.getElementById("btnResetQForm")?.addEventListener("click", () => {
  resetQuestionForm();
});

// Filter triggers
document.getElementById("filterQCourse")?.addEventListener("change", () => renderQuestionBankList());
document.getElementById("searchQText")?.addEventListener("input", () => renderQuestionBankList());

function resetQuestionForm() {
  if (qBankForm) qBankForm.reset();
  document.getElementById("qId").value = "";
  document.getElementById("qFormTitle").innerHTML = `<i class="fa-solid fa-circle-question" style="color: var(--accent);"></i> New Question`;
  const qSession = document.getElementById("qSession");
  if (qSession) qSession.value = timelineSettings.session;
  const qSemester = document.getElementById("qSemester");
  if (qSemester) qSemester.value = timelineSettings.semester;
}

function editQuestion(id) {
  const q = questionBankData.find(item => item.id === id);
  if (!q) return;

  document.getElementById("qId").value = q.id;
  document.getElementById("qCourseSelect").value = q.courseCode;
  document.getElementById("qSession").value = q.academicSession;
  document.getElementById("qSemester").value = q.semester;
  document.getElementById("qText").value = q.question;
  document.getElementById("qOptA").value = q.optionA;
  document.getElementById("qOptB").value = q.optionB;
  document.getElementById("qOptC").value = q.optionC;
  document.getElementById("qOptD").value = q.optionD;
  document.getElementById("qCorrectAnswer").value = q.correctAnswer;
  document.getElementById("qMarks").value = q.marks;
  document.getElementById("qExplanation").value = q.explanation || "";

  document.getElementById("qFormTitle").innerHTML = `<i class="fa-solid fa-pen-to-square" style="color: var(--accent);"></i> Edit Question`;
  window.showToast("Question coordinates populated for revision.", "info");
}

function previewQuestion(id) {
  const q = questionBankData.find(item => item.id === id);
  if (!q) return;

  alert(`[QUESTION PREVIEW - ${q.courseCode}]\n\nQuestion: ${q.question}\n\n[A] ${q.optionA}\n[B] ${q.optionB}\n[C] ${q.optionC}\n[D] ${q.optionD}\n\nCorrect Answer: Option [${q.correctAnswer}]\nMarks Allocated: ${q.marks} marks\n\nExplanation:\n${q.explanation || 'None provided.'}`);
}

async function deleteQuestion(id) {
  if (!confirm("⚠️ Are you sure you want to delete this question? This action is permanent.")) return;

  try {
    const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
    await deleteDoc(doc(db, "questionBank", id));
    window.showToast("Question successfully purged.", "success");
    await loadQuestionBank();
    renderQuestionBankList();
  } catch (err) {
    console.error("Delete question error:", err);
    window.showToast("Purge failed: " + err.message, "error");
  }
}

// ==========================================
// SECTION B: CREATE / MODIFY EXAMINATIONS
// ==========================================

async function loadExaminations() {
  try {
    const examSnap = await getDocs(query(collection(db, "examinations"), where("lecturerId", "==", currentLecturerDoc.lecturerId)));
    examinationsData = examSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.error("Failed to load examinations:", err);
  }
}

const createExamForm = document.getElementById("createExamForm");
if (createExamForm) {
  createExamForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentLecturerDoc) return;

    const examIdVal = document.getElementById("examId").value;
    const courseCode = document.getElementById("examCourse").value;
    const numQuestions = parseInt(document.getElementById("examNumQuestions").value) || 20;

    // Validation: Lecturer should have enough questions in the Question Bank for this course!
    const availableQuestions = questionBankData.filter(q => q.courseCode === courseCode);
    if (availableQuestions.length < numQuestions) {
      alert(`⚠️ Question Bank Deficit!\n\nYou have requested ${numQuestions} questions, but only ${availableQuestions.length} questions exist in your Question Bank for course ${courseCode}.\n\nPlease add more questions first, or decrease the requested exam question size.`);
      return;
    }

    const data = {
      courseCode: courseCode,
      academicSession: document.getElementById("examSession").value,
      semester: document.getElementById("examSemester").value,
      title: document.getElementById("examTitle").value.trim(),
      duration: parseInt(document.getElementById("examDuration").value) || 60,
      numQuestions: numQuestions,
      startDate: document.getElementById("examOpenDate").value,
      endDate: document.getElementById("examCloseDate").value,
      randomizeQuestions: document.getElementById("examRandQuestions").value === "Yes",
      randomizeOptions: document.getElementById("examRandOptions").value === "Yes",
      showResultImmediately: document.getElementById("examShowResult").value === "Yes",
      status: document.getElementById("examStatus").value,
      lecturerId: currentLecturerDoc.lecturerId,
      updatedAt: new Date().toISOString()
    };

    try {
      const examRef = examIdVal ? doc(db, "examinations", examIdVal) : doc(collection(db, "examinations"));
      if (!examIdVal) {
        data.createdAt = new Date().toISOString();
      }

      await setDoc(examRef, data, { merge: true });
      window.showToast("Examination configuration successfully registered.", "success");

      resetExamForm();
      await loadExaminations();
      switchCbtSubtab("scheduled-exams");
    } catch (err) {
      console.error("Save exam error:", err);
      window.showToast("Failed to save examination parameters: " + err.message, "error");
    }
  });
}

document.getElementById("btnCancelExamForm")?.addEventListener("click", () => {
  resetExamForm();
  switchCbtSubtab("scheduled-exams");
});

function resetExamForm() {
  if (createExamForm) createExamForm.reset();
  document.getElementById("examId").value = "";
  
  const examSession = document.getElementById("examSession");
  if (examSession) examSession.value = timelineSettings.session;
  const examSemester = document.getElementById("examSemester");
  if (examSemester) examSemester.value = timelineSettings.semester;
}

// ==========================================
// SECTION C: SCHEDULED EXAMINATIONS LIST
// ==========================================

function renderScheduledExamsList() {
  const tableBody = document.getElementById("scheduledExamsTableBody");
  if (!tableBody) return;

  if (examinationsData.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);"><i class="fa-solid fa-calendar-times" style="font-size: 2.5rem; opacity: 0.3; display: block; margin-bottom: 0.5rem;"></i> No assessment configurations found.</td></tr>`;
    return;
  }

  tableBody.innerHTML = examinationsData.map(ex => {
    let statusClass = "status-badge pending";
    if (ex.status === "Published") statusClass = "status-badge cleared";
    if (ex.status === "Closed") statusClass = "status-badge"; // neutral grey

    const formattedStart = formatCbtDate(ex.startDate);
    const formattedEnd = formatCbtDate(ex.endDate);

    return `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 0.85rem; font-weight: 700; color: var(--primary);">${ex.courseCode}</td>
        <td style="padding: 0.85rem; font-weight: 600;">${escapeHtml(ex.title)}</td>
        <td style="padding: 0.85rem; font-size: 0.78rem;">
          <div><strong>Start:</strong> ${formattedStart}</div>
          <div><strong>End:</strong> ${formattedEnd}</div>
        </td>
        <td style="padding: 0.85rem; text-align: center;">${ex.duration} mins</td>
        <td style="padding: 0.85rem; text-align: center; font-weight: 600;">${ex.numQuestions} Qs</td>
        <td style="padding: 0.85rem; text-align: center;">
          <span class="${statusClass}" style="display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-weight:700; font-size: 0.7rem;">${ex.status}</span>
        </td>
        <td style="padding: 0.85rem; text-align: center;">
          <div style="display: flex; gap: 0.4rem; justify-content: center;">
            ${ex.status === 'Draft' ? `<button class="btn btn-action-publish" data-id="${ex.id}" title="Publish Exam" style="background-color: #28A745; color: white; border: none; width: 30px; height: 30px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-circle-check"></i></button>` : ''}
            ${ex.status === 'Published' ? `<button class="btn btn-action-close" data-id="${ex.id}" title="Close Exam" style="background-color: #DC3545; color: white; border: none; width: 30px; height: 30px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-circle-xmark"></i></button>` : ''}
            <button class="btn btn-action-edit" data-id="${ex.id}" title="Edit" style="background-color: var(--primary); color: white; border: none; width: 30px; height: 30px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-action-delete" data-id="${ex.id}" title="Delete" style="background-color: #555; color: white; border: none; width: 30px; height: 30px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Bind Exam Action listeners
  document.querySelectorAll(".btn-action-publish").forEach(btn => {
    btn.addEventListener("click", () => updateExamStatus(btn.getAttribute("data-id"), "Published"));
  });

  document.querySelectorAll(".btn-action-close").forEach(btn => {
    btn.addEventListener("click", () => updateExamStatus(btn.getAttribute("data-id"), "Closed"));
  });

  document.querySelectorAll(".btn-action-edit").forEach(btn => {
    btn.addEventListener("click", () => editExam(btn.getAttribute("data-id")));
  });

  document.querySelectorAll(".btn-action-delete").forEach(btn => {
    btn.addEventListener("click", () => deleteExam(btn.getAttribute("data-id")));
  });
}

async function updateExamStatus(id, newStatus) {
  try {
    await updateDoc(doc(db, "examinations", id), { status: newStatus, updatedAt: new Date().toISOString() });
    window.showToast(`Assessment status set to [${newStatus}].`, "success");
    await loadExaminations();
    renderScheduledExamsList();
  } catch (err) {
    console.error("Update status error:", err);
    window.showToast("Failed to alter status: " + err.message, "error");
  }
}

function editExam(id) {
  const ex = examinationsData.find(item => item.id === id);
  if (!ex) return;

  document.getElementById("examId").value = ex.id;
  document.getElementById("examCourse").value = ex.courseCode;
  document.getElementById("examSession").value = ex.academicSession;
  document.getElementById("examSemester").value = ex.semester;
  document.getElementById("examTitle").value = ex.title;
  document.getElementById("examDuration").value = ex.duration;
  document.getElementById("examNumQuestions").value = ex.numQuestions;
  document.getElementById("examOpenDate").value = ex.startDate;
  document.getElementById("examCloseDate").value = ex.endDate;
  document.getElementById("examRandQuestions").value = ex.randomizeQuestions ? "Yes" : "No";
  document.getElementById("examRandOptions").value = ex.randomizeOptions ? "Yes" : "No";
  document.getElementById("examShowResult").value = ex.showResultImmediately ? "Yes" : "No";
  document.getElementById("examStatus").value = ex.status;

  switchCbtSubtab("create-exam");
  window.showToast("Assessment configuration loaded for editing.", "info");
}

async function deleteExam(id) {
  if (!confirm("⚠️ Confirm Assessment Purge\n\nAre you sure you want to permanently delete this examination?")) return;

  try {
    const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
    await deleteDoc(doc(db, "examinations", id));
    window.showToast("Examination configuration successfully deleted.", "success");
    await loadExaminations();
    renderScheduledExamsList();
  } catch (err) {
    console.error("Delete exam error:", err);
    window.showToast("Failed to delete exam: " + err.message, "error");
  }
}

// ==========================================
// SECTION D: RESULTS & STATISTICS
// ==========================================

let activeResultsList = [];

function populateResultsExamDropdown() {
  const select = document.getElementById("resultsExamSelect");
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = `<option value="">-- Choose Examination --</option>` +
    examinationsData.map(ex => `<option value="${ex.id}">[${ex.courseCode}] ${escapeHtml(ex.title)}</option>`).join("");
  
  select.value = currentVal;

  // Setup selector listener (one time)
  if (!select.dataset.listenerBound) {
    select.addEventListener("change", (e) => loadSelectedExamResults(e.target.value));
    select.dataset.listenerBound = "true";
  }
}

async function loadSelectedExamResults(examId) {
  const tableBody = document.getElementById("cbtResultsTableBody");
  const exportBtn = document.getElementById("btnExportCbtResults");
  if (!tableBody) return;

  if (!examId) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">Please select an examination from the dropdown above.</td></tr>`;
    if (exportBtn) exportBtn.disabled = true;
    resetCbtStatsCounters();
    return;
  }

  tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">Fetching results data...</td></tr>`;

  try {
    const rSnap = await getDocs(query(collection(db, "examinationResults"), where("examId", "==", examId)));
    activeResultsList = rSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (activeResultsList.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2.5rem; color: var(--text-muted);"><i class="fa-solid fa-graduation-cap" style="font-size: 2rem; opacity: 0.3; display: block; margin-bottom: 0.5rem;"></i> No students have submitted answers for this examination yet.</td></tr>`;
      if (exportBtn) exportBtn.disabled = true;
      resetCbtStatsCounters();
      return;
    }

    if (exportBtn) exportBtn.disabled = false;
    calculateAndRenderCbtStats();

    tableBody.innerHTML = activeResultsList.map(res => `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 0.75rem;">${res.studentId}</td>
        <td style="padding: 0.75rem; font-weight: 600;">${escapeHtml(res.studentName)}</td>
        <td style="padding: 0.75rem;">${res.studentMatric}</td>
        <td style="padding: 0.75rem; text-align: center; font-weight: 700; color: var(--primary);">${res.score} / ${res.totalQuestions}</td>
        <td style="padding: 0.75rem; text-align: center; font-weight: 600;">${res.percentage}%</td>
        <td style="padding: 0.75rem; text-align: center; font-weight: 700;">${res.grade}</td>
        <td style="padding: 0.75rem; text-align: center;">
          <span class="status-badge ${res.passed ? 'cleared' : ''}" style="display:inline-block; font-size:0.7rem; font-weight:700; background-color: ${res.passed ? 'rgba(40,167,69,0.1)' : 'rgba(220,53,69,0.1)'}; color: ${res.passed ? '#28a745' : '#dc3545'}">${res.passed ? 'PASS' : 'FAIL'}</span>
        </td>
        <td style="padding: 0.75rem; text-align: center; font-size: 0.75rem; color: var(--text-muted);">${formatCbtDate(res.submittedAt)}</td>
      </tr>
    `).join("");

  } catch (err) {
    console.error("Load exam results error:", err);
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--danger-color);">Error fetching results: ${err.message}</td></tr>`;
  }
}

function calculateAndRenderCbtStats() {
  if (activeResultsList.length === 0) return;

  const total = activeResultsList.length;
  const percentages = activeResultsList.map(r => r.percentage);
  
  const sum = percentages.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / total);

  const max = Math.max(...percentages);
  const min = Math.min(...percentages);

  const passes = activeResultsList.filter(r => r.passed).length;
  const fails = total - passes;

  const passRate = Math.round((passes / total) * 100);
  const failRate = 100 - passRate;

  document.getElementById("statCbtTotalStudents").textContent = total;
  document.getElementById("statCbtAvgScore").textContent = `${avg}%`;
  document.getElementById("statCbtHighLow").textContent = `${max}% / ${min}%`;
  document.getElementById("statCbtPassRate").textContent = `${passRate}%`;
  document.getElementById("statCbtFailRate").textContent = `${failRate}%`;
}

function resetCbtStatsCounters() {
  document.getElementById("statCbtTotalStudents").textContent = "0";
  document.getElementById("statCbtAvgScore").textContent = "0%";
  document.getElementById("statCbtHighLow").textContent = "0% / 0%";
  document.getElementById("statCbtPassRate").textContent = "0%";
  document.getElementById("statCbtFailRate").textContent = "0%";
}

// CSV Export Utility
document.getElementById("btnExportCbtResults")?.addEventListener("click", () => {
  if (activeResultsList.length === 0) return;

  const examSelect = document.getElementById("resultsExamSelect");
  const examText = examSelect ? examSelect.options[examSelect.selectedIndex].text : "cbt_examination";
  const fileName = `${examText.replace(/[\s/]+/g, "_").toLowerCase()}_results.csv`;

  const headers = ["Student ID", "Full Name", "Matric Number", "Score", "Total Qs", "Percentage (%)", "Grade", "Status", "Submitted At"];
  const rows = activeResultsList.map(r => [
    r.studentId,
    r.studentName,
    r.studentMatric,
    r.score,
    r.totalQuestions,
    r.percentage,
    r.grade,
    r.passed ? "PASS" : "FAIL",
    r.submittedAt
  ]);

  let csvContent = "data:text/csv;charset=utf-8," 
    + [headers.join(","), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.showToast("Results successfully exported as CSV spreadsheet.", "success");
});

// Helper formatting functions
function formatCbtDate(dateString) {
  if (!dateString) return "-";
  try {
    const d = new Date(dateString);
    return d.toLocaleString('en-US', { hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return dateString;
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

// Global hook to make functions available if called from other inline handlers
window.renderCbtManagementTab = renderCbtManagementTab;

// ==========================================
// SECTION E: ATTENDANCE MANAGEMENT LOGIC
// ==========================================

let attendanceInitialized = false;
async function renderAttendanceTab() {
  if (!currentLecturerDoc) return;
  const assigned = currentLecturerDoc.coursesAssigned || [];
  
  const courseSelect = document.getElementById("attendanceCourseSelect");
  const filterSelect = document.getElementById("historyAttendanceCourseFilter");
  
  if (courseSelect) {
    courseSelect.innerHTML = assigned.map(c => `<option value="${c}">${c}</option>`).join("");
    if (assigned.length === 0) {
      courseSelect.innerHTML = `<option value="">No assigned courses</option>`;
    }
  }
  
  if (filterSelect) {
    filterSelect.innerHTML = `<option value="">-- Choose Course --</option>` + 
      assigned.map(c => `<option value="${c}">${c}</option>`).join("");
  }

  // Pre-fill date
  const dateInput = document.getElementById("attendanceDate");
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  if (!attendanceInitialized) {
    attendanceInitialized = true;
    setupAttendanceListeners();
  }
  
  loadAttendanceHistory();
}

let activeAttendanceStudents = [];
function setupAttendanceListeners() {
  const form = document.getElementById("attendanceSetupForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const courseCode = document.getElementById("attendanceCourseSelect").value;
      const date = document.getElementById("attendanceDate").value;
      const sessionTitle = document.getElementById("attendanceSessionTitle").value.trim();
      
      if (!courseCode) {
        window.showToast("No course selected.", "warning");
        return;
      }
      
      const tbody = document.getElementById("attendanceSheetTableBody");
      tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Loading enrolled student register...</td></tr>`;
      
      try {
        // Query registrations
        const regSnap = await getDocs(query(collection(db, "registrations"), where("courseCode", "==", courseCode), where("academicSession", "==", timelineSettings.session)));
        const registrants = [];
        regSnap.forEach(snap => registrants.push(snap.data()));
        
        if (registrants.length === 0) {
          tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 2rem; color: var(--text-muted);">No student registrations found for course ${courseCode} in session ${timelineSettings.session}.</td></tr>`;
          document.getElementById("attendanceActionBlock").style.display = "none";
          return;
        }

        // Fetch student details
        activeAttendanceStudents = [];
        for (let reg of registrants) {
          const sRef = doc(db, "students", reg.studentId);
          const sSnap = await getDoc(sRef);
          if (sSnap.exists()) {
            activeAttendanceStudents.push({
              studentId: reg.studentId,
              fullName: sSnap.data().fullName || "N/A",
              matricNumber: sSnap.data().matricNumber || "N/A",
              status: "Present" // default to Present
            });
          }
        }

        // Render sheet
        renderActiveAttendanceSheet();
        
      } catch (err) {
        console.error("Attendance load register failed:", err);
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: red;">Failed to retrieve student register: ${err.message}</td></tr>`;
      }
    });
  }

  // Bind mark all present
  document.getElementById("btnMarkAllPresent")?.addEventListener("click", () => {
    activeAttendanceStudents.forEach(s => s.status = "Present");
    renderActiveAttendanceSheet();
    window.showToast("All students marked PRESENT.", "success");
  });

  // Bind save attendance sheet
  document.getElementById("btnSaveAttendanceSheet")?.addEventListener("click", async () => {
    const courseCode = document.getElementById("attendanceCourseSelect").value;
    const date = document.getElementById("attendanceDate").value;
    const sessionTitle = document.getElementById("attendanceSessionTitle").value.trim();

    if (!courseCode || !date || !sessionTitle || activeAttendanceStudents.length === 0) {
      window.showToast("Incomplete roll call information.", "warning");
      return;
    }

    const btnSave = document.getElementById("btnSaveAttendanceSheet");
    if (btnSave) btnSave.disabled = true;
    window.showToast("Saving attendance records in theology database...", "info");

    try {
      const docId = `${courseCode}_${date}_${sessionTitle.replace(/[\s/]+/g, '_')}`;
      const payload = {
        courseCode,
        date,
        sessionTitle,
        semester: timelineSettings.semester,
        academicSession: timelineSettings.session,
        lecturerId: currentLecturerDoc.lecturerId,
        records: activeAttendanceStudents.map(s => ({ studentId: s.studentId, status: s.status })),
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, "attendance", docId), payload);
      window.showToast("Roll call registers successfully synchronized.", "success");
      
      // Reset form & view
      document.getElementById("attendanceSessionTitle").value = "";
      document.getElementById("attendanceSheetTableBody").innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 3rem; color: var(--text-muted);">Please configure session details on the left and load the sheet.</td></tr>`;
      document.getElementById("attendanceActionBlock").style.display = "none";
      document.getElementById("attendanceSummaryText").textContent = "-";
      
      loadAttendanceHistory();

    } catch (err) {
      console.error("Attendance save failed:", err);
      window.showToast("Failed to save attendance register: " + err.message, "error");
    } finally {
      if (btnSave) btnSave.disabled = false;
    }
  });

  // Filter listener for history
  document.getElementById("historyAttendanceCourseFilter")?.addEventListener("change", () => loadAttendanceHistory());
  document.getElementById("btnRefreshAttendanceHistory")?.addEventListener("click", () => loadAttendanceHistory());
}

function renderActiveAttendanceSheet() {
  const tbody = document.getElementById("attendanceSheetTableBody");
  if (!tbody) return;

  tbody.innerHTML = activeAttendanceStudents.map(s => `
    <tr style="border-bottom: 1px solid var(--border-color);">
      <td style="padding: 0.85rem;"><strong>${escapeHtml(s.fullName)}</strong></td>
      <td style="padding: 0.85rem;"><code>${s.matricNumber}</code></td>
      <td style="padding: 0.85rem; text-align: center;">
        <div style="display: flex; gap: 0.5rem; justify-content: center;">
          <button type="button" class="btn-attendance-toggle" data-student-id="${s.studentId}" data-status="Present" style="background-color: ${s.status === 'Present' ? '#28A745' : '#E9ECEF'}; color: ${s.status === 'Present' ? 'white' : 'var(--text-dark)'}; border: none; padding: 0.4rem 1rem; border-radius: 4px; font-weight: 700; cursor: pointer; font-size: 0.72rem; transition: all 0.2s;">PRESENT</button>
          <button type="button" class="btn-attendance-toggle" data-student-id="${s.studentId}" data-status="Absent" style="background-color: ${s.status === 'Absent' ? '#DC3545' : '#E9ECEF'}; color: ${s.status === 'Absent' ? 'white' : 'var(--text-dark)'}; border: none; padding: 0.4rem 1rem; border-radius: 4px; font-weight: 700; cursor: pointer; font-size: 0.72rem; transition: all 0.2s;">ABSENT</button>
        </div>
      </td>
    </tr>
  `).join("");

  // Setup count summary
  const presentCount = activeAttendanceStudents.filter(s => s.status === "Present").length;
  document.getElementById("attendanceSummaryText").textContent = `Presence Rate: ${presentCount} / ${activeAttendanceStudents.length} Present`;
  document.getElementById("attendanceActionBlock").style.display = "flex";

  // Bind toggle clicks
  tbody.querySelectorAll(".btn-attendance-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const sId = btn.getAttribute("data-student-id");
      const status = btn.getAttribute("data-status");
      const student = activeAttendanceStudents.find(s => s.studentId === sId);
      if (student) {
        student.status = status;
        renderActiveAttendanceSheet();
      }
    });
  });
}

async function loadAttendanceHistory() {
  const tbody = document.getElementById("attendanceHistoryTableBody");
  if (!tbody) return;

  const courseFilter = document.getElementById("historyAttendanceCourseFilter")?.value;
  if (!courseFilter) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">Choose a course above to display history log books.</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Syncing attendance logs...</td></tr>`;

  try {
    const q = query(collection(db, "attendance"), where("courseCode", "==", courseFilter), where("lecturerId", "==", currentLecturerDoc.lecturerId));
    const snap = await getDocs(q);
    const logs = [];
    snap.forEach(docSnap => logs.push({ id: docSnap.id, ...docSnap.data() }));

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">No archived attendance sheets found for course ${courseFilter}.</td></tr>`;
      return;
    }

    // Sort by date descending
    logs.sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = logs.map(log => {
      const records = log.records || [];
      const presents = records.filter(r => r.status === "Present").length;
      const rate = records.length > 0 ? Math.round((presents / records.length) * 100) : 0;
      
      return `
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 0.85rem; font-weight: 700; color: var(--primary);">${log.courseCode}</td>
          <td style="padding: 0.85rem;">${new Date(log.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
          <td style="padding: 0.85rem; font-weight: 600;">${escapeHtml(log.sessionTitle)}</td>
          <td style="padding: 0.85rem; text-align: center;">
            <span class="status-badge cleared" style="font-size: 0.75rem; padding: 0.2rem 0.5rem; font-weight: 700;">${presents} / ${records.length} (${rate}%)</span>
          </td>
          <td style="padding: 0.85rem; text-align: center;">
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
              <button class="btn btn-view-attendance-log" data-id="${log.id}" style="background-color: var(--primary); color: white; border: none; padding: 0.3rem 0.75rem; border-radius: 4px; font-weight: 700; font-size: 0.75rem; cursor: pointer; font-family: 'Poppins';"><i class="fa-solid fa-eye"></i> View</button>
              <button class="btn btn-delete-attendance-log" data-id="${log.id}" style="background-color: #DC3545; color: white; border: none; padding: 0.3rem 0.75rem; border-radius: 4px; font-weight: 700; font-size: 0.75rem; cursor: pointer; font-family: 'Poppins';"><i class="fa-solid fa-trash"></i> Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    // Bind log action clicks
    tbody.querySelectorAll(".btn-view-attendance-log").forEach(btn => {
      btn.addEventListener("click", () => viewAttendanceLog(btn.getAttribute("data-id"), logs));
    });

    tbody.querySelectorAll(".btn-delete-attendance-log").forEach(btn => {
      btn.addEventListener("click", () => deleteAttendanceLog(btn.getAttribute("data-id")));
    });

  } catch (err) {
    console.error("Load attendance logs failed:", err);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: red;">Logs retrieval error: ${err.message}</td></tr>`;
  }
}

async function viewAttendanceLog(id, logs) {
  const log = logs.find(l => l.id === id);
  if (!log) return;

  window.showToast(`Loading registers for: ${log.sessionTitle}...`, "info");
  
  // Set setup inputs
  document.getElementById("attendanceCourseSelect").value = log.courseCode;
  document.getElementById("attendanceDate").value = log.date;
  document.getElementById("attendanceSessionTitle").value = log.sessionTitle;

  // Render active sheet using saved records
  activeAttendanceStudents = [];
  try {
    for (let rec of log.records) {
      const sRef = doc(db, "students", rec.studentId);
      const sSnap = await getDoc(sRef);
      if (sSnap.exists()) {
        activeAttendanceStudents.push({
          studentId: rec.studentId,
          fullName: sSnap.data().fullName || "N/A",
          matricNumber: sSnap.data().matricNumber || "N/A",
          status: rec.status
        });
      }
    }
    renderActiveAttendanceSheet();
    window.showToast("Saved roll call sheet populated. You can edit and save to overwrite.", "success");
    document.getElementById("attendanceSheetHeader").scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    console.error("View log details failed:", err);
    window.showToast("Error parsing log file: " + err.message, "error");
  }
}

async function deleteAttendanceLog(id) {
  if (!confirm("⚠️ Are you sure you want to delete this attendance log book? This action is permanent.")) return;

  try {
    const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
    await deleteDoc(doc(db, "attendance", id));
    window.showToast("Attendance register log purged successfully.", "success");
    loadAttendanceHistory();
  } catch (err) {
    console.error("Delete attendance log error:", err);
    window.showToast("Failed to delete log: " + err.message, "error");
  }
}

// ==========================================
// SECTION F: SYLLABUS LEARNING MATERIALS
// ==========================================

let materialsInitialized = false;
async function renderLearningMaterialsTab() {
  if (!currentLecturerDoc) return;
  const assigned = currentLecturerDoc.coursesAssigned || [];
  
  const mSelect = document.getElementById("materialCourseSelect");
  const filterM = document.getElementById("filterMaterialCourse");
  
  if (mSelect) {
    mSelect.innerHTML = assigned.map(c => `<option value="${c}">${c}</option>`).join("");
    if (assigned.length === 0) {
      mSelect.innerHTML = `<option value="">No assigned courses</option>`;
    }
  }
  
  if (filterM) {
    const currentVal = filterM.value;
    filterM.innerHTML = `<option value="all">All Courses</option>` + 
      assigned.map(c => `<option value="${c}">${c}</option>`).join("");
    filterM.value = currentVal;
  }

  if (!materialsInitialized) {
    materialsInitialized = true;
    setupMaterialsListeners();
  }

  loadLearningMaterials();
}

function setupMaterialsListeners() {
  const form = document.getElementById("learningMaterialForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const materialId = document.getElementById("materialId").value;
      const courseCode = document.getElementById("materialCourseSelect").value;
      const title = document.getElementById("materialTitle").value.trim();
      const fileType = document.getElementById("materialFileType").value;
      const link = document.getElementById("materialLink").value.trim();

      if (!courseCode || !title || !link) {
        window.showToast("Please fill all resource fields.", "warning");
        return;
      }

      const btnSave = document.getElementById("btnSaveMaterial");
      if (btnSave) btnSave.disabled = true;
      window.showToast("Publishing learning asset...", "info");

      try {
        const payload = {
          courseCode,
          title,
          fileType,
          link,
          lecturerId: currentLecturerDoc.lecturerId,
          lecturerName: currentLecturerDoc.fullName,
          academicSession: timelineSettings.session,
          semester: timelineSettings.semester,
          updatedAt: new Date().toISOString()
        };

        const docRef = materialId ? doc(db, "learningMaterials", materialId) : doc(collection(db, "learningMaterials"));
        if (!materialId) {
          payload.createdAt = new Date().toISOString();
        }

        await setDoc(docRef, payload, { merge: true });
        window.showToast("Academic resource successfully published to Syllabus catalog.", "success");
        
        resetMaterialForm();
        loadLearningMaterials();

      } catch (err) {
        console.error("Save material error:", err);
        window.showToast("Save failed: " + err.message, "error");
      } finally {
        if (btnSave) btnSave.disabled = false;
      }
    });
  }

  document.getElementById("btnResetMaterialForm")?.addEventListener("click", () => resetMaterialForm());
  document.getElementById("filterMaterialCourse")?.addEventListener("change", () => loadLearningMaterials());
}

function resetMaterialForm() {
  const form = document.getElementById("learningMaterialForm");
  if (form) form.reset();
  document.getElementById("materialId").value = "";
  document.getElementById("materialFormTitle").innerHTML = `<i class="fa-solid fa-cloud-arrow-up" style="color: var(--accent);"></i> Publish Material`;
}

async function loadLearningMaterials() {
  const container = document.getElementById("materialsDisplayContainer");
  if (!container) return;

  container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Querying resource directories...</p>`;

  try {
    const courseFilter = document.getElementById("filterMaterialCourse")?.value || "all";
    let q = query(collection(db, "learningMaterials"), where("lecturerId", "==", currentLecturerDoc.lecturerId));
    const snap = await getDocs(q);
    let materials = [];
    snap.forEach(docSnap => materials.push({ id: docSnap.id, ...docSnap.data() }));

    if (courseFilter !== "all") {
      materials = materials.filter(m => m.courseCode === courseFilter);
    }

    if (materials.length === 0) {
      container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 3rem;"><i class="fa-solid fa-folder-open" style="font-size: 2.5rem; opacity: 0.2; display: block; margin-bottom: 0.5rem;"></i> No syllabus assets have been registered for this filter category.</p>`;
      return;
    }

    materials.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    container.innerHTML = materials.map(m => {
      let icon = "fa-file-pdf";
      let color = "#DC3545"; // pdf red
      if (m.fileType === "PPTX") { icon = "fa-file-powerpoint"; color = "#FD7E14"; } // ppt orange
      if (m.fileType === "DOCX") { icon = "fa-file-word"; color = "#007BFF"; } // word blue
      if (m.fileType === "LINK") { icon = "fa-link"; color = "#17A2B8"; } // link cyan

      return `
        <div style="background-color: var(--bg-slate); border: 1.5px solid var(--border-color); border-radius: 6px; padding: 1.25rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; transition: transform 0.2s; cursor: default;">
          <div style="display: flex; align-items: center; gap: 1.15rem; min-width: 0;">
            <div style="width: 48px; height: 48px; border-radius: 6px; background-color: var(--bg-white); border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; color: ${color}; font-size: 1.5rem; flex-shrink: 0;">
              <i class="fa-solid ${icon}"></i>
            </div>
            <div style="min-width: 0;">
              <div style="font-weight: 800; color: var(--primary); font-size: 0.95rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(m.title)}</div>
              <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600; display: flex; align-items: center; gap: 0.75rem; margin-top: 0.15rem;">
                <span><i class="fa-solid fa-graduation-cap"></i> ${m.courseCode}</span>
                <span>•</span>
                <span><i class="fa-solid fa-tags"></i> ${m.fileType}</span>
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 0.4rem; flex-shrink: 0;">
            <a href="${m.link}" target="_blank" class="btn" style="background-color: #28A745; color: white; border: none; padding: 0.45rem 0.85rem; border-radius: 4px; font-weight: 700; font-size: 0.75rem; text-decoration: none; display: inline-flex; align-items: center; gap: 0.35rem; font-family: 'Poppins';"><i class="fa-solid fa-download"></i> View</a>
            <button class="btn btn-edit-material" data-id="${m.id}" style="background-color: var(--primary); color: white; border: none; padding: 0.45rem; width: 32px; height: 32px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-delete-material" data-id="${m.id}" style="background-color: #DC3545; color: white; border: none; padding: 0.45rem; width: 32px; height: 32px; border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      `;
    }).join("");

    // Bind edit/delete actions
    container.querySelectorAll(".btn-edit-material").forEach(btn => {
      btn.addEventListener("click", () => {
        const matId = btn.getAttribute("data-id");
        const m = materials.find(x => x.id === matId);
        if (m) {
          document.getElementById("materialId").value = m.id;
          document.getElementById("materialCourseSelect").value = m.courseCode;
          document.getElementById("materialTitle").value = m.title;
          document.getElementById("materialFileType").value = m.fileType;
          document.getElementById("materialLink").value = m.link;
          document.getElementById("materialFormTitle").innerHTML = `<i class="fa-solid fa-pen-to-square" style="color: var(--accent);"></i> Edit Resource`;
          document.getElementById("materialFormTitle").scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });

    container.querySelectorAll(".btn-delete-material").forEach(btn => {
      btn.addEventListener("click", async () => {
        const matId = btn.getAttribute("data-id");
        if (!confirm("⚠️ Are you sure you want to delete this resource asset?")) return;
        try {
          const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
          await deleteDoc(doc(db, "learningMaterials", matId));
          window.showToast("Resource asset purged successfully.", "success");
          loadLearningMaterials();
        } catch (err) {
          window.showToast("Failed to delete resource: " + err.message, "error");
        }
      });
    });

  } catch (err) {
    console.error("Load learning materials failed:", err);
    container.innerHTML = `<p style="text-align: center; color: red;">Query failed: ${err.message}</p>`;
  }
}

// ==========================================
// SECTION G: WEEKLY LECTURE TIMETABLE
// ==========================================

let timetableInitialized = false;
async function renderTimetableTab() {
  if (!currentLecturerDoc) return;

  if (!timetableInitialized) {
    timetableInitialized = true;
    document.getElementById("btnRefreshTimetable")?.addEventListener("click", () => renderTimetableTab());
  }

  const tbody = document.getElementById("timetableGridBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Compiling weekly grid coordinates...</td></tr>`;

  try {
    const assigned = currentLecturerDoc.coursesAssigned || [];
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const sessions = ["Morning", "Midday", "Evening"];

    // Fetch timetable database records
    const qSnap = await getDocs(query(collection(db, "timetables"), where("lecturerId", "==", currentLecturerDoc.lecturerId)));
    const records = [];
    qSnap.forEach(snap => records.push(snap.data()));

    // Seeding fallback: If database is empty, generate gorgeous logical slots for assigned courses!
    if (records.length === 0 && assigned.length > 0) {
      assigned.forEach((course, index) => {
        const dayIdx = (index + 1) % days.length; 
        const sesIdx = index % sessions.length;
        const rooms = ["Theology Lecture Hall A", "Syllabus Room 3", "Faculty Complex Seminar C", "Divine Chapel Hall B"];
        records.push({
          lecturerId: currentLecturerDoc.lecturerId,
          courseCode: course,
          day: days[dayIdx],
          session: sessions[sesIdx],
          room: rooms[index % rooms.length]
        });
      });
    }

    // Generate Grid HTML rows
    tbody.innerHTML = days.map(day => {
      const cellHtml = sessions.map(ses => {
        const slot = records.find(r => r.day === day && r.session === ses);
        if (slot) {
          return `
            <td style="padding: 1.15rem; border: 1px solid var(--border-color); background-color: rgba(31,59,130,0.04); text-align: center; font-size: 0.88rem; vertical-align: middle;">
              <strong style="color: var(--primary); display: block; font-size: 0.95rem; margin-bottom: 0.25rem;"><i class="fa-solid fa-bible"></i> ${slot.courseCode}</strong>
              <div style="font-size: 0.75rem; color: var(--accent); font-weight: 700; margin-bottom: 0.15rem;"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(slot.room)}</div>
              <span class="status-badge cleared" style="font-size: 0.65rem; padding: 0.1rem 0.4rem; font-weight: 800;">ACTIVE SESSION</span>
            </td>
          `;
        } else {
          return `
            <td style="padding: 1.15rem; border: 1px solid var(--border-color); background-color: var(--bg-white); text-align: center; font-size: 0.8rem; color: var(--text-muted); vertical-align: middle;">
              <span style="opacity: 0.4;">— Empty Block —</span>
            </td>
          `;
        }
      }).join("");

      return `
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 1rem; border: 1px solid var(--border-color); background-color: var(--bg-slate); font-weight: 800; color: var(--primary); font-size: 0.95rem; vertical-align: middle;">
            <i class="fa-solid fa-calendar-day"></i> ${day}
          </td>
          ${cellHtml}
        </tr>
      `;
    }).join("");

  } catch (err) {
    console.error("Timetable grid load error:", err);
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red;">Failed to retrieve weekly timetable: ${err.message}</td></tr>`;
  }
}

// ==========================================
// SECTION H: PERFORMANCE ANALYTICS LOGIC
// ==========================================

let analyticsInitialized = false;
async function renderPerformanceAnalyticsTab() {
  if (!currentLecturerDoc) return;
  const assigned = currentLecturerDoc.coursesAssigned || [];
  
  const select = document.getElementById("analyticsCourseSelect");
  if (select) {
    const currentVal = select.value;
    select.innerHTML = `<option value="">-- Choose Course --</option>` + 
      assigned.map(c => `<option value="${c}">${c}</option>`).join("");
    select.value = currentVal;
  }

  if (!analyticsInitialized) {
    analyticsInitialized = true;
    document.getElementById("analyticsCourseSelect")?.addEventListener("change", (e) => loadCoursePerformanceAnalytics(e.target.value));
  }

  loadOverallPerformanceSummary(assigned);

  if (select && select.value) {
    loadCoursePerformanceAnalytics(select.value);
  } else {
    document.getElementById("analyticsVisualizerBody").style.display = "none";
    document.getElementById("analyticsNoDataMessage").style.display = "block";
  }
}

async function loadOverallPerformanceSummary(assigned) {
  if (assigned.length === 0) return;
  
  try {
    let totalScoreSum = 0;
    let gradedCount = 0;
    let passCount = 0;
    
    const qSnap = await getDocs(query(collection(db, "results"), where("uploadedBy", "==", currentLecturerDoc.lecturerId)));
    
    qSnap.forEach(snap => {
      const data = snap.data();
      const score = data.score || 0;
      totalScoreSum += score;
      gradedCount++;
      if (score >= 40) passCount++;
    });

    if (gradedCount > 0) {
      const avgScore = Math.round(totalScoreSum / gradedCount);
      let overallGrade = "F";
      if (avgScore >= 70) overallGrade = "A";
      else if (avgScore >= 60) overallGrade = "B";
      else if (avgScore >= 50) overallGrade = "C";
      else if (avgScore >= 40) overallGrade = "D";

      const successRate = Math.round((passCount / gradedCount) * 100);

      document.getElementById("analyticsAvgGrade").textContent = overallGrade;
      document.getElementById("analyticsPassRate").textContent = `${successRate}%`;
      document.getElementById("analyticsTopCourse").textContent = assigned[0];
    } else {
      document.getElementById("analyticsAvgGrade").textContent = "-";
      document.getElementById("analyticsPassRate").textContent = "0%";
      document.getElementById("analyticsTopCourse").textContent = "-";
    }

  } catch (err) {
    console.error("Overall metrics compute failed:", err);
  }
}

async function loadCoursePerformanceAnalytics(courseCode) {
  const visualBody = document.getElementById("analyticsVisualizerBody");
  const noDataMsg = document.getElementById("analyticsNoDataMessage");
  
  if (!courseCode) {
    if (visualBody) visualBody.style.display = "none";
    if (noDataMsg) noDataMsg.style.display = "block";
    return;
  }

  try {
    const qSnap = await getDocs(query(collection(db, "results"), where("courseCode", "==", courseCode), where("academicSession", "==", timelineSettings.session)));
    const grades = [];
    let scoreSum = 0;

    qSnap.forEach(snap => {
      const d = snap.data();
      grades.push(d.grade || "F");
      scoreSum += (d.score || 0);
    });

    if (grades.length === 0) {
      if (visualBody) visualBody.style.display = "none";
      if (noDataMsg) {
        noDataMsg.innerHTML = `<i class="fa-solid fa-chart-pie" style="font-size: 3rem; opacity: 0.2; margin-bottom: 1rem; display: block;"></i> No uploaded student results were discovered for course ${courseCode} in academic session ${timelineSettings.session}.`;
        noDataMsg.style.display = "block";
      }
      return;
    }

    if (noDataMsg) noDataMsg.style.display = "none";
    if (visualBody) visualBody.style.display = "block";

    const total = grades.length;
    const countA = grades.filter(g => g === "A").length;
    const countB = grades.filter(g => g === "B").length;
    const countC = grades.filter(g => g === "C").length;
    const countD = grades.filter(g => g === "D").length;
    const countF = grades.filter(g => g === "F").length;

    const percentA = Math.round((countA / total) * 100);
    const percentB = Math.round((countB / total) * 100);
    const percentC = Math.round((countC / total) * 100);
    const percentD = Math.round((countD / total) * 100);
    const percentF = Math.round((countF / total) * 100);

    const averageScore = (scoreSum / total).toFixed(2);

    document.getElementById("labelPercentA").textContent = `${countA} Students (${percentA}%)`;
    document.getElementById("labelPercentB").textContent = `${countB} Students (${percentB}%)`;
    document.getElementById("labelPercentC").textContent = `${countC} Students (${percentC}%)`;
    document.getElementById("labelPercentD").textContent = `${countD} Students (${percentD}%)`;
    document.getElementById("labelPercentF").textContent = `${countF} Students (${percentF}%)`;

    document.getElementById("analyticsTotalGradedCount").textContent = total;
    document.getElementById("analyticsAverageCourseScore").textContent = `${averageScore}%`;

    document.getElementById("barPercentA").style.width = `${percentA}%`;
    document.getElementById("barPercentB").style.width = `${percentB}%`;
    document.getElementById("barPercentC").style.width = `${percentC}%`;
    document.getElementById("barPercentD").style.width = `${percentD}%`;
    document.getElementById("barPercentF").style.width = `${percentF}%`;

  } catch (err) {
    console.error("Course analytics loading error:", err);
    window.showToast("Failed to compute visual distribution metrics.", "error");
  }
}

// Global hooks to prevent any reference errors
window.renderAttendanceTab = renderAttendanceTab;
window.renderLearningMaterialsTab = renderLearningMaterialsTab;
window.renderTimetableTab = renderTimetableTab;
window.renderPerformanceAnalyticsTab = renderPerformanceAnalyticsTab;

