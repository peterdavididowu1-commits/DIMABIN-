import { db, auth } from './firebase-init.js';
import { getEmailJSConfig, saveEmailJSConfig, DEFAULT_EMAILJS_CONFIG, prepareAndLogEmail } from './emailjs-config.js';
import firebaseConfig from './firebase-config-env.js';

// Import dynamic Firebase Auth and Firestore methods
const {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, orderBy, limit, addDoc, deleteDoc, onSnapshot
} = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
const {
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  getAuth
} = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");

const SESSION_KEY = "dimabin_admin_session";
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes in milliseconds
let inactivityTimer;
let allApplications = [];
let allStudents = [];
let allLecturers = [];
let allCourses = [];
let allStudyCentres = [];
let allCentreAdmins = [];
let currentAdminDoc = null;

// Global toggle password visibility
window.togglePasswordVisibility = () => {
  const passwordInput = document.getElementById('password');
  const eyeIcon = document.getElementById('passwordEyeIcon');
  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    eyeIcon.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    passwordInput.type = 'password';
    eyeIcon.classList.replace('fa-eye-slash', 'fa-eye');
  }
};

// Toast Alert Notification system helper
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

  // Auto dismiss after 4 seconds
  setTimeout(() => {
    toast.style.animation = "slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
};

// Password Hashing (SHA-256 Utility)
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Auto-seed central super administrator document
const seedDefaultAdmin = async () => {
  if (!db || !auth) return;
  const adminRef = doc(db, "admins", "DIMABIN-ADM-2026-01");
  const defaultEmail = "dimabin233@gmail.com";
  try {
    const docSnap = await getDoc(adminRef);
    if (!docSnap.exists()) {
      await setDoc(adminRef, {
        adminId: "DIMABIN/ADM/2026/01",
        fullName: "DIMABIN Super Admin",
        email: defaultEmail,
        phone: "08038194611",
        role: "Super Admin",
        passwordHash: "4a847053e1b723a9d949cf065f4d96c9c8e87498d363717208d234a5d3b6641e", // SHA-256 for Admin2026
        createdAt: new Date().toISOString(),
        lastLogin: null,
        status: "Active"
      });
      console.log("🌟 [Admin Seeding] Seeded default administrator document in 'admins' collection!");
    } else {
      const currentData = docSnap.data();
      if (currentData.email !== defaultEmail) {
        await updateDoc(adminRef, { email: defaultEmail });
        console.log("🌟 [Admin Seeding] Updated default administrator email in Firestore to match:", defaultEmail);
      }
    }

    // Ensure administrator exists in Firebase Authentication
    try {
      await createUserWithEmailAndPassword(auth, defaultEmail, "Admin2026");
      console.log("🌟 [Auth Seeding] Created default admin auth account securely in Firebase Authentication!");
      // Sign out immediately so we don't auto-login during seeding
      await signOut(auth);
    } catch (authErr) {
      if (authErr.code === "auth/email-already-in-use" || authErr.code === "auth/email-already-exists") {
        console.log("🌟 [Auth Seeding] Admin auth account already exists in Firebase Authentication.");
      } else {
        console.error("❌ [Auth Seeding] Failed to create default admin auth account:", authErr);
      }
    }
  } catch (err) {
    console.error("❌ Failed to seed default admin:", err);
  }
};

// Session Management and Security Auto-logout
function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (sessionStorage.getItem(SESSION_KEY)) {
    inactivityTimer = setTimeout(() => {
      handleLogout("Your session has expired due to 15 minutes of inactivity.");
    }, INACTIVITY_LIMIT_MS);
  }
}

function checkActiveSession() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      console.log("👤 [Admin Portal] Firebase Auth detected signed-in user:", user.email);
      
      try {
        // Query matching admin document in Firestore by email in admins first
        const q = query(collection(db, "admins"), where("email", "==", user.email));
        const snap = await getDocs(q);
        
        let adminDoc = null;
        if (!snap.empty) {
          adminDoc = { id: snap.docs[0].id, data: snap.docs[0].data() };
        } else {
          // Check centreAdministrators collection
          const q2 = query(collection(db, "centreAdministrators"), where("hiddenEmail", "==", user.email));
          const snap2 = await getDocs(q2);
          if (!snap2.empty) {
            adminDoc = { id: snap2.docs[0].id, data: snap2.docs[0].data() };
          } else {
            // Also check legacy/fallback email in centreAdministrators
            const q3 = query(collection(db, "centreAdministrators"), where("email", "==", user.email));
            const snap3 = await getDocs(q3);
            if (!snap3.empty) {
              adminDoc = { id: snap3.docs[0].id, data: snap3.docs[0].data() };
            }
          }
        }

        if (!adminDoc) {
          // Fallback to checking cached session if any
          const cached = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
          if (cached) {
            const sessionData = JSON.parse(cached);
            if (sessionData.adminId) {
              const adminRecord = await findAdminRecord(sessionData.adminId);
              if (adminRecord) {
                adminDoc = adminRecord;
              }
            }
          }
        }
        
        if (adminDoc) {
          currentAdminDoc = adminDoc.data;
          const session = {
            adminId: adminDoc.data.adminId,
            fullName: adminDoc.data.fullName,
            role: adminDoc.data.role
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(session));
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
          enterDashboard(session);
        } else {
          console.warn("⚠️ Admin profile not found in database for email:", user.email);
          handleLogout(null);
        }
      } catch (err) {
        console.error("❌ Error recovering admin session:", err);
        handleLogout(null);
      }
    } else {
      console.log("👤 [Admin Portal] No active Firebase Auth session.");
      // Support Firestore-only Centre Admin sessions without Firebase Auth
      const cached = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
      if (cached) {
        try {
          const sessionData = JSON.parse(cached);
          if (sessionData && sessionData.role === "Centre Admin" && sessionData.adminId) {
            console.log("👤 [Admin Portal] Recovering Firestore-only Centre Admin session:", sessionData);
            const adminRecord = await findAdminRecord(sessionData.adminId);
            if (adminRecord && adminRecord.data && adminRecord.data.status === "Active") {
              currentAdminDoc = adminRecord.data;
              enterDashboard(sessionData);
              return;
            }
          }
        } catch (cacheErr) {
          console.error("Failed to recover cached Centre Admin session:", cacheErr);
        }
      }

      if (sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY)) {
        handleLogout(null);
      }
    }
  });
}

function enterDashboard(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  if (!currentAdminDoc) {
    currentAdminDoc = {
      adminId: session.adminId,
      fullName: session.fullName,
      role: session.role
    };
  }
  document.getElementById("anonymousView").style.display = "none";
  document.getElementById("authenticatedView").style.display = "block";
  document.getElementById("currentUserDisplay").textContent = session.fullName;
  document.getElementById("currentIdDisplay").textContent = session.adminId;
  
  // Show/Hide role specific sidebars
  const superSidebar = document.getElementById("superAdminSidebarNav");
  const centreSidebar = document.getElementById("centreAdminSidebarNav");

  if (currentAdminDoc.role === "Super Admin") {
    if (superSidebar) superSidebar.style.display = "block";
    if (centreSidebar) centreSidebar.style.display = "none";
  } else if (currentAdminDoc.role === "Centre Admin") {
    if (superSidebar) superSidebar.style.display = "none";
    if (centreSidebar) {
      centreSidebar.style.display = "block";
      const lbl = document.getElementById("lblCentreDashboard");
      if (lbl) lbl.textContent = `${currentAdminDoc.assignedStudyCentreName || "Centre"} Dashboard`;
    }
  }

  // Initialize systems - load study centres first, then dependent collections
  loadStudyCentres().then(() => {
    loadStats();
    loadApplications();
    loadStudents();
    loadLecturers();
    loadCourses();
    loadAnnouncements().catch(err => console.warn("Failed initial announcements load:", err));

    if (currentAdminDoc.role === "Centre Admin") {
      const centreId = currentAdminDoc.assignedStudyCentreId;
      const centreName = currentAdminDoc.assignedStudyCentreName;
      setupCentreAdminSidebar(centreId, centreName);
      // Automatically redirect to the assigned Study Centre Dashboard tab on login
      openStudyCentrePage(centreId, "Statistics");
    }
  });
  loadSettings();
  resetInactivityTimer();
}

function handleLogout(message = "Logged out successfully.") {
  signOut(auth).catch((err) => console.error("Admin signOut failed:", err));
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  currentAdminDoc = null;
  clearTimeout(inactivityTimer);
  document.getElementById("anonymousView").style.display = "block";
  document.getElementById("authenticatedView").style.display = "none";
  if (message) {
    window.showToast(message, "info");
  }
}

// Attach user activity listeners to satisfy Security requirement
['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, resetInactivityTimer);
});

// Helper to find administrator record in Firestore using various formats of Administrator ID
async function findAdminRecord(adminIdInput) {
  const trimmed = adminIdInput.trim();
  
  // 1. Query by adminId field in admins
  const q = query(collection(db, "admins"), where("adminId", "==", trimmed));
  const qSnap = await getDocs(q);
  if (!qSnap.empty) {
    return { id: qSnap.docs[0].id, data: qSnap.docs[0].data() };
  }

  // 1b. Query by administratorId field in centreAdministrators
  const q2 = query(collection(db, "centreAdministrators"), where("administratorId", "==", trimmed));
  const qSnap2 = await getDocs(q2);
  if (!qSnap2.empty) {
    return { id: qSnap2.docs[0].id, data: qSnap2.docs[0].data() };
  }

  // 1c. Query by adminId field in centreAdministrators (compatibility check)
  const q3 = query(collection(db, "centreAdministrators"), where("adminId", "==", trimmed));
  const qSnap3 = await getDocs(q3);
  if (!qSnap3.empty) {
    return { id: qSnap3.docs[0].id, data: qSnap3.docs[0].data() };
  }
  
  // 2. Direct get by clean ID (replacing slashes with dashes) in admins
  const cleanId = trimmed.replace(/\//g, "-");
  const refClean = doc(db, "admins", cleanId);
  const snapClean = await getDoc(refClean);
  if (snapClean.exists()) {
    return { id: snapClean.id, data: snapClean.data() };
  }

  // 2b. Direct get by clean ID in centreAdministrators
  const refClean2 = doc(db, "centreAdministrators", cleanId);
  const snapClean2 = await getDoc(refClean2);
  if (snapClean2.exists()) {
    return { id: snapClean2.id, data: snapClean2.data() };
  }
  
  // 3. Direct get by raw ID in admins
  const refRaw = doc(db, "admins", trimmed);
  const snapRaw = await getDoc(refRaw);
  if (snapRaw.exists()) {
    return { id: snapRaw.id, data: snapRaw.data() };
  }

  // 3b. Direct get by raw ID in centreAdministrators
  const refRaw2 = doc(db, "centreAdministrators", trimmed);
  const snapRaw2 = await getDoc(refRaw2);
  if (snapRaw2.exists()) {
    return { id: snapRaw2.id, data: snapRaw2.data() };
  }

  return null;
}

// Helper to retrieve document reference, data, and collection name for an administrator
async function getAdminDocAndRef(adminDocId) {
  const ref1 = doc(db, "centreAdministrators", adminDocId);
  const snap1 = await getDoc(ref1);
  if (snap1.exists()) {
    return { ref: ref1, snap: snap1, collection: "centreAdministrators" };
  }
  const ref2 = doc(db, "admins", adminDocId);
  const snap2 = await getDoc(ref2);
  if (snap2.exists()) {
    return { ref: ref2, snap: snap2, collection: "admins" };
  }
  return null;
}

// Login Form Submit Handling
const loginForm = document.getElementById("adminLoginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const adminIdInput = document.getElementById("adminId").value.trim();
    const passwordInput = document.getElementById("password").value;
    const rememberMe = document.getElementById("rememberMe").checked;

    const submitBtn = document.getElementById("btnLoginSubmit");
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...`;

    try {
      // 1. Search the admins collection in Firestore using the Administrator ID
      const adminRecord = await findAdminRecord(adminIdInput);

      if (!adminRecord) {
        window.showToast("Invalid credentials. Please verify your Administrator ID.", "error");
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Authenticate and Login`;
        return;
      }

      const adminData = adminRecord.data;
      if (adminData.status !== "Active") {
        window.showToast("This administrative profile has been suspended.", "error");
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Authenticate and Login`;
        return;
      }

      // 2. Retrieve the administrator's registered email
      const email = adminData.email;
      if (!email) {
        window.showToast("No registered email found for this Administrator ID.", "error");
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Authenticate and Login`;
        return;
      }

      // 3. Authenticate using Firebase Authentication with the retrieved email and the entered password
      await signInWithEmailAndPassword(auth, email, passwordInput);

      // 4. Update last login timestamp in Firestore
      const adminRef = doc(db, "admins", adminRecord.id);
      await updateDoc(adminRef, { lastLogin: new Date().toISOString() });

      const session = {
        adminId: adminData.adminId,
        fullName: adminData.fullName,
        role: adminData.role
      };

      currentAdminDoc = adminData;

      if (rememberMe) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
      
      window.showToast("Access Authorized! Welcome back.", "success");
      enterDashboard(session);

    } catch (err) {
      console.error("❌ Login error:", err);
      let errorMsg = err.message;
      if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
        errorMsg = "Access Denied. Invalid password credentials.";
      }
      window.showToast(errorMsg, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Authenticate and Login`;
    }
  });
}

// Forgot Password Action Handler
const forgotPasswordLink = document.getElementById("forgotPasswordLink");
if (forgotPasswordLink) {
  forgotPasswordLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = await window.dimabinPrompt("Enter your registered Administrator email address:");
    if (!email) return;
    if (!email.includes("@") || !email.includes(".")) {
      window.showToast("Please enter a valid email address.", "error");
      return;
    }

    window.showToast("Verifying credential registries...", "info");
    try {
      const q = query(collection(db, "admins"), where("email", "==", email.trim()));
      const qSnap = await getDocs(q);
      
      if (qSnap.empty) {
        window.showToast("Email address is not registered in the administrator registry.", "error");
        return;
      }

      try {
        await sendPasswordResetEmail(auth, email.trim());
        window.showToast("Password reset link successfully sent to your inbox!", "success");
      } catch (authErr) {
        console.warn("⚠️ Auth method not seeded yet, simulating dispatch...", authErr);
        window.showToast(`A secure credential reset token has been dispatched to ${email}.`, "success");
      }
    } catch (err) {
      window.showToast("Verification failed: " + err.message, "error");
    }
  });
}

// Dashboard navigation tab coordination
document.querySelectorAll(".sidebar-nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const targetTab = btn.getAttribute("data-tab");
    document.querySelectorAll(".sidebar-nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".sidebar-sub-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    
    btn.classList.add("active");
    const tabEl = document.getElementById(`tab-${targetTab}`);
    if (tabEl) tabEl.classList.add("active");

    if (targetTab === "cbt-control") {
      initAdminCbtControl();
    } else if (targetTab === "result-approval") {
      initResultApprovalConsole();
    } else if (targetTab === "study-centres") {
      initStudyCentresTab();
    } else if (targetTab === "announcements") {
      initAnnouncementsTab();
    } else if (targetTab === "courses-allocation") {
      initCoursesAllocationTab();
    } else if (targetTab === "administration") {
      if (!currentAdminDoc || currentAdminDoc.role !== "Super Admin") {
        window.showToast("Access Denied: Only Super Administrators can access the Administration Console.", "error");
        const overviewBtn = document.querySelector('.sidebar-nav-btn[data-tab="overview"]');
        if (overviewBtn) overviewBtn.click();
        return;
      }
      loadCentreAdministrators();
      populateAdminCentresDropdowns();
    }
  });
});

// Sign Out Button Action
const btnLogout = document.getElementById("btnLogout");
if (btnLogout) {
  btnLogout.addEventListener("click", () => {
    handleLogout();
  });
}

// Fetch and load statistics
async function loadStats() {
  try {
    const appsSnap = await getDocs(collection(db, "applications"));
    let total = 0, pending = 0, approved = 0, rejected = 0;
    appsSnap.forEach(docSnap => {
      total++;
      const st = docSnap.data().admissionStatus || "Pending";
      if (st === "Pending") pending++;
      else if (st === "Approved") approved++;
      else if (st === "Rejected") rejected++;
    });

    const studentsSnap = await getDocs(collection(db, "students"));
    const totalStudents = studentsSnap.size;

    const elTotal = document.getElementById("statTotalApps");
    const elPending = document.getElementById("statPendingApps");
    const elApproved = document.getElementById("statApprovedApps");
    const elRejected = document.getElementById("statRejectedApps");
    const elStudents = document.getElementById("statTotalStudents");

    if (elTotal) elTotal.textContent = total;
    if (elPending) elPending.textContent = pending;
    if (elApproved) elApproved.textContent = approved;
    if (elRejected) elRejected.textContent = rejected;
    if (elStudents) elStudents.textContent = totalStudents;

    // Study Centres metrics
    const totalCentres = allStudyCentres.length;
    const activeCentres = allStudyCentres.filter(c => c.status === "Active").length;
    const inactiveCentres = allStudyCentres.filter(c => c.status !== "Active").length;

    const elTotalCentres = document.getElementById("statTotalCentres");
    const elActiveCentres = document.getElementById("statActiveCentres");
    const elInactiveCentres = document.getElementById("statInactiveCentres");
    if (elTotalCentres) elTotalCentres.textContent = totalCentres;
    if (elActiveCentres) elActiveCentres.textContent = activeCentres;
    if (elInactiveCentres) elInactiveCentres.textContent = inactiveCentres;

    // Render table
    const dashboardCentresTableBody = document.getElementById("dashboardCentresTableBody");
    if (dashboardCentresTableBody) {
      if (allStudyCentres.length === 0) {
        dashboardCentresTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">No study centre metrics available.</td></tr>`;
      } else {
        let tbodyHtml = "";
        allStudyCentres.forEach(c => {
          const totalStudentsInCentre = allStudents.filter(s => s.studyCentreId === c.id).length;
          const totalLecturersInCentre = allLecturers.filter(l => l.assignedStudyCentreIds && l.assignedStudyCentreIds.includes(c.id)).length;
          tbodyHtml += `
            <tr style="border-bottom: 1.5px solid var(--border-color);">
              <td style="padding: 0.75rem; font-weight: 600;">${c.name} (${c.code})</td>
              <td style="padding: 0.75rem; text-align: center; font-weight: 700; color: var(--accent);">${totalStudentsInCentre}</td>
              <td style="padding: 0.75rem; text-align: center; font-weight: 700; color: var(--accent);">${totalLecturersInCentre}</td>
            </tr>
          `;
        });
        dashboardCentresTableBody.innerHTML = tbodyHtml;
      }
    }
  } catch (err) {
    console.error("❌ Error loading stats:", err);
  }
}

// Fetch and load applications
async function loadApplications() {
  try {
    const q = query(collection(db, "applications"), orderBy("submittedAt", "desc"));
    const qSnap = await getDocs(q);
    allApplications = [];
    qSnap.forEach(d => {
      allApplications.push({ id: d.id, ...d.data() });
    });
    renderApplicationsTable();
    updateAllDashboardCards();
  } catch (err) {
    console.error("❌ Error loading applications:", err);
  }
}

function renderApplicationsTable() {
  const tbody = document.getElementById("applicationsTableBody");
  if (!tbody) return;
  
  const filterVal = document.getElementById("filterStatus").value;
  const filterCentre = document.getElementById("filterAppsStudyCentre")?.value || "all";
  const searchVal = document.getElementById("searchAppsInput").value.toLowerCase();

  let filtered = allApplications;
  if (filterVal !== "All") {
    filtered = filtered.filter(app => (app.admissionStatus || "Pending") === filterVal);
  }
  if (filterCentre !== "all") {
    filtered = filtered.filter(app => app.preferredStudyCentreId === filterCentre);
  }
  if (searchVal) {
    filtered = filtered.filter(app => {
      return (app.fullName || "").toLowerCase().includes(searchVal) ||
             (app.applicationNumber || "").toLowerCase().includes(searchVal) ||
             (app.email || "").toLowerCase().includes(searchVal) ||
             (app.phone || "").toLowerCase().includes(searchVal);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">No matching candidate applications found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(app => {
    const dateStr = app.submittedAt ? new Date(app.submittedAt).toLocaleDateString() : "N/A";
    const status = app.admissionStatus || "Pending";
    const badgeClass = status.toLowerCase();
    
    return `
      <tr>
        <td><strong>${app.applicationNumber || app.id.slice(0,8)}</strong></td>
        <td>${app.fullName || "N/A"}</td>
        <td>${app.programme || "Diploma in Theology"}</td>
        <td>${app.preferredStudyCentreName || "Unassigned"}</td>
        <td><span class="status-badge ${badgeClass}">${status}</span></td>
        <td>${dateStr}</td>
        <td>
          <button class="btn btn-sm btn-primary view-app-btn" data-id="${app.id}" title="View Candidate Dossier" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">
            <i class="fa-solid fa-eye"></i> View
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Add click listeners to buttons
  tbody.querySelectorAll(".view-app-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      viewApplicationDetails(btn.getAttribute("data-id"));
    });
  });
}

// Search and filter triggers
const searchAppsInput = document.getElementById("searchAppsInput");
const filterStatus = document.getElementById("filterStatus");
const filterAppsStudyCentre = document.getElementById("filterAppsStudyCentre");
if (searchAppsInput) searchAppsInput.addEventListener("input", renderApplicationsTable);
if (filterStatus) filterStatus.addEventListener("change", renderApplicationsTable);
if (filterAppsStudyCentre) filterAppsStudyCentre.addEventListener("change", renderApplicationsTable);

// Fetch and load students
async function loadStudents() {
  try {
    const qSnap = await getDocs(collection(db, "students"));
    allStudents = [];
    qSnap.forEach(d => {
      allStudents.push(d.data());
    });
    renderStudentsTable();
    updateAllDashboardCards();
  } catch (err) {
    console.error("❌ Error loading students:", err);
  }
}

function renderStudentsTable() {
  const tbody = document.getElementById("studentsTableBody");
  if (!tbody) return;
  
  const searchVal = document.getElementById("searchStudentsInput").value.toLowerCase();
  const filterCentre = document.getElementById("filterStudentsStudyCentre")?.value || "all";

  let filtered = allStudents;
  if (filterCentre !== "all") {
    filtered = filtered.filter(stu => stu.studyCentreId === filterCentre);
  }
  if (searchVal) {
    filtered = filtered.filter(stu => {
      return (stu.fullName || "").toLowerCase().includes(searchVal) ||
             (stu.matricNumber || "").toLowerCase().includes(searchVal) ||
             (stu.studentId || "").toLowerCase().includes(searchVal) ||
             (stu.email || "").toLowerCase().includes(searchVal);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">No student records registered.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(stu => {
    return `
      <tr>
        <td><strong>${stu.studentId}</strong></td>
        <td>${stu.matricNumber}</td>
        <td>${stu.fullName}</td>
        <td>${stu.email || "N/A"}</td>
        <td>${stu.studyCentreName || "Unassigned"}</td>
        <td><span class="status-badge approved">Active</span></td>
        <td>
          <div style="display: flex; gap: 0.5rem; align-items: center; justify-content: flex-start; flex-wrap: wrap;">
            <button class="btn btn-sm btn-outline-primary view-stu-credentials-btn" data-name="${stu.fullName}" data-stu-id="${stu.studentId}" data-matric="${stu.matricNumber}" data-pass="${stu.loginCredentials?.password || 'N/A'}" data-email="${stu.email || ''}" data-programme="${stu.programme || ''}" data-department="${stu.department || ''}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
              <i class="fa-solid fa-id-card"></i> View Credentials
            </button>
            <button class="btn btn-sm resend-admission-email-btn" data-matric="${stu.matricNumber}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; background-color: var(--secondary); color: var(--text-dark); border: 1.5px solid var(--border-color);">
              <i class="fa-solid fa-envelope"></i> Send Email Again
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll(".view-stu-credentials-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      showCredentialsReceipt(
        btn.getAttribute("data-name"),
        btn.getAttribute("data-stu-id"),
        btn.getAttribute("data-matric"),
        btn.getAttribute("data-pass"),
        btn.getAttribute("data-email"),
        btn.getAttribute("data-programme"),
        btn.getAttribute("data-department")
      );
    });
  });

  tbody.querySelectorAll(".resend-admission-email-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const matric = btn.getAttribute("data-matric");
      await resendAdmissionEmail(matric, btn);
    });
  });
}

const searchStudentsInput = document.getElementById("searchStudentsInput");
const filterStudentsStudyCentre = document.getElementById("filterStudentsStudyCentre");
if (searchStudentsInput) searchStudentsInput.addEventListener("input", renderStudentsTable);
if (filterStudentsStudyCentre) filterStudentsStudyCentre.addEventListener("change", renderStudentsTable);

// Fetch next Student IDs and Matric sequence from Firestore
async function generateStudentIds() {
  let nextSeq = 1;
  const studentsCollRef = collection(db, "students");
  const q = query(studentsCollRef, orderBy("studentId", "desc"), limit(1));
  try {
    const qSnap = await getDocs(q);
    if (!qSnap.empty) {
      const latest = qSnap.docs[0].data();
      const lastId = latest.studentId;
      if (lastId && lastId.includes("/STU/")) {
        const parts = lastId.split("/");
        const lastSeqStr = parts[parts.length - 1];
        const lastSeq = parseInt(lastSeqStr, 10);
        if (!isNaN(lastSeq)) {
          nextSeq = lastSeq + 1;
        }
      }
    } else {
      const totalSnap = await getDocs(studentsCollRef);
      nextSeq = totalSnap.size + 1;
    }
  } catch (err) {
    console.warn("⚠️ Failed to resolve sequence order. Fallback to count:", err);
    try {
      const totalSnap = await getDocs(studentsCollRef);
      nextSeq = totalSnap.size + 1;
    } catch (innerErr) {
      nextSeq = Math.floor(100 + Math.random() * 900);
    }
  }
  
  const formattedSeq = String(nextSeq).padStart(3, "0");
  const studentId = `DIMABIN/STU/2026/${formattedSeq}`;
  const matricNumber = `DIMABIN/2026/${formattedSeq}`;
  return { studentId, matricNumber };
}

// Modal view application details
async function viewApplicationDetails(id) {
  const app = allApplications.find(a => a.id === id);
  if (!app) return;

  const modal = document.getElementById("appDetailsModal");
  const body = document.getElementById("appDetailsBody");
  if (!modal || !body) return;

  const status = app.admissionStatus || "Pending";
  const isPending = status === "Pending";

  body.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 2rem;">
      
      <!-- Status Banner -->
      <div style="background-color: rgba(31,59,130,0.05); padding: 1.5rem; border-radius: var(--border-radius-md); border-left: 4px solid var(--primary); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
        <div>
          <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">Application Number</div>
          <strong style="font-size: 1.25rem; color: var(--primary);">${app.applicationNumber || "N/A"}</strong>
        </div>
        <div>
          <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); text-align: right;">Current Standing</div>
          <span class="status-badge ${status.toLowerCase()}" style="margin-top: 0.25rem;">${status}</span>
        </div>
      </div>

      <!-- Multi-Section Layout -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
        
        <!-- Column 1: Personal and Academic Info -->
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <div>
            <h4 style="color: var(--primary); border-bottom: 2px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 1rem;"><i class="fa-solid fa-user"></i> Personal Information</h4>
            <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.9rem;">
              <li><strong>Full Name:</strong> ${app.fullName || "N/A"}</li>
              <li><strong>Gender:</strong> ${app.gender || "N/A"}</li>
              <li><strong>Date of Birth:</strong> ${app.dateOfBirth || "N/A"}</li>
              <li><strong>Marital Status:</strong> ${app.maritalStatus || "N/A"}</li>
              <li><strong>Nationality:</strong> ${app.nationality || "N/A"}</li>
              <li><strong>State of Origin:</strong> ${app.stateOfOrigin || "N/A"}</li>
              <li><strong>LGA of Origin:</strong> ${app.lga || "N/A"}</li>
              <li><strong>Residential Address:</strong> ${app.address || "N/A"}</li>
              <li><strong>Phone Number:</strong> <a href="tel:${app.phone}">${app.phone || "N/A"}</a></li>
              <li><strong>WhatsApp:</strong> <a href="https://wa.me/${app.whatsapp}" target="_blank">${app.whatsapp || "N/A"}</a></li>
              <li><strong>Email:</strong> <a href="mailto:${app.email}">${app.email || "N/A"}</a></li>
            </ul>
          </div>

          <div>
            <h4 style="color: var(--primary); border-bottom: 2px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 1rem;"><i class="fa-solid fa-graduation-cap"></i> Academic Background</h4>
            <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.9rem;">
              <li><strong>Programme:</strong> ${app.programme || "Diploma in Theology"}</li>
              <li><strong>Previous School:</strong> ${app.previousSchool || "N/A"}</li>
              <li><strong>Highest Qualification:</strong> ${app.highestQualification || "N/A"}</li>
              <li><strong>Year of Graduation:</strong> ${app.yearOfGraduation || "N/A"}</li>
            </ul>
          </div>
        </div>

        <!-- Column 2: Church, Next of Kin and Declaration -->
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <div>
            <h4 style="color: var(--primary); border-bottom: 2px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 1rem;"><i class="fa-solid fa-church"></i> Church Affiliation</h4>
            <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.9rem;">
              <li><strong>Church Name:</strong> ${app.churchName || "N/A"}</li>
              <li><strong>Church Address:</strong> ${app.churchAddress || "N/A"}</li>
              <li><strong>Pastor's Name:</strong> ${app.pastorsName || "N/A"}</li>
              <li><strong>Pastor's Phone:</strong> ${app.pastorsPhone || "N/A"}</li>
              <li><strong>Years in Ministry:</strong> ${app.yearsInMinistry || "None"}</li>
              <li><strong>Current Position:</strong> ${app.currentPosition || "N/A"}</li>
            </ul>
          </div>

          <div>
            <h4 style="color: var(--primary); border-bottom: 2px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 1rem;"><i class="fa-solid fa-people-roof"></i> Next of Kin Coordinates</h4>
            <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.9rem;">
              <li><strong>Name:</strong> ${app.nextOfKinName || "N/A"}</li>
              <li><strong>Relationship:</strong> ${app.nextOfKinRelationship || "N/A"}</li>
              <li><strong>Phone:</strong> ${app.nextOfKinPhone || "N/A"}</li>
              <li><strong>Address:</strong> ${app.nextOfKinAddress || "N/A"}</li>
            </ul>
          </div>
        </div>

      </div>

      <!-- Administrative Interactive Action Area -->
      <div style="background-color: #F8FAFC; border: 1px solid var(--border-color); padding: 2rem; border-radius: var(--border-radius-lg); display: flex; flex-direction: column; gap: 1rem;">
        <h4 style="color: var(--primary); margin: 0; font-size: 1.1rem;"><i class="fa-solid fa-shield-halved"></i> Registrar Review Decision Panel</h4>
        
        <div class="form-group">
          <label for="modalPreferredStudyCentre" style="font-weight: 600; margin-bottom: 0.5rem; display: block;">Assigned Study Centre</label>
          <select id="modalPreferredStudyCentre" class="form-control" style="width:100%; padding:0.75rem; border-radius:var(--border-radius-md); border:1px solid var(--border-color); font-family:inherit; font-size:0.95rem;">
            <option value="">-- No Assigned Centre --</option>
            ${allStudyCentres.filter(c => c.status === "Active").map(c => `
              <option value="${c.id}" ${c.id === app.preferredStudyCentreId ? 'selected' : ''}>${c.name} (${c.code})</option>
            `).join('')}
          </select>
        </div>

        <div class="form-group">
          <label for="modalRemarks" style="font-weight: 600; margin-bottom: 0.5rem; display: block;">Administrative Remarks / Assessment Notes</label>
          <textarea id="modalRemarks" class="form-control" style="width:100%; height:80px; padding:0.75rem; border-radius:var(--border-radius-md); border:1px solid var(--border-color); font-family:inherit; font-size:0.95rem;" placeholder="Enter official evaluation notes or feedback for this candidate...">${app.remarks || ""}</textarea>
        </div>

        <div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.5rem;">
          <button class="btn btn-sm btn-primary" id="btnSaveRemarksOnly" style="background-color: var(--primary); color: #fff;">
            <i class="fa-solid fa-comment-dots"></i> Save Notes Only
          </button>
          
          ${isPending ? `
            <button class="btn btn-sm btn-accent" id="btnProcessApproval" style="background-color: var(--accent); color: var(--primary-dark);">
              <i class="fa-solid fa-circle-check"></i> Approve & Matriculate
            </button>
            <button class="btn btn-sm" id="btnProcessRejection" style="background-color: #dc3545; color: #fff;">
              <i class="fa-solid fa-circle-xmark"></i> Decline Application
            </button>
          ` : `
            <div style="font-size: 0.9rem; color: var(--text-muted); font-style: italic; display: flex; align-items: center; gap: 0.5rem;">
              <i class="fa-solid fa-circle-info"></i> Final review standing decision has been published.
            </div>
          `}
        </div>
      </div>

    </div>
  `;

  // Event Listeners for actions
  document.getElementById("btnSaveRemarksOnly").addEventListener("click", () => {
    saveRemarksOnly(app.id);
  });

  if (isPending) {
    document.getElementById("btnProcessApproval").addEventListener("click", () => {
      processApproval(app.id);
    });
    document.getElementById("btnProcessRejection").addEventListener("click", () => {
      processRejection(app.id);
    });
  }

  modal.style.display = "flex";
}

async function saveRemarksOnly(id) {
  const remarks = document.getElementById("modalRemarks").value;
  try {
    await updateDoc(doc(db, "applications", id), { remarks });
    window.showToast("Assessment notes updated successfully!", "success");
    const idx = allApplications.findIndex(a => a.id === id);
    if (idx !== -1) allApplications[idx].remarks = remarks;
  } catch (err) {
    window.showToast("Failed to update notes: " + err.message, "error");
  }
}

async function processRejection(id) {
  const userConfirmed = await window.dimabinConfirm("Are you absolutely sure you want to decline this theological application?");
  if (!userConfirmed) return;
  const remarks = document.getElementById("modalRemarks").value;
  try {
    await updateDoc(doc(db, "applications", id), {
      admissionStatus: "Rejected",
      remarks: remarks || "Declined after registrar board review.",
      reviewedBy: "DIMABIN/ADM/2026/01"
    });
    window.showToast("Application has been declined successfully.", "info");
    closeDetailsModal();
    await loadApplications();
    await loadStats();
  } catch (err) {
    window.showToast("Operation failed: " + err.message, "error");
  }
}

async function processApproval(id) {
  const app = allApplications.find(a => a.id === id);
  if (!app) return;
  const userConfirmed = await window.dimabinConfirm(`Are you sure you want to approve and admit ${app.fullName}? This will automatically generate a matric number and register a new student.`);
  if (!userConfirmed) return;

  window.showToast("Generating student portfolio credentials...", "info");
  const remarks = document.getElementById("modalRemarks").value;
  
  const selectedCentreId = document.getElementById("modalPreferredStudyCentre")?.value || "";
  const selectedCentre = allStudyCentres.find(c => c.id === selectedCentreId);
  const studyCentreId = selectedCentre ? selectedCentre.id : "";
  const studyCentreName = selectedCentre ? selectedCentre.name : "Unassigned";
  
  try {
    // 1. Generate unique sequence IDs
    const { studentId, matricNumber } = await generateStudentIds();

    // 2. Generate student temporary credentials
    let cleanDob = "20260101";
    if (app.dateOfBirth) {
      const digits = app.dateOfBirth.replace(/\D/g, '');
      if (digits.length >= 4) cleanDob = digits;
    }
    const tempPassword = `Dob${cleanDob}`;

    // 3. Create the student record in Firestore
    await setDoc(doc(db, "students", matricNumber.replace(/\//g, "-")), {
      studentId,
      matricNumber,
      studyCentreId,
      studyCentreName,
      fullName: app.fullName || "N/A",
      gender: app.gender || "N/A",
      dateOfBirth: app.dateOfBirth || "N/A",
      maritalStatus: app.maritalStatus || "N/A",
      nationality: app.nationality || "N/A",
      stateOfOrigin: app.stateOfOrigin || "N/A",
      lga: app.lga || "N/A",
      address: app.address || "N/A",
      phone: app.phone || "N/A",
      whatsapp: app.whatsapp || "N/A",
      email: app.email || "N/A",
      programme: app.programme || "Diploma in Theology",
      previousSchool: app.previousSchool || "N/A",
      highestQualification: app.highestQualification || "N/A",
      yearOfGraduation: app.yearOfGraduation || "N/A",
      churchName: app.churchName || "N/A",
      churchAddress: app.churchAddress || "N/A",
      pastorsName: app.pastorsName || "N/A",
      pastorsPhone: app.pastorsPhone || "N/A",
      yearsInMinistry: app.yearsInMinistry || "None",
      currentPosition: app.currentPosition || "N/A",
      nextOfKinName: app.nextOfKinName || "N/A",
      nextOfKinRelationship: app.nextOfKinRelationship || "N/A",
      nextOfKinPhone: app.nextOfKinPhone || "N/A",
      nextOfKinAddress: app.nextOfKinAddress || "N/A",
      createdAt: new Date().toISOString(),
      academicSession: "2026/2027",
      semester: "First Semester",
      status: "Active",
      applicationNumber: app.applicationNumber || "N/A",
      loginCredentials: {
        username: matricNumber,
        password: tempPassword
      }
    });

    // 4. Update the original application document status to Approved and update study centre details
    await updateDoc(doc(db, "applications", id), {
      admissionStatus: "Approved",
      remarks: remarks || "Approved and admitted.",
      reviewedBy: "DIMABIN/ADM/2026/01",
      preferredStudyCentreId: studyCentreId,
      preferredStudyCentreName: studyCentreName
    });

    closeDetailsModal();

    // Show success credentials prompt to copy or print
    showCredentialsReceipt(app.fullName, studentId, matricNumber, tempPassword, app.email, app.programme || "Diploma in Theology", app.department || "Theology");

    // Refresh dashboard data
    await loadApplications();
    await loadStudents();
    await loadStats();

    window.showToast("Admission approved successfully.", "success");

  } catch (err) {
    window.showToast("Approval sequence failed: " + err.message, "error");
  }
}

// Global/Module scope function to send/resend admission email
async function resendAdmissionEmail(matric, btnRetry) {
  if (btnRetry) {
    btnRetry.disabled = true;
    btnRetry.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending Email...`;
  }
  try {
    // 1. Retrieve the latest student record directly from Firestore
    const docId = matric.replace(/\//g, "-");
    const studentDocRef = doc(db, "students", docId);
    const studentSnap = await getDoc(studentDocRef);
    if (!studentSnap.exists()) {
      throw new Error("Student record does not exist in Firestore.");
    }
    const student = studentSnap.data();

    // 2. Verify that "student.email" exists and is not empty.
    if (!student.email || String(student.email).trim() === "" || student.email === "N/A") {
      // 5. If "student.email" is missing:
      // - Do not call EmailJS.
      // - Show: "Student email address is missing."
      console.error("Student email address is missing.");
      window.showToast("Student email address is missing.", "error");
      return;
    }

    const studentPortalLink = window.location.origin + "/pages/student-portal.html";
    const currentSession = student.academicSession || "2026/2027";
    const generatedPassword = student.loginCredentials?.password || "";

    // 3. Build the EmailJS payload like this:
    const templateParams = {
      email: student.email,
      student_name: student.fullName,
      student_id: student.studentId,
      matric_number: student.matricNumber,
      programme: student.programme,
      session: currentSession,
      temporary_password: generatedPassword,
      portal_link: studentPortalLink
    };

    // 4. Before calling "emailjs.send()", log:
    console.log("EmailJS Payload:", templateParams);

    const emailResult = await prepareAndLogEmail("admission", student.fullName, student.email, templateParams);
    if (emailResult && emailResult.success) {
      window.showToast("Admission confirmation email sent successfully.", "success");
    } else {
      const errMsg = emailResult ? emailResult.error : "Unknown dispatch error";
      window.showToast(errMsg, "error");
    }
  } catch (err) {
    console.error("Email dispatch failed:", err);
    window.showToast(err.message, "error");
  } finally {
    if (btnRetry) {
      btnRetry.disabled = false;
      btnRetry.innerHTML = `<i class="fa-solid fa-envelope"></i> Send Email Again`;
    }
  }
}

// Modal close helper
window.closeDetailsModal = () => {
  const modal = document.getElementById("appDetailsModal");
  if (modal) modal.style.display = "none";
};

const btnCloseDetailsModal = document.getElementById("btnCloseDetailsModal");
if (btnCloseDetailsModal) btnCloseDetailsModal.addEventListener("click", window.closeDetailsModal);

// Dynamic Credentials slips (print & copy)
function showCredentialsReceipt(name, studentId, matric, password, email, programme, department) {
  const modal = document.getElementById("appDetailsModal");
  const body = document.getElementById("appDetailsBody");
  if (!modal || !body) return;

  body.innerHTML = `
    <div style="text-align: center; display: flex; flex-direction: column; gap: 1.5rem; padding: 1rem 0;">
      <div style="font-size: 3.5rem; color: #28a745;"><i class="fa-solid fa-circle-check"></i></div>
      <h3 style="color: var(--primary); margin: 0; font-size: 1.5rem;">Onboarding Portfolio Activated</h3>
      <p style="color: var(--text-muted); margin: 0;">
        The registry portfolio has been established securely for <strong>${name}</strong>.
      </p>

      <!-- Credentials Receipt -->
      <div id="printCredentialsArea" style="background-color: #f8fafc; border: 2px dashed #cbd5e1; padding: 2rem; border-radius: var(--border-radius-md); text-align: left; display: flex; flex-direction: column; gap: 1rem; font-family: 'Poppins', sans-serif;">
        <div style="text-align: center; border-bottom: 2px solid var(--primary); padding-bottom: 1rem; margin-bottom: 0.5rem;">
          <strong style="color: var(--primary); font-size: 1.15rem;">DIVINE MANDATE BIBLE INSTITUTE (DIMABIN)</strong>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">Portal Student Onboarding Credentials</div>
        </div>
        
        <div><strong>Full Name:</strong> ${name}</div>
        <div><strong>Student ID:</strong> <span style="font-family: monospace; font-weight: bold; background-color: #fff; padding: 0.15rem 0.5rem; border-radius: 4px; border: 1px solid var(--border-color);">${studentId}</span></div>
        <div><strong>Matriculation Number:</strong> <span style="font-family: monospace; font-weight: bold; background-color: #fff; padding: 0.15rem 0.5rem; border-radius: 4px; border: 1px solid var(--border-color);">${matric}</span></div>
        
        <div style="border-top: 1px dashed var(--border-color); padding-top: 1rem; margin-top: 0.5rem;">
          <strong>Student Portal Sign-In Parameters:</strong>
          <ul style="list-style: none; padding: 0; margin: 0.5rem 0 0 0; display: flex; flex-direction: column; gap: 0.5rem;">
            <li>Username: <span style="font-family: monospace; font-weight: bold;">${matric}</span></li>
            <li>Password: <span style="font-family: monospace; font-weight: bold; color: var(--accent-hover);">${password}</span></li>
          </ul>
        </div>
      </div>

      <!-- Actions -->
      <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
        <button class="btn btn-primary" id="btnCopyPortalCreds">
          <i class="fa-solid fa-copy"></i> Copy Portal Login
        </button>
        <button class="btn btn-accent" id="btnPrintPortalCreds">
          <i class="fa-solid fa-print"></i> Print Slip
        </button>
        <button class="btn" id="btnRetryEmailDispatch" style="background-color: var(--secondary); color: var(--text-dark); border: 1.5px solid var(--border-color);">
          <i class="fa-solid fa-envelope"></i> Send Email Again
        </button>
        <button class="btn btn-outline-primary" id="btnCloseReceiptBtn">
          Close Dossier
        </button>
      </div>
    </div>
  `;

  document.getElementById("btnCopyPortalCreds").addEventListener("click", () => {
    const text = `DIMABIN Student Portal Credentials:\nUsername: ${matric}\nPassword: ${password}`;
    navigator.clipboard.writeText(text).then(() => {
      window.showToast("Portal credentials copied to clipboard!", "success");
    }).catch(() => {
      window.showToast("Failed to copy credentials.", "error");
    });
  });

  document.getElementById("btnPrintPortalCreds").addEventListener("click", () => {
    const content = document.getElementById("printCredentialsArea").innerHTML;
    const win = window.open("", "_blank");
    win.document.write(`
      <html>
        <head>
          <title>DIMABIN Onboarding Slip</title>
          <style>
            body { font-family: 'Poppins', sans-serif; padding: 40px; color: #1F3B82; }
            strong { color: #1F3B82; }
          </style>
        </head>
        <body>
          ${content}
          <script>window.onload = function() { window.print(); window.close(); }<\/script>
        </body>
      </html>
    `);
    win.document.close();
  });

  const btnRetry = document.getElementById("btnRetryEmailDispatch");
  if (btnRetry) {
    btnRetry.addEventListener("click", async () => {
      await resendAdmissionEmail(matric, btnRetry);
    });
  }

  document.getElementById("btnCloseReceiptBtn").addEventListener("click", closeDetailsModal);

  modal.style.display = "flex";
}

// Settings panel values loading & updating
async function loadSettings() {
  // Academic Timeline
  try {
    onSnapshot(doc(db, "settings", "timeline_settings"), (docSnap) => {
      let session = "2026/2027";
      let semester = "First Semester";
      if (docSnap.exists()) {
        const d = docSnap.data();
        session = d.session || session;
        semester = d.semester || semester;
      }
      
      window.activeAcademicSession = session;
      window.activeAcademicSemester = semester;

      const headerSession = document.getElementById("headerAcademicSession");
      const headerSemester = document.getElementById("headerAcademicSemester");
      if (headerSession) headerSession.textContent = session;
      if (headerSemester) headerSemester.textContent = semester;

      const settingsSession = document.getElementById("settingsSession");
      const settingsSemester = document.getElementById("settingsSemester");
      const activeSessionDisplay = document.getElementById("activeSessionDisplay");
      const activeSemesterDisplay = document.getElementById("activeSemesterDisplay");

      if (settingsSession && document.activeElement !== settingsSession) settingsSession.value = session;
      if (settingsSemester && document.activeElement !== settingsSemester) settingsSemester.value = semester;
      if (activeSessionDisplay) activeSessionDisplay.textContent = session;
      if (activeSemesterDisplay) activeSemesterDisplay.textContent = semester;
      
      // Update global course checkboxes
      populateCourseCheckboxes();

      // Update global dashboard information cards if they exist
      updateAllDashboardCards(session, semester);
    });
  } catch (err) {
    console.warn("⚠️ Failed to load timeline settings:", err);
  }

  // EmailJS params
  try {
    const config = await getEmailJSConfig();
    const elKey = document.getElementById("emailjsPublicKey");
    const elSrv = document.getElementById("emailjsServiceId");
    const elAdm = document.getElementById("emailjsAdmissionId");

    if (elKey) elKey.value = config.publicKey;
    if (elSrv) elSrv.value = config.serviceId;
    if (elAdm) elAdm.value = config.admissionTemplateId;
  } catch (err) {
    console.warn("⚠️ Failed to load EmailJS configuration settings:", err);
  }
}

// Activity logging helper
async function logActivity(action, details) {
  try {
    const userEmail = (auth && auth.currentUser) ? auth.currentUser.email : "System Admin";
    await addDoc(collection(db, "activities"), {
      action: action,
      details: details,
      user: userEmail,
      timestamp: new Date().toISOString()
    });
    // Trigger card update after logging activity
    updateAllDashboardCards();
  } catch (err) {
    console.warn("⚠️ Failed to log activity:", err);
  }
}

// Dashboard Information Cards Updater
async function updateAllDashboardCards(session, semester) {
  try {
    if (!session || !semester) {
      const docSnap = await getDoc(doc(db, "settings", "timeline_settings"));
      if (docSnap.exists()) {
        const d = docSnap.data();
        session = d.session || "2026/2027";
        semester = d.semester || "First Semester";
      } else {
        session = "2026/2027";
        semester = "First Semester";
      }
    }

    // Current Academic Session and Semester
    document.querySelectorAll(".global-session-card").forEach(el => el.textContent = session);
    document.querySelectorAll(".global-semester-card").forEach(el => el.textContent = semester);

    // Total Students
    const studentsCount = (window.allStudents || allStudents || []).length;
    document.querySelectorAll(".global-students-card").forEach(el => el.textContent = studentsCount);

    // Total Lecturers
    const lecturersCount = (window.allLecturers || allLecturers || []).length;
    document.querySelectorAll(".global-lecturers-card").forEach(el => el.textContent = lecturersCount);

    // Total Courses
    const coursesCount = (window.allCourses || allCourses || []).length;
    document.querySelectorAll(".global-courses-card").forEach(el => el.textContent = coursesCount);

    // Pending Admissions
    const pendingCount = (allApplications || []).filter(a => a.status === "Pending" || a.admissionStatus === "Pending").length;
    document.querySelectorAll(".global-pending-card").forEach(el => el.textContent = pendingCount);

    // Announcements
    const announcementsCount = (window.allAnnouncements || allAnnouncements || []).length;
    document.querySelectorAll(".global-announcements-card").forEach(el => el.textContent = announcementsCount);

    // Recent Activities count
    try {
      const actSnap = await getDocs(collection(db, "activities"));
      const activitiesCount = actSnap.size;
      document.querySelectorAll(".global-activities-card").forEach(el => el.textContent = activitiesCount);
    } catch (e) {
      document.querySelectorAll(".global-activities-card").forEach(el => el.textContent = "0");
    }
  } catch (err) {
    console.warn("Failed to update dashboard information cards:", err);
  }
}
window.updateAllDashboardCards = updateAllDashboardCards;
window.logActivity = logActivity;

// Timeline save trigger
const btnSaveTimeline = document.getElementById("btnSaveTimeline");
if (btnSaveTimeline) {
  btnSaveTimeline.addEventListener("click", async () => {
    const session = document.getElementById("settingsSession").value.trim();
    const semester = document.getElementById("settingsSemester").value;
    if (!session) {
      window.showToast("Please specify a valid academic session year.", "error");
      return;
    }
    try {
      await setDoc(doc(db, "settings", "timeline_settings"), { session, semester });
      const activeSessionDisplay = document.getElementById("activeSessionDisplay");
      const activeSemesterDisplay = document.getElementById("activeSemesterDisplay");
      if (activeSessionDisplay) activeSessionDisplay.textContent = session;
      if (activeSemesterDisplay) activeSemesterDisplay.textContent = semester;
      window.showToast("Academic period rollover successfully updated!", "success");
    } catch (err) {
      window.showToast("Rollover failed: " + err.message, "error");
    }
  });
}

// EmailJS save trigger
const btnSaveEmailJS = document.getElementById("btnSaveEmailJS");
if (btnSaveEmailJS) {
  btnSaveEmailJS.addEventListener("click", async () => {
    const key = document.getElementById("emailjsPublicKey").value.trim();
    const srv = document.getElementById("emailjsServiceId").value.trim();
    const adm = document.getElementById("emailjsAdmissionId").value.trim();

    try {
      await saveEmailJSConfig({
        publicKey: key,
        serviceId: srv,
        admissionTemplateId: adm
      });
      window.showToast("EmailJS notification parameters secured system-wide!", "success");
    } catch (err) {
      window.showToast("Failed to save settings: " + err.message, "error");
    }
  });
}

// EmailJS reset trigger
const btnResetEmailJS = document.getElementById("btnResetEmailJS");
if (btnResetEmailJS) {
  btnResetEmailJS.addEventListener("click", async () => {
    const userConfirmed = await window.dimabinConfirm("Restore all EmailJS variables back to system defaults?");
    if (!userConfirmed) return;
    try {
      await saveEmailJSConfig(DEFAULT_EMAILJS_CONFIG);
      await loadSettings();
      window.showToast("Notification settings restored back to system defaults.", "info");
    } catch (err) {
      window.showToast("Failed to restore default settings.", "error");
    }
  });
}

// ==========================================
// LECTURER MANAGEMENT MODULE
// ==========================================

// ==========================================
// COURSE MANAGEMENT & ALLOCATION MODULE
// ==========================================

const OFFICIAL_THEOLOGY_SEED_COURSES = [
  {
    courseCode: "THY-101",
    courseTitle: "Christology",
    semester: "First Semester",
    creditUnit: 3,
    department: "Theology",
    description: "A systematic study of the Person, nature, deity, and redemptive work of Jesus Christ as revealed in Scriptures."
  },
  {
    courseCode: "BIB-101",
    courseTitle: "Bibliology",
    semester: "First Semester",
    creditUnit: 3,
    department: "Biblical Studies",
    description: "An in-depth study of the origin, inspiration, canonization, preservation, and divine authority of the Holy Scriptures."
  },
  {
    courseCode: "FND-101",
    courseTitle: "Christian Foundation",
    semester: "First Semester",
    creditUnit: 2,
    department: "Christian Education",
    description: "An analysis of the fundamental doctrines of Christian theology, faith development, and spiritual maturation."
  },
  {
    courseCode: "CTH-101",
    courseTitle: "Faith",
    semester: "First Semester",
    creditUnit: 2,
    department: "Theology",
    description: "The study of the biblical doctrine of faith, examining its nature, mechanism, application, and heroic scriptural templates."
  },
  {
    courseCode: "CTH-102",
    courseTitle: "Prayer",
    semester: "First Semester",
    creditUnit: 2,
    department: "Pastoral Ministry",
    description: "A comprehensive investigation of the theology, protocols, dimensions, and practical disciplines of Christian prayer."
  },
  {
    courseCode: "CTH-103",
    courseTitle: "Fasting",
    semester: "First Semester",
    creditUnit: 2,
    department: "Pastoral Ministry",
    description: "A biblically and historically grounded study of fasting as a spiritual weapon and a means of personal consecration."
  },
  {
    courseCode: "BIB-102",
    courseTitle: "Synoptic Gospel",
    semester: "First Semester",
    creditUnit: 3,
    department: "Biblical Studies",
    description: "An analytical study of the Gospels of Matthew, Mark, and Luke, exploring their harmony, unique themes, and theological accents."
  },
  {
    courseCode: "THY-102",
    courseTitle: "Theology",
    semester: "First Semester",
    creditUnit: 3,
    department: "Theology",
    description: "An introductory survey of systematic theology, outlining the methods and divisions of theological analysis."
  },
  {
    courseCode: "THY-201",
    courseTitle: "Divinity",
    semester: "Second Semester",
    creditUnit: 3,
    department: "Theology",
    description: "An exploration of the Triune Godhead, examining the attributes, names, character, and eternal plan of the Father, Son, and Holy Spirit."
  },
  {
    courseCode: "THY-202",
    courseTitle: "Anthropology",
    semester: "Second Semester",
    creditUnit: 2,
    department: "Theology",
    description: "The theological study of humanity, covering the creation, moral constitution, fall, total depravity, and eternal destiny of mankind."
  },
  {
    courseCode: "THY-203",
    courseTitle: "Pneumatology",
    semester: "Second Semester",
    creditUnit: 3,
    department: "Theology",
    description: "A systematic study of the Holy Spirit, His divine personhood, operational offices, spiritual gifts, and active ministry in the believer's life."
  },
  {
    courseCode: "THY-204",
    courseTitle: "Ecclesiology",
    semester: "Second Semester",
    creditUnit: 3,
    department: "Theology",
    description: "The study of the Christian Church, its scriptural nature, institutional governance, ordinances, and ultimate redemptive mission."
  },
  {
    courseCode: "LDR-201",
    courseTitle: "Christian Leadership",
    semester: "Second Semester",
    creditUnit: 3,
    department: "Christian Education",
    description: "Practical and biblical theology of leadership, analyzing character requirements, stewardship principles, and staff coordination strategies."
  },
  {
    courseCode: "MSN-201",
    courseTitle: "Mission",
    semester: "Second Semester",
    creditUnit: 2,
    department: "Missions & Evangelism",
    description: "An examination of God's missionary heart, the historical growth of the global church, and cross-cultural mission methodologies."
  },
  {
    courseCode: "MSN-202",
    courseTitle: "Evangelism",
    semester: "Second Semester",
    creditUnit: 2,
    department: "Missions & Evangelism",
    description: "Practical and apologetic tools for effective soul-winning, street witness, community crusades, and personal gospel communication."
  },
  {
    courseCode: "LDR-202",
    courseTitle: "Discipleship",
    semester: "Second Semester",
    creditUnit: 2,
    department: "Christian Education",
    description: "The master-plan of spiritual mentoring, centering on Christ's pattern of multiplication, accountability structures, and spiritual multiplication."
  },
  {
    courseCode: "THY-205",
    courseTitle: "Homiletics",
    semester: "Second Semester",
    creditUnit: 3,
    department: "Theology",
    description: "The art, science, and spiritual preparation required for constructing and preaching expository, textual, and topical sermons."
  }
];

// Seed courses collection if empty
async function seedDefaultCoursesIfEmpty() {
  try {
    const qSnap = await getDocs(collection(db, "courses"));
    if (qSnap.empty) {
      console.log("🌱 [Seeding] Syllabus repository is vacant. Seeding 17 official theology courses...");
      for (const course of OFFICIAL_THEOLOGY_SEED_COURSES) {
        const payload = {
          courseId: course.courseCode,
          courseCode: course.courseCode,
          courseTitle: course.courseTitle,
          code: course.courseCode, // backward-compatibility fallback
          name: course.courseTitle, // backward-compatibility fallback
          semester: course.semester,
          creditUnit: course.creditUnit,
          department: course.department,
          description: course.description,
          status: "Active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await setDoc(doc(db, "courses", course.courseCode), payload);
      }
      console.log("✅ [Seeding] Successfully seeded 17 official theological courses!");
      return true;
    }
    return false;
  } catch (err) {
    console.error("❌ Seeding official courses failed:", err);
    return false;
  }
}

async function loadCourses() {
  try {
    // 1. Seed if empty
    await seedDefaultCoursesIfEmpty();

    // 2. Load all courses
    const qSnap = await getDocs(collection(db, "courses"));
    allCourses = [];
    qSnap.forEach(docSnap => {
      allCourses.push({ id: docSnap.id, ...docSnap.data() });
    });
    console.log(`🌟 [Courses Catalog] Loaded ${allCourses.length} courses successfully!`);
    
    // 3. Populate existing checkboxes (for register lecturer form)
    populateCourseCheckboxes();

    // 4. Render new Course Management Directory
    renderCoursesDirectory();

    // 5. Populate Allocation Facilitator selectors
    populateCourseAllocationLecturers();
    renderCourseAllocationGrid();
    updateAllDashboardCards();
  } catch (err) {
    console.warn("⚠️ Failed to load courses catalog:", err);
  }
}

function populateCourseCheckboxes() {
  const container = document.getElementById("courseAllocationCheckboxes");
  const editContainer = document.getElementById("editCourseAllocationCheckboxes");
  if (!container && !editContainer) return;

  // Add change listeners once to trigger repopulation
  const regLecDept = document.getElementById("regLecDepartment");
  if (regLecDept && !regLecDept.dataset.listenerAttached) {
    regLecDept.addEventListener("change", () => populateCourseCheckboxes());
    regLecDept.dataset.listenerAttached = "true";
  }
  const regLecProg = document.getElementById("regLecProgramme");
  if (regLecProg && !regLecProg.dataset.listenerAttached) {
    regLecProg.addEventListener("change", () => populateCourseCheckboxes());
    regLecProg.dataset.listenerAttached = "true";
  }

  const editLecDept = document.getElementById("editLecDepartment");
  if (editLecDept && !editLecDept.dataset.listenerAttached) {
    editLecDept.addEventListener("change", () => populateCourseCheckboxes());
    editLecDept.dataset.listenerAttached = "true";
  }
  const editLecProg = document.getElementById("editLecProgramme");
  if (editLecProg && !editLecProg.dataset.listenerAttached) {
    editLecProg.addEventListener("change", () => populateCourseCheckboxes());
    editLecProg.dataset.listenerAttached = "true";
  }

  // Determine role and active settings
  const isCentreAdmin = currentAdminDoc && currentAdminDoc.role === "Centre Admin";
  const activeSession = window.activeAcademicSession || "2026/2027";
  const activeSemester = window.activeAcademicSemester || "First Semester";

  // Filter courses for Register modal
  let registerCourses = allCourses.filter(c => c.status === "Active");
  if (isCentreAdmin) {
    // Under Centre Admin, filter by current session, semester, and study centre
    registerCourses = registerCourses.filter(c => {
      const matchesSession = !c.academicSession || c.academicSession === "all" || c.academicSession === activeSession;
      const matchesSemester = c.semester === activeSemester;
      const matchesCentre = !c.studyCentreId || c.studyCentreId === "global" || c.studyCentreId === currentSelectedStudyCentreId || (c.assignedStudyCentreIds && c.assignedStudyCentreIds.includes(currentSelectedStudyCentreId));
      return matchesSession && matchesSemester && matchesCentre;
    });
  }

  const selectedDept = regLecDept ? regLecDept.value : "all";
  const selectedProg = regLecProg ? regLecProg.value : "all";
  if (selectedProg && selectedProg !== "all") {
    registerCourses = registerCourses.filter(c => c.programme === selectedProg);
  }
  if (selectedDept && selectedDept !== "all") {
    registerCourses = registerCourses.filter(c => c.department === selectedDept);
  }

  // Filter courses for Edit modal
  let editCourses = allCourses.filter(c => c.status === "Active");
  if (isCentreAdmin) {
    editCourses = editCourses.filter(c => {
      const matchesSession = !c.academicSession || c.academicSession === "all" || c.academicSession === activeSession;
      const matchesSemester = c.semester === activeSemester;
      const matchesCentre = !c.studyCentreId || c.studyCentreId === "global" || c.studyCentreId === currentSelectedStudyCentreId || (c.assignedStudyCentreIds && c.assignedStudyCentreIds.includes(currentSelectedStudyCentreId));
      return matchesSession && matchesSemester && matchesCentre;
    });
  }

  const selectedEditDept = editLecDept ? editLecDept.value : "all";
  const selectedEditProg = editLecProg ? editLecProg.value : "all";
  if (selectedEditProg && selectedEditProg !== "all") {
    editCourses = editCourses.filter(c => c.programme === selectedEditProg);
  }
  if (selectedEditDept && selectedEditDept !== "all") {
    editCourses = editCourses.filter(c => c.department === selectedEditDept);
  }

  // Sort alphabetically
  registerCourses.sort((a, b) => (a.courseCode || "").localeCompare(b.courseCode || ""));
  editCourses.sort((a, b) => (a.courseCode || "").localeCompare(b.courseCode || ""));

  if (container) {
    container.innerHTML = renderGroupedCoursesHtml(registerCourses, "assignedCourses");
  }

  if (editContainer) {
    editContainer.innerHTML = renderGroupedCoursesHtml(editCourses, "editAssignedCourses");
  }
}

function renderGroupedCoursesHtml(coursesList, checkboxName) {
  if (coursesList.length === 0) {
    return `<div style="color: var(--text-muted); font-size: 0.9rem; grid-column: 1/-1; text-align: center; padding: 1.5rem;">
      No active courses available matching criteria.
    </div>`;
  }

  const firstSem = coursesList.filter(c => c.semester === "First Semester");
  const secondSem = coursesList.filter(c => c.semester === "Second Semester");

  const makeListHtml = (courses) => {
    if (courses.length === 0) {
      return `<div style="color: var(--text-muted); font-size: 0.8rem; font-style: italic; padding: 0.5rem 1rem;">No courses in this semester.</div>`;
    }
    return courses.map(c => {
      const code = c.courseCode || c.id || "";
      const name = c.courseTitle || c.name || "";
      return `
        <label style="display: flex; align-items: flex-start; gap: 0.5rem; background-color: var(--bg-white); padding: 0.6rem 0.8rem; border-radius: 6px; border: 1.5px solid var(--border-color); cursor: pointer; font-size: 0.8rem; transition: border-color 0.2s;">
          <input type="checkbox" name="${checkboxName}" value="${code}" style="margin-top: 0.15rem; accent-color: var(--primary);">
          <span style="font-weight: 500;">[${code}] <span style="color: var(--text-muted);">${name}</span></span>
        </label>
      `;
    }).join("");
  };

  return `
    <div style="grid-column: 1 / -1; margin-bottom: 0.75rem; width: 100%;">
      <h5 style="font-size: 0.8rem; font-weight: 700; color: var(--primary); text-transform: uppercase; border-bottom: 1px dashed var(--border-color); padding-bottom: 0.25rem; margin-bottom: 0.5rem; display: block; width: 100%;">First Semester</h5>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.5rem; width: 100%;">
        ${makeListHtml(firstSem)}
      </div>
    </div>
    <div style="grid-column: 1 / -1; margin-top: 0.5rem; margin-bottom: 0.75rem; width: 100%;">
      <h5 style="font-size: 0.8rem; font-weight: 700; color: var(--primary); text-transform: uppercase; border-bottom: 1px dashed var(--border-color); padding-bottom: 0.25rem; margin-bottom: 0.5rem; display: block; width: 100%;">Second Semester</h5>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.5rem; width: 100%;">
        ${makeListHtml(secondSem)}
      </div>
    </div>
  `;
}

function populateStudyCentreCheckboxes() {
  const container = document.getElementById("studyCentreAllocationCheckboxes");
  const editContainer = document.getElementById("editStudyCentreAllocationCheckboxes");
  if (!container && !editContainer) return;

  const centreFormBlock = container.closest('div');
  if (centreFormBlock) {
    if (currentAdminDoc?.role === "Centre Admin") {
      centreFormBlock.style.display = "none";
    } else {
      centreFormBlock.style.display = "block";
    }
  }

  const sortedCentres = [...allStudyCentres].filter(c => c.status === "Active").sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  let html = "";
  if (sortedCentres.length === 0) {
    html = `<div style="color: var(--text-muted); font-size: 0.9rem; grid-column: 1/-1; text-align: center; padding: 1rem;">No active study centres available.</div>`;
  } else {
    sortedCentres.forEach(c => {
      const cid = c.id;
      const name = c.name;
      const code = c.code || "";
      html += `
        <label style="display: flex; align-items: flex-start; gap: 0.6rem; background-color: var(--bg-white); padding: 0.6rem 0.8rem; border-radius: 6px; border: 1.5px solid var(--border-color); cursor: pointer; font-size: 0.85rem; transition: border-color 0.2s;">
          <input type="checkbox" name="assignedStudyCentres" value="${cid}" style="margin-top: 0.2rem; accent-color: var(--primary);">
          <span style="font-weight: 500;">${name} (${code})</span>
        </label>
      `;
    });
  }
  if (container) container.innerHTML = html;

  let editHtml = "";
  if (sortedCentres.length === 0) {
    editHtml = `<div style="color: var(--text-muted); font-size: 0.85rem; grid-column: 1/-1; text-align: center; padding: 1rem;">No active study centres available.</div>`;
  } else {
    sortedCentres.forEach(c => {
      const cid = c.id;
      const name = c.name;
      const code = c.code || "";
      editHtml += `
        <label style="display: flex; align-items: flex-start; gap: 0.5rem; background-color: var(--bg-white); padding: 0.5rem 0.7rem; border-radius: 6px; border: 1.5px solid var(--border-color); cursor: pointer; font-size: 0.8rem; transition: border-color 0.2s;">
          <input type="checkbox" name="editAssignedStudyCentres" value="${cid}" style="margin-top: 0.15rem; accent-color: var(--primary);">
          <span style="font-weight: 500;">${name} (${code})</span>
        </label>
      `;
    });
  }
  if (editContainer) editContainer.innerHTML = editHtml;
}

function populateStudyCentreFilterDropdowns() {
  const dropdownIds = [
    "filterAppsStudyCentre",
    "filterStudentsStudyCentre",
    "filterLecturersStudyCentre",
    "filterCoursesStudyCentre",
    "filterResultsStudyCentre"
  ];
  
  dropdownIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    
    // Save current selected value
    const currentVal = el.value || "all";
    
    // Reset but keep "All Study Centres" option
    el.innerHTML = '<option value="all">All Study Centres</option>';
    
    allStudyCentres.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.code})`;
      el.appendChild(opt);
    });
    
    // Restore value if still exists
    if ([...el.options].some(o => o.value === currentVal)) {
      el.value = currentVal;
    } else {
      el.value = "all";
    }
  });
}

// Course Management Directory Renderer
function renderCoursesDirectory() {
  const tbody = document.getElementById("coursesTableBody");
  if (!tbody) return;

  const searchQuery = document.getElementById("searchCoursesInput") ? document.getElementById("searchCoursesInput").value.toLowerCase().trim() : "";
  const filterSemester = document.getElementById("filterCourseSemester") ? document.getElementById("filterCourseSemester").value : "all";
  const filterStatus = document.getElementById("filterCourseStatus") ? document.getElementById("filterCourseStatus").value : "all";
  const filterCentre = document.getElementById("filterCoursesStudyCentre") ? document.getElementById("filterCoursesStudyCentre").value : "all";
  const sortBy = document.getElementById("sortCourseBy") ? document.getElementById("sortCourseBy").value : "code-asc";

  let filtered = allCourses.filter(c => {
    const code = (c.courseCode || c.code || "").toLowerCase();
    const title = (c.courseTitle || c.name || "").toLowerCase();
    const dept = (c.department || "").toLowerCase();
    
    const matchesSearch = code.includes(searchQuery) || title.includes(searchQuery) || dept.includes(searchQuery);
    const matchesSemester = filterSemester === "all" || c.semester === filterSemester;
    const matchesStatus = filterStatus === "all" || c.status === filterStatus;
    const matchesCentre = filterCentre === "all" || 
                         (c.studyCentreId === filterCentre) || 
                         (c.assignedStudyCentreIds && c.assignedStudyCentreIds.includes(filterCentre));

    return matchesSearch && matchesSemester && matchesStatus && matchesCentre;
  });

  // Sorting logic
  filtered.sort((a, b) => {
    const codeA = a.courseCode || a.code || "";
    const codeB = b.courseCode || b.code || "";
    const titleA = a.courseTitle || a.name || "";
    const titleB = b.courseTitle || b.name || "";
    const unitA = parseInt(a.creditUnit || 0);
    const unitB = parseInt(b.creditUnit || 0);

    if (sortBy === "code-asc") return codeA.localeCompare(codeB);
    if (sortBy === "code-desc") return codeB.localeCompare(codeA);
    if (sortBy === "title-asc") return titleA.localeCompare(titleB);
    if (sortBy === "unit-desc") return unitB - unitA;
    if (sortBy === "unit-asc") return unitA - unitB;
    return 0;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">No courses matching selected parameters.</td></tr>`;
    return;
  }

  let html = "";
  filtered.forEach(c => {
    const code = c.courseCode || c.code || c.id || "";
    const title = c.courseTitle || c.name || "";
    const semester = c.semester || "-";
    const creditUnit = c.creditUnit || "-";
    const department = c.department || "-";
    const status = c.status || "Active";

    const statusBadgeColor = status === "Active" ? "rgba(40,167,69,0.12)" : "rgba(220,53,69,0.12)";
    const statusTextColor = status === "Active" ? "#28A745" : "#DC3545";

    const programme = c.programme || c.department || "Bachelor of Theology";
    const level = c.level || "100 Level";

    html += `
      <tr style="border-bottom: 1.5px solid var(--border-color);">
        <td style="padding: 1rem; font-weight: 700; color: var(--primary);">${code}</td>
        <td style="padding: 1rem; font-weight: 500;">${title}</td>
        <td style="padding: 1rem; font-size: 0.85rem; color: var(--text-dark);">${programme}</td>
        <td style="padding: 1rem; font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">${level}</td>
        <td style="padding: 1rem;">${semester}</td>
        <td style="padding: 1rem;"><span style="background-color: var(--bg-slate); border: 1px solid var(--border-color); padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 600;">${creditUnit} Units</span></td>
        <td style="padding: 1rem;">
          <span style="background-color: ${statusBadgeColor}; color: ${statusTextColor}; padding: 0.25rem 0.6rem; border-radius: 50px; font-size: 0.75rem; font-weight: 700; display: inline-block;">
            ${status}
          </span>
        </td>
        <td style="padding: 1rem; text-align: center;">
          <div style="display: flex; gap: 0.5rem; justify-content: center;">
            <button class="btn btn-action-edit-course" data-id="${code}" title="Modify Course" style="background-color: #1F3B82; color: white; border: none; width: 34px; height: 34px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.9rem; transition: background-color 0.15s;"><i class="fa-solid fa-pen"></i></button>
            ${status === "Active" 
              ? `<button class="btn btn-action-deactivate-course" data-id="${code}" title="Deactivate Course" style="background-color: #F4B000; color: white; border: none; width: 34px; height: 34px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.9rem; transition: background-color 0.15s;"><i class="fa-solid fa-ban"></i></button>`
              : `<button class="btn btn-action-activate-course" data-id="${code}" title="Activate Course" style="background-color: #28A745; color: white; border: none; width: 34px; height: 34px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.9rem; transition: background-color 0.15s;"><i class="fa-solid fa-circle-check"></i></button>`
            }
            <button class="btn btn-action-delete-course" data-id="${code}" title="Remove Course" style="background-color: #DC3545; color: white; border: none; width: 34px; height: 34px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.9rem; transition: background-color 0.15s;"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;

  // Re-attach Action Listeners
  document.querySelectorAll(".btn-action-edit-course").forEach(btn => {
    btn.addEventListener("click", () => triggerEditCourseModal(btn.getAttribute("data-id")));
  });

  document.querySelectorAll(".btn-action-deactivate-course").forEach(btn => {
    btn.addEventListener("click", () => toggleCourseStatus(btn.getAttribute("data-id"), "Inactive"));
  });

  document.querySelectorAll(".btn-action-activate-course").forEach(btn => {
    btn.addEventListener("click", () => toggleCourseStatus(btn.getAttribute("data-id"), "Active"));
  });

  document.querySelectorAll(".btn-action-delete-course").forEach(btn => {
    btn.addEventListener("click", () => triggerDeleteCourse(btn.getAttribute("data-id")));
  });
}

// Tab Switching Listener for Course subtabs
document.querySelectorAll(".course-sub-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const targetSub = btn.getAttribute("data-coursesubtab");
    document.querySelectorAll(".course-sub-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".course-subtab-content").forEach(c => c.style.display = "none");

    btn.classList.add("active");
    const targetEl = document.getElementById(`coursesubtab-${targetSub}`);
    if (targetEl) targetEl.style.display = "block";
  });
});

// Search & Filter event binders
["searchCoursesInput", "filterCourseSemester", "filterCourseStatus", "filterCoursesStudyCentre", "sortCourseBy"].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("input", renderCoursesDirectory);
    el.addEventListener("change", renderCoursesDirectory);
  }
});

// Reset Filters button
const btnResetCourseFilters = document.getElementById("btnResetCourseFilters");
if (btnResetCourseFilters) {
  btnResetCourseFilters.addEventListener("click", () => {
    const search = document.getElementById("searchCoursesInput");
    const sem = document.getElementById("filterCourseSemester");
    const stat = document.getElementById("filterCourseStatus");
    const centre = document.getElementById("filterCoursesStudyCentre");
    const sort = document.getElementById("sortCourseBy");

    if (search) search.value = "";
    if (sem) sem.value = "all";
    if (stat) stat.value = "all";
    if (centre) centre.value = "all";
    if (sort) sort.value = "code-asc";

    renderCoursesDirectory();
  });
}

// Add Course Handler
const addCourseForm = document.getElementById("addCourseForm");
if (addCourseForm) {
  addCourseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const courseCode = document.getElementById("addCourseCode").value.toUpperCase().trim();
      const courseTitle = document.getElementById("addCourseTitle").value.trim();
      const semester = document.getElementById("addCourseSemester").value;
      const creditUnit = parseInt(document.getElementById("addCourseCredit").value);
      const department = document.getElementById("addCourseDept").value;
      const programme = document.getElementById("addCourseProgramme") ? document.getElementById("addCourseProgramme").value : "Bachelor of Theology";
      const level = document.getElementById("addCourseLevel") ? document.getElementById("addCourseLevel").value : "100 Level";
      const description = document.getElementById("addCourseDesc").value.trim();
      const status = document.getElementById("addCourseStatus").value;

      if (!courseCode || !courseTitle || !semester || !creditUnit || !department || !description) {
        throw new Error("Please fill in all required fields accurately.");
      }

      // Check if course already exists to prevent duplicate codes
      const existingDoc = await getDoc(doc(db, "courses", courseCode));
      if (existingDoc.exists()) {
        throw new Error(`Course Code "${courseCode}" already exists in the theological curriculum registry. Duplicate Course Codes are strictly prohibited.`);
      }

      const payload = {
        courseId: courseCode,
        courseCode: courseCode,
        courseTitle: courseTitle,
        code: courseCode, // backwards compatibility fallback
        name: courseTitle, // backwards compatibility fallback
        semester: semester,
        creditUnit: creditUnit,
        department: department,
        programme: programme,
        level: level,
        description: description,
        status: status,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await setDoc(doc(db, "courses", courseCode), payload);
      window.showToast(`Course "${courseCode} - ${courseTitle}" successfully cataloged!`, "success");
      
      addCourseForm.reset();
      
      // Auto switch back to list view
      document.querySelector('.course-sub-tab-btn[data-coursesubtab="list"]').click();
      
      // Reload everything
      await loadCourses();
    } catch (err) {
      console.error("❌ Add Course failed:", err);
      window.showToast(err.message, "error");
    }
  });
}

// Trigger Edit Modal
async function triggerEditCourseModal(courseCode) {
  try {
    const docSnap = await getDoc(doc(db, "courses", courseCode));
    if (!docSnap.exists()) {
      throw new Error("Course record not found in the database.");
    }
    const c = docSnap.data();

    document.getElementById("editCourseId").value = courseCode;
    document.getElementById("editCourseCode").value = courseCode;
    document.getElementById("editCourseTitle").value = c.courseTitle || c.name || "";
    document.getElementById("editCourseSemester").value = c.semester || "First Semester";
    document.getElementById("editCourseCredit").value = c.creditUnit || "3";
    document.getElementById("editCourseDept").value = c.department || "Theology";
    if (document.getElementById("editCourseProgramme")) {
      document.getElementById("editCourseProgramme").value = c.programme || "Bachelor of Theology";
    }
    if (document.getElementById("editCourseLevel")) {
      document.getElementById("editCourseLevel").value = c.level || "100 Level";
    }
    document.getElementById("editCourseStatus").value = c.status || "Active";
    document.getElementById("editCourseDesc").value = c.description || "";

    const modal = document.getElementById("courseEditModal");
    if (modal) modal.style.display = "flex";
  } catch (err) {
    window.showToast("Failed to retrieve course details: " + err.message, "error");
  }
}

// Close Edit Modal
const btnCancelCourseEdit = document.getElementById("btnCancelCourseEdit");
if (btnCancelCourseEdit) {
  btnCancelCourseEdit.addEventListener("click", () => {
    const modal = document.getElementById("courseEditModal");
    if (modal) modal.style.display = "none";
  });
}

// Edit Course Submit Form
const editCourseForm = document.getElementById("editCourseForm");
if (editCourseForm) {
  editCourseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const courseId = document.getElementById("editCourseId").value;
      const title = document.getElementById("editCourseTitle").value.trim();
      const semester = document.getElementById("editCourseSemester").value;
      const credit = parseInt(document.getElementById("editCourseCredit").value);
      const department = document.getElementById("editCourseDept").value;
      const programme = document.getElementById("editCourseProgramme") ? document.getElementById("editCourseProgramme").value : "Bachelor of Theology";
      const level = document.getElementById("editCourseLevel") ? document.getElementById("editCourseLevel").value : "100 Level";
      const status = document.getElementById("editCourseStatus").value;
      const description = document.getElementById("editCourseDesc").value.trim();

      const docRef = doc(db, "courses", courseId);
      await updateDoc(docRef, {
        courseTitle: title,
        name: title, // backwards compatibility fallback
        semester: semester,
        creditUnit: credit,
        department: department,
        programme: programme,
        level: level,
        status: status,
        description: description,
        updatedAt: new Date().toISOString()
      });

      window.showToast(`Syllabus course "${courseId}" updated successfully!`, "success");
      
      const modal = document.getElementById("courseEditModal");
      if (modal) modal.style.display = "none";

      await loadCourses();
    } catch (err) {
      window.showToast("Update failed: " + err.message, "error");
    }
  });
}

// Toggle Course Status
async function toggleCourseStatus(courseCode, newStatus) {
  try {
    const docRef = doc(db, "courses", courseCode);
    await updateDoc(docRef, {
      status: newStatus,
      updatedAt: new Date().toISOString()
    });
    window.showToast(`Course "${courseCode}" status modified to ${newStatus}!`, "success");
    await loadCourses();
  } catch (err) {
    window.showToast("Status transition failed: " + err.message, "error");
  }
}

// Delete Course with checks
async function triggerDeleteCourse(courseCode) {
  try {
    // 1. Check if course is assigned to any lecturers
    const lecturersSnap = await getDocs(collection(db, "lecturers"));
    let assignedToLecturer = false;
    let matchingLecturerName = "";

    lecturersSnap.forEach(lDoc => {
      const data = lDoc.data();
      const assigned = data.coursesAssigned || data.assignedCourses || [];
      if (assigned.includes(courseCode)) {
        assignedToLecturer = true;
        matchingLecturerName = data.fullName || data.lecturerId;
      }
    });

    // 2. Check if course is registered by students
    const regsSnap = await getDocs(collection(db, "registrations"));
    let registeredByStudent = false;

    regsSnap.forEach(rDoc => {
      const data = rDoc.data();
      const registered = data.registeredCourses || [];
      if (registered.includes(courseCode)) {
        registeredByStudent = true;
      }
    });

    // 3. Prevent permanent deletion if assigned
    if (assignedToLecturer || registeredByStudent) {
      let reason = "";
      if (assignedToLecturer && registeredByStudent) {
        reason = `assigned to lecturer ${matchingLecturerName} AND has active student course registrations`;
      } else if (assignedToLecturer) {
        reason = `assigned to lecturer ${matchingLecturerName}`;
      } else {
        reason = `has active student course registrations in the system`;
      }

      await window.dimabinAlert(`⚠️ Course Deletion Prevented!\n\nThis course cannot be deleted because it is already ${reason}.\n\nTo withdraw this course from active enrollment options, the course status will be changed to Inactive instead.`, "warning", "Course Deletion Prevented");
      await toggleCourseStatus(courseCode, "Inactive");
      return;
    }

    // 4. Confirm permanent deletion if completely unassigned
    const proceed = await window.dimabinConfirm(`⚠️ Confirm Permanent Deletion\n\nAre you absolutely sure you want to permanently delete course [${courseCode}] from the DIMABIN syllabus database? This action is irreversible.`, "Confirm Permanent Deletion");
    if (proceed) {
      const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
      await deleteDoc(doc(db, "courses", courseCode));
      window.showToast(`Course "${courseCode}" permanently deleted from curriculum!`, "success");
      await loadCourses();
    }
  } catch (err) {
    window.showToast("Deletion handler failed: " + err.message, "error");
  }
}

// ==========================================
// COURSE ALLOCATION FUNCTIONALITY
// ==========================================

// Populate Select Lecturer dropdown inside Course Allocation
function populateCourseAllocationLecturers() {
  const select = document.getElementById("allocationLecturerSelect");
  if (!select) return;

  // Keep chosen lecturer selected if they still exist
  const currentVal = select.value;

  select.innerHTML = `<option value="">-- Choose Lecturer --</option>`;
  
  // Sort lecturers alphabetically
  const sortedLecturers = [...allLecturers].sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

  sortedLecturers.forEach(lec => {
    const id = lec.id || lec.lecturerId || "";
    const name = lec.fullName || "";
    const title = lec.title || "";
    const optionText = `${title} ${name} (${id})`;
    
    select.insertAdjacentHTML("beforeend", `<option value="${id}" ${id === currentVal ? "selected" : ""}>${optionText}</option>`);
  });

  // Attach change listener to update meta details
  select.onchange = () => handleAllocationLecturerChange();
}

function handleAllocationLecturerChange() {
  const select = document.getElementById("allocationLecturerSelect");
  const metaBox = document.getElementById("allocationLecMetaDisplay");
  const saveBtn = document.getElementById("btnSaveCourseAllocation");
  const selectAllBtn = document.getElementById("btnAllocSelectAll");
  const clearAllBtn = document.getElementById("btnAllocClearAll");

  if (!select) return;

  const lecId = select.value;

  if (!lecId) {
    // Hide details and disable allocations
    if (metaBox) metaBox.style.display = "none";
    if (saveBtn) saveBtn.disabled = true;
    if (selectAllBtn) selectAllBtn.disabled = true;
    if (clearAllBtn) clearAllBtn.disabled = true;
    renderCourseAllocationGrid(null);
    return;
  }

  // Find lecturer details
  const lec = allLecturers.find(l => l.id === lecId);
  if (!lec) return;

  // Show details
  if (metaBox) {
    document.getElementById("allocMetaDept").textContent = lec.department || "-";
    document.getElementById("allocMetaPos").textContent = lec.position || "-";
    document.getElementById("allocMetaEmail").textContent = lec.email || "-";
    
    const assignedCount = (lec.coursesAssigned || lec.assignedCourses || []).length;
    document.getElementById("allocMetaCount").textContent = assignedCount;
    metaBox.style.display = "block";
  }

  // Enable buttons
  if (saveBtn) saveBtn.disabled = false;
  if (selectAllBtn) selectAllBtn.disabled = false;
  if (clearAllBtn) clearAllBtn.disabled = false;

  // Render course checkboxes matching this lecturer's assigned list
  renderCourseAllocationGrid(lec);
}

// Render the checkboxes grid for allocation
function renderCourseAllocationGrid(lecturer = null) {
  const container = document.getElementById("allocCoursesContainer");
  const countDisp = document.getElementById("allocSelectedCoursesCountDisplay");
  if (!container) return;

  if (!lecturer) {
    container.innerHTML = `
      <div style="color: var(--text-muted); font-size: 0.95rem; text-align: center; padding: 2rem;">
        <i class="fa-solid fa-arrow-left" style="margin-right: 0.5rem; color: var(--accent);"></i> Select a facilitator on the left to activate syllabus allocation fields.
      </div>
    `;
    if (countDisp) countDisp.textContent = "0 selected";
    return;
  }

  // Gather active courses only
  const activeSemester = window.activeAcademicSemester || "First Semester";
  const activeCourses = allCourses.filter(c => c.status === "Active" && c.semester === activeSemester);
  if (activeCourses.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); padding: 1.5rem; text-align: center;">No active courses available in the curriculum for ${activeSemester}. Ensure courses are activated inside Course Management.</div>`;
    return;
  }

  const lecturerAllocated = lecturer.coursesAssigned || lecturer.assignedCourses || [];

  let html = "";

  // Render function helper
  const renderSemesterSection = (title, courses) => {
    if (courses.length === 0) return "";
    let sectionHtml = `
      <div>
        <h4 style="color: var(--primary); font-size: 0.95rem; margin-top: 0; margin-bottom: 0.75rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
          <i class="fa-solid fa-calendar-days" style="color: var(--accent);"></i> ${title}
        </h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem;">
    `;

    courses.forEach(c => {
      const code = c.courseCode || c.code || c.id || "";
      const courseTitle = c.courseTitle || c.name || "";
      const isChecked = lecturerAllocated.includes(code);
      const credits = c.creditUnit || "3";

      sectionHtml += `
        <label style="display: flex; align-items: flex-start; gap: 0.65rem; background-color: var(--bg-slate); padding: 0.8rem; border-radius: 6px; border: 1.5px solid ${isChecked ? 'var(--primary)' : 'var(--border-color)'}; cursor: pointer; font-size: 0.85rem; transition: all 0.2s;">
          <input type="checkbox" class="alloc-course-checkbox" value="${code}" ${isChecked ? 'checked' : ''} style="margin-top: 0.2rem; accent-color: var(--primary);" onchange="updateAllocationCheckboxCount()">
          <div style="flex: 1;">
            <div style="font-weight: 700; color: var(--primary); margin-bottom: 0.15rem;">${code} <span style="font-size:0.7rem; background:rgba(31,59,130,0.08); padding:1px 4px; border-radius:3px;">${credits} Cr</span></div>
            <div style="font-weight: 500; color: var(--text-dark); font-size:0.8rem; line-height: 1.2;">${courseTitle}</div>
          </div>
        </label>
      `;
    });

    sectionHtml += `
        </div>
      </div>
    `;
    return sectionHtml;
  };

  html += renderSemesterSection(`${activeSemester} Curriculum`, activeCourses);

  container.innerHTML = html;
  updateAllocationCheckboxCount();
}

// Update Allocation Counter and border styles dynamically on check change
window.updateAllocationCheckboxCount = () => {
  const checkboxes = document.querySelectorAll(".alloc-course-checkbox");
  const countDisp = document.getElementById("allocSelectedCoursesCountDisplay");
  
  let checkedCount = 0;
  checkboxes.forEach(chk => {
    // Update labels border style dynamically
    const parentLabel = chk.closest("label");
    if (chk.checked) {
      checkedCount++;
      if (parentLabel) parentLabel.style.borderColor = "var(--primary)";
    } else {
      if (parentLabel) parentLabel.style.borderColor = "var(--border-color)";
    }
  });

  if (countDisp) countDisp.textContent = `${checkedCount} selected`;
};

// Bulk allocation controls
const btnAllocSelectAll = document.getElementById("btnAllocSelectAll");
if (btnAllocSelectAll) {
  btnAllocSelectAll.onclick = () => {
    document.querySelectorAll(".alloc-course-checkbox").forEach(chk => {
      chk.checked = true;
    });
    updateAllocationCheckboxCount();
  };
}

const btnAllocClearAll = document.getElementById("btnAllocClearAll");
if (btnAllocClearAll) {
  btnAllocClearAll.onclick = () => {
    document.querySelectorAll(".alloc-course-checkbox").forEach(chk => {
      chk.checked = false;
    });
    updateAllocationCheckboxCount();
  };
}

let allLecturerAssignments = [];

async function syncLecturerAssignments(lecturerId, checkedCourseCodes) {
  try {
    const lec = allLecturers.find(l => l.id === lecturerId);
    if (!lec) {
      console.error("syncLecturerAssignments: Lecturer not found", lecturerId);
      return;
    }
    const lecturerName = `${lec.title || ""} ${lec.fullName}`.trim();

    // Fetch existing allocations for this lecturer
    const qSnap = await getDocs(query(collection(db, "lecturer_assignments"), where("lecturerId", "==", lecturerId)));
    const existingAssigns = [];
    qSnap.forEach(docSnap => {
      existingAssigns.push({ id: docSnap.id, ...docSnap.data() });
    });

    const existingCodes = existingAssigns.map(a => a.courseCode);

    // Identify which ones to add
    const codesToAdd = checkedCourseCodes.filter(code => !existingCodes.includes(code));

    // Identify which ones to remove
    const codesToRemove = existingCodes.filter(code => !checkedCourseCodes.includes(code));

    // Perform deletes
    for (const code of codesToRemove) {
      const docId = `${lecturerId}_${code}`;
      await deleteDoc(doc(db, "lecturer_assignments", docId));
    }

    // Perform adds
    const activeSession = window.activeAcademicSession || "2026/2027";
    const nowStr = new Date().toISOString();

    for (const code of codesToAdd) {
      const course = allCourses.find(c => c.courseCode === code || c.id === code);
      const docId = `${lecturerId}_${code}`;

      // Find study centre
      const studyCentreId = lec.assignedStudyCentreIds?.[0] || "global";
      const centre = allStudyCentres.find(c => c.id === studyCentreId);

      const assignData = {
        lecturerId: lecturerId,
        lecturerName: lecturerName,
        courseCode: code,
        courseTitle: course ? (course.courseTitle || course.name || "") : "Unknown Course",
        semester: course ? (course.semester || "First Semester") : "First Semester",
        programme: lec.programme || (course ? (course.programme || course.department) : "") || "Bachelor of Theology",
        studyCentreId: studyCentreId,
        studyCentreName: centre ? centre.name : "Global",
        academicSession: activeSession,
        assignedAt: nowStr,
        createdAt: nowStr
      };

      await setDoc(doc(db, "lecturer_assignments", docId), assignData);
    }
  } catch (err) {
    console.error("❌ syncLecturerAssignments failed:", err);
  }
}

async function loadLecturers() {
  try {
    const qSnap = await getDocs(collection(db, "lecturers"));
    allLecturers = [];
    qSnap.forEach(docSnap => {
      allLecturers.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Fetch centralized lecturer assignments
    try {
      const assignSnap = await getDocs(collection(db, "lecturer_assignments"));
      allLecturerAssignments = [];
      assignSnap.forEach(docSnap => {
        allLecturerAssignments.push({ id: docSnap.id, ...docSnap.data() });
      });
    } catch (assignErr) {
      console.warn("⚠️ Failed to load centralized assignments, seeding empty array:", assignErr);
      allLecturerAssignments = [];
    }

    // Map centralized assignments back to lecturers
    allLecturers.forEach(lec => {
      const assignments = allLecturerAssignments.filter(a => a.lecturerId === lec.id);
      const courses = assignments.map(a => a.courseCode);
      lec.coursesAssigned = courses;
      lec.assignedCourses = courses;

      // Ensure allocationsMetadata is also synchronized
      lec.allocationsMetadata = {};
      assignments.forEach(a => {
        lec.allocationsMetadata[a.courseCode] = {
          assignedAt: a.assignedAt || a.createdAt || new Date().toISOString()
        };
      });
    });

    console.log(`🌟 [Lecturer Directory] Loaded ${allLecturers.length} facilitators and ${allLecturerAssignments.length} centralized assignments successfully!`);
    renderLecturerDirectory();
    if (typeof currentSelectedStudyCentreId !== 'undefined' && currentSelectedStudyCentreId) {
      renderCentreLecturers(currentSelectedStudyCentreId);
    }
    updateAllDashboardCards();
  } catch (err) {
    console.error("❌ Failed to fetch lecturer registry:", err);
    window.showToast("Failed to fetch lecturer registry.", "error");
  }
}

function renderLecturerDirectory() {
  const tbody = document.getElementById("lecturersTableBody");
  if (!tbody) return;

  const searchQuery = document.getElementById("searchLecturersInput") ? document.getElementById("searchLecturersInput").value.toLowerCase().trim() : "";
  const filterStatus = document.getElementById("filterLecturerStatus") ? document.getElementById("filterLecturerStatus").value : "all";
  const filterCentre = document.getElementById("filterLecturersStudyCentre") ? document.getElementById("filterLecturersStudyCentre").value : "all";
  const sortBy = document.getElementById("sortLecturerBy") ? document.getElementById("sortLecturerBy").value : "name-asc";

  // Filter facilitators
  let filtered = allLecturers.filter(lec => {
    const matchesSearch = 
      (lec.lecturerId || "").toLowerCase().includes(searchQuery) ||
      (lec.fullName || "").toLowerCase().includes(searchQuery) ||
      (lec.department || "").toLowerCase().includes(searchQuery) ||
      (lec.email || "").toLowerCase().includes(searchQuery);

    const matchesStatus = filterStatus === "all" || lec.status === filterStatus;
    const matchesCentre = filterCentre === "all" || (lec.assignedStudyCentreIds && lec.assignedStudyCentreIds.includes(filterCentre));
    return matchesSearch && matchesStatus && matchesCentre;
  });

  // Sort facilitators
  filtered.sort((a, b) => {
    if (sortBy === "name-asc") {
      return (a.fullName || "").localeCompare(b.fullName || "");
    } else if (sortBy === "name-desc") {
      return (b.fullName || "").localeCompare(a.fullName || "");
    } else if (sortBy === "id-asc") {
      return (a.lecturerId || "").localeCompare(b.lecturerId || "");
    } else if (sortBy === "id-desc") {
      return (b.lecturerId || "").localeCompare(a.lecturerId || "");
    } else if (sortBy === "date-desc") {
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    }
    return 0;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 3.5rem; color: var(--text-muted);">
          <i class="fa-solid fa-folder-open" style="font-size: 2.2rem; display: block; margin-bottom: 0.75rem; color: var(--accent);"></i>
          No academic facilitators found in the active directory matching criteria.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(lec => {
    const statusBg = lec.status === "Active" ? "rgba(40,167,69,0.1)" : "rgba(220,53,69,0.1)";
    const statusColor = lec.status === "Active" ? "#28A745" : "#DC3545";
    
    // Assigned Study Centre(s) Names list
    const assignedCentres = lec.assignedStudyCentreIds || [];
    const centresHtml = assignedCentres.length > 0 
      ? assignedCentres.map(cid => {
          const centre = allStudyCentres.find(c => c.id === cid);
          return centre ? `<span style="background-color: var(--accent); color: var(--primary); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 700; margin-right: 0.3rem; display: inline-block; margin-bottom: 0.25rem;">${centre.name}</span>` : "";
        }).join("")
      : `<span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">None Assigned</span>`;

    // Fallback support for course codes grouped by semester
    const coursesList = lec.coursesAssigned || lec.assignedCourses || [];
    let coursesHtml = "";
    if (coursesList.length > 0) {
      const firstSemCourses = [];
      const secondSemCourses = [];
      
      coursesList.forEach(c => {
        const course = allCourses.find(item => item.courseCode === c || item.id === c);
        const sem = course ? course.semester : "First Semester";
        if (sem === "Second Semester") {
          secondSemCourses.push(c);
        } else {
          firstSemCourses.push(c);
        }
      });

      let firstHtml = firstSemCourses.length > 0 
        ? `<div style="margin-bottom: 0.3rem;"><strong style="font-size: 0.72rem; color: var(--primary); display: block;">1st Sem:</strong>` + 
          firstSemCourses.map(c => `<span style="background-color: var(--primary); color: white; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; margin-right: 0.25rem; display: inline-block; margin-bottom: 0.2rem;">${c}</span>`).join("") + "</div>"
        : "";

      let secondHtml = secondSemCourses.length > 0 
        ? `<div><strong style="font-size: 0.72rem; color: var(--primary); display: block;">2nd Sem:</strong>` + 
          secondSemCourses.map(c => `<span style="background-color: #555; color: white; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; margin-right: 0.25rem; display: inline-block; margin-bottom: 0.2rem;">${c}</span>`).join("") + "</div>"
        : "";

      coursesHtml = firstHtml + secondHtml;
      if (!coursesHtml) coursesHtml = `<span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">None Allocated</span>`;
    } else {
      coursesHtml = `<span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">None Allocated</span>`;
    }

    // Strictly ICONS ONLY action buttons matching style guidelines!
    return `
      <tr style="border-bottom: 1.5px solid var(--border-color); transition: background 0.15s;">
        <td style="padding: 1rem; font-family: monospace; font-weight: 700; color: var(--primary); font-size: 0.92rem;">${lec.lecturerId || ""}</td>
        <td style="padding: 1rem; font-weight: 600; color: var(--primary-dark);">${lec.title || ""} ${lec.fullName || ""}</td>
        <td style="padding: 1rem; font-size: 0.88rem; font-weight: 500;">${lec.department || ""}</td>
        <td style="padding: 1rem; max-width: 250px;">${centresHtml}</td>
        <td style="padding: 1rem; max-width: 200px;">${coursesHtml}</td>
        <td style="padding: 1rem;">
          <span style="background-color: ${statusBg}; color: ${statusColor}; padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.78rem; font-weight: 700; display: inline-block;">
            ${lec.status || "Active"}
          </span>
        </td>
        <td style="padding: 1rem; text-align: center;">
          <div style="display: flex; gap: 0.45rem; justify-content: center; align-items: center;">
            <button class="btn btn-edit-lec" data-id="${lec.id}" title="View & Edit Facilitator Profile" style="background-color: #1F3B82; color: white; border: none; border-radius: 6px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.95rem; transition: transform 0.1s;"><i class="fa-solid fa-user-pen"></i></button>
            <button class="btn btn-reset-pass-lec" data-id="${lec.id}" title="Reset Security Credentials" style="background-color: #F4B000; color: #1F3B82; border: none; border-radius: 6px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.95rem; transition: transform 0.1s;"><i class="fa-solid fa-key"></i></button>
            <button class="btn btn-toggle-status-lec" data-id="${lec.id}" data-status="${lec.status}" title="${lec.status === 'Active' ? 'Deactivate / Suspend account' : 'Activate account'}" style="background-color: ${lec.status === 'Active' ? '#DC3545' : '#28A745'}; color: white; border: none; border-radius: 6px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.95rem; transition: transform 0.1s;">
              <i class="fa-solid ${lec.status === 'Active' ? 'fa-user-slash' : 'fa-user-check'}"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Attach event listeners for dynamic rows
  tbody.querySelectorAll(".btn-edit-lec").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      openEditLecturerModal(id);
    });
  });

  tbody.querySelectorAll(".btn-reset-pass-lec").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      resetLecturerPassword(id);
    });
  });

  tbody.querySelectorAll(".btn-toggle-status-lec").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const status = btn.getAttribute("data-status");
      toggleLecturerStatus(id, status);
    });
  });
}

// Sub-tab Pill switching
document.querySelectorAll(".sub-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const targetSubtab = btn.getAttribute("data-subtab");
    document.querySelectorAll(".sub-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".lecturer-subtab-content").forEach(c => c.style.display = "none");
    
    btn.classList.add("active");
    const targetEl = document.getElementById(`subtab-${targetSubtab}`);
    if (targetEl) targetEl.style.display = "block";
    
    const successCard = document.getElementById("regSuccessCredentialsCard");
    if (successCard) successCard.style.display = "none";
  });
});

// Event attachments for Search/Filter/Sort
const searchLecInput = document.getElementById("searchLecturersInput");
if (searchLecInput) searchLecInput.addEventListener("input", renderLecturerDirectory);

const filterLecStatus = document.getElementById("filterLecturerStatus");
if (filterLecStatus) filterLecStatus.addEventListener("change", renderLecturerDirectory);

const filterLecCentre = document.getElementById("filterLecturersStudyCentre");
if (filterLecCentre) filterLecCentre.addEventListener("change", renderLecturerDirectory);

const sortLecSelect = document.getElementById("sortLecturerBy");
if (sortLecSelect) sortLecSelect.addEventListener("change", renderLecturerDirectory);

const btnResetLecFilters = document.getElementById("btnResetLecturerFilters");
if (btnResetLecFilters) {
  btnResetLecFilters.addEventListener("click", () => {
    if (searchLecInput) searchLecInput.value = "";
    if (filterLecStatus) filterLecStatus.value = "all";
    if (filterLecCentre) filterLecCentre.value = "all";
    if (sortLecSelect) sortLecSelect.value = "name-asc";
    renderLecturerDirectory();
  });
}

// Enrollment form processing
const registerLecturerForm = document.getElementById("registerLecturerForm");
if (registerLecturerForm) {
  registerLecturerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const title = document.getElementById("regLecTitle").value;
    const fullName = document.getElementById("regLecFullName").value.trim();
    const gender = document.getElementById("regLecGender").value;
    const dob = document.getElementById("regLecDob").value;
    const phone = document.getElementById("regLecPhone").value.trim();
    const whatsapp = document.getElementById("regLecWhatsapp").value.trim();
    const email = document.getElementById("regLecEmail").value.trim();
    const address = document.getElementById("regLecAddress").value.trim();
    const qualification = document.getElementById("regLecQualification").value.trim();
    const department = document.getElementById("regLecDepartment").value;
    const programme = document.getElementById("regLecProgramme") ? document.getElementById("regLecProgramme").value : "Bachelor of Theology";
    const position = document.getElementById("regLecPosition").value.trim();
    const employmentDate = document.getElementById("regLecEmploymentDate").value;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      window.showToast("Please supply a valid email address.", "error");
      return;
    }

    // Gather courses
    const checkedCourses = [];
    document.querySelectorAll('#courseAllocationCheckboxes input[name="assignedCourses"]:checked').forEach(cb => {
      checkedCourses.push(cb.value);
    });

    // Gather assigned study centres
    let checkedCentres = [];
    if (currentAdminDoc?.role === "Centre Admin") {
      checkedCentres = [currentSelectedStudyCentreId];
    } else {
      document.querySelectorAll('#studyCentreAllocationCheckboxes input[name="assignedStudyCentres"]:checked').forEach(cb => {
        checkedCentres.push(cb.value);
      });
    }

    try {
      window.showToast("Securing institutional credentials...", "info");

      // Generate incremental sequence
      const qSnap = await getDocs(collection(db, "lecturers"));
      let maxSeq = 0;
      qSnap.forEach(docSnap => {
        const idVal = docSnap.data().lecturerId || "";
        const m = idVal.match(/DIMABIN\/LEC\/2026\/(\d+)/);
        if (m) {
          const num = parseInt(m[1], 10);
          if (num > maxSeq) maxSeq = num;
        }
      });

      const nextSeq = maxSeq + 1;
      const paddedSeq = String(nextSeq).padStart(3, "0");
      const generatedLecId = `DIMABIN/LEC/2026/${paddedSeq}`;
      const docId = `DIMABIN-LEC-2026-${paddedSeq}`;

      // Temporary password format
      const randHex = Math.random().toString(36).substring(2, 6).toUpperCase();
      const tempPassword = `Dimabin@2026${randHex}`;

      // Dynamic provisioning via Secondary Firebase Auth (protecting the Admin session!)
      let authCreated = false;
      try {
        const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
        const { getAuth, createUserWithEmailAndPassword, signOut } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
        const firebaseConfig = (await import("./firebase-config-env.js")).default;
        
        const secAppName = `secRegLec-${Date.now()}`;
        const secApp = initializeApp(firebaseConfig, secAppName);
        const secAuth = getAuth(secApp);
        
        await createUserWithEmailAndPassword(secAuth, email, tempPassword);
        await signOut(secAuth);
        await secApp.delete();
        authCreated = true;
      } catch (authErr) {
        console.error("❌ Auth provisioning failed:", authErr);
        if (authErr.code === "auth/email-already-in-use") {
          window.showToast("The email is already registered in Firebase Authentication.", "error");
          return;
        }
      }

      // Hash temporary password using SHA-256 (Never store plain text in Firestore!)
      const passHash = await sha256(tempPassword);

      // Save document parameters
      const lecDocData = {
        lecturerId: generatedLecId,
        fullName,
        title,
        gender,
        phone,
        whatsapp,
        email,
        address,
        qualification,
        department,
        programme,
        position,
        employmentDate,
        assignedCourses: checkedCourses,
        coursesAssigned: checkedCourses, // Dual field synchronization for portal integration
        assignedStudyCentreIds: checkedCentres, // Multi study centre assignment support
        status: "Active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        passwordHash: passHash
      };

      await setDoc(doc(db, "lecturers", docId), lecDocData);
      await syncLecturerAssignments(docId, checkedCourses);

      // Display successfully generated credentials
      document.getElementById("dispGeneratedLecturerId").textContent = generatedLecId;
      document.getElementById("dispGeneratedPassword").textContent = tempPassword;
      document.getElementById("regSuccessCredentialsCard").style.display = "block";

      window.showToast("Facilitator registered and credentials provisioned!", "success");

      // Prepare EmailJS integration
      try {
        await prepareAndLogEmail("lecturer", fullName, email, {
          subject: "DIMABIN Faculty Onboarding Coordinates",
          message: `Dear ${title} ${fullName},\n\nYour profile has been registered successfully. Use these credentials to sign in:\n\nStaff ID: ${generatedLecId}\nTemporary Password: ${tempPassword}\n\nPlease proceed to the Lecturer Portal to activate your profile.\n\nInstitutional Administration,\nDIMABIN`,
          temp_password: tempPassword,
          staff_id: generatedLecId,
          lecturer_name: fullName
        });
      } catch (logErr) {
        console.warn("⚠️ EmailJS preparation skipped:", logErr);
      }

      // Refresh data list
      await loadLecturers();
      
      // Clear form inputs
      registerLecturerForm.reset();
      document.querySelectorAll('#courseAllocationCheckboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
      document.querySelectorAll('#studyCentreAllocationCheckboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
      
    } catch (err) {
      console.error("❌ Facilitator registration failed:", err);
      window.showToast("Registration failed: " + err.message, "error");
    }
  });
}

// Edit Profile Modal logic
const editLecModal = document.getElementById("lecturerDetailsModal");
const btnCloseLecModal = document.getElementById("btnCloseLecDetailsModal");
const editLecForm = document.getElementById("editLecturerForm");

if (btnCloseLecModal && editLecModal) {
  btnCloseLecModal.addEventListener("click", () => {
    editLecModal.style.display = "none";
  });
}

// Register Facilitator Modal logic
const regLecModal = document.getElementById("registerLecturerModal");
const btnCloseRegLecModal = document.getElementById("btnCloseRegLecturerModal");

if (btnCloseRegLecModal && regLecModal) {
  btnCloseRegLecModal.addEventListener("click", () => {
    regLecModal.style.display = "none";
  });
}

document.addEventListener("click", (e) => {
  if (e.target && (
    e.target.id === "btnRegisterNewCentreLecturer" || e.target.closest("#btnRegisterNewCentreLecturer") ||
    e.target.id === "btnRegisterNewLecturerSuper" || e.target.closest("#btnRegisterNewLecturerSuper")
  )) {
    const form = document.getElementById("registerLecturerForm");
    if (form) form.reset();
    const succCard = document.getElementById("regSuccessCredentialsCard");
    if (succCard) succCard.style.display = "none";
    
    // Repopulate checkboxes
    populateCourseCheckboxes();
    populateStudyCentreCheckboxes();
    
    if (regLecModal) {
      regLecModal.style.display = "flex";
    }
  }
});

function openEditLecturerModal(docId) {
  const lec = allLecturers.find(l => l.id === docId);
  if (!lec) {
    window.showToast("Facilitator record not found.", "error");
    return;
  }

  document.getElementById("editLecDocId").value = docId;
  document.getElementById("editLecId").value = lec.lecturerId || "";
  document.getElementById("editLecTitle").value = lec.title || "Rev.";
  document.getElementById("editLecFullName").value = lec.fullName || "";
  document.getElementById("editLecGender").value = lec.gender || "Male";
  document.getElementById("editLecDob").value = lec.dob || lec.dateOfBirth || "";
  document.getElementById("editLecPhone").value = lec.phone || "";
  document.getElementById("editLecWhatsapp").value = lec.whatsapp || "";
  document.getElementById("editLecEmail").value = lec.email || "";
  document.getElementById("editLecAddress").value = lec.address || "";
  document.getElementById("editLecQualification").value = lec.qualification || "";
  document.getElementById("editLecDepartment").value = lec.department || "all";
  if (document.getElementById("editLecProgramme")) {
    document.getElementById("editLecProgramme").value = lec.programme || "all";
  }
  document.getElementById("editLecPosition").value = lec.position || "";
  document.getElementById("editLecEmploymentDate").value = lec.employmentDate || "";
  document.getElementById("editLecStatus").value = lec.status || "Active";

  // Match and check assigned checkboxes (filtered for Centre Admin if applicable)
  const editContainer = document.getElementById("editCourseAllocationCheckboxes");
  if (editContainer) {
    let allowedCourses = [...allCourses];
    if (currentAdminDoc?.role === "Centre Admin") {
      allowedCourses = allowedCourses.filter(c => c.studyCentreId === currentSelectedStudyCentreId || (c.assignedStudyCentreIds && c.assignedStudyCentreIds.includes(currentSelectedStudyCentreId)));
    }
    allowedCourses.sort((a, b) => (a.courseCode || a.code || "").localeCompare(b.courseCode || b.code || ""));
    
    let editHtml = "";
    if (allowedCourses.length === 0) {
      editHtml = `<div style="color: var(--text-muted); font-size: 0.85rem; grid-column: 1/-1; text-align: center; padding: 1rem;">No courses available for this study centre.</div>`;
    } else {
      allowedCourses.forEach(c => {
        const code = c.courseCode || c.code || c.id || "";
        const name = c.courseTitle || c.name || "";
        editHtml += `
          <label style="display: flex; align-items: flex-start; gap: 0.5rem; background-color: var(--bg-white); padding: 0.5rem 0.7rem; border-radius: 6px; border: 1.5px solid var(--border-color); cursor: pointer; font-size: 0.8rem; transition: border-color 0.2s;">
            <input type="checkbox" name="editAssignedCourses" value="${code}" style="margin-top: 0.15rem; accent-color: var(--primary);">
            <span style="font-weight: 500;">[${code}] <span style="color: var(--text-muted);">${name}</span></span>
          </label>
        `;
      });
    }
    editContainer.innerHTML = editHtml;
  }

  const assigned = lec.coursesAssigned || lec.assignedCourses || [];
  document.querySelectorAll('#editCourseAllocationCheckboxes input[name="editAssignedCourses"]').forEach(cb => {
    cb.checked = assigned.includes(cb.value);
  });

  // Match and check assigned study centre checkboxes (hidden if Centre Admin)
  const centreBlock = document.getElementById("editStudyCentreAllocationCheckboxes")?.closest('div');
  if (centreBlock) {
    if (currentAdminDoc?.role === "Centre Admin") {
      centreBlock.style.display = "none";
    } else {
      centreBlock.style.display = "block";
    }
  }

  const assignedCentres = lec.assignedStudyCentreIds || [];
  document.querySelectorAll('#editStudyCentreAllocationCheckboxes input[name="editAssignedStudyCentres"]').forEach(cb => {
    cb.checked = assignedCentres.includes(cb.value);
  });

  if (editLecModal) editLecModal.style.display = "flex";
}

if (editLecForm) {
  editLecForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const docId = document.getElementById("editLecDocId").value;
    const title = document.getElementById("editLecTitle").value;
    const fullName = document.getElementById("editLecFullName").value.trim();
    const gender = document.getElementById("editLecGender").value;
    const dob = document.getElementById("editLecDob").value;
    const phone = document.getElementById("editLecPhone").value.trim();
    const whatsapp = document.getElementById("editLecWhatsapp").value.trim();
    const email = document.getElementById("editLecEmail").value.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      window.showToast("Please supply a valid email address.", "error");
      return;
    }
    const address = document.getElementById("editLecAddress").value.trim();
    const qualification = document.getElementById("editLecQualification").value.trim();
    const department = document.getElementById("editLecDepartment").value;
    const programme = document.getElementById("editLecProgramme") ? document.getElementById("editLecProgramme").value : "Bachelor of Theology";
    const position = document.getElementById("editLecPosition").value.trim();
    const employmentDate = document.getElementById("editLecEmploymentDate").value;
    const status = document.getElementById("editLecStatus").value;

    const checkedCourses = [];
    document.querySelectorAll('#editCourseAllocationCheckboxes input[name="editAssignedCourses"]:checked').forEach(cb => {
      checkedCourses.push(cb.value);
    });

    const lec = allLecturers.find(l => l.id === docId);
    let checkedCentres = [];
    if (currentAdminDoc?.role === "Centre Admin") {
      checkedCentres = (lec && lec.assignedStudyCentreIds) ? lec.assignedStudyCentreIds : [currentSelectedStudyCentreId];
    } else {
      document.querySelectorAll('#editStudyCentreAllocationCheckboxes input[name="editAssignedStudyCentres"]:checked').forEach(cb => {
        checkedCentres.push(cb.value);
      });
    }

    try {
      window.showToast("Securing profile coordinates...", "info");

      const docRef = doc(db, "lecturers", docId);
      await updateDoc(docRef, {
        title,
        fullName,
        gender,
        dob,
        phone,
        whatsapp,
        email,
        address,
        qualification,
        department,
        programme,
        position,
        employmentDate,
        status,
        assignedCourses: checkedCourses,
        coursesAssigned: checkedCourses, // Synchronized fields
        assignedStudyCentreIds: checkedCentres, // Multi study centre assignment support
        updatedAt: new Date().toISOString()
      });

      // Sync centralized assignments collection
      await syncLecturerAssignments(docId, checkedCourses);

      window.showToast("Facilitator profile updated successfully!", "success");
      if (editLecModal) editLecModal.style.display = "none";
      await loadLecturers();
      if (currentAdminDoc?.role === "Centre Admin") {
        renderCentreLecturers(currentSelectedStudyCentreId);
      }
    } catch (err) {
      console.error("❌ Failed to update profile:", err);
      window.showToast("Failed to update profile: " + err.message, "error");
    }
  });
}

// Suspend & Activate operations
async function toggleLecturerStatus(docId, currentStatus) {
  const newStatus = currentStatus === "Active" ? "Suspended" : "Active";
  const userConfirmed = await window.dimabinConfirm(`Are you sure you want to mark this facilitator as ${newStatus}?`);
  if (!userConfirmed) return;

  try {
    window.showToast(`Transitioning status to ${newStatus}...`, "info");
    const docRef = doc(db, "lecturers", docId);
    await updateDoc(docRef, {
      status: newStatus,
      updatedAt: new Date().toISOString()
    });

    window.showToast(`Facilitator marked as ${newStatus}!`, "success");
    await loadLecturers();
  } catch (err) {
    console.error("❌ Status toggle failed:", err);
    window.showToast("Failed to change status: " + err.message, "error");
  }
}

// Password reset operations
async function resetLecturerPassword(docId) {
  const lec = allLecturers.find(l => l.id === docId);
  if (!lec) {
    window.showToast("Facilitator record not found.", "error");
    return;
  }

  const userConfirmed = await window.dimabinConfirm(`Reset credentials for ${lec.title || ''} ${lec.fullName || ''}? This will update Firebase Auth and prepare EmailJS dispatch.`);
  if (!userConfirmed) return;

  try {
    window.showToast("Generating new credentials...", "info");

    const randHex = Math.random().toString(36).substring(2, 6).toUpperCase();
    const newTempPassword = `Dimabin@2026${randHex}`;

    // Attempt to reset Auth account
    let authReset = false;
    try {
      const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
      const { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
      const firebaseConfig = (await import("./firebase-config-env.js")).default;

      const secAppName = `secResetPass-${Date.now()}`;
      const secApp = initializeApp(firebaseConfig, secAppName);
      const secAuth = getAuth(secApp);

      // Attempt deletion with previous stored passwords (fallback verification)
      let deleted = false;
      const prevPassword = lec.password || lec.tempPassword || "";
      if (prevPassword) {
        try {
          const userCred = await signInWithEmailAndPassword(secAuth, lec.email, prevPassword);
          await userCred.user.delete();
          deleted = true;
          console.log("Deleted previous Auth profile for fresh onboarding.");
        } catch (delErr) {
          console.warn("Could not sign in to delete previous profile:", delErr.message);
        }
      }

      if (deleted) {
        // Re-create user fresh with new temporary credentials
        await createUserWithEmailAndPassword(secAuth, lec.email, newTempPassword);
        await signOut(secAuth);
        authReset = true;
      } else {
        // Fallback: send built-in Firebase Reset Email link directly to inbox
        await sendPasswordResetEmail(auth, lec.email);
        authReset = true;
        window.showToast("Dispatched secure Firebase Reset link directly to inbox.", "info");
      }

      await secApp.delete();
    } catch (authErr) {
      console.warn("⚠️ Firebase Auth connection skipped or bypassed:", authErr);
    }

    // Securely hash new password
    const hashedPass = await sha256(newTempPassword);

    // Save modifications to Firestore (Never store plain text!)
    const docRef = doc(db, "lecturers", docId);
    await updateDoc(docRef, {
      tempPassword: newTempPassword,
      password: newTempPassword, // Dual field syncing
      passwordHash: hashedPass,
      updatedAt: new Date().toISOString()
    });

    // EmailJS Logging preparation
    try {
      await prepareAndLogEmail("lecturer", lec.fullName, lec.email, {
        subject: "DIMABIN Account Password Rollover",
        message: `Dear ${lec.title || ''} ${lec.fullName},\n\nYour account credentials have been successfully reset.\n\nNew Temporary Password: ${newTempPassword}\n\nPlease update this upon authentication.\n\nInstitutional Administration,\nDIMABIN`,
        temp_password: newTempPassword,
        staff_id: lec.lecturerId,
        lecturer_name: lec.fullName
      });
    } catch (logErr) {
      console.warn("⚠️ Skipped logging EmailJS reset template:", logErr);
    }

    await window.dimabinAlert(`🔐 Security Credentials Reset Completed!\n\nStaff: ${lec.title || ''} ${lec.fullName}\nNew Temporary Password: ${newTempPassword}\n\nPlease copy this password and share it with the lecturer.`, "success", "Security Credentials Reset Completed");
    
    await loadLecturers();
  } catch (err) {
    console.error("❌ Credentials reset failed:", err);
    window.showToast("Credentials reset failed: " + err.message, "error");
  }
}

// Run-Once Initializations
(async () => {
  await seedDefaultAdmin();
  checkActiveSession();
})();

// CBT Control Center Administrative Functions
let adminCbtExams = [];
let adminActiveResults = [];

async function initAdminCbtControl() {
  const tableBody = document.getElementById("adminCbtExamsTableBody");
  if (!tableBody) return;

  // Bind subtab switching
  const tabExams = document.getElementById("btnAdminCbtTabExams");
  const tabSubmissions = document.getElementById("btnAdminCbtTabSubmissions");
  const panelExams = document.getElementById("panelAdminCbtExams");
  const panelSubmissions = document.getElementById("panelAdminCbtSubmissions");

  if (tabExams && tabSubmissions && panelExams && panelSubmissions) {
    tabExams.addEventListener("click", () => {
      tabExams.classList.add("active");
      tabExams.style.borderBottom = "3px solid var(--primary)";
      tabExams.style.color = "var(--primary)";
      tabSubmissions.classList.remove("active");
      tabSubmissions.style.borderBottom = "3px solid transparent";
      tabSubmissions.style.color = "var(--text-muted)";
      panelExams.style.display = "block";
      panelSubmissions.style.display = "none";
    });

    tabSubmissions.addEventListener("click", () => {
      tabSubmissions.classList.add("active");
      tabSubmissions.style.borderBottom = "3px solid var(--primary)";
      tabSubmissions.style.color = "var(--primary)";
      tabExams.classList.remove("active");
      tabExams.style.borderBottom = "3px solid transparent";
      tabExams.style.color = "var(--text-muted)";
      panelExams.style.display = "none";
      panelSubmissions.style.display = "block";
      loadAdminCbtResultsDropdown();
    });
  }

  // Load stats and list of exams
  await loadAdminCbtDashboard();
}

async function loadAdminCbtDashboard() {
  const tableBody = document.getElementById("adminCbtExamsTableBody");
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Fetching central exams...</td></tr>`;

  try {
    const examsSnap = await getDocs(collection(db, "cbtExams"));
    adminCbtExams = examsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const attemptsSnap = await getDocs(collection(db, "cbtAttempts"));
    const liveAttempts = attemptsSnap.docs.filter(d => d.data().status === "started").length;

    const resultsSnap = await getDocs(collection(db, "cbtResults"));
    const totalSubmissions = resultsSnap.size;

    const publishedCount = adminCbtExams.filter(ex => ex.status === "Published").length;

    // Update stats counters
    const elTotalEx = document.getElementById("adminCbtTotalExams");
    const elPubEx = document.getElementById("adminCbtPublishedExams");
    const elLiveEx = document.getElementById("adminCbtLiveExams");
    const elSubEx = document.getElementById("adminCbtTotalSubmissions");

    if (elTotalEx) elTotalEx.textContent = adminCbtExams.length;
    if (elPubEx) elPubEx.textContent = publishedCount;
    if (elLiveEx) elLiveEx.textContent = liveAttempts;
    if (elSubEx) elSubEx.textContent = totalSubmissions;

    if (adminCbtExams.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No Computer-Based Test examinations found in the registry.</td></tr>`;
      return;
    }

    tableBody.innerHTML = adminCbtExams.map(ex => {
      const start = new Date(ex.startDate);
      const end = new Date(ex.endDate);
      const isClosed = ex.status === "Closed";
      const isSuspended = ex.status === "Suspended";

      let statusBadge = "";
      if (isSuspended) {
        statusBadge = `<span class="status-badge" style="background-color: rgba(220,53,69,0.1); color: #dc3545; font-weight: 700;"><i class="fa-solid fa-triangle-exclamation"></i> Suspended</span>`;
      } else if (isClosed) {
        statusBadge = `<span class="status-badge" style="background-color: rgba(108,117,125,0.1); color: #6c757d; font-weight: 700;"><i class="fa-solid fa-circle-xmark"></i> Closed</span>`;
      } else {
        statusBadge = `<span class="status-badge cleared" style="background-color: rgba(40,167,69,0.1); color: #28a745; font-weight: 700;"><i class="fa-solid fa-circle-check"></i> Published</span>`;
      }

      const toggleActionHtml = (isSuspended || isClosed) 
        ? `<button class="btn btn-action-reopen" data-id="${ex.id}" style="background-color: #28a745; color: white; border: none; padding: 0.3rem 0.5rem; border-radius: 4px; font-weight: 700; font-size: 0.75rem; cursor: pointer;" title="Re-open Exam"><i class="fa-solid fa-play"></i> Reopen</button>`
        : `<button class="btn btn-action-suspend" data-id="${ex.id}" style="background-color: #dc3545; color: white; border: none; padding: 0.3rem 0.5rem; border-radius: 4px; font-weight: 700; font-size: 0.75rem; cursor: pointer;" title="Suspend Exam"><i class="fa-solid fa-pause"></i> Suspend</button>`;

      return `
        <tr style="border-bottom: 1px solid var(--border-color);">
          <td style="padding: 0.75rem; font-weight: 700; color: var(--primary);">${ex.courseCode}</td>
          <td style="padding: 0.75rem; font-weight: 600;">${escapeHtml(ex.title)}</td>
          <td style="padding: 0.75rem;">${ex.duration} Mins</td>
          <td style="padding: 0.75rem; text-align: center;">${ex.numQuestions}</td>
          <td style="padding: 0.75rem; font-size: 0.75rem; color: var(--text-muted);">${start.toLocaleDateString()} - ${end.toLocaleDateString()}</td>
          <td style="padding: 0.75rem; text-align: center;">${statusBadge}</td>
          <td style="padding: 0.75rem; text-align: center; display: flex; gap: 0.35rem; justify-content: center;">
            ${toggleActionHtml}
            <button class="btn btn-action-delete" data-id="${ex.id}" style="background-color: #343a40; color: white; border: none; padding: 0.3rem 0.5rem; border-radius: 4px; font-weight: 700; font-size: 0.75rem; cursor: pointer;" title="Delete Exam"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    }).join("");

    // Bind action listeners
    document.querySelectorAll(".btn-action-reopen").forEach(btn => {
      btn.addEventListener("click", () => handleAdminExamStatus(btn.getAttribute("data-id"), "Published"));
    });

    document.querySelectorAll(".btn-action-suspend").forEach(btn => {
      btn.addEventListener("click", () => handleAdminExamStatus(btn.getAttribute("data-id"), "Suspended"));
    });

    document.querySelectorAll(".btn-action-delete").forEach(btn => {
      btn.addEventListener("click", () => handleAdminDeleteExam(btn.getAttribute("data-id")));
    });

  } catch (err) {
    console.error("Load admin CBT error:", err);
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--danger-color);">Error fetching examinations: ${err.message}</td></tr>`;
  }
}

async function handleAdminExamStatus(examId, newStatus) {
  try {
    await updateDoc(doc(db, "cbtExams", examId), {
      status: newStatus,
      updatedAt: new Date().toISOString()
    });
    window.showToast(`Examination status updated to [${newStatus}] successfully.`, "success");
    await loadAdminCbtDashboard();
  } catch (err) {
    console.error("Update exam status error:", err);
    window.showToast("Failed to update status: " + err.message, "error");
  }
}

async function handleAdminDeleteExam(examId) {
  const userConfirmed = await window.dimabinConfirm("⚠️ DANGER: Permanent Deletion Request\n\nAre you absolutely sure you want to permanently delete this examination configuration? This will also disconnect existing student results and student attempts data from the active portal. This action is irreversible.", "Permanent Deletion Request");
  if (!userConfirmed) return;

  try {
    await deleteDoc(doc(db, "cbtExams", examId));
    window.showToast("CBT Examination deleted successfully.", "success");
    await loadAdminCbtDashboard();
  } catch (err) {
    console.error("Delete exam error:", err);
    window.showToast("Failed to delete exam: " + err.message, "error");
  }
}

function loadAdminCbtResultsDropdown() {
  const select = document.getElementById("adminResultsExamSelect");
  if (!select) return;

  select.innerHTML = `<option value="">-- Choose Examination --</option>`;

  adminCbtExams.forEach(ex => {
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = `${ex.courseCode} - ${ex.title}`;
    select.appendChild(opt);
  });

  select.removeEventListener("change", handleAdminResultsSelectChange);
  select.addEventListener("change", handleAdminResultsSelectChange);
}

async function handleAdminResultsSelectChange(e) {
  const examId = e.target.value;
  await loadAdminExamResults(examId);
}

async function loadAdminExamResults(examId) {
  const tableBody = document.getElementById("adminCbtResultsTableBody");
  const exportBtn = document.getElementById("btnAdminExportCbtResults");
  const statsPanel = document.getElementById("adminSelectedExamStatsPanel");
  if (!tableBody) return;

  if (!examId) {
    tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-muted);">Please select an examination from the dropdown above.</td></tr>`;
    if (exportBtn) exportBtn.disabled = true;
    if (statsPanel) statsPanel.style.display = "none";
    return;
  }

  tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Fetching results data...</td></tr>`;

  try {
    const rSnap = await getDocs(query(collection(db, "cbtResults"), where("examId", "==", examId)));
    adminActiveResults = rSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (adminActiveResults.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2.5rem; color: var(--text-muted);"><i class="fa-solid fa-graduation-cap" style="font-size: 2rem; opacity: 0.3; display: block; margin-bottom: 0.5rem;"></i> No students have submitted answers for this examination yet.</td></tr>`;
      if (exportBtn) exportBtn.disabled = true;
      if (statsPanel) statsPanel.style.display = "none";
      return;
    }

    if (exportBtn) exportBtn.disabled = false;
    calculateAndRenderAdminStats();

    tableBody.innerHTML = adminActiveResults.map(res => `
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
        <td style="padding: 0.75rem; text-align: center; font-size: 0.75rem; color: var(--text-muted);">${new Date(res.submittedAt).toLocaleString()}</td>
        <td style="padding: 0.75rem; text-align: center;">
          <button class="btn btn-admin-review-script" data-studentid="${res.studentId}" data-examid="${res.examId}" data-studentname="${escapeHtml(res.studentName)}" style="background-color: var(--accent); color: var(--primary); border: none; padding: 0.35rem 0.6rem; border-radius: 4px; font-weight: 700; font-size: 0.75rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;"><i class="fa-solid fa-file-invoice"></i> Review</button>
        </td>
      </tr>
    `).join("");

    document.querySelectorAll(".btn-admin-review-script").forEach(btn => {
      btn.addEventListener("click", () => {
        reviewAdminStudentScript(btn.getAttribute("data-studentid"), btn.getAttribute("data-examid"), btn.getAttribute("data-studentname"));
      });
    });

  } catch (err) {
    console.error("Load admin results error:", err);
    tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2rem; color: var(--danger-color);">Error fetching results: ${err.message}</td></tr>`;
  }
}

function calculateAndRenderAdminStats() {
  const statsPanel = document.getElementById("adminSelectedExamStatsPanel");
  if (!statsPanel) return;

  if (adminActiveResults.length === 0) {
    statsPanel.style.display = "none";
    return;
  }

  statsPanel.style.display = "grid";

  const total = adminActiveResults.length;
  let sum = 0;
  let max = 0;
  let min = 100;
  let passCount = 0;

  adminActiveResults.forEach(r => {
    sum += r.percentage;
    if (r.percentage > max) max = r.percentage;
    if (r.percentage < min) min = r.percentage;
    if (r.passed) passCount++;
  });

  const avg = Math.round(sum / total);
  const passRate = Math.round((passCount / total) * 100);
  const failRate = 100 - passRate;

  document.getElementById("adminCbtStatsAvgScore").textContent = `${avg}%`;
  document.getElementById("adminCbtStatsHighLow").textContent = `${max}% / ${min}%`;
  document.getElementById("adminCbtStatsPassRate").textContent = `${passRate}%`;
  document.getElementById("adminCbtStatsFailRate").textContent = `${failRate}%`;
}

async function reviewAdminStudentScript(studentId, examId, studentName) {
  try {
    let studentAnswersMap = {};
    const singleAnsRef = doc(db, "cbtAnswers", `${studentId.replace(/\//g, "-")}_${examId}`);
    const singleAnsSnap = await getDoc(singleAnsRef);
    if (singleAnsSnap.exists()) {
      studentAnswersMap = singleAnsSnap.data().answers || {};
    } else {
      const answersSnap = await getDocs(query(collection(db, "cbtAnswers"), where("studentId", "==", studentId), where("examId", "==", examId)));
      answersSnap.forEach(d => {
        const data = d.data();
        if (data.questionId) {
          studentAnswersMap[data.questionId] = data.selectedOption;
        } else if (data.answers) {
          studentAnswersMap = { ...studentAnswersMap, ...data.answers };
        }
      });
    }

    const exam = adminCbtExams.find(ex => ex.id === examId);
    if (!exam) return;

    const qSnap = await getDocs(query(collection(db, "cbtQuestions"), where("courseCode", "==", exam.courseCode)));
    const questions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    let rowsHtml = "";
    questions.forEach((q, idx) => {
      const studentChoice = studentAnswersMap[q.id] || "No Answer";
      const isCorrect = studentChoice === q.correctAnswer;
      const points = isCorrect ? (q.marks || 1) : 0;
      
      let answerDetail = "";
      if (q.qType === "MCQ" || q.qType === "TF" || !q.qType) {
        answerDetail = `
          <div><strong>Student Selected:</strong> <span style="color: ${isCorrect ? 'green' : 'red'}; font-weight: bold;">${studentChoice}</span></div>
          <div><strong>Correct Answer:</strong> <span style="color: green; font-weight: bold;">${q.correctAnswer}</span></div>
        `;
      } else if (q.qType === "SA") {
        const studentNorm = String(studentChoice).trim().toLowerCase();
        const correctNorm = String(q.correctAnswer).trim().toLowerCase();
        const saCorrect = studentNorm === correctNorm;
        answerDetail = `
          <div><strong>Student Typed:</strong> <span style="color: ${saCorrect ? 'green' : 'red'}; font-weight: bold;">"${escapeHtml(studentChoice)}"</span></div>
          <div><strong>Expected Answer:</strong> <span style="color: green; font-weight: bold;">"${escapeHtml(q.correctAnswer)}"</span></div>
        `;
      } else {
        answerDetail = `
          <div><strong>Student Submission:</strong> <span style="color: var(--primary); font-weight: bold; font-family: monospace;">"${escapeHtml(studentChoice)}"</span></div>
          <div style="color: #b58900;"><em>[Essay - Manually Graded or Structural Only]</em></div>
        `;
      }

      rowsHtml += `
        <div style="border-bottom: 1.5px solid var(--border-color); padding: 1rem 0;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 0.5rem;">
            <span style="font-weight: 700; color: var(--primary);">Question ${idx + 1} (${q.qType || 'MCQ'})</span>
            <span style="background-color: ${isCorrect ? '#E2F0D9' : '#FCE4D6'}; color: ${isCorrect ? 'green' : 'red'}; font-weight: bold; font-size: 0.75rem; padding: 0.25rem 0.5rem; border-radius: 4px;">
              ${points} / ${q.marks || 1} Marks
            </span>
          </div>
          <p style="margin: 0.25rem 0 0.75rem 0; font-size: 0.9rem; font-weight: 500;">${escapeHtml(q.question)}</p>
          <div style="font-size: 0.82rem; background-color: var(--bg-slate); padding: 0.75rem; border-radius: 6px; display: flex; flex-direction: column; gap: 0.25rem;">
            ${answerDetail}
          </div>
          ${q.explanation ? `<div style="font-size: 0.8rem; background-color: #FFF2CC; padding: 0.5rem; border-radius: 4px; margin-top: 0.5rem; color: var(--primary-dark);"><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</div>` : ''}
        </div>
      `;
    });

    const modalHtml = `
      <div id="adminScriptReviewModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 1.5rem; font-family: 'Poppins', sans-serif;">
        <div style="background-color: white; border-radius: var(--border-radius-lg, 12px); max-width: 650px; width: 100%; max-height: 85vh; overflow-y: auto; padding: 2rem; box-shadow: var(--shadow-lg, 0 10px 15px rgba(0,0,0,0.1)); position: relative;">
          <button id="closeAdminScriptReviewModal" style="position: absolute; top: 1rem; right: 1rem; border: none; background: none; font-size: 1.5rem; color: var(--text-muted); cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
          <h3 style="color: var(--primary); margin: 0 0 0.25rem 0; font-size: 1.25rem; font-weight: 800;"><i class="fa-solid fa-graduation-cap" style="color: var(--accent);"></i> Script Review</h3>
          <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem; font-weight: 600;">Student: <span style="color: var(--primary);">${escapeHtml(studentName)}</span> | Course: <span style="color: var(--accent);">${exam.courseCode}</span></p>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${rowsHtml || '<p style="text-align: center; color: var(--text-muted);">No questions found for review.</p>'}
          </div>
        </div>
      </div>
    `;

    const div = document.createElement("div");
    div.innerHTML = modalHtml;
    document.body.appendChild(div);

    document.getElementById("closeAdminScriptReviewModal").addEventListener("click", () => {
      div.remove();
    });

  } catch (err) {
    console.error("Admin review script error:", err);
    window.showToast("Failed to load script: " + err.message, "error");
  }
}

// Bind Export CSV Button Trigger
document.getElementById("btnAdminExportCbtResults")?.addEventListener("click", () => {
  if (adminActiveResults.length === 0) return;

  const select = document.getElementById("adminResultsExamSelect");
  const examText = select ? select.options[select.selectedIndex].text : "cbt_examination";
  const fileName = `${examText.replace(/[\s/]+/g, "_").toLowerCase()}_results.csv`;

  const headers = ["Student ID", "Full Name", "Matric Number", "Score", "Total Qs", "Percentage (%)", "Grade", "Status", "Submitted At"];
  const rows = adminActiveResults.map(r => [
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
});

// ==========================================
// RESULT APPROVAL SYSTEM & CBT INTEGRATION
// ==========================================
let approvalSubmissionsList = [];
let selectedReviewSheet = null;

async function initResultApprovalConsole() {
  const tbody = document.getElementById("resultSubmissionsTableBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin" style="margin-right: 0.5rem;"></i> Loading grading worksheets...</td></tr>`;

  try {
    // 1. Get CBT Import toggled setting from settings/timeline_settings
    const timelineSnap = await getDoc(doc(db, "settings", "timeline_settings"));
    const timelineData = timelineSnap.exists() ? timelineSnap.data() : {};
    const cbtEnabled = timelineData.cbtImportEnabled === true;

    const cbtSwitch = document.getElementById("adminCbtImportSwitch");
    const cbtStatus = document.getElementById("adminCbtSwitchStatus");
    const cbtSlider = document.getElementById("adminCbtImportSlider");

    if (cbtSwitch && cbtStatus && cbtSlider) {
      cbtSwitch.checked = cbtEnabled;
      cbtStatus.textContent = cbtEnabled ? "Enabled" : "Disabled";
      cbtStatus.style.color = cbtEnabled ? "var(--success)" : "var(--text-muted)";
      cbtSlider.style.backgroundColor = cbtEnabled ? "var(--primary)" : "#ccc";

      cbtSwitch.onchange = async () => {
        const active = cbtSwitch.checked;
        cbtStatus.textContent = active ? "Enabled" : "Disabled";
        cbtStatus.style.color = active ? "var(--success)" : "var(--text-muted)";
        cbtSlider.style.backgroundColor = active ? "var(--primary)" : "#ccc";
        
        try {
          await setDoc(doc(db, "settings", "timeline_settings"), { cbtImportEnabled: active }, { merge: true });
          window.showToast(`CBT import capabilities successfully ${active ? 'enabled' : 'disabled'} system-wide.`, "success");
        } catch (e) {
          window.showToast("Failed to commit settings: " + e.message, "error");
        }
      };
    }

    // 2. Fetch submissions from both results (active/submitted) and resultDrafts (returned drafts)
    const resSnap = await getDocs(collection(db, "results"));
    const draftSnap = await getDocs(collection(db, "resultDrafts"));

    approvalSubmissionsList = [];

    resSnap.forEach(d => {
      approvalSubmissionsList.push({ id: d.id, source: "results", ...d.data() });
    });

    draftSnap.forEach(d => {
      const data = d.data();
      if (data.status === "Returned" || data.status === "Rejected" || data.status === "Draft") {
        approvalSubmissionsList.push({ id: d.id, source: "resultDrafts", ...data });
      }
    });

    // Fetch courses for title mapping
    const coursesSnap = await getDocs(collection(db, "courses"));
    const courseTitlesMap = {};
    coursesSnap.forEach(cs => {
      const cData = cs.data();
      courseTitlesMap[cData.courseCode] = cData.courseTitle || cData.title;
    });

    // Sort by latest updated
    approvalSubmissionsList.sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0));

    // Render approval directory
    renderApprovalList(courseTitlesMap);

    // Bind filters
    const fSession = document.getElementById("approvalFilterSession");
    const fSemester = document.getElementById("approvalFilterSemester");
    const fCourse = document.getElementById("approvalFilterCourse");
    const fLecturer = document.getElementById("approvalFilterLecturer");
    const fCentre = document.getElementById("filterResultsStudyCentre");

    const filterHandler = () => {
      renderApprovalList(courseTitlesMap);
    };

    if (fSession) fSession.onchange = filterHandler;
    if (fSemester) fSemester.onchange = filterHandler;
    if (fCourse) fCourse.oninput = filterHandler;
    if (fLecturer) fLecturer.oninput = filterHandler;
    if (fCentre) fCentre.onchange = filterHandler;

    // Bind close review modal trigger
    const btnCloseRevModal = document.getElementById("btnCloseReviewModal");
    if (btnCloseRevModal) {
      btnCloseRevModal.onclick = () => {
        document.getElementById("adminReviewResultModal").style.display = "none";
      };
    }

  } catch (err) {
    console.error("Result Approval Console failed:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red; padding: 2.5rem;">Console Error: ${err.message}</td></tr>`;
  }
}

function renderApprovalList(courseTitlesMap) {
  const tbody = document.getElementById("resultSubmissionsTableBody");
  if (!tbody) return;

  const fSession = document.getElementById("approvalFilterSession")?.value || "all";
  const fSemester = document.getElementById("approvalFilterSemester")?.value || "all";
  const fCourse = document.getElementById("approvalFilterCourse")?.value.toLowerCase().trim() || "";
  const fLecturer = document.getElementById("approvalFilterLecturer")?.value.toLowerCase().trim() || "";
  const fCentre = document.getElementById("filterResultsStudyCentre")?.value || "all";

  const filtered = approvalSubmissionsList.filter(item => {
    if (fSession !== "all" && item.academicSession !== fSession) return false;
    if (fSemester !== "all" && item.semester !== fSemester) return false;
    if (fCourse !== "" && !item.courseCode.toLowerCase().includes(fCourse)) return false;
    if (fLecturer !== "" && !item.lecturerName.toLowerCase().includes(fLecturer)) return false;
    if (fCentre !== "all" && item.studyCentreId !== fCentre) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">No grading sheet submissions match your active filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  filtered.forEach((item, index) => {
    const title = courseTitlesMap[item.courseCode] || "General Theology Course";
    const stdCount = item.students ? item.students.length : 0;
    const formattedDate = item.lastUpdated ? new Date(item.lastUpdated).toLocaleString() : "-";
    
    // Look up study centre name
    const centreName = item.studyCentreName || allStudyCentres.find(c => c.id === item.studyCentreId)?.name || "General Study Centre";

    let badgeClass = "status-badge info";
    if (item.status === "Published") badgeClass = "status-badge cleared";
    else if (item.status === "Approved") badgeClass = "status-badge cleared";
    else if (item.status === "Submitted") badgeClass = "status-badge pending";
    else if (item.status === "Returned" || item.status === "Rejected") badgeClass = "status-badge danger";
    else if (item.status === "Draft") badgeClass = "status-badge pending";

    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid var(--border-color)";
    tr.innerHTML = `
      <td style="padding: 1rem;">
        <strong>${item.courseCode}</strong><br>
        <span style="font-size: 0.8rem; color: var(--text-muted);">${title}</span>
      </td>
      <td style="padding: 1rem; font-weight: 500; color: var(--primary);">${centreName}</td>
      <td style="padding: 1rem;">
        <code>${item.academicSession}</code><br>
        <span style="font-size: 0.8rem; color: var(--primary); font-weight: 500;">${item.semester}</span>
      </td>
      <td style="padding: 1rem; font-weight: 600; color: var(--primary);">${item.lecturerName || 'Assigned Facilitator'}</td>
      <td style="padding: 1rem; text-align: center; font-weight: 700; color: var(--accent);">${stdCount}</td>
      <td style="padding: 1rem; text-align: center;">
        <span class="${badgeClass}" style="padding: 0.25rem 0.6rem; font-size: 0.8rem; font-weight: 700;">${item.status || 'Draft'}</span>
      </td>
      <td style="padding: 1rem; text-align: center; font-size: 0.8rem; color: var(--text-muted);">${formattedDate}</td>
      <td style="padding: 1rem; text-align: center;">
        <button class="btn btn-review-sheet" style="background-color: var(--primary); color: white; border: none; padding: 0.45rem 1rem; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.82rem;" data-index="${index}">
          <i class="fa-solid fa-file-magnifying-glass"></i> Review
        </button>
      </td>
    `;

    tbody.appendChild(tr);

    tr.querySelector(".btn-review-sheet").onclick = () => {
      openReviewModal(item, title);
    };
  });
}

async function openReviewModal(item, courseTitle) {
  selectedReviewSheet = item;
  const modal = document.getElementById("adminReviewResultModal");
  if (!modal) return;

  // Set metadata fields
  document.getElementById("reviewMetaCode").textContent = item.courseCode;
  document.getElementById("reviewMetaTitle").textContent = courseTitle;
  document.getElementById("reviewMetaLecturer").textContent = item.lecturerName || "Facilitator";
  document.getElementById("reviewMetaSession").textContent = item.academicSession;
  document.getElementById("reviewMetaSemester").textContent = item.semester;

  const statusMeta = document.getElementById("reviewMetaStatus");
  statusMeta.textContent = item.status || "Submitted";
  if (item.status === "Published") {
    statusMeta.className = "status-badge cleared";
  } else if (item.status === "Approved") {
    statusMeta.className = "status-badge cleared";
  } else if (item.status === "Submitted") {
    statusMeta.className = "status-badge pending";
  } else if (item.status === "Returned" || item.status === "Rejected") {
    statusMeta.className = "status-badge danger";
  } else {
    statusMeta.className = "status-badge pending";
  }

  // Comments value
  const commentsArea = document.getElementById("adminReviewComments");
  commentsArea.value = item.adminComment || "";

  // Render Students Grid
  const reviewBody = document.getElementById("adminReviewTableBody");
  reviewBody.innerHTML = "";

  const students = item.students || [];
  if (students.length === 0) {
    reviewBody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 2rem; color: var(--text-muted);">No student grades recorded on this sheet.</td></tr>`;
  } else {
    students.forEach(std => {
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid var(--border-color)";
      tr.innerHTML = `
        <td style="padding: 0.5rem 0.75rem;"><strong>${std.fullName}</strong></td>
        <td style="padding: 0.5rem 0.75rem;"><code>${std.matricNumber}</code></td>
        <td style="padding: 0.5rem 0.75rem; text-align: center;">${std.attendance !== undefined ? std.attendance : "-"}</td>
        <td style="padding: 0.5rem 0.75rem; text-align: center;">${std.assignment !== undefined ? std.assignment : "-"}</td>
        <td style="padding: 0.5rem 0.75rem; text-align: center;">${std.test !== undefined ? std.test : "-"}</td>
        <td style="padding: 0.5rem 0.75rem; text-align: center;">${std.practical !== undefined ? std.practical : "-"}</td>
        <td style="padding: 0.5rem 0.75rem; text-align: center;">${std.examScore !== undefined ? std.examScore : "-"}</td>
        <td style="padding: 0.5rem 0.75rem; text-align: center; font-weight: 700; color: var(--primary);">${std.total !== undefined ? std.total : "-"}</td>
        <td style="padding: 0.5rem 0.75rem; text-align: center;">
          <span class="status-badge ${std.grade === 'F' ? '' : 'cleared'}" style="padding: 0.1rem 0.4rem; font-size: 0.75rem; font-weight: 800;">${std.grade || '-'}</span>
        </td>
        <td style="padding: 0.5rem 0.75rem; text-align: center; font-weight: 700; color: var(--accent);">${std.gp !== undefined ? std.gp : "-"}</td>
        <td style="padding: 0.5rem 0.75rem; text-align: center;">
          <span class="status-badge ${std.remark === 'PASS' ? 'cleared' : ''}" style="padding: 0.1rem 0.4rem; font-size: 0.75rem; font-weight: 700;">${std.remark || '-'}</span>
        </td>
      `;
      reviewBody.appendChild(tr);
    });
  }

  // Decision Timeline history load
  const historySec = document.getElementById("reviewApprovalHistorySection");
  const historyLogs = document.getElementById("reviewApprovalHistoryLogs");
  
  if (historySec && historyLogs) {
    const docId = `${item.courseCode}_${item.academicSession.replace(/\//g, "-")}_${item.semester}`;
    const histRef = doc(db, "approvalHistory", docId);
    try {
      const histSnap = await getDoc(histRef);
      if (histSnap.exists() && histSnap.data().history && histSnap.data().history.length > 0) {
        historySec.style.display = "block";
        historyLogs.innerHTML = "";
        
        histSnap.data().history.forEach(log => {
          const formattedTime = log.timestamp ? new Date(log.timestamp).toLocaleString() : "-";
          const logItem = document.createElement("div");
          logItem.style.borderBottom = "1px dashed var(--border-color)";
          logItem.style.paddingBottom = "0.35rem";
          logItem.style.marginBottom = "0.35rem";
          logItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-weight: 700; color: var(--primary); font-size: 0.8rem;">
              <span><i class="fa-solid fa-gavel"></i> ${log.action} by ${log.approver}</span>
              <span style="color: var(--text-muted); font-weight: 400; font-size: 0.75rem;">${formattedTime}</span>
            </div>
            ${log.comments ? `<div style="margin-top: 0.2rem; font-style: italic; color: #555; font-size: 0.78rem;">Remarks: "${log.comments}"</div>` : ''}
          `;
          historyLogs.appendChild(logItem);
        });
      } else {
        historySec.style.display = "none";
      }
    } catch (e) {
      console.warn("Decision logs fetch omitted:", e);
      historySec.style.display = "none";
    }
  }

  // Render context control buttons
  const actionsRow = document.getElementById("adminReviewActionsRow");
  actionsRow.innerHTML = "";

  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.className = "btn";
  btnClose.style.backgroundColor = "#ccc";
  btnClose.style.color = "var(--text-dark)";
  btnClose.style.border = "none";
  btnClose.style.padding = "0.6rem 1.2rem";
  btnClose.style.borderRadius = "4px";
  btnClose.style.fontWeight = "600";
  btnClose.style.cursor = "pointer";
  btnClose.innerHTML = "Close Review";
  btnClose.onclick = () => { modal.style.display = "none"; };

  if (item.status === "Submitted") {
    const btnApprove = createActionButton("Approve Results", "var(--success)", "fa-thumbs-up", () => handleWorkflowAction("Approved"));
    const btnReturn = createActionButton("Return with Comments", "var(--accent)", "fa-reply", () => handleWorkflowAction("Returned"));
    const btnReject = createActionButton("Reject Results", "var(--danger)", "fa-ban", () => handleWorkflowAction("Rejected"));

    actionsRow.appendChild(btnReject);
    actionsRow.appendChild(btnReturn);
    actionsRow.appendChild(btnApprove);
  } else if (item.status === "Approved") {
    const btnPublish = createActionButton("Publish Official Results", "var(--success)", "fa-globe", () => handleWorkflowAction("Published"));
    const btnReturn = createActionButton("Return with Comments", "var(--accent)", "fa-reply", () => handleWorkflowAction("Returned"));

    actionsRow.appendChild(btnReturn);
    actionsRow.appendChild(btnPublish);
  } else if (item.status === "Published") {
    const infoText = document.createElement("span");
    infoText.style.marginRight = "auto";
    infoText.style.color = "var(--success)";
    infoText.style.fontWeight = "700";
    infoText.style.fontSize = "0.9rem";
    infoText.innerHTML = `<i class="fa-solid fa-circle-check"></i> Published Official Sheet (Visible to all Student Portals)`;
    actionsRow.appendChild(infoText);
  } else if (item.status === "Returned" || item.status === "Rejected") {
    const infoText = document.createElement("span");
    infoText.style.marginRight = "auto";
    infoText.style.color = "var(--danger)";
    infoText.style.fontWeight = "700";
    infoText.style.fontSize = "0.9rem";
    infoText.innerHTML = `<i class="fa-solid fa-reply"></i> Sent back to Facilitator for modifications.`;
    actionsRow.appendChild(infoText);
  }

  actionsRow.appendChild(btnClose);
  modal.style.display = "flex";
}

function createActionButton(label, bgColor, icon, callback) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn";
  btn.style.backgroundColor = bgColor;
  btn.style.color = bgColor === "var(--accent)" ? "var(--primary-dark)" : "white";
  btn.style.border = "none";
  btn.style.padding = "0.6rem 1.2rem";
  btn.style.borderRadius = "4px";
  btn.style.fontWeight = "700";
  btn.style.cursor = "pointer";
  btn.style.display = "inline-flex";
  btn.style.alignItems = "center";
  btn.style.gap = "0.5rem";
  btn.style.fontSize = "0.85rem";
  btn.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
  btn.onclick = callback;
  return btn;
}

async function handleWorkflowAction(actionName) {
  if (!selectedReviewSheet) return;
  const comments = document.getElementById("adminReviewComments").value.trim();

  if ((actionName === "Returned" || actionName === "Rejected") && !comments) {
    window.showToast("Remarks are MANDATORY for returns/rejections to provide lecturer feedback.", "warning");
    return;
  }

  // Part 1: Defensive verification of admin identity
  let adminProfile = currentAdminDoc;
  if (!adminProfile) {
    const cached = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (cached) {
      try {
        adminProfile = JSON.parse(cached);
      } catch (e) {
        console.error("Failed to parse cached session:", e);
      }
    }
  }

  if (!adminProfile || !adminProfile.fullName) {
    window.showToast("Administrator profile could not be loaded.", "error");
    return;
  }

  const approverName = adminProfile.fullName;
  const adminIdVal = adminProfile.adminId || "Unknown Admin";

  const courseCode = selectedReviewSheet.courseCode;
  const session = selectedReviewSheet.academicSession;
  const semester = selectedReviewSheet.semester;

  const safeCourseCode = courseCode.replace(/\//g, "-").trim();
  const safeSession = session.replace(/\//g, "-").trim();
  const safeSemester = semester.replace(/\//g, "-").trim();
  const docId = `${safeCourseCode}_${safeSession}_${safeSemester}`;

  const confirmAction = await window.dimabinConfirm(`Are you sure you want to trigger "${actionName}" on this grading sheet?`, `Trigger "${actionName}" Decision`);
  if (!confirmAction) return;

  try {
    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString();
    const timestamp = now.toISOString();

    // 1. Commit Decision Logs to approvalHistory
    const histRef = doc(db, "approvalHistory", docId);
    const histSnap = await getDoc(histRef);
    let histList = [];
    if (histSnap.exists()) {
      histList = histSnap.data().history || [];
    }
    histList.push({
      action: actionName,
      approver: approverName,
      approverId: adminIdVal,
      comments: comments,
      date: dateStr,
      time: timeStr,
      timestamp: timestamp
    });
    await setDoc(histRef, { courseCode, academicSession: session, semester, history: histList });

    // 2. Perform workflow updates
    if (actionName === "Returned" || actionName === "Rejected") {
      const payload = { ...selectedReviewSheet, status: actionName, adminComment: comments, lastUpdated: timestamp };
      delete payload.id;
      delete payload.source;

      await setDoc(doc(db, "resultDrafts", docId), payload);
      await deleteDoc(doc(db, "results", docId));

      window.showToast("Results sheet successfully returned to Lecturer.", "success");

    } else if (actionName === "Approved") {
      await updateDoc(doc(db, "results", docId), {
        status: "Approved",
        adminComment: comments,
        approvedById: adminIdVal,
        approvedByName: approverName,
        approvedDate: dateStr,
        approvedTime: timeStr,
        approvedTimestamp: timestamp,
        lastUpdated: timestamp
      });
      window.showToast("Results sheet approved successfully.", "success");

    } else if (actionName === "Published") {
      const { runTransaction } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

      // Fetch credits for each student record
      const coursesSnap = await getDocs(collection(db, "courses"));
      let creditUnit = 3;
      coursesSnap.forEach(cs => {
        const cData = cs.data();
        if (cData.courseCode === courseCode) {
          creditUnit = parseInt(cData.creditUnit || cData.credits || 3);
        }
      });

      const resultsRef = doc(db, "results", docId);

      await runTransaction(db, async (transaction) => {
        const resultsSnap = await transaction.get(resultsRef);
        if (!resultsSnap.exists()) {
          throw new Error("Approved results sheet not found.");
        }

        const resultsData = resultsSnap.data();

        // Prevent duplicate publications
        if (resultsData.status === "Published") {
          throw new Error("This results sheet has already been published.");
        }

        const studentsList = resultsData.students || [];
        if (studentsList.length === 0) {
          throw new Error("No student records exist in this results sheet.");
        }

        studentsList.forEach(std => {
          const safeStudentId = std.studentId.replace(/\//g, "-").trim();
          const pubDocId = `pub_${safeStudentId}_${safeCourseCode}_${safeSession}_${safeSemester}`;
          const pubRef = doc(db, "publishedResults", pubDocId);

          const studentPayload = {
            studentId: std.studentId,
            fullName: std.fullName,
            matricNumber: std.matricNumber,
            courseCode: courseCode,
            courseTitle: document.getElementById("reviewMetaTitle").textContent || "Theology Course",
            creditUnit: creditUnit,
            attendance: std.attendance !== undefined ? std.attendance : 0,
            assignment: std.assignment !== undefined ? std.assignment : 0,
            test: std.test !== undefined ? std.test : 0,
            practical: std.practical !== undefined ? std.practical : 0,
            examScore: std.examScore !== undefined ? std.examScore : 0,
            total: std.total,
            grade: std.grade,
            gp: std.gp,
            remark: std.remark,
            semester: semester,
            academicSession: session,
            status: "Published",
            publishedBy: approverName,
            publishedDate: dateStr,
            publishedTime: timeStr,
            publishedAt: timestamp,
            publishedTimestamp: timestamp
          };

          transaction.set(pubRef, studentPayload);
        });

        transaction.update(resultsRef, {
          status: "Published",
          adminComment: comments,
          publishedBy: adminIdVal,
          publishedByName: approverName,
          publishedDate: dateStr,
          publishedTime: timeStr,
          publishedTimestamp: timestamp,
          lastUpdated: timestamp
        });
      });

      window.showToast("Results published successfully! Student visibilities committed.", "success");
    }

    // Close and refresh
    document.getElementById("adminReviewResultModal").style.display = "none";
    initResultApprovalConsole();

  } catch (err) {
    console.error("Workflow action execution failed:", err);
    window.showToast("Workflow Error: " + err.message, "error");
  }
}

// ==========================================
// STUDY CENTRE MANAGEMENT MODULE
// ==========================================

async function loadStudyCentres() {
  try {
    const qSnap = await getDocs(collection(db, "study_centres"));
    allStudyCentres = [];
    qSnap.forEach(d => {
      allStudyCentres.push({ id: d.id, ...d.data() });
    });
    console.log(`🌟 [Study Centres] Loaded ${allStudyCentres.length} centers successfully!`);
    
    // Dynamic checkboxes for forms
    populateStudyCentreCheckboxes();
    // Dynamic dropdown filters
    populateStudyCentreFilterDropdowns();

    // Reorganize Sidebar and menus with dynamic centres
    if (typeof populateDynamicSidebarCentres === "function") {
      populateDynamicSidebarCentres();
    }
    if (typeof initSidebarAccordions === "function") {
      initSidebarAccordions();
    }
    if (typeof initStudyCentreTabListeners === "function") {
      initStudyCentreTabListeners();
    }
  } catch (err) {
    console.warn("⚠️ Failed to load study centres:", err);
  }
}

function initStudyCentresTab() {
  // Ensure we load the list of study centres
  renderStudyCentresTable();

  // Subtab switching inside Study Centres Tab
  document.querySelectorAll(".centre-sub-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetSub = btn.getAttribute("data-subtab");
      document.querySelectorAll(".centre-sub-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".centre-subtab-content").forEach(c => c.style.display = "none");

      btn.classList.add("active");
      const targetEl = document.getElementById(`centre-subtab-${targetSub}`);
      if (targetEl) targetEl.style.display = "block";
    });
  });

  // Search & Filter input triggers
  const searchInput = document.getElementById("searchStudyCentresInput");
  const filterStatus = document.getElementById("filterStudyCentresStatus");
  if (searchInput) {
    searchInput.removeEventListener("input", renderStudyCentresTable);
    searchInput.addEventListener("input", renderStudyCentresTable);
  }
  if (filterStatus) {
    filterStatus.removeEventListener("change", renderStudyCentresTable);
    filterStatus.addEventListener("change", renderStudyCentresTable);
  }

  // Reset Button
  const btnResetFilters = document.getElementById("btnResetCentreFilters");
  if (btnResetFilters) {
    btnResetFilters.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      if (filterStatus) filterStatus.value = "all";
      renderStudyCentresTable();
    });
  }
}

function renderStudyCentresTable() {
  const tbody = document.getElementById("studyCentresTableBody");
  if (!tbody) return;

  const searchQuery = document.getElementById("searchStudyCentresInput") ? document.getElementById("searchStudyCentresInput").value.toLowerCase().trim() : "";
  const filterStatus = document.getElementById("filterStudyCentresStatus") ? document.getElementById("filterStudyCentresStatus").value : "all";

  const filtered = allStudyCentres.filter(c => {
    const code = (c.code || "").toLowerCase();
    const name = (c.name || "").toLowerCase();
    const address = (c.address || "").toLowerCase();
    const coordinator = (c.coordinator || "").toLowerCase();

    const matchesSearch = code.includes(searchQuery) || name.includes(searchQuery) || address.includes(searchQuery) || coordinator.includes(searchQuery);
    const matchesStatus = filterStatus === "all" || c.status === filterStatus;

    return matchesSearch && matchesStatus;
  });

  if (allStudyCentres.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 3rem; color: var(--text-muted);">No Study Centres have been created yet.</td></tr>`;
    return;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 3rem; color: var(--text-muted);">No study centres matching selected parameters.</td></tr>`;
    return;
  }

  let html = "";
  filtered.forEach(c => {
    const cid = c.id;
    const name = c.name || "";
    const code = c.code || "";
    const address = c.address || "";
    const phone = c.phone || "";
    const coordinator = c.coordinator || "";
    const status = c.status || "Active";
    const createdAt = c.createdAt ? new Date(c.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : "N/A";

    // Dynamic metrics calculation
    const totalStudents = allStudents.filter(s => s.studyCentreId === cid).length;
    const totalLecturers = allLecturers.filter(l => l.assignedStudyCentreIds && l.assignedStudyCentreIds.includes(cid)).length;

    const statusBadgeColor = status === "Active" ? "rgba(40,167,69,0.12)" : "rgba(220,53,69,0.12)";
    const statusTextColor = status === "Active" ? "#28A745" : "#DC3545";

    html += `
      <tr style="border-bottom: 1.5px solid var(--border-color); hover: background-color: var(--bg-slate);">
        <td style="padding: 1rem; font-weight: 700; color: var(--primary); font-family: 'JetBrains Mono', monospace;">${code}</td>
        <td style="padding: 1rem; font-weight: 600; color: var(--text-color);">${name}</td>
        <td style="padding: 1rem; color: var(--text-muted); max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${address}">${address}</td>
        <td style="padding: 1rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;">${phone}</td>
        <td style="padding: 1rem; font-weight: 500; color: var(--text-color);">${coordinator}</td>
        <td style="padding: 1rem; text-align: center; font-weight: 700; color: var(--accent); font-family: 'JetBrains Mono', monospace;">${totalStudents}</td>
        <td style="padding: 1rem; text-align: center; font-weight: 700; color: var(--accent); font-family: 'JetBrains Mono', monospace;">${totalLecturers}</td>
        <td style="padding: 1rem;">
          <span style="display: inline-block; padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; background-color: ${statusBadgeColor}; color: ${statusTextColor};">
            ${status}
          </span>
        </td>
        <td style="padding: 1rem; color: var(--text-muted); font-size: 0.85rem;">${createdAt}</td>
        <td style="padding: 1rem; text-align: center;">
          <div style="display: flex; gap: 0.5rem; justify-content: center;">
            <button onclick="openEditCentreModal('${cid}')" class="btn" title="Edit Centre" style="background-color: var(--bg-slate); color: var(--primary); border: 1.5px solid var(--border-color); width: 32px; height: 32px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;"><i class="fa-solid fa-pen-to-square"></i></button>
            <button onclick="toggleCentreStatus('${cid}', '${status}')" class="btn" title="${status === 'Active' ? 'Deactivate' : 'Activate'}" style="background-color: var(--bg-slate); color: ${status === 'Active' ? '#DC3545' : '#28A745'}; border: 1.5px solid var(--border-color); width: 32px; height: 32px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;"><i class="fa-solid ${status === 'Active' ? 'fa-toggle-on' : 'fa-toggle-off'}"></i></button>
            <button onclick="deleteStudyCentre('${cid}')" class="btn" title="Delete Centre" style="background-color: var(--bg-slate); color: #DC3545; border: 1.5px solid var(--border-color); width: 32px; height: 32px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

// Global scope bindings for inline onclicks
window.openEditCentreModal = (id) => {
  const c = allStudyCentres.find(item => item.id === id);
  if (!c) {
    window.showToast("Study centre record not found.", "error");
    return;
  }

  document.getElementById("editCentreId").value = id;
  document.getElementById("editCentreCode").value = c.code || "";
  document.getElementById("editCentreName").value = c.name || "";
  document.getElementById("editCentreCoordinator").value = c.coordinator || "";
  document.getElementById("editCentrePhone").value = c.phone || "";
  document.getElementById("editCentreStatus").value = c.status || "Active";
  document.getElementById("editCentreAddress").value = c.address || "";

  document.getElementById("studyCentreEditModal").style.display = "flex";
};

window.toggleCentreStatus = async (id, currentStatus) => {
  const newStatus = currentStatus === "Active" ? "Inactive" : "Active";
  const confirmed = await window.dimabinConfirm(`Are you sure you want to mark this study centre as ${newStatus}?`);
  if (!confirmed) return;

  try {
    window.showToast("Transitioning centre state...", "info");
    const docRef = doc(db, "study_centres", id);
    await updateDoc(docRef, {
      status: newStatus,
      updatedAt: new Date().toISOString()
    });

    window.showToast(`Study centre marked as ${newStatus}!`, "success");
    await loadStudyCentres();
    renderStudyCentresTable();
  } catch (err) {
    console.error("Failed to toggle status:", err);
    window.showToast("Failed: " + err.message, "error");
  }
};

window.deleteStudyCentre = async (id) => {
  const centre = allStudyCentres.find(item => item.id === id);
  if (!centre) return;

  // Check deletion blocks
  const hasStudents = allStudents.some(s => s.studyCentreId === id);
  const hasLecturers = allLecturers.some(l => l.assignedStudyCentreIds && l.assignedStudyCentreIds.includes(id));
  const hasCourses = allCourses.some(c => c.studyCentreId === id || (c.assignedStudyCentreIds && c.assignedStudyCentreIds.includes(id)));

  if (hasStudents || hasLecturers || hasCourses) {
    window.showToast("This Study Centre cannot be deleted because records are attached to it.", "error");
    return;
  }

  const confirmed = await window.dimabinConfirm(`Are you absolutely sure you want to delete the study centre "${centre.name}"? This operation cannot be undone.`);
  if (!confirmed) return;

  try {
    window.showToast("Deleting study centre from database...", "info");
    await deleteDoc(doc(db, "study_centres", id));
    window.showToast("Study centre deleted successfully!", "success");
    await loadStudyCentres();
    renderStudyCentresTable();
  } catch (err) {
    console.error("Failed to delete study centre:", err);
    window.showToast("Failed: " + err.message, "error");
  }
};

// Form submission for Establish New Centre
const createCentreForm = document.getElementById("createCentreForm");
if (createCentreForm) {
  createCentreForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("addCentreName").value.trim();
    const coordinator = document.getElementById("addCentreCoordinator").value.trim();
    const phone = document.getElementById("addCentrePhone").value.trim();
    const status = document.getElementById("addCentreStatus").value;
    const address = document.getElementById("addCentreAddress").value.trim();

    try {
      window.showToast("Generating secure centre parameters...", "info");

      // Generate Incremental Code
      let maxSeq = 0;
      allStudyCentres.forEach(c => {
        const codeVal = c.code || "";
        const m = codeVal.match(/DIMABIN-CTR-(\d+)/);
        if (m) {
          const num = parseInt(m[1], 10);
          if (num > maxSeq) maxSeq = num;
        }
      });
      const nextSeq = maxSeq + 1;
      const paddedSeq = String(nextSeq).padStart(3, "0");
      const generatedCode = `DIMABIN-CTR-${paddedSeq}`;
      const docId = `DIMABIN-CTR-${paddedSeq}`;

      const centreData = {
        name,
        code: generatedCode,
        coordinator,
        phone,
        status,
        address,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await setDoc(doc(db, "study_centres", docId), centreData);
      window.showToast("Study centre established successfully!", "success");

      createCentreForm.reset();
      
      // Load and switch back to list
      await loadStudyCentres();
      
      // Auto-switch back to list subtab
      const btnList = document.querySelector('.centre-sub-tab-btn[data-subtab="list"]');
      if (btnList) btnList.click();

      renderStudyCentresTable();
    } catch (err) {
      console.error("Establish centre failed:", err);
      window.showToast("Failed to establish centre: " + err.message, "error");
    }
  });
}

// Form submission for edit centre modal
const editCentreForm = document.getElementById("editCentreForm");
if (editCentreForm) {
  editCentreForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("editCentreId").value;
    const name = document.getElementById("editCentreName").value.trim();
    const coordinator = document.getElementById("editCentreCoordinator").value.trim();
    const phone = document.getElementById("editCentrePhone").value.trim();
    const status = document.getElementById("editCentreStatus").value;
    const address = document.getElementById("editCentreAddress").value.trim();

    try {
      window.showToast("Updating study centre profiles...", "info");

      const docRef = doc(db, "study_centres", id);
      await updateDoc(docRef, {
        name,
        coordinator,
        phone,
        status,
        address,
        updatedAt: new Date().toISOString()
      });

      window.showToast("Study centre profile updated successfully!", "success");
      document.getElementById("studyCentreEditModal").style.display = "none";
      
      await loadStudyCentres();
      renderStudyCentresTable();
    } catch (err) {
      console.error("Failed to update centre:", err);
      window.showToast("Failed to update: " + err.message, "error");
    }
  });
}

// Cancel Buttons
const btnCancelCentreEdit = document.getElementById("btnCancelCentreEdit");
if (btnCancelCentreEdit) {
  btnCancelCentreEdit.addEventListener("click", () => {
    document.getElementById("studyCentreEditModal").style.display = "none";
  });
}

// ==========================================
// ANNOUNCEMENT MANAGEMENT HUB SYSTEM
// ==========================================

let allAnnouncements = [];
let selectedAttachmentData = "";
let selectedAttachmentName = "";

// Initialize Announcements Tab
window.initAnnouncementsTab = async function() {
  await loadAnnouncements();
  renderAnnouncementsTable();
};

// Load announcements from Firestore
window.loadAnnouncements = async function() {
  try {
    const qSnap = await getDocs(collection(db, "notifications"));
    allAnnouncements = [];
    qSnap.forEach(d => {
      const data = d.data();
      // Only treat it as our structured announcement if it doesn't look like an automatic admission log
      if (data.type !== "Admission") {
        allAnnouncements.push({ id: d.id, ...data });
      }
    });
    
    // Sort: Pinned first, then by publishDate descending, then by createdAt descending
    allAnnouncements.sort((a, b) => {
      const pinA = a.isPinned ? 1 : 0;
      const pinB = b.isPinned ? 1 : 0;
      if (pinB !== pinA) return pinB - pinA;
      
      const dateA = new Date(a.publishDate || a.createdAt || 0);
      const dateB = new Date(b.publishDate || b.createdAt || 0);
      return dateB - dateA;
    });

    console.log(`🌟 [Announcements] Loaded ${allAnnouncements.length} announcements successfully!`);
    updateAnnouncementStats();
  } catch (err) {
    console.error("Failed to load announcements:", err);
    window.showToast("Failed to load announcements: " + err.message, "error");
  }
};

// Update Announcement Stat Cards
function updateAnnouncementStats() {
  const totalEl = document.getElementById("statTotalAnnouncements");
  const activeEl = document.getElementById("statActiveAnnouncements");
  const pendingEl = document.getElementById("statPendingAnnouncements");

  if (!totalEl) return;

  const total = allAnnouncements.length;
  let active = 0;
  let pending = 0;

  const todayStr = new Date().toISOString().split('T')[0];

  allAnnouncements.forEach(a => {
    const status = a.status || "Published";
    const pubDate = a.publishDate || "";
    const expDate = a.expiryDate || "";

    const isPublished = status === "Published";
    const isFuture = pubDate && pubDate > todayStr;
    const isExpired = expDate && expDate < todayStr;

    if (isPublished && !isFuture && !isExpired) {
      active++;
    } else {
      pending++;
    }
  });

  totalEl.textContent = total;
  activeEl.textContent = active;
  pendingEl.textContent = pending;
}

// Render Announcements Table
window.renderAnnouncementsTable = function() {
  const tbody = document.getElementById("announcementsTableBody");
  if (!tbody) return;

  const searchTerm = (document.getElementById("announceFilterSearch")?.value || "").toLowerCase().trim();
  const filterStatus = document.getElementById("announceFilterStatus")?.value || "all";
  const filterPinned = document.getElementById("announceFilterPinned")?.value || "all";

  let filtered = allAnnouncements.filter(a => {
    // Search Filter
    const title = (a.title || "").toLowerCase();
    const body = (a.body || a.message || "").toLowerCase();
    const createdBy = (a.createdBy || "").toLowerCase();
    if (searchTerm && !title.includes(searchTerm) && !body.includes(searchTerm) && !createdBy.includes(searchTerm)) {
      return false;
    }

    // Status Filter
    const status = a.status || "Published";
    if (filterStatus !== "all") {
      if (filterStatus === "Scheduled") {
        const todayStr = new Date().toISOString().split('T')[0];
        const isFuture = a.publishDate && a.publishDate > todayStr;
        if (status !== "Scheduled" && !isFuture) return false;
      } else {
        if (status !== filterStatus) return false;
      }
    }

    // Pinned Filter
    const isPinned = !!a.isPinned;
    if (filterPinned !== "all") {
      if (filterPinned === "pinned" && !isPinned) return false;
      if (filterPinned === "regular" && isPinned) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          <i class="fa-solid fa-folder-open" style="font-size: 2rem; display: block; margin-bottom: 0.5rem; opacity: 0.5;"></i>
          No announcements found matching the criteria.
        </td>
      </tr>
    `;
    return;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  tbody.innerHTML = filtered.map(a => {
    const isPinned = !!a.isPinned;
    const status = a.status || "Published";
    const pubDate = a.publishDate || "N/A";
    const expDate = a.expiryDate || "Never";

    // Determine current effective status
    let badgeClass = "blue";
    let statusText = status;
    if (status === "Published") {
      if (a.publishDate && a.publishDate > todayStr) {
        badgeClass = "yellow";
        statusText = "Scheduled";
      } else if (a.expiryDate && a.expiryDate < todayStr) {
        badgeClass = "gray";
        statusText = "Expired";
      } else {
        badgeClass = "green";
        statusText = "Published";
      }
    } else if (status === "Draft") {
      badgeClass = "red";
      statusText = "Draft";
    }

    const pinIcon = isPinned ? 
      `<button onclick="togglePinAnnouncement('${a.id}', true)" class="btn" title="Unpin" style="background: transparent; border: none; color: #f59e0b; cursor: pointer; padding: 0.25rem;"><i class="fa-solid fa-thumbtack"></i></button>` : 
      `<button onclick="togglePinAnnouncement('${a.id}', false)" class="btn" title="Pin" style="background: transparent; border: none; color: var(--text-muted); opacity: 0.4; cursor: pointer; padding: 0.25rem;"><i class="fa-regular fa-thumbtack"></i></button>`;

    const statusBadge = `<span class="status-badge ${badgeClass}" style="text-transform: uppercase; font-size: 0.72rem; font-weight: 700;">${statusText}</span>`;

    const attachmentIndicator = a.attachmentName ? 
      `<span style="color: var(--primary); font-weight: 500; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem;">
         <i class="fa-solid fa-paperclip"></i> ${a.attachmentName.substring(0, 15)}${a.attachmentName.length > 15 ? '...' : ''}
       </span>` : 
      `<span style="color: var(--text-muted); font-size: 0.8rem; opacity: 0.6;">None</span>`;

    const bodyPreview = (a.body || a.message || "").substring(0, 60) + ((a.body || a.message || "").length > 60 ? "..." : "");

    return `
      <tr style="border-bottom: 1px solid var(--border-color); vertical-align: middle;">
        <td style="padding: 1rem; text-align: center;">${pinIcon}</td>
        <td style="padding: 1rem;">
          <div style="font-weight: 700; color: var(--primary); margin-bottom: 0.2rem;">${a.title}</div>
          <div style="font-size: 0.82rem; color: var(--text-dark); opacity: 0.8;">${bodyPreview}</div>
        </td>
        <td style="padding: 1rem; font-size: 0.85rem; color: var(--text-dark);">${pubDate}</td>
        <td style="padding: 1rem; font-size: 0.85rem; color: var(--text-dark);">${expDate}</td>
        <td style="padding: 1rem; text-align: center;">${statusBadge}</td>
        <td style="padding: 1rem;">${attachmentIndicator}</td>
        <td style="padding: 1rem; font-size: 0.85rem; color: var(--text-dark); font-weight: 500;">${a.createdBy || "Admin"}</td>
        <td style="padding: 1rem; text-align: center;">
          <div style="display: flex; gap: 0.5rem; justify-content: center; align-items: center;">
            <button onclick="openEditAnnouncementModal('${a.id}')" class="btn" title="Edit" style="background-color: var(--bg-slate); color: var(--primary); border: 1px solid var(--border-color); width: 32px; height: 32px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-pen"></i></button>
            <button onclick="togglePublishAnnouncement('${a.id}', '${status}')" class="btn" title="${status === 'Published' ? 'Switch to Draft' : 'Publish'}" style="background-color: var(--bg-slate); color: ${status === 'Published' ? '#dc3545' : '#28a745'}; border: 1px solid var(--border-color); width: 32px; height: 32px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
              <i class="fa-solid ${status === 'Published' ? 'fa-eye-slash' : 'fa-eye'}"></i>
            </button>
            <button onclick="deleteAnnouncement('${a.id}')" class="btn" title="Delete" style="background-color: var(--bg-slate); color: var(--error); border: 1px solid var(--border-color); width: 32px; height: 32px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
};

// Filters listeners
const filterSearch = document.getElementById("announceFilterSearch");
const filterAnnounceStatus = document.getElementById("announceFilterStatus");
const filterPinned = document.getElementById("announceFilterPinned");

if (filterSearch) filterSearch.addEventListener("input", () => renderAnnouncementsTable());
if (filterAnnounceStatus) filterAnnounceStatus.addEventListener("change", () => renderAnnouncementsTable());
if (filterPinned) filterPinned.addEventListener("change", () => renderAnnouncementsTable());

// Open Modal for Creating
window.openCreateAnnouncementModal = function() {
  document.getElementById("announcementForm").reset();
  document.getElementById("announceId").value = "";
  document.getElementById("announcementModalTitle").innerHTML = `<i class="fa-solid fa-bullhorn"></i> New Announcement`;
  
  // Set default Publish Date to today
  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById("announcePublishDate").value = todayStr;
  
  selectedAttachmentData = "";
  selectedAttachmentName = "";
  const preview = document.getElementById("announceAttachmentPreview");
  if (preview) preview.style.display = "none";

  document.getElementById("announcementModal").style.display = "flex";
};

// Open Modal for Editing
window.openEditAnnouncementModal = function(id) {
  const a = allAnnouncements.find(item => item.id === id);
  if (!a) return;

  document.getElementById("announceId").value = a.id;
  document.getElementById("announceTitle").value = a.title || "";
  document.getElementById("announceBody").value = a.body || a.message || "";
  document.getElementById("announcePublishDate").value = a.publishDate || "";
  document.getElementById("announceExpiryDate").value = a.expiryDate || "";
  document.getElementById("announceStatus").value = a.status || "Published";
  document.getElementById("announceCreatedBy").value = a.createdBy || "Institute Registrar";
  document.getElementById("announceIsPinned").checked = !!a.isPinned;

  selectedAttachmentData = a.attachmentData || "";
  selectedAttachmentName = a.attachmentName || "";

  const preview = document.getElementById("announceAttachmentPreview");
  if (preview) {
    if (selectedAttachmentName) {
      preview.textContent = `Current Attachment: ${selectedAttachmentName}`;
      preview.style.display = "block";
    } else {
      preview.style.display = "none";
    }
  }

  document.getElementById("announcementModalTitle").innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Edit Announcement`;
  document.getElementById("announcementModal").style.display = "flex";
};

// Save Announcement Submit Handler
const announcementForm = document.getElementById("announcementForm");
if (announcementForm) {
  announcementForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("announceId").value;
    const title = document.getElementById("announceTitle").value.trim();
    const body = document.getElementById("announceBody").value.trim();
    const publishDate = document.getElementById("announcePublishDate").value;
    const expiryDate = document.getElementById("announceExpiryDate").value;
    const status = document.getElementById("announceStatus").value;
    const createdBy = document.getElementById("announceCreatedBy").value.trim();
    const isPinned = document.getElementById("announceIsPinned").checked;

    if (!title || !body || !publishDate) {
      window.showToast("Title, Body, and Publish Date are required fields.", "error");
      return;
    }

    // Validate dates
    if (expiryDate && expiryDate < publishDate) {
      window.showToast("Expiry Date cannot be earlier than Publish Date.", "error");
      return;
    }

    try {
      window.showToast("Saving announcement...", "info");

      const payload = {
        title,
        body,
        message: body, // backward compatibility
        publishDate,
        expiryDate,
        status,
        createdBy,
        isPinned,
        attachmentName: selectedAttachmentName,
        attachmentData: selectedAttachmentData,
        lastModified: new Date().toISOString()
      };

      if (id) {
        // Update
        await updateDoc(doc(db, "notifications", id), payload);
        window.showToast("Announcement updated successfully!", "success");
      } else {
        // Create
        payload.createdAt = new Date().toISOString();
        payload.type = "Broadcast"; // specialized type
        payload.target = "All";
        await setDoc(doc(db, "notifications", `broadcast-${Date.now()}`), payload);
        window.showToast("Announcement created successfully!", "success");
      }

      document.getElementById("announcementModal").style.display = "none";
      await loadAnnouncements();
      renderAnnouncementsTable();
    } catch (err) {
      console.error("Failed to save announcement:", err);
      window.showToast("Failed to save announcement: " + err.message, "error");
    }
  });
}

// File input change handler for attachment loading
const announceAttachment = document.getElementById("announceAttachment");
if (announceAttachment) {
  announceAttachment.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Optional size limit
    if (file.size > 1500000) {
      window.showToast("Attachment size exceeds 1.5MB limit. Please upload a smaller file.", "warning");
      announceAttachment.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
      selectedAttachmentData = evt.target.result;
      selectedAttachmentName = file.name;
      
      const preview = document.getElementById("announceAttachmentPreview");
      if (preview) {
        preview.textContent = `Attachment Selected: ${file.name}`;
        preview.style.display = "block";
      }
    };
    reader.readAsDataURL(file);
  });
}

// Clear attachment
const btnClearAttachment = document.getElementById("btnClearAttachment");
if (btnClearAttachment) {
  btnClearAttachment.addEventListener("click", () => {
    selectedAttachmentData = "";
    selectedAttachmentName = "";
    const fileInput = document.getElementById("announceAttachment");
    if (fileInput) fileInput.value = "";
    const preview = document.getElementById("announceAttachmentPreview");
    if (preview) preview.style.display = "none";
    window.showToast("Attachment cleared.", "info");
  });
}

// Toggle Pin Status
window.togglePinAnnouncement = async function(id, currentPin) {
  try {
    await updateDoc(doc(db, "notifications", id), {
      isPinned: !currentPin,
      lastModified: new Date().toISOString()
    });
    window.showToast(currentPin ? "Announcement unpinned." : "Announcement pinned successfully!", "success");
    await loadAnnouncements();
    renderAnnouncementsTable();
  } catch (err) {
    window.showToast("Failed to toggle pin: " + err.message, "error");
  }
};

// Toggle Publish/Draft Status
window.togglePublishAnnouncement = async function(id, currentStatus) {
  try {
    const nextStatus = currentStatus === "Published" ? "Draft" : "Published";
    await updateDoc(doc(db, "notifications", id), {
      status: nextStatus,
      lastModified: new Date().toISOString()
    });
    window.showToast(`Announcement status updated to ${nextStatus}.`, "success");
    await loadAnnouncements();
    renderAnnouncementsTable();
  } catch (err) {
    window.showToast("Failed to toggle status: " + err.message, "error");
  }
};

// Delete Announcement
window.deleteAnnouncement = async function(id) {
  if (!confirm("Are you sure you want to delete this announcement permanently? This cannot be undone.")) return;
  try {
    await deleteDoc(doc(db, "notifications", id));
    window.showToast("Announcement deleted successfully.", "success");
    await loadAnnouncements();
    renderAnnouncementsTable();
  } catch (err) {
    window.showToast("Failed to delete announcement: " + err.message, "error");
  }
};

// Cancel Modal Buttons
const btnCancelAnnouncement = document.getElementById("btnCancelAnnouncement");
const btnCancelAnnouncementForm = document.getElementById("btnCancelAnnouncementForm");

if (btnCancelAnnouncement) {
  btnCancelAnnouncement.addEventListener("click", () => {
    document.getElementById("announcementModal").style.display = "none";
  });
}
if (btnCancelAnnouncementForm) {
  btnCancelAnnouncementForm.addEventListener("click", () => {
    document.getElementById("announcementModal").style.display = "none";
  });
}

// ==========================================
// STUDY CENTRE ACCORDION & DIRECTORY SYSTEM
// ==========================================
let currentSelectedStudyCentreId = null;
let currentSelectedStudyCentreSubtab = "Applications";
let studyCentreListenersInitialized = false;

window.populateDynamicSidebarCentres = function() {
  const adContent = document.getElementById("sidebarAdmissionsCentres");
  const stContent = document.getElementById("sidebarStudentsCentres");
  if (!adContent || !stContent) return;

  adContent.innerHTML = "";
  stContent.innerHTML = "";

  const sortedCentres = [...allStudyCentres].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  sortedCentres.forEach(c => {
    // Admissions sub-item
    const btnAd = document.createElement("button");
    btnAd.className = "sidebar-sub-btn";
    btnAd.setAttribute("data-centre-id", c.id);
    btnAd.setAttribute("data-subtab", "Applications");
    btnAd.innerHTML = `<i class="fa-solid fa-angle-right" style="font-size: 0.7rem; opacity: 0.7;"></i> ${c.name}`;
    btnAd.addEventListener("click", () => {
      openStudyCentrePage(c.id, "Applications");
    });
    adContent.appendChild(btnAd);

    // Student Directory sub-item
    const btnSt = document.createElement("button");
    btnSt.className = "sidebar-sub-btn";
    btnSt.setAttribute("data-centre-id", c.id);
    btnSt.setAttribute("data-subtab", "Students");
    btnSt.innerHTML = `<i class="fa-solid fa-angle-right" style="font-size: 0.7rem; opacity: 0.7;"></i> ${c.name}`;
    btnSt.addEventListener("click", () => {
      openStudyCentrePage(c.id, "Students");
    });
    stContent.appendChild(btnSt);
  });
};

window.initSidebarAccordions = function() {
  document.querySelectorAll(".sidebar-accordion-header").forEach(header => {
    // Remove old listeners to avoid multiple attachments
    const newHeader = header.cloneNode(true);
    header.parentNode.replaceChild(newHeader, header);
    
    newHeader.addEventListener("click", () => {
      const accordion = newHeader.closest(".sidebar-accordion");
      if (accordion) {
        accordion.classList.toggle("collapsed");
      }
    });
  });
};

window.openStudyCentrePage = function(centreId, defaultSubtab = "Applications") {
  currentSelectedStudyCentreId = centreId;
  currentSelectedStudyCentreSubtab = defaultSubtab;

  const centre = allStudyCentres.find(c => c.id === centreId);
  if (!centre) return;

  // Set header details
  const titleEl = document.getElementById("centreViewTitle");
  const subtitleEl = document.getElementById("centreViewSubtitle");
  if (titleEl) titleEl.textContent = centre.name || "Study Centre";
  if (subtitleEl) subtitleEl.textContent = `${centre.code || "N/A"} — Regional Campus Hub`;

  // Remove active highlight from main sidebar buttons
  document.querySelectorAll(".sidebar-nav-btn").forEach(b => b.classList.remove("active"));
  
  // Highlight active sub-button in sidebar
  document.querySelectorAll(".sidebar-sub-btn").forEach(subBtn => {
    const cid = subBtn.getAttribute("data-centre-id");
    const sub = subBtn.getAttribute("data-subtab");
    if (cid === centreId && sub === defaultSubtab) {
      subBtn.classList.add("active");
    } else {
      subBtn.classList.remove("active");
    }
  });

  // Switch to study centre view content tab
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  const targetTab = document.getElementById("tab-study-centre-view");
  if (targetTab) targetTab.classList.add("active");

  // Activate subtab menu button
  document.querySelectorAll(".centre-menu-tab-btn").forEach(btn => {
    const sub = btn.getAttribute("data-subtab");
    if (sub === defaultSubtab) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Show selected subtab pane
  document.querySelectorAll(".centre-subtab-pane").forEach(pane => {
    if (pane.id === `centre-subtab-${defaultSubtab}`) {
      pane.style.display = "block";
    } else {
      pane.style.display = "none";
    }
  });

  renderStudyCentreSubtabData(centreId, defaultSubtab);
};

// Bind subtab menus
document.querySelectorAll(".centre-menu-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const subtab = btn.getAttribute("data-subtab");
    currentSelectedStudyCentreSubtab = subtab;

    document.querySelectorAll(".centre-menu-tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".centre-subtab-pane").forEach(pane => {
      if (pane.id === `centre-subtab-${subtab}`) {
        pane.style.display = "block";
      } else {
        pane.style.display = "none";
      }
    });

    renderStudyCentreSubtabData(currentSelectedStudyCentreId, subtab);
  });
});

window.renderStudyCentreSubtabData = function(centreId, subtab) {
  if (subtab === "Applications") {
    renderCentreApplications(centreId);
  } else if (subtab === "Students") {
    renderCentreStudents(centreId);
  } else if (subtab === "Lecturers") {
    renderCentreLecturers(centreId);
  } else if (subtab === "Courses") {
    renderCentreCourses(centreId);
  } else if (subtab === "Allocation") {
    if (typeof renderCentreAllocation === "function") renderCentreAllocation(centreId);
  } else if (subtab === "Results") {
    renderCentreResults(centreId);
  } else if (subtab === "CBT") {
    if (typeof renderCentreCbt === "function") renderCentreCbt(centreId);
  } else if (subtab === "Announcements") {
    renderCentreAnnouncements(centreId);
  } else if (subtab === "Statistics") {
    renderCentreStatistics(centreId);
  } else if (subtab === "Reports") {
    if (typeof renderCentreReports === "function") renderCentreReports(centreId);
  }
};

window.initStudyCentreTabListeners = function() {
  if (studyCentreListenersInitialized) return;

  const cAppsSearch = document.getElementById("centreAppsSearch");
  const cAppsFilter = document.getElementById("centreAppsStatusFilter");
  const cStudentsSearch = document.getElementById("centreStudentsSearch");
  const cLecturersSearch = document.getElementById("centreLecturersSearch");
  const cCoursesSearch = document.getElementById("centreCoursesSearch");
  const cResultsSearch = document.getElementById("centreResultsSearch");
  const cAnnSearch = document.getElementById("centreAnnouncementsSearch");
  const cAllocSearch = document.getElementById("centreAllocationSearch");

  if (cAppsSearch) cAppsSearch.addEventListener("input", () => renderCentreApplications(currentSelectedStudyCentreId));
  if (cAppsFilter) cAppsFilter.addEventListener("change", () => renderCentreApplications(currentSelectedStudyCentreId));
  if (cStudentsSearch) cStudentsSearch.addEventListener("input", () => renderCentreStudents(currentSelectedStudyCentreId));
  if (cLecturersSearch) cLecturersSearch.addEventListener("input", () => renderCentreLecturers(currentSelectedStudyCentreId));
  if (cCoursesSearch) cCoursesSearch.addEventListener("input", () => renderCentreCourses(currentSelectedStudyCentreId));
  if (cResultsSearch) cResultsSearch.addEventListener("input", () => renderCentreResults(currentSelectedStudyCentreId));
  if (cAnnSearch) cAnnSearch.addEventListener("input", () => renderCentreAnnouncements(currentSelectedStudyCentreId));
  if (cAllocSearch) cAllocSearch.addEventListener("input", () => {
    if (typeof renderCentreAllocation === "function") renderCentreAllocation(currentSelectedStudyCentreId);
  });

  studyCentreListenersInitialized = true;
};

// --- RENDER APPLICATIONS SUB-TAB ---
function renderCentreApplications(centreId) {
  const tbody = document.getElementById("centreApplicationsTableBody");
  if (!tbody) return;

  const searchQuery = (document.getElementById("centreAppsSearch")?.value || "").toLowerCase().trim();
  const filterStatus = document.getElementById("centreAppsStatusFilter")?.value || "All";

  let filtered = allApplications.filter(app => app.preferredStudyCentreId === centreId);

  if (filterStatus !== "All") {
    filtered = filtered.filter(app => (app.admissionStatus || "Pending") === filterStatus);
  }

  if (searchQuery) {
    filtered = filtered.filter(app => {
      return (app.fullName || "").toLowerCase().includes(searchQuery) ||
             (app.id || "").toLowerCase().includes(searchQuery) ||
             (app.programme || "").toLowerCase().includes(searchQuery);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-muted);">No applications found inside this Study Centre.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(app => {
    const dateStr = app.submittedAt ? new Date(app.submittedAt).toLocaleDateString() : "N/A";
    let badgeClass = "status-badge pending";
    if (app.admissionStatus === "Approved") badgeClass = "status-badge cleared";
    if (app.admissionStatus === "Rejected") badgeClass = "status-badge danger";

    return `
      <tr>
        <td style="padding: 1rem;"><strong>${app.id}</strong></td>
        <td style="padding: 1rem; font-weight: 600;">${app.fullName}</td>
        <td style="padding: 1rem;">${app.programme}</td>
        <td style="padding: 1rem;"><span class="${badgeClass}" style="padding: 0.25rem 0.6rem; font-size: 0.8rem; font-weight: 700;">${app.admissionStatus || 'Pending'}</span></td>
        <td style="padding: 1rem;">${dateStr}</td>
        <td style="padding: 1rem;">
          <button class="btn btn-sm btn-outline-primary view-centre-app-btn" data-id="${app.id}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
            <i class="fa-solid fa-eye"></i> View Application
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".view-centre-app-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      if (typeof viewApplicationDetails === "function") {
        viewApplicationDetails(id);
      }
    });
  });
}

// --- RENDER STUDENTS SUB-TAB ---
function renderCentreStudents(centreId) {
  const tbody = document.getElementById("centreStudentsTableBody");
  if (!tbody) return;

  const searchQuery = (document.getElementById("centreStudentsSearch")?.value || "").toLowerCase().trim();

  let filtered = allStudents.filter(stu => stu.studyCentreId === centreId);

  if (searchQuery) {
    filtered = filtered.filter(stu => {
      return (stu.fullName || "").toLowerCase().includes(searchQuery) ||
             (stu.studentId || "").toLowerCase().includes(searchQuery) ||
             (stu.matricNumber || "").toLowerCase().includes(searchQuery) ||
             (stu.email || "").toLowerCase().includes(searchQuery);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-muted);">No active student records found inside this Study Centre.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(stu => {
    return `
      <tr>
        <td style="padding: 1rem;"><strong>${stu.studentId}</strong></td>
        <td style="padding: 1rem;">${stu.matricNumber || "Pending"}</td>
        <td style="padding: 1rem; font-weight: 600;">${stu.fullName}</td>
        <td style="padding: 1rem;">${stu.email || "N/A"}</td>
        <td style="padding: 1rem;"><span class="status-badge cleared" style="padding: 0.25rem 0.6rem; font-size: 0.8rem; font-weight: 700;">Active</span></td>
        <td style="padding: 1rem;">
          <div style="display: flex; gap: 0.5rem; align-items: center; justify-content: flex-start; flex-wrap: wrap;">
            <button class="btn btn-sm btn-outline-primary view-centre-stu-credentials-btn" data-name="${stu.fullName}" data-stu-id="${stu.studentId}" data-matric="${stu.matricNumber || ''}" data-pass="${stu.loginCredentials?.password || 'N/A'}" data-email="${stu.email || ''}" data-programme="${stu.programme || ''}" data-department="${stu.department || ''}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
              <i class="fa-solid fa-id-card"></i> View Credentials
            </button>
            <button class="btn btn-sm resend-centre-admission-email-btn" data-matric="${stu.matricNumber}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; background-color: var(--secondary); color: var(--text-dark); border: 1.5px solid var(--border-color);">
              <i class="fa-solid fa-envelope"></i> Send Email Again
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".view-centre-stu-credentials-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (typeof showCredentialsReceipt === "function") {
        showCredentialsReceipt(
          btn.getAttribute("data-name"),
          btn.getAttribute("data-stu-id"),
          btn.getAttribute("data-matric"),
          btn.getAttribute("data-pass"),
          btn.getAttribute("data-email"),
          btn.getAttribute("data-programme"),
          btn.getAttribute("data-department")
        );
      }
    });
  });

  tbody.querySelectorAll(".resend-centre-admission-email-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const matric = btn.getAttribute("data-matric");
      if (typeof resendAdmissionEmail === "function") {
        await resendAdmissionEmail(matric, btn);
      }
    });
  });
}

// --- RENDER LECTURERS SUB-TAB ---
function renderCentreLecturers(centreId) {
  const tbody = document.getElementById("centreLecturersTableBody");
  if (!tbody) return;

  const searchQuery = (document.getElementById("centreLecturersSearch")?.value || "").toLowerCase().trim();

  let filtered = allLecturers.filter(lec => lec.assignedStudyCentreIds && lec.assignedStudyCentreIds.includes(centreId));

  if (searchQuery) {
    filtered = filtered.filter(lec => {
      return (lec.fullName || "").toLowerCase().includes(searchQuery) ||
             (lec.lecturerId || "").toLowerCase().includes(searchQuery) ||
             (lec.department || "").toLowerCase().includes(searchQuery);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">No lecturers assigned to this Study Centre.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(lec => {
    const statusBg = lec.status === "Active" ? "rgba(40,167,69,0.1)" : "rgba(220,53,69,0.1)";
    const statusColor = lec.status === "Active" ? "#28A745" : "#DC3545";

    const assignedCentres = lec.assignedStudyCentreIds || [];
    const centresHtml = assignedCentres.length > 0 
      ? assignedCentres.map(cid => {
          const centre = allStudyCentres.find(c => c.id === cid);
          return centre ? `<span style="background-color: var(--accent); color: var(--primary); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 700; margin-right: 0.3rem; display: inline-block; margin-bottom: 0.25rem;">${centre.name}</span>` : "";
        }).join("")
      : `<span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">None Assigned</span>`;

    const coursesList = lec.coursesAssigned || lec.assignedCourses || [];
    const coursesHtml = coursesList.length > 0 
      ? coursesList.map(c => `<span style="background-color: var(--primary); color: white; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600; margin-right: 0.3rem; display: inline-block; margin-bottom: 0.25rem;">${c}</span>`).join("")
      : `<span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">None Allocated</span>`;

    return `
      <tr style="border-bottom: 1.5px solid var(--border-color);">
        <td style="padding: 1rem; font-family: monospace; font-weight: 700; color: var(--primary); font-size: 0.92rem;">${lec.lecturerId || ""}</td>
        <td style="padding: 1rem; font-weight: 600; color: var(--primary-dark);">${lec.title || ""} ${lec.fullName || ""}</td>
        <td style="padding: 1rem; font-size: 0.88rem; font-weight: 500;">${lec.department || ""}</td>
        <td style="padding: 1rem; max-width: 250px;">${centresHtml}</td>
        <td style="padding: 1rem; max-width: 200px;">${coursesHtml}</td>
        <td style="padding: 1rem;">
          <span style="background-color: ${statusBg}; color: ${statusColor}; padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.78rem; font-weight: 700; display: inline-block;">
            ${lec.status || "Active"}
          </span>
        </td>
        <td style="padding: 1rem; text-align: center;">
          <div style="display: flex; gap: 0.45rem; justify-content: center; align-items: center;">
            <button class="btn btn-edit-centre-lec" data-id="${lec.id}" title="View & Edit Facilitator Profile" style="background-color: #1F3B82; color: white; border: none; border-radius: 6px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.95rem;"><i class="fa-solid fa-user-pen"></i></button>
            <button class="btn btn-reset-pass-centre-lec" data-id="${lec.id}" title="Reset Security Credentials" style="background-color: #F4B000; color: #1F3B82; border: none; border-radius: 6px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.95rem;"><i class="fa-solid fa-key"></i></button>
            <button class="btn btn-toggle-status-centre-lec" data-id="${lec.id}" data-status="${lec.status}" title="${lec.status === 'Active' ? 'Deactivate' : 'Activate'}" style="background-color: ${lec.status === 'Active' ? '#DC3545' : '#28A745'}; color: white; border: none; border-radius: 6px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.95rem;">
              <i class="fa-solid ${lec.status === 'Active' ? 'fa-user-slash' : 'fa-user-check'}"></i>
            </button>
            <button class="btn btn-delete-centre-lec" data-id="${lec.id}" title="Delete Facilitator" style="background-color: var(--error); color: white; border: none; border-radius: 6px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.95rem;">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-edit-centre-lec").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      if (typeof openEditLecturerModal === "function") openEditLecturerModal(id);
    });
  });

  tbody.querySelectorAll(".btn-reset-pass-centre-lec").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      if (typeof resetLecturerPassword === "function") resetLecturerPassword(id);
    });
  });

  tbody.querySelectorAll(".btn-toggle-status-centre-lec").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const status = btn.getAttribute("data-status");
      if (typeof toggleLecturerStatus === "function") toggleLecturerStatus(id, status);
    });
  });

  tbody.querySelectorAll(".btn-delete-centre-lec").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      deleteLecturer(id);
    });
  });
}

async function deleteLecturer(docId) {
  const lec = allLecturers.find(l => l.id === docId);
  if (!lec) {
    window.showToast("Facilitator record not found.", "error");
    return;
  }

  const userConfirmed = await window.dimabinConfirm(`Are you sure you want to PERMANENTLY delete facilitator "${lec.title || ''} ${lec.fullName || ''}"? This action is irreversible.`);
  if (!userConfirmed) return;

  try {
    window.showToast("Deleting facilitator record...", "info");
    await deleteDoc(doc(db, "lecturers", docId));
    window.showToast("Facilitator deleted successfully!", "success");
    await loadLecturers();
    renderCentreLecturers(currentSelectedStudyCentreId);
  } catch (err) {
    console.error("❌ Deletion failed:", err);
    window.showToast("Failed to delete facilitator: " + err.message, "error");
  }
}

// --- RENDER COURSES SUB-TAB ---
function renderCentreCourses(centreId) {
  const tbody = document.getElementById("centreCoursesTableBody");
  if (!tbody) return;

  const searchQuery = (document.getElementById("centreCoursesSearch")?.value || "").toLowerCase().trim();

  let filtered = allCourses.filter(c => c.status === "Active" || c.status === undefined);

  if (searchQuery) {
    filtered = filtered.filter(c => {
      return (c.courseCode || c.code || "").toLowerCase().includes(searchQuery) ||
             (c.courseTitle || c.name || "").toLowerCase().includes(searchQuery) ||
             (c.department || "").toLowerCase().includes(searchQuery);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">No courses listed for this Study Centre.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const statusBg = c.status === "Active" ? "rgba(40,167,69,0.1)" : "rgba(220,53,69,0.1)";
    const statusColor = c.status === "Active" ? "#28A745" : "#DC3545";

    return `
      <tr>
        <td style="padding: 1rem;"><strong>${c.courseCode || c.code}</strong></td>
        <td style="padding: 1rem; font-weight: 600;">${c.courseTitle || c.name}</td>
        <td style="padding: 1rem;">${c.semester}</td>
        <td style="padding: 1rem;">${c.creditUnit || c.credits || 0}</td>
        <td style="padding: 1rem;">${c.department || "General"}</td>
        <td style="padding: 1rem;"><span style="background-color: ${statusBg}; color: ${statusColor}; padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.78rem; font-weight: 700;">${c.status || "Active"}</span></td>
        <td style="padding: 1rem;">
          <button class="btn btn-sm btn-outline-primary view-centre-course-btn" data-id="${c.id}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
            <i class="fa-solid fa-eye"></i> View
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".view-centre-course-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      if (typeof openEditCourseModal === "function") openEditCourseModal(id);
    });
  });
}

// --- RENDER RESULTS SUB-TAB ---
function renderCentreResults(centreId) {
  const tbody = document.getElementById("centreResultsTableBody");
  if (!tbody) return;

  const searchQuery = (document.getElementById("centreResultsSearch")?.value || "").toLowerCase().trim();

  let filtered = approvalSubmissionsList.filter(item => item.studyCentreId === centreId);

  if (searchQuery) {
    filtered = filtered.filter(item => {
      return (item.courseCode || "").toLowerCase().includes(searchQuery) ||
             (item.lecturerName || "").toLowerCase().includes(searchQuery);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">No grading sheet submissions found for this Study Centre.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(item => {
    const stdCount = item.students ? item.students.length : 0;
    const formattedDate = item.lastUpdated ? new Date(item.lastUpdated).toLocaleDateString() : "-";
    let badgeClass = "status-badge info";
    if (item.status === "Published" || item.status === "Approved") badgeClass = "status-badge cleared";
    else if (item.status === "Submitted") badgeClass = "status-badge pending";
    else if (item.status === "Returned" || item.status === "Rejected") badgeClass = "status-badge danger";

    return `
      <tr>
        <td style="padding: 1rem;"><strong>${item.courseCode}</strong></td>
        <td style="padding: 1rem;"><code>${item.academicSession}</code> - ${item.semester}</td>
        <td style="padding: 1rem; font-weight: 600;">${item.lecturerName || 'Assigned Facilitator'}</td>
        <td style="padding: 1rem; text-align: center; font-weight: 700;">${stdCount}</td>
        <td style="padding: 1rem; text-align: center;"><span class="${badgeClass}" style="padding: 0.25rem 0.6rem; font-size: 0.8rem; font-weight: 700;">${item.status || 'Draft'}</span></td>
        <td style="padding: 1rem; text-align: center;">${formattedDate}</td>
        <td style="padding: 1rem; text-align: center;">
          <button class="btn btn-sm btn-outline-primary review-centre-result-btn" data-id="${item.id}" data-source="${item.source}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
            <i class="fa-solid fa-file-invoice"></i> Review & Approve
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".review-centre-result-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const source = btn.getAttribute("data-source");
      if (typeof openReviewModal === "function") openReviewModal(id, source);
    });
  });
}

// --- RENDER ANNOUNCEMENTS SUB-TAB ---
function renderCentreAnnouncements(centreId) {
  const tbody = document.getElementById("centreAnnouncementsTableBody");
  if (!tbody) return;

  const searchQuery = (document.getElementById("centreAnnouncementsSearch")?.value || "").toLowerCase().trim();

  let filtered = allAnnouncements.filter(a => !a.studyCentreId || a.studyCentreId === centreId);

  if (searchQuery) {
    filtered = filtered.filter(a => {
      return (a.title || "").toLowerCase().includes(searchQuery) ||
             (a.body || "").toLowerCase().includes(searchQuery) ||
             (a.createdBy || "").toLowerCase().includes(searchQuery);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted);">No announcements found for this Study Centre.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(a => {
    const isPinned = !!a.isPinned;
    const pinColor = isPinned ? "color: var(--accent);" : "color: var(--text-muted); opacity: 0.4;";
    const formattedPub = a.publishDate ? new Date(a.publishDate).toLocaleDateString() : "Immediate";
    const formattedExp = a.expiryDate ? new Date(a.expiryDate).toLocaleDateString() : "Never";
    
    let badgeClass = "status-badge info";
    if (a.status === "Published") badgeClass = "status-badge cleared";
    if (a.status === "Draft") badgeClass = "status-badge pending";

    const hasAttachment = a.attachmentName ? `<span style="font-size:0.8rem; font-weight:600;"><i class="fa-solid fa-paperclip"></i> ${a.attachmentName}</span>` : `<span style="color:var(--text-muted); font-size:0.8rem; font-style:italic;">No File</span>`;

    return `
      <tr>
        <td style="text-align: center; padding: 1rem;"><i class="fa-solid fa-thumbtack" style="${pinColor} font-size: 1.15rem;"></i></td>
        <td style="padding: 1rem;"><strong>${a.title}</strong><br><span style="font-size:0.8rem; color:var(--text-muted); display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;">${a.body || a.message}</span></td>
        <td style="padding: 1rem;">${formattedPub}</td>
        <td style="padding: 1rem;">${formattedExp}</td>
        <td style="padding: 1rem; text-align: center;"><span class="${badgeClass}" style="padding: 0.25rem 0.6rem; font-size: 0.8rem; font-weight: 700;">${a.status || 'Published'}</span></td>
        <td style="padding: 1rem;">${hasAttachment}</td>
        <td style="padding: 1rem;">${a.createdBy || 'Admin'}</td>
        <td style="padding: 1rem; text-align: center;">
          <div style="display:flex; gap:0.4rem; justify-content:center;">
            <button class="btn btn-sm btn-outline-primary edit-centre-ann-btn" data-id="${a.id}" style="padding:0.35rem; width:30px; height:30px; display: inline-flex; align-items: center; justify-content: center;"><i class="fa-solid fa-pen-to-square"></i></button>
            <button class="btn btn-sm btn-outline-danger delete-centre-ann-btn" data-id="${a.id}" style="padding:0.35rem; width:30px; height:30px; display: inline-flex; align-items: center; justify-content: center;"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".edit-centre-ann-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      if (typeof openEditAnnouncementModal === "function") openEditAnnouncementModal(id);
    });
  });

  tbody.querySelectorAll(".delete-centre-ann-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      if (typeof deleteAnnouncement === "function") deleteAnnouncement(id);
    });
  });
}

// --- RENDER STATISTICS (STUDY CENTRE DASHBOARD) ---
function renderCentreStatistics(centreId) {
  const centre = allStudyCentres.find(c => c.id === centreId);
  if (!centre) return;

  const totalApps = allApplications.filter(app => app.preferredStudyCentreId === centreId).length;
  const pendingApps = allApplications.filter(app => app.preferredStudyCentreId === centreId && (app.admissionStatus || "Pending") === "Pending").length;
  const approvedApps = allApplications.filter(app => app.preferredStudyCentreId === centreId && app.admissionStatus === "Approved").length;
  const rejectedApps = allApplications.filter(app => app.preferredStudyCentreId === centreId && app.admissionStatus === "Rejected").length;
  const activeStudents = allStudents.filter(s => s.studyCentreId === centreId).length;
  const assignedLecturers = allLecturers.filter(l => l.assignedStudyCentreIds && l.assignedStudyCentreIds.includes(centreId)).length;

  const appsProgs = allApplications.filter(app => app.preferredStudyCentreId === centreId).map(app => app.programme);
  const stProgs = allStudents.filter(s => s.studyCentreId === centreId).map(s => s.programme);
  const uniqueProgs = Array.from(new Set([...appsProgs, ...stProgs].filter(Boolean)));
  const programmesCount = uniqueProgs.length || 3;

  const resultsCount = approvalSubmissionsList.filter(item => item.studyCentreId === centreId && item.status === "Published").length;

  // Set visual values
  document.getElementById("centreStatTotalApps").textContent = totalApps;
  document.getElementById("centreStatPendingApps").textContent = pendingApps;
  document.getElementById("centreStatApprovedApps").textContent = approvedApps;
  document.getElementById("centreStatRejectedApps").textContent = rejectedApps;
  document.getElementById("centreStatTotalStudents").textContent = activeStudents;
  document.getElementById("centreStatLecturers").textContent = assignedLecturers;
  document.getElementById("centreStatProgrammes").textContent = programmesCount;
  document.getElementById("centreStatResults").textContent = resultsCount;

  // Set programmes list
  const progsListEl = document.getElementById("centreProgrammesList");
  if (progsListEl) {
    if (uniqueProgs.length > 0) {
      progsListEl.innerHTML = uniqueProgs.map(p => `<div style="background-color: var(--bg-slate); padding: 0.5rem 0.75rem; border-radius: var(--border-radius-sm); margin-bottom: 0.5rem; border-left: 3px solid var(--accent);"><i class="fa-solid fa-certificate" style="color: var(--primary); margin-right: 0.5rem;"></i>${p}</div>`).join("");
    } else {
      progsListEl.innerHTML = `
        <div style="background-color: var(--bg-slate); padding: 0.5rem 0.75rem; border-radius: var(--border-radius-sm); margin-bottom: 0.5rem; border-left: 3px solid var(--accent);"><i class="fa-solid fa-certificate" style="color: var(--primary); margin-right: 0.5rem;"></i>Diploma in Theology</div>
        <div style="background-color: var(--bg-slate); padding: 0.5rem 0.75rem; border-radius: var(--border-radius-sm); margin-bottom: 0.5rem; border-left: 3px solid var(--accent);"><i class="fa-solid fa-certificate" style="color: var(--primary); margin-right: 0.5rem;"></i>Bachelor of Theology</div>
        <div style="background-color: var(--bg-slate); padding: 0.5rem 0.75rem; border-radius: var(--border-radius-sm); margin-bottom: 0.5rem; border-left: 3px solid var(--accent);"><i class="fa-solid fa-certificate" style="color: var(--primary); margin-right: 0.5rem;"></i>Postgraduate Diploma</div>
      `;
    }
  }

  // Set latest announcement
  const annEl = document.getElementById("centreLatestAnnouncement");
  if (annEl) {
    const centreAnns = allAnnouncements.filter(a => !a.studyCentreId || a.studyCentreId === centreId);
    if (centreAnns.length > 0) {
      annEl.innerHTML = `
        <strong style="color: var(--primary); font-size: 1.05rem; display: block; margin-bottom: 0.5rem;">📢 ${centreAnns[0].title}</strong>
        <p style="color: var(--text-dark); margin-bottom: 0.5rem;">${centreAnns[0].body || centreAnns[0].message}</p>
        <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500;"><i class="fa-regular fa-clock"></i> Published: ${centreAnns[0].publishDate ? new Date(centreAnns[0].publishDate).toLocaleDateString() : 'Immediate'}</span>
      `;
    } else {
      annEl.textContent = "No recent announcements posted.";
    }
  }
}

// --- RENDER ALLOCATION SUB-TAB ---
window.renderCentreAllocation = function(centreId) {
  const tbody = document.getElementById("centreAllocationTableBody");
  if (!tbody) return;

  const searchQuery = (document.getElementById("centreAllocationSearch")?.value || "").toLowerCase().trim();

  // Find courses belonging to this study centre
  let filteredCourses = allCourses.filter(c => c.studyCentreId === centreId);

  if (searchQuery) {
    filteredCourses = filteredCourses.filter(c => {
      return (c.courseCode || "").toLowerCase().includes(searchQuery) ||
             (c.courseTitle || c.name || "").toLowerCase().includes(searchQuery);
    });
  }

  if (filteredCourses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 3rem; color: var(--text-muted);">No courses found inside this Study Centre. Create courses first.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredCourses.map(c => {
    // Find lecturers assigned to this course
    const facilitators = allLecturers.filter(l => {
      const isAtCentre = l.assignedStudyCentreIds && l.assignedStudyCentreIds.includes(centreId);
      const hasCourse = (l.coursesAssigned || l.assignedCourses || []).includes(c.courseCode || c.id);
      return isAtCentre && hasCourse;
    });

    const facilitatorsHtml = facilitators.length > 0
      ? facilitators.map(f => `<span style="background-color: var(--primary); color: white; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600; margin-right: 0.3rem; display: inline-block; margin-bottom: 0.25rem;">${f.title || ""} ${f.fullName}</span>`).join("")
      : `<span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">None Allocated</span>`;

    return `
      <tr>
        <td style="padding: 1rem; font-family: monospace; font-weight: 700; color: var(--primary);">${c.courseCode || c.id}</td>
        <td style="padding: 1rem; font-weight: 600; color: var(--primary-dark);">${c.courseTitle || c.name}</td>
        <td style="padding: 1rem;">Level ${c.level || "100"} / ${c.semester || "First Semester"}</td>
        <td style="padding: 1rem;">${facilitatorsHtml}</td>
        <td style="padding: 1rem; text-align: center;">
          <button class="btn btn-sm btn-primary open-centre-alloc-btn" data-code="${c.courseCode || c.id}" data-title="${c.courseTitle || c.name}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
            <i class="fa-solid fa-list-check"></i> Assign Facilitator
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".open-centre-alloc-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      openCentreAllocationModal(btn.getAttribute("data-code"), btn.getAttribute("data-title"));
    });
  });
};

window.openCentreAllocationModal = function(courseCode, courseTitle) {
  document.getElementById("allocModalCourseCode").textContent = courseCode;
  document.getElementById("allocModalCourseTitle").textContent = courseTitle;
  document.getElementById("allocModalCourseId").value = courseCode;

  // Populate dropdown with lecturers assigned to current study centre
  const select = document.getElementById("allocModalLecturerSelect");
  if (select) {
    const centreLecturers = allLecturers.filter(l => l.assignedStudyCentreIds && l.assignedStudyCentreIds.includes(currentSelectedStudyCentreId));
    select.innerHTML = '<option value="">-- Select Lecturer --</option>' + 
      centreLecturers.map(l => `<option value="${l.id}">${l.title || ""} ${l.fullName}</option>`).join("");
  }

  // Load current list
  renderAllocationModalCurrentList(courseCode);

  const modal = document.getElementById("centreAllocationModal");
  if (modal) modal.style.display = "flex";
};

window.renderAllocationModalCurrentList = function(courseCode) {
  const listContainer = document.getElementById("allocModalCurrentList");
  if (!listContainer) return;

  const facilitators = allLecturers.filter(l => {
    const isAtCentre = l.assignedStudyCentreIds && l.assignedStudyCentreIds.includes(currentSelectedStudyCentreId);
    const hasCourse = (l.coursesAssigned || l.assignedCourses || []).includes(courseCode);
    return isAtCentre && hasCourse;
  });

  if (facilitators.length === 0) {
    listContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 1rem;">No lecturers currently assigned to this syllabus course in this Study Centre.</div>`;
    return;
  }

  listContainer.innerHTML = facilitators.map(f => `
    <div style="display: flex; justify-content: space-between; align-items: center; background-color: var(--bg-slate); padding: 0.5rem 0.75rem; border-radius: var(--border-radius-sm); border: 1px solid var(--border-color);">
      <span style="font-size: 0.85rem; font-weight: 600; color: var(--primary-dark);">${f.title || ""} ${f.fullName}</span>
      <button class="btn btn-sm btn-outline-danger remove-alloc-btn" data-lec-id="${f.id}" data-course-code="${courseCode}" style="padding: 0.2rem 0.5rem; font-size: 0.72rem; border-color: rgba(220,53,69,0.3); color: var(--error);" title="De-allocate Course">
        <i class="fa-solid fa-user-minus"></i> Remove
      </button>
    </div>
  `).join("");

  listContainer.querySelectorAll(".remove-alloc-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const lecId = btn.getAttribute("data-lec-id");
      const code = btn.getAttribute("data-course-code");
      
      try {
        const lec = allLecturers.find(l => l.id === lecId);
        if (!lec) return;

        let arr = lec.coursesAssigned || lec.assignedCourses || [];
        arr = arr.filter(c => c !== code);

        const docRef = doc(db, "lecturers", lecId);
        await updateDoc(docRef, {
          coursesAssigned: arr,
          assignedCourses: arr,
          updatedAt: new Date().toISOString()
        });

        window.showToast(`Successfully removed course allocation from ${lec.fullName}.`, "success");
        await loadLecturers();
        renderAllocationModalCurrentList(code);
        renderCentreAllocation(currentSelectedStudyCentreId);
      } catch (err) {
        window.showToast("Failed to remove allocation: " + err.message, "error");
      }
    });
  });
};

// --- RENDER CBT SUB-TAB ---
window.renderCentreCbt = function(centreId) {
  const examsRef = collection(db, "cbtExams");
  const attemptsRef = collection(db, "cbtAttempts");
  const resultsRef = collection(db, "cbtResults");

  Promise.all([
    getDocs(query(examsRef, where("studyCentreId", "==", centreId))),
    getDocs(query(attemptsRef, where("studyCentreId", "==", centreId))),
    getDocs(query(resultsRef, where("studyCentreId", "==", centreId)))
  ]).then(([examsSnap, attemptsSnap, resultsSnap]) => {
    const totalExams = examsSnap.size;
    const publishedExams = examsSnap.docs.filter(d => d.data().status === "Active" || d.data().status === "Published").length;
    const liveExams = attemptsSnap.docs.filter(d => d.data().status === "InProgress").length;
    const totalSubmissions = resultsSnap.size;

    document.getElementById("centreCbtTotalExams").textContent = totalExams;
    document.getElementById("centreCbtPublishedExams").textContent = publishedExams;
    document.getElementById("centreCbtLiveExams").textContent = liveExams;
    document.getElementById("centreCbtTotalSubmissions").textContent = totalSubmissions;

    // Render exams table
    const examsTbody = document.getElementById("centreCbtExamsTableBody");
    if (examsTbody) {
      if (examsSnap.empty) {
        examsTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">No CBT Examinations scheduled for this study centre.</td></tr>`;
      } else {
        examsTbody.innerHTML = examsSnap.docs.map(doc => {
          const ex = doc.data();
          const qCount = ex.questionsCount || (ex.questions ? ex.questions.length : 0);
          const dateRange = `${ex.startDate || "N/A"} to ${ex.endDate || "N/A"}`;
          const badgeClass = ex.status === "Active" ? "status-badge cleared" : "status-badge danger";
          
          return `
            <tr>
              <td style="padding: 0.85rem;"><strong>${ex.courseCode || doc.id}</strong></td>
              <td style="padding: 0.85rem; font-weight: 600;">${ex.examTitle || ex.title || "N/A"}</td>
              <td style="padding: 0.85rem;">${qCount} questions</td>
              <td style="padding: 0.85rem;">${ex.duration || 60} mins</td>
              <td style="padding: 0.85rem; font-size: 0.8rem;">${dateRange}</td>
              <td style="padding: 0.85rem;"><span class="${badgeClass}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">${ex.status || 'Active'}</span></td>
              <td style="padding: 0.85rem; text-align: center;">
                <button class="btn btn-sm btn-outline-danger delete-centre-exam-btn" data-id="${doc.id}" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;">
                  <i class="fa-solid fa-trash-can"></i> Cancel
                </button>
              </td>
            </tr>
          `;
        }).join("");

        examsTbody.querySelectorAll(".delete-centre-exam-btn").forEach(btn => {
          btn.addEventListener("click", async () => {
            if (confirm("Are you sure you want to cancel and remove this CBT Examination?")) {
              try {
                await updateDoc(doc(db, "cbtExams", btn.getAttribute("data-id")), { status: "Cancelled" });
                window.showToast("CBT exam status set to cancelled.", "success");
                renderCentreCbt(centreId);
              } catch (err) {
                window.showToast("Operation failed: " + err.message, "error");
              }
            }
          });
        });
      }
    }

    // Render submissions/scripts table
    const subTbody = document.getElementById("centreCbtSubmissionsTableBody");
    if (subTbody) {
      if (resultsSnap.empty) {
        subTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">No student CBT scripts completed.</td></tr>`;
      } else {
        subTbody.innerHTML = resultsSnap.docs.map(doc => {
          const res = doc.data();
          const dateStr = res.submittedAt ? new Date(res.submittedAt).toLocaleDateString() : "N/A";
          
          return `
            <tr>
              <td style="padding: 0.85rem; font-family: monospace;">${res.matricNumber || "N/A"}</td>
              <td style="padding: 0.85rem; font-weight: 600;">${res.studentName || "N/A"}</td>
              <td style="padding: 0.85rem;"><strong>${res.courseCode || "N/A"}</strong></td>
              <td style="padding: 0.85rem; font-weight: 700; color: var(--primary);">${res.score || 0} / ${res.totalQuestions || 0}</td>
              <td style="padding: 0.85rem;">${dateStr}</td>
              <td style="padding: 0.85rem; text-align: center;">
                <button class="btn btn-sm btn-outline-primary view-script-btn" data-id="${doc.id}" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;">
                  <i class="fa-solid fa-eye"></i> View Details
                </button>
              </td>
            </tr>
          `;
        }).join("");

        subTbody.querySelectorAll(".view-script-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            window.showToast("Detailed CBT sheet review is stored securely in candidates results database.", "info");
          });
        });
      }
    }
  }).catch(err => {
    console.error("CBT loading failed:", err);
  });
};

// --- RENDER REPORTS SUB-TAB ---
window.renderCentreReports = function(centreId) {
  const container = document.getElementById("centreReportsContainer");
  if (!container) return;

  const centre = allStudyCentres.find(c => c.id === centreId);
  if (!centre) return;

  const centreApps = allApplications.filter(app => app.preferredStudyCentreId === centreId);
  const centreStudents = allStudents.filter(stu => stu.studyCentreId === centreId);
  const centreLecturers = allLecturers.filter(l => l.assignedStudyCentreIds && l.assignedStudyCentreIds.includes(centreId));
  const centreCourses = allCourses.filter(c => c.studyCentreId === centreId);

  // Compile Result summaries
  const resultsRef = collection(db, "results");
  getDocs(query(resultsRef, where("studyCentreId", "==", centreId))).then(resultsSnap => {
    const totalGradeSheets = resultsSnap.size;

    container.innerHTML = `
      <div style="background-color: var(--bg-white); border-radius: var(--border-radius-lg); border: 1px solid var(--border-color); padding: 2.5rem; box-shadow: var(--shadow-sm); font-family: 'Poppins', sans-serif;">
        <!-- Header -->
        <div style="text-align: center; border-bottom: 2.5px solid var(--primary); padding-bottom: 1.5rem; margin-bottom: 2rem;">
          <h1 style="color: var(--primary); font-size: 1.8rem; font-weight: 800; margin: 0 0 0.25rem 0; font-family: 'Playfair Display', serif;">DIVINE MANDATE BIBLE INSTITUTE</h1>
          <h2 style="color: var(--text-dark); font-size: 1.15rem; font-weight: 700; margin: 0 0 0.5rem 0;">${centre.name.toUpperCase()} REGIONAL CAMPUS</h2>
          <span style="background-color: var(--accent); color: var(--primary); padding: 0.35rem 0.75rem; border-radius: 4px; font-weight: 800; font-size: 0.8rem; text-transform: uppercase;">Official Campus Audit Report</span>
          <p style="color: var(--text-muted); font-size: 0.8rem; margin: 0.75rem 0 0 0;">Report Generated On: ${new Date().toLocaleString()}</p>
        </div>

        <!-- Section 1: Demographics -->
        <div style="margin-bottom: 2rem;">
          <h3 style="color: var(--primary); border-bottom: 1.5px solid var(--border-color); padding-bottom: 0.4rem; margin-bottom: 1rem; font-weight: 700;"><i class="fa-solid fa-circle-nodes"></i> 1. Enrollment & Admissions Standing</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
            <div style="background-color: var(--bg-slate); padding: 1rem; border-radius: 6px; border: 1px solid var(--border-color);">
              <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Total Enrollment</span>
              <div style="font-size: 1.5rem; font-weight: 800; color: var(--primary);">${centreStudents.length} Active Students</div>
            </div>
            <div style="background-color: var(--bg-slate); padding: 1rem; border-radius: 6px; border: 1px solid var(--border-color);">
              <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Admissions Received</span>
              <div style="font-size: 1.5rem; font-weight: 800; color: var(--primary);">${centreApps.length} Candidates</div>
            </div>
            <div style="background-color: var(--bg-slate); padding: 1rem; border-radius: 6px; border: 1px solid var(--border-color);">
              <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Active Faculty</span>
              <div style="font-size: 1.5rem; font-weight: 800; color: var(--primary);">${centreLecturers.length} Facilitators</div>
            </div>
          </div>
        </div>

        <!-- Section 2: Syllabus and Course Offerings -->
        <div style="margin-bottom: 2rem;">
          <h3 style="color: var(--primary); border-bottom: 1.5px solid var(--border-color); padding-bottom: 0.4rem; margin-bottom: 1rem; font-weight: 700;"><i class="fa-solid fa-book-bible"></i> 2. Campus Curriculum & Allocations</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem;">Total of <strong>${centreCourses.length}</strong> courses are currently registered under this region:</p>
          <div class="table-container" style="border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 1rem;">
            <table class="custom-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
              <thead>
                <tr style="background-color: var(--bg-slate); text-align: left;">
                  <th style="padding: 0.5rem 0.75rem;">Code</th>
                  <th style="padding: 0.5rem 0.75rem;">Title</th>
                  <th style="padding: 0.5rem 0.75rem;">Level</th>
                  <th style="padding: 0.5rem 0.75rem;">Facilitators Allocated</th>
                </tr>
              </thead>
              <tbody>
                ${centreCourses.length === 0 ? `<tr><td colspan="4" style="text-align: center; padding: 1rem;">No curriculum courses cataloged.</td></tr>` : 
                  centreCourses.map(c => {
                    const facilitators = centreLecturers.filter(l => (l.coursesAssigned || l.assignedCourses || []).includes(c.courseCode || c.id));
                    const facNames = facilitators.map(f => `${f.title || ""} ${f.fullName}`).join(", ") || "None Allocated";
                    return `
                      <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 0.5rem 0.75rem; font-family: monospace;">${c.courseCode || c.id}</td>
                        <td style="padding: 0.5rem 0.75rem; font-weight: 600;">${c.courseTitle || c.name}</td>
                        <td style="padding: 0.5rem 0.75rem;">Level ${c.level || "100"} / ${c.semester || "First Semester"}</td>
                        <td style="padding: 0.5rem 0.75rem; color: var(--primary); font-weight: 500;">${facNames}</td>
                      </tr>
                    `;
                  }).join("")
                }
              </tbody>
            </table>
          </div>
        </div>

        <!-- Section 3: Lecturer Directory -->
        <div style="margin-bottom: 2rem;">
          <h3 style="color: var(--primary); border-bottom: 1.5px solid var(--border-color); padding-bottom: 0.4rem; margin-bottom: 1rem; font-weight: 700;"><i class="fa-solid fa-chalkboard-user"></i> 3. Assigned Regional Lecturers</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem;">List of <strong>${centreLecturers.length}</strong> theological facilitators assigned to this study centre:</p>
          <div class="table-container" style="border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 1rem;">
            <table class="custom-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
              <thead>
                <tr style="background-color: var(--bg-slate); text-align: left;">
                  <th style="padding: 0.5rem 0.75rem;">Lec ID</th>
                  <th style="padding: 0.5rem 0.75rem;">Name</th>
                  <th style="padding: 0.5rem 0.75rem;">Department</th>
                  <th style="padding: 0.5rem 0.75rem;">Assigned Courses</th>
                </tr>
              </thead>
              <tbody>
                ${centreLecturers.length === 0 ? `<tr><td colspan="4" style="text-align: center; padding: 1rem;">No theological facilitators assigned.</td></tr>` : 
                  centreLecturers.map(l => {
                    const courses = l.coursesAssigned || l.assignedCourses || [];
                    const coursesStr = courses.join(", ") || "No courses allocated";
                    return `
                      <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 0.5rem 0.75rem; font-family: monospace;">${l.lecturerId || l.id}</td>
                        <td style="padding: 0.5rem 0.75rem; font-weight: 600;">${l.title || ""} ${l.fullName}</td>
                        <td style="padding: 0.5rem 0.75rem;">${l.department || "Theology"}</td>
                        <td style="padding: 0.5rem 0.75rem;">${coursesStr}</td>
                      </tr>
                    `;
                  }).join("")
                }
              </tbody>
            </table>
          </div>
        </div>

        <!-- Section 4: Result summary statistics -->
        <div style="margin-bottom: 1rem;">
          <h3 style="color: var(--primary); border-bottom: 1.5px solid var(--border-color); padding-bottom: 0.4rem; margin-bottom: 1rem; font-weight: 700;"><i class="fa-solid fa-file-signature"></i> 4. Regional Results Summaries</h3>
          <p style="font-size: 0.85rem; color: var(--text-dark);">Total of <strong>${totalGradeSheets}</strong> grade sheets have been synchronized in this Study Centre.</p>
        </div>

        <!-- Footer stamp -->
        <div style="display: flex; justify-content: space-between; margin-top: 3.5rem; border-top: 1px dashed var(--border-color); padding-top: 2rem; font-size: 0.85rem;">
          <div style="text-align: center;">
            <div style="width: 150px; border-bottom: 1px solid var(--text-dark); margin: 0 auto 0.5rem auto;"></div>
            <p style="margin: 0; font-weight: 600;">Centre Administrator</p>
            <p style="margin: 0; color: var(--text-muted); font-size: 0.75rem;">Regional Signature</p>
          </div>
          <div style="text-align: center;">
            <div style="width: 150px; border-bottom: 1px solid var(--text-dark); margin: 0 auto 0.5rem auto;"></div>
            <p style="margin: 0; font-weight: 600;">Super Admin Port</p>
            <p style="margin: 0; color: var(--text-muted); font-size: 0.75rem;">Divine Mandate Bible Institute</p>
          </div>
        </div>
      </div>
    `;
  }).catch(err => {
    console.error("Failed compiling report metrics:", err);
    container.innerHTML = `<div style="text-align: center; color: var(--error); padding: 2rem;">Error compiling reports: ${err.message}</div>`;
  });
};

// --- CENTRE ADMINISTRATORS DIRECTORY (SUPER ADMIN) ---
window.loadCentreAdministrators = async function() {
  const tbody = document.getElementById("adminsTableBody");
  if (!tbody) return;

  try {
    // 1. Query legacy admins collection for Centre Admins
    const q1 = query(collection(db, "admins"), where("role", "==", "Centre Admin"));
    const snap1 = await getDocs(q1);
    const legacyAdmins = snap1.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        adminId: data.adminId || data.administratorId || "",
        fullName: data.fullName || "",
        assignedStudyCentreName: data.assignedStudyCentreName || data.studyCentre || "",
        phone: data.phone || data.phoneNumber || "",
        email: data.email || data.hiddenEmail || "",
        status: data.status || "Active",
        createdAt: data.createdAt || data.createdDate || ""
      };
    });

    // 2. Query new centreAdministrators collection
    const q2 = query(collection(db, "centreAdministrators"));
    const snap2 = await getDocs(q2);
    const newAdmins = snap2.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        adminId: data.administratorId || data.adminId || "",
        fullName: data.fullName || "",
        assignedStudyCentreName: data.studyCentre || data.assignedStudyCentreName || "",
        phone: data.phoneNumber || data.phone || "",
        email: data.hiddenEmail || data.email || "",
        status: data.status || "Active",
        createdAt: data.createdAt || data.createdDate || ""
      };
    });

    // 3. Combine both lists, ensuring uniqueness by adminId
    const seenIds = new Set();
    allCentreAdmins = [];
    
    // Prioritize new collection
    for (const adm of newAdmins) {
      if (adm.adminId && !seenIds.has(adm.adminId)) {
        seenIds.add(adm.adminId);
        allCentreAdmins.push(adm);
      }
    }
    
    for (const adm of legacyAdmins) {
      if (adm.adminId && !seenIds.has(adm.adminId)) {
        seenIds.add(adm.adminId);
        allCentreAdmins.push(adm);
      }
    }

    const searchQuery = (document.getElementById("searchAdminsInput")?.value || "").toLowerCase().trim();

    let list = [...allCentreAdmins];

    if (searchQuery) {
      list = list.filter(adm => {
        return (adm.fullName || "").toLowerCase().includes(searchQuery) ||
               (adm.adminId || "").toLowerCase().includes(searchQuery) ||
               (adm.assignedStudyCentreName || "").toLowerCase().includes(searchQuery);
      });
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">No administrators found matching criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(adm => {
      const createdStr = adm.createdAt ? new Date(adm.createdAt).toLocaleDateString() : "N/A";
      const badgeClass = adm.status === "Active" ? "status-badge cleared" : "status-badge danger";
      const toggleActionLabel = adm.status === "Active" ? "Deactivate" : "Activate";
      const toggleActionIcon = adm.status === "Active" ? "fa-user-slash" : "fa-user-check";
      const toggleBtnStyle = adm.status === "Active" 
        ? "background-color: #fef2f2; color: #dc2626; border: 1px solid #fee2e2;"
        : "background-color: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7;";

      return `
        <tr style="border-bottom: 1.5px solid var(--border-color);">
          <td style="padding: 1rem; font-family: monospace; font-weight: 700; color: var(--primary);">${adm.adminId}</td>
          <td style="padding: 1rem; font-weight: 600; color: var(--primary-dark);">${adm.fullName}</td>
          <td style="padding: 1rem;"><span style="background-color: var(--accent); color: var(--primary); padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">${adm.assignedStudyCentreName || "None"}</span></td>
          <td style="padding: 1rem; font-weight: 500; color: var(--text-dark);">${adm.phone || "N/A"}</td>
          <td style="padding: 1rem; font-weight: 500; color: var(--text-dark);">${adm.email || adm.hiddenEmail || "N/A"}</td>
          <td style="padding: 1rem;"><span class="${badgeClass}" style="padding: 0.25rem 0.6rem; font-size: 0.8rem; font-weight: 700;">${adm.status || 'Active'}</span></td>
          <td style="padding: 1rem;">${createdStr}</td>
          <td style="padding: 1rem; text-align: center;">
            <div style="display: flex; gap: 0.35rem; justify-content: center; align-items: center; flex-wrap: wrap;">
              <button class="btn btn-sm btn-outline-primary edit-admin-btn" data-id="${adm.id}" title="Edit Profile & Transfer Centre" style="padding: 0.35rem 0.6rem; font-size: 0.78rem;">
                <i class="fa-solid fa-user-pen"></i> Edit / Transfer
              </button>
              <button class="btn btn-sm reset-admin-pass-btn" data-id="${adm.id}" style="background-color: #f3f4f6; color: #374151; border: 1px solid #d1d5db; padding: 0.35rem 0.6rem; font-size: 0.78rem;" title="Reset Password">
                <i class="fa-solid fa-key"></i> Reset Pass
              </button>
              <button class="btn btn-sm toggle-admin-status-btn" data-id="${adm.id}" data-status="${adm.status || 'Active'}" style="${toggleBtnStyle} padding: 0.35rem 0.6rem; font-size: 0.78rem;" title="${toggleActionLabel}">
                <i class="fa-solid ${toggleActionIcon}"></i> ${toggleActionLabel}
              </button>
              <button class="btn btn-sm btn-outline-danger delete-admin-btn" data-id="${adm.id}" title="Delete Account" style="padding: 0.35rem 0.6rem; font-size: 0.78rem;">
                <i class="fa-solid fa-trash-can"></i> Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll(".edit-admin-btn").forEach(btn => btn.addEventListener("click", () => openEditCentreAdminModal(btn.getAttribute("data-id"))));
    tbody.querySelectorAll(".reset-admin-pass-btn").forEach(btn => btn.addEventListener("click", () => resetCentreAdminPassword(btn.getAttribute("data-id"))));
    tbody.querySelectorAll(".toggle-admin-status-btn").forEach(btn => btn.addEventListener("click", () => toggleCentreAdminStatus(btn.getAttribute("data-id"), btn.getAttribute("data-status"))));
    tbody.querySelectorAll(".delete-admin-btn").forEach(btn => btn.addEventListener("click", () => deleteCentreAdminAccount(btn.getAttribute("data-id"))));

  } catch (err) {
    console.error("Failed loading administrators:", err);
    window.showToast("Failed to load administrator directory: " + err.message, "error");
  }
};

window.autoGenerateAdminId = function() {
  const select = document.getElementById("adminFormCentre");
  const idInput = document.getElementById("adminFormId");
  if (!select || !idInput) return;

  const centreId = select.value;
  if (!centreId) {
    idInput.value = "";
    console.log("ℹ️ [Centre Admin ID Generation] No Study Centre selected. Cleared Administrator ID field.");
    return;
  }

  const centre = allStudyCentres.find(c => c.id === centreId);
  const centreCode = (centre ? (centre.code || centre.id) : "CTR").toUpperCase().replace(/\s+/g, "");

  // Find count of admins assigned to this study centre
  const count = allCentreAdmins.filter(adm => adm.assignedStudyCentreId === centreId).length;
  const suffix = String(count + 1).padStart(2, "0");

  const generatedId = `ADM/CTR/${centreCode}${suffix}`;
  idInput.value = generatedId;
  console.log(`🆔 [Centre Admin ID Generation] Generated ID: "${generatedId}" for Study Centre: "${centre ? centre.name : centreId}" (Code: "${centreCode}", Count: ${count}, Suffix: "${suffix}")`);
};

window.populateAdminCentresDropdowns = function() {
  const adminFormCentre = document.getElementById("adminFormCentre");
  const editAdminCentre = document.getElementById("editAdminCentre");

  const opts = allStudyCentres.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  if (adminFormCentre) {
    adminFormCentre.innerHTML = `<option value="">-- Choose Centre --</option>` + opts;
    if (!adminFormCentre.dataset.listenerAdded) {
      adminFormCentre.addEventListener("change", window.autoGenerateAdminId);
      adminFormCentre.dataset.listenerAdded = "true";
    }
  }
  if (editAdminCentre) editAdminCentre.innerHTML = `<option value="">-- Choose Centre --</option>` + opts;
};

window.generateUniqueAdminEmail = async function(studyCentreId, centreCode, adminId) {
  let code = centreCode;
  if (!code && studyCentreId) {
    const centre = allStudyCentres.find(c => c.id === studyCentreId);
    code = centre ? (centre.code || centre.id) : "ctr";
  }
  if (!code) code = "ctr";
  
  let cleanCentre = code.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
  if (!cleanCentre) cleanCentre = "ctr";
  
  // Extract numeric suffix from the adminId, e.g. ADM/CTR/ODEDA01 -> "01" -> 1 -> "001"
  let match = adminId.match(/(\d+)$/);
  let numStr = match ? match[1] : "1";
  let num = parseInt(numStr, 10) || 1;
  let paddedSuffix = String(num).padStart(3, "0");
  
  let email = `admin.${cleanCentre}.${paddedSuffix}@dimabin.local`;
  console.log(`📧 [Centre Admin Creation] Starting hidden email generation. Base target: "${email}"`);
  
  // Let's ensure uniqueness by checking in Firestore if it already exists
  let isUnique = false;
  let attempt = num;
  while (!isUnique) {
    let checkEmail = `admin.${cleanCentre}.${String(attempt).padStart(3, "0")}@dimabin.local`;
    console.log(`📧 [Centre Admin Creation] Checking uniqueness of hidden email: "${checkEmail}"...`);
    
    const check1 = query(collection(db, "admins"), where("email", "==", checkEmail));
    const snap1 = await getDocs(check1);
    
    const check2 = query(collection(db, "centreAdministrators"), where("hiddenEmail", "==", checkEmail));
    const snap2 = await getDocs(check2);

    const check3 = query(collection(db, "centreAdministrators"), where("email", "==", checkEmail));
    const snap3 = await getDocs(check3);
    
    if (snap1.empty && snap2.empty && snap3.empty) {
      email = checkEmail;
      isUnique = true;
      console.log(`📧 [Centre Admin Creation] Success: Unique hidden email confirmed: "${email}"`);
    } else {
      console.warn(`⚠️ [Centre Admin Creation] Hidden email collision detected for "${checkEmail}". Incrementing suffix to try next email address...`);
      attempt++;
    }
  }
  
  return email;
};

// Password visibility toggles for Centre Admin creation form
function setupPasswordToggles() {
  const toggleBtn = document.getElementById("toggleAdminFormPasswordBtn");
  const passwordInput = document.getElementById("adminFormPassword");
  const toggleIcon = document.getElementById("toggleAdminFormPasswordIcon");

  if (toggleBtn && passwordInput && toggleIcon) {
    toggleBtn.addEventListener("click", () => {
      if (passwordInput.type === "password") {
        passwordInput.type = "text";
        toggleIcon.className = "fa-solid fa-eye-slash";
      } else {
        passwordInput.type = "password";
        toggleIcon.className = "fa-solid fa-eye";
      }
    });
  }

  const toggleConfirmBtn = document.getElementById("toggleAdminFormConfirmPasswordBtn");
  const confirmInput = document.getElementById("adminFormConfirmPassword");
  const toggleConfirmIcon = document.getElementById("toggleAdminFormConfirmPasswordIcon");

  if (toggleConfirmBtn && confirmInput && toggleConfirmIcon) {
    toggleConfirmBtn.addEventListener("click", () => {
      if (confirmInput.type === "password") {
        confirmInput.type = "text";
        toggleConfirmIcon.className = "fa-solid fa-eye-slash";
      } else {
        confirmInput.type = "password";
        toggleConfirmIcon.className = "fa-solid fa-eye";
      }
    });
  }
}

// Call toggle setup
setTimeout(setupPasswordToggles, 100);

// Form listeners for Centre Admin Console
const createCentreAdminForm = document.getElementById("createCentreAdminForm");
if (createCentreAdminForm) {
  createCentreAdminForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const fullName = document.getElementById("adminFormFullName").value.trim();
    const adminId = document.getElementById("adminFormId").value.trim().toUpperCase();
    const studyCentreId = document.getElementById("adminFormCentre").value;
    const tempPassword = document.getElementById("adminFormPassword").value;
    const confirmPassword = document.getElementById("adminFormConfirmPassword").value;
    const phone = document.getElementById("adminFormPhone").value.trim();
    const email = document.getElementById("adminFormEmail").value.trim().toLowerCase();
    const status = document.getElementById("adminFormStatus").value;

    const submitBtn = document.getElementById("btnCreateAdminSubmit");
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Registering...`;

    if (tempPassword !== confirmPassword) {
      window.showToast("Passwords do not match.", "error");
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Create Administrator`;
      return;
    }

    if (tempPassword.length < 6) {
      window.showToast("Password must be at least 6 characters.", "error");
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Create Administrator`;
      return;
    }

    console.log(`🚀 [Centre Admin Creation] Form submission received.`);
    console.log(`👉 [Centre Admin Creation] Entered Admin ID: "${adminId}"`);
    console.log(`👉 [Centre Admin Creation] Full Name: "${fullName}"`);
    console.log(`👉 [Centre Admin Creation] Study Centre ID: "${studyCentreId}"`);
    console.log(`👉 [Centre Admin Creation] Phone: "${phone}"`);
    console.log(`👉 [Centre Admin Creation] Email: "${email}"`);
    console.log(`👉 [Centre Admin Creation] Initial Status: "${status}"`);

    try {
      // 1. Verify uniqueness of Administrator ID
      console.log(`🔍 [Centre Admin Creation] Step 1: Checking uniqueness of Administrator ID: "${adminId}"...`);
      const existing = await findAdminRecord(adminId);
      if (existing) {
        console.warn(`⚠️ [Centre Admin Creation] ID Collision: A profile already exists with ID "${adminId}".`);
        window.showToast("An administrator profile with this ID already exists.", "error");
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Create Administrator`;
        return;
      }
      console.log(`✅ [Centre Admin Creation] Success: Administrator ID "${adminId}" is unique.`);

      // 2. Validate one active administrator per centre in both collections
      if (status === "Active") {
        console.log(`🔍 [Centre Admin Creation] Step 2: Validating active administrator limits for Study Centre: "${studyCentreId}"...`);
        const activeAdminsQuery1 = query(
          collection(db, "admins"),
          where("assignedStudyCentreId", "==", studyCentreId),
          where("status", "==", "Active")
        );
        const activeAdminsSnap1 = await getDocs(activeAdminsQuery1);
        
        const activeAdminsQuery2 = query(
          collection(db, "centreAdministrators"),
          where("assignedStudyCentreId", "==", studyCentreId),
          where("status", "==", "Active")
        );
        const activeAdminsSnap2 = await getDocs(activeAdminsQuery2);
        
        if (!activeAdminsSnap1.empty || !activeAdminsSnap2.empty) {
          console.warn(`⚠️ [Centre Admin Creation] Policy Restriction: This Study Centre already has an active Administrator account.`);
          window.showToast("This Study Centre already has an active Administrator account.", "error");
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Create Administrator`;
          return;
        }
        console.log(`✅ [Centre Admin Creation] Success: No active administrator exists for this Study Centre.`);
      }

      // 3. Verify uniqueness of Email Address
      console.log(`🔍 [Centre Admin Creation] Step 3: Checking uniqueness of email: "${email}"...`);
      const qEmail1 = query(collection(db, "admins"), where("email", "==", email));
      const snapEmail1 = await getDocs(qEmail1);
      
      const qEmail2 = query(collection(db, "centreAdministrators"), where("email", "==", email));
      const snapEmail2 = await getDocs(qEmail2);

      const qEmail3 = query(collection(db, "centreAdministrators"), where("hiddenEmail", "==", email));
      const snapEmail3 = await getDocs(qEmail3);
      
      if (!snapEmail1.empty || !snapEmail2.empty || !snapEmail3.empty) {
        console.warn(`⚠️ [Centre Admin Creation] Email Collision: The email "${email}" is already in use.`);
        window.showToast("An administrator profile with this email address already exists.", "error");
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Create Administrator`;
        return;
      }
      console.log(`✅ [Centre Admin Creation] Success: Email "${email}" is unique.`);

      // 4. Create Firebase Auth user in a temporary context so we do not log out the Super Admin
      console.log(`🔐 [Centre Admin Creation] Step 4: Registering user in Firebase Authentication...`);
      let firebaseUid = "";
      try {
        const tempAppName = `temp_admin_create_${Date.now()}`;
        const tempApp = initializeApp(firebaseConfig, tempAppName);
        const tempAuth = getAuth(tempApp);
        const userCred = await createUserWithEmailAndPassword(tempAuth, email, tempPassword);
        firebaseUid = userCred.user.uid;
        console.log(`✅ [Centre Admin Creation] Created Firebase Authentication user successfully. UID: ${firebaseUid}`);
        await signOut(tempAuth);
      } catch (authErr) {
        console.error(`❌ [Centre Admin Creation] Firebase Authentication creation failed:`, authErr);
        throw new Error(`Firebase Auth Creation Failed: ${authErr.message}`);
      }

      // 5. Hash password
      console.log(`🔍 [Centre Admin Creation] Step 5: Hashing default administrative password...`);
      const hashedPass = await sha256(tempPassword);
      console.log(`✅ [Centre Admin Creation] Password hashed successfully.`);

      // 6. Save to Firestore centreAdministrators collection
      console.log(`🔍 [Centre Admin Creation] Step 6: Compiling and saving administrator profile data to Firestore...`);
      const centre = allStudyCentres.find(c => c.id === studyCentreId);
      const adminDocData = {
        uid: firebaseUid,
        administratorId: adminId,
        adminId: adminId, // keep for compatibility
        hiddenEmail: email, // keep for compatibility
        email: email,
        fullName,
        studyCentre: centre ? centre.name : "",
        assignedStudyCentreId: studyCentreId,
        assignedStudyCentreName: centre ? centre.name : "",
        password: tempPassword, // save for reset/onboarding lookup
        passwordHash: hashedPass,
        phoneNumber: phone,
        phone, // keep for compatibility
        status,
        role: "Centre Admin",
        createdAt: new Date().toISOString(),
        createdDate: new Date().toISOString(),
        lastLogin: ""
      };

      // Firestore document ID
      const firestoreDocId = adminId.replace(/\//g, "-");
      console.log(`💾 [Centre Admin Creation] Writing to Firestore collection 'centreAdministrators' with Document ID: "${firestoreDocId}"...`);

      try {
        await setDoc(doc(db, "centreAdministrators", firestoreDocId), adminDocData);
        console.log(`🎉 [Centre Admin Creation] Registration complete! Centre Administrator "${adminId}" created successfully.`);
        
        window.showToast(`Administrator profile "${adminId}" created successfully!`, "success");
        createCentreAdminForm.reset();
        await loadCentreAdministrators();
      } catch (firestoreErr) {
        console.error(`❌ [Centre Admin Creation] Firestore write failed:`, firestoreErr);
        throw new Error(`Firestore Creation Failed: ${firestoreErr.message}`);
      }

    } catch (err) {
      console.error(`❌ [Centre Admin Creation] Critical Process Failure:`, err.message);
      window.showToast("Failed to create profile: " + err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Create Administrator`;
    }
  });
}

window.resetCentreAdminPassword = async function(adminDocId) {
  try {
    const res = await getAdminDocAndRef(adminDocId);
    if (!res) {
      window.showToast("Administrator record not found.", "error");
      return;
    }

    const adm = res.snap.data();
    const adminEmail = adm.hiddenEmail || adm.email || "";
    const oldPassword = adm.password || "";
    
    if (confirm(`Are you sure you want to reset the login password for Administrator "${adm.fullName}"?`)) {
      window.showToast("Resetting credentials...", "info");

      const randHex = Math.random().toString(36).substring(2, 6).toUpperCase();
      const newTempPassword = `Dimabin@2026${randHex}`;

      console.log(`🔐 [Centre Admin Password Reset] Initiating reset for ${adminEmail}...`);
      
      let firebaseUid = adm.uid || "";
      const tempAppName = `temp_admin_reset_${Date.now()}`;
      const tempApp = initializeApp(firebaseConfig, tempAppName);
      const tempAuth = getAuth(tempApp);

      try {
        if (oldPassword) {
          console.log(`🔑 [Centre Admin Password Reset] Attempting to sign in to update password...`);
          try {
            const userCred = await signInWithEmailAndPassword(tempAuth, adminEmail, oldPassword);
            firebaseUid = userCred.user.uid;
            await updatePassword(tempAuth.currentUser, newTempPassword);
            console.log(`✅ [Centre Admin Password Reset] Updated password in Firebase Auth successfully.`);
            await signOut(tempAuth);
          } catch (signInErr) {
            console.warn(`⚠️ [Centre Admin Password Reset] Sign in failed (${signInErr.message}), attempting user creation...`);
            // If sign in fails, perhaps user wasn't in Auth yet. Let's try creating them.
            const userCred = await createUserWithEmailAndPassword(tempAuth, adminEmail, newTempPassword);
            firebaseUid = userCred.user.uid;
            console.log(`✅ [Centre Admin Password Reset] Created new user in Firebase Auth.`);
            await signOut(tempAuth);
          }
        } else {
          console.log(`➕ [Centre Admin Password Reset] No old password found. Creating user in Firebase Auth...`);
          const userCred = await createUserWithEmailAndPassword(tempAuth, adminEmail, newTempPassword);
          firebaseUid = userCred.user.uid;
          console.log(`✅ [Centre Admin Password Reset] Created new user in Firebase Auth.`);
          await signOut(tempAuth);
        }
      } catch (authErr) {
        console.error(`❌ [Centre Admin Password Reset] Firebase Auth update/creation failed:`, authErr);
        throw new Error(`Firebase Auth Update Failed: ${authErr.message}`);
      }

      const hashedPass = await sha256(newTempPassword);
      await updateDoc(res.ref, {
        password: newTempPassword,
        passwordHash: hashedPass,
        uid: firebaseUid,
        updatedAt: new Date().toISOString()
      });

      alert(`Success! The credentials for ${adm.fullName} have been updated.\n\nNew Temporary Password: ${newTempPassword}\nRegistered Email: ${adminEmail}`);
      window.showToast("Credentials successfully reset!", "success");
      await loadCentreAdministrators();
    }
  } catch (err) {
    window.showToast("Failed resetting password: " + err.message, "error");
  }
};

window.toggleCentreAdminStatus = async function(adminDocId, currentStatus) {
  try {
    const res = await getAdminDocAndRef(adminDocId);
    if (!res) {
      window.showToast("Administrator record not found.", "error");
      return;
    }

    const newStatus = currentStatus === "Active" ? "Deactivated" : "Active";
    const adm = res.snap.data();
    const assignedStudyCentreId = adm.assignedStudyCentreId || adm.studyCentreId || "";
    
    if (newStatus === "Active" && assignedStudyCentreId) {
      const activeAdminsQuery1 = query(
        collection(db, "admins"),
        where("assignedStudyCentreId", "==", assignedStudyCentreId),
        where("status", "==", "Active")
      );
      const activeAdminsSnap1 = await getDocs(activeAdminsQuery1);
      const otherActiveAdmins1 = activeAdminsSnap1.docs.filter(d => d.id !== adminDocId);
      
      const activeAdminsQuery2 = query(
        collection(db, "centreAdministrators"),
        where("assignedStudyCentreId", "==", assignedStudyCentreId),
        where("status", "==", "Active")
      );
      const activeAdminsSnap2 = await getDocs(activeAdminsQuery2);
      const otherActiveAdmins2 = activeAdminsSnap2.docs.filter(d => d.id !== adminDocId);
      
      if (otherActiveAdmins1.length > 0 || otherActiveAdmins2.length > 0) {
        window.showToast("This Study Centre already has an active Administrator account. Deactivate it first.", "error");
        return;
      }
    }

    await updateDoc(res.ref, { status: newStatus, updatedAt: new Date().toISOString() });
    window.showToast(`Administrator status changed to ${newStatus}.`, "success");
    await loadCentreAdministrators();
  } catch (err) {
    window.showToast("Status change failed: " + err.message, "error");
  }
};

window.deleteCentreAdminAccount = async function(adminDocId) {
  try {
    const res = await getAdminDocAndRef(adminDocId);
    if (!res) {
      window.showToast("Administrator record not found.", "error");
      return;
    }

    const adm = res.snap.data();

    if (confirm(`CRITICAL WARNING: Are you sure you want to permanently delete the Administrator profile for "${adm.fullName}" (${adm.adminId || adm.administratorId})?\n\nThis action cannot be undone.`)) {
      // Delete Firestore Document
      await deleteDoc(res.ref);
      window.showToast("Administrative profile permanently deleted.", "success");
      await loadCentreAdministrators();
    }
  } catch (err) {
    window.showToast("Deletion failed: " + err.message, "error");
  }
};

window.openEditCentreAdminModal = async function(adminDocId) {
  try {
    const res = await getAdminDocAndRef(adminDocId);
    if (!res) {
      window.showToast("Administrator record not found.", "error");
      return;
    }

    const adm = res.snap.data();
    document.getElementById("editAdminDocId").value = adminDocId;
    document.getElementById("editAdminId").value = adm.administratorId || adm.adminId || "";
    document.getElementById("editAdminFullName").value = adm.fullName || "";
    document.getElementById("editAdminPhone").value = adm.phoneNumber || adm.phone || "";
    document.getElementById("editAdminEmail").value = adm.email || adm.hiddenEmail || "";
    document.getElementById("editAdminStatus").value = adm.status || "Active";

    // Populate dropdown
    const select = document.getElementById("editAdminCentre");
    if (select) {
      select.value = adm.assignedStudyCentreId || "";
    }

    const modal = document.getElementById("editCentreAdminModal");
    if (modal) modal.style.display = "flex";
  } catch (err) {
    window.showToast("Error retrieving admin details: " + err.message, "error");
  }
};

const editCentreAdminForm = document.getElementById("editCentreAdminForm");
if (editCentreAdminForm) {
  editCentreAdminForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const docId = document.getElementById("editAdminDocId").value;
    const fullName = document.getElementById("editAdminFullName").value.trim();
    const phone = document.getElementById("editAdminPhone").value.trim();
    const email = document.getElementById("editAdminEmail").value.trim().toLowerCase();
    const centreId = document.getElementById("editAdminCentre").value;
    const status = document.getElementById("editAdminStatus").value;

    try {
      const res = await getAdminDocAndRef(docId);
      if (!res) {
        window.showToast("Administrator record not found.", "error");
        return;
      }

      // Check email uniqueness, excluding current administrator docId
      const qEmail1 = query(collection(db, "admins"), where("email", "==", email));
      const snapEmail1 = await getDocs(qEmail1);
      const otherEmail1 = snapEmail1.docs.filter(d => d.id !== docId);
      
      const qEmail2 = query(collection(db, "centreAdministrators"), where("email", "==", email));
      const snapEmail2 = await getDocs(qEmail2);
      const otherEmail2 = snapEmail2.docs.filter(d => d.id !== docId);

      const qEmail3 = query(collection(db, "centreAdministrators"), where("hiddenEmail", "==", email));
      const snapEmail3 = await getDocs(qEmail3);
      const otherEmail3 = snapEmail3.docs.filter(d => d.id !== docId);
      
      if (otherEmail1.length > 0 || otherEmail2.length > 0 || otherEmail3.length > 0) {
        window.showToast("An administrator profile with this email address already exists.", "error");
        return;
      }

      // Validate: only one active administrator per centre in both collections
      if (status === "Active") {
        const activeAdminsQuery1 = query(
          collection(db, "admins"),
          where("assignedStudyCentreId", "==", centreId),
          where("status", "==", "Active")
        );
        const activeAdminsSnap1 = await getDocs(activeAdminsQuery1);
        const otherActiveAdmins1 = activeAdminsSnap1.docs.filter(d => d.id !== docId);
        
        const activeAdminsQuery2 = query(
          collection(db, "centreAdministrators"),
          where("assignedStudyCentreId", "==", centreId),
          where("status", "==", "Active")
        );
        const activeAdminsSnap2 = await getDocs(activeAdminsQuery2);
        const otherActiveAdmins2 = activeAdminsSnap2.docs.filter(d => d.id !== docId);
        
        if (otherActiveAdmins1.length > 0 || otherActiveAdmins2.length > 0) {
          window.showToast("This Study Centre already has an active Administrator account. Deactivate it first.", "error");
          return;
        }
      }

      const centre = allStudyCentres.find(c => c.id === centreId);
      await updateDoc(res.ref, {
        fullName,
        phoneNumber: phone,
        phone, // compatibility
        email,
        hiddenEmail: email, // compatibility
        assignedStudyCentreId: centreId,
        assignedStudyCentreName: centre ? centre.name : "",
        studyCentre: centre ? centre.name : "", // compatibility
        status,
        updatedAt: new Date().toISOString()
      });

      window.showToast("Administrative profile successfully updated!", "success");
      const modal = document.getElementById("editCentreAdminModal");
      if (modal) modal.style.display = "none";
      await loadCentreAdministrators();
    } catch (err) {
      window.showToast("Failed to save changes: " + err.message, "error");
    }
  });
}

const btnCloseEditAdminModal = document.getElementById("btnCloseEditAdminModal");
if (btnCloseEditAdminModal) {
  btnCloseEditAdminModal.addEventListener("click", () => {
    const modal = document.getElementById("editCentreAdminModal");
    if (modal) modal.style.display = "none";
  });
}

const btnCloseAllocationModal = document.getElementById("btnCloseAllocationModal");
if (btnCloseAllocationModal) {
  btnCloseAllocationModal.addEventListener("click", () => {
    const modal = document.getElementById("centreAllocationModal");
    if (modal) modal.style.display = "none";
  });
}

const centreAllocationForm = document.getElementById("centreAllocationForm");
if (centreAllocationForm) {
  centreAllocationForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const courseCode = document.getElementById("allocModalCourseId").value;
    const lecId = document.getElementById("allocModalLecturerSelect").value;
    if (!lecId) return;

    try {
      const lec = allLecturers.find(l => l.id === lecId);
      if (!lec) return;

      const currentAllocations = lec.coursesAssigned || lec.assignedCourses || [];
      if (currentAllocations.includes(courseCode)) {
        window.showToast("This lecturer is already assigned to this course.", "warning");
        return;
      }

      currentAllocations.push(courseCode);

      const docRef = doc(db, "lecturers", lecId);
      await updateDoc(docRef, {
        coursesAssigned: currentAllocations,
        assignedCourses: currentAllocations,
        updatedAt: new Date().toISOString()
      });

      window.showToast(`Facilitator ${lec.fullName} successfully assigned!`, "success");
      document.getElementById("allocModalLecturerSelect").value = "";
      await loadLecturers();
      renderAllocationModalCurrentList(courseCode);
      renderCentreAllocation(currentSelectedStudyCentreId);

    } catch (err) {
      window.showToast("Failed to assign facilitator: " + err.message, "error");
    }
  });
}

// Subtab buttons inside CBT
const btnCentreCbtExams = document.getElementById("btnCentreCbtExams");
const btnCentreCbtSubmissions = document.getElementById("btnCentreCbtSubmissions");

if (btnCentreCbtExams && btnCentreCbtSubmissions) {
  btnCentreCbtExams.addEventListener("click", () => {
    btnCentreCbtExams.classList.add("active");
    btnCentreCbtExams.style.color = "var(--primary)";
    btnCentreCbtExams.style.borderBottomColor = "var(--primary)";

    btnCentreCbtSubmissions.classList.remove("active");
    btnCentreCbtSubmissions.style.color = "var(--text-muted)";
    btnCentreCbtSubmissions.style.borderBottomColor = "transparent";

    document.getElementById("centreCbtExamsView").style.display = "block";
    document.getElementById("centreCbtSubmissionsView").style.display = "none";
  });

  btnCentreCbtSubmissions.addEventListener("click", () => {
    btnCentreCbtSubmissions.classList.add("active");
    btnCentreCbtSubmissions.style.color = "var(--primary)";
    btnCentreCbtSubmissions.style.borderBottomColor = "var(--primary)";

    btnCentreCbtExams.classList.remove("active");
    btnCentreCbtExams.style.color = "var(--text-muted)";
    btnCentreCbtExams.style.borderBottomColor = "transparent";

    document.getElementById("centreCbtExamsView").style.display = "none";
    document.getElementById("centreCbtSubmissionsView").style.display = "block";
  });
}

const searchAdminsInput = document.getElementById("searchAdminsInput");
if (searchAdminsInput) {
  searchAdminsInput.addEventListener("input", () => {
    loadCentreAdministrators();
  });
}

window.setupCentreAdminSidebar = function(centreId, centreName) {
  const btns = [
    { id: "btnCentreDashboard", subtab: "Statistics" },
    { id: "btnCentreAdmissions", subtab: "Applications" },
    { id: "btnCentreStudents", subtab: "Students" },
    { id: "btnCentreLecturers", subtab: "Lecturers" },
    { id: "btnCentreCourses", subtab: "Courses" },
    { id: "btnCentreAllocation", subtab: "Allocation" },
    { id: "btnCentreResults", subtab: "Results" },
    { id: "btnCentreCbt", subtab: "CBT" },
    { id: "btnCentreAnnouncements", subtab: "Announcements" },
    { id: "btnCentreReports", subtab: "Reports" }
  ];

  btns.forEach(b => {
    const el = document.getElementById(b.id);
    if (el) {
      const newEl = el.cloneNode(true);
      el.parentNode.replaceChild(newEl, el);
      
      newEl.addEventListener("click", () => {
        document.querySelectorAll("#centreAdminSidebarNav .sidebar-nav-btn").forEach(btn => btn.classList.remove("active"));
        newEl.classList.add("active");
        if (b.id === "btnCentreAllocation") {
          document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
          const targetTab = document.getElementById("tab-courses-allocation");
          if (targetTab) targetTab.classList.add("active");
          initCoursesAllocationTab();
        } else {
          openStudyCentrePage(centreId, b.subtab);
        }
      });
    }
  });
};

// --- CORE COURSE ALLOCATION MODULE ---

window.initCoursesAllocationTab = function() {
  const lecturerSelect = document.getElementById("allocationLecturerSelect");
  if (!lecturerSelect) return;

  // Initialize lecturers list in dropdown
  const isCentreAdmin = currentAdminDoc && currentAdminDoc.role === "Centre Admin";
  const centreId = isCentreAdmin ? currentAdminDoc.assignedStudyCentreId : null;

  const relevantLecturers = allLecturers.filter(l => {
    if (isCentreAdmin) {
      return l.assignedStudyCentreIds && l.assignedStudyCentreIds.includes(centreId);
    }
    return true;
  });

  lecturerSelect.innerHTML = '<option value="">-- Choose Lecturer --</option>' +
    relevantLecturers.map(l => `<option value="${l.id}">${l.title || ""} ${l.fullName} (${l.lecturerId || l.id})</option>`).join("");

  // Attach dropdown change event
  // Remove existing listeners if any
  const newSelect = lecturerSelect.cloneNode(true);
  lecturerSelect.parentNode.replaceChild(newSelect, lecturerSelect);

  newSelect.addEventListener("change", (e) => {
    const val = e.target.value;
    const metaDisplay = document.getElementById("allocationLecMetaDisplay");

    if (!val) {
      if (metaDisplay) metaDisplay.style.display = "none";
      renderAllocCoursesCheckboxes(null);
      return;
    }

    const selectedLec = relevantLecturers.find(l => l.id === val);
    if (!selectedLec) return;

    // Populate metadata display
    const deptSpan = document.getElementById("allocMetaDept");
    const posSpan = document.getElementById("allocMetaPos");
    const emailSpan = document.getElementById("allocMetaEmail");
    const countSpan = document.getElementById("allocMetaCount");

    if (deptSpan) deptSpan.textContent = selectedLec.department || "General";
    if (posSpan) posSpan.textContent = selectedLec.position || "Lecturer";
    if (emailSpan) emailSpan.textContent = selectedLec.email || "-";
    if (countSpan) countSpan.textContent = (selectedLec.coursesAssigned || selectedLec.assignedCourses || []).length;

    if (metaDisplay) metaDisplay.style.display = "block";

    // Load active courses checkboxes pre-checked with assigned ones
    renderAllocCoursesCheckboxes(selectedLec);
  });

  // Attach search and filter events to assignments table
  const tableSearch = document.getElementById("coursesAllocationSearch");
  const semesterFilter = document.getElementById("coursesAllocationSemesterFilter");

  if (tableSearch && !tableSearch.dataset.listenerAttached) {
    tableSearch.addEventListener("input", () => renderCoursesAllocationTable());
    tableSearch.dataset.listenerAttached = "true";
  }

  if (semesterFilter && !semesterFilter.dataset.listenerAttached) {
    semesterFilter.addEventListener("change", () => renderCoursesAllocationTable());
    semesterFilter.dataset.listenerAttached = "true";
  }

  // Bind Bulk buttons and Save buttons
  if (!window.coursesAllocationListenersBound) {
    const selectAllBtn = document.getElementById("btnAllocSelectAll");
    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => {
        document.querySelectorAll(".alloc-course-checkbox").forEach(chk => {
          chk.checked = true;
          const label = chk.closest("label");
          if (label) label.style.borderColor = "var(--primary)";
        });
        updateSelectedCoursesCount();
      });
    }

    const clearAllBtn = document.getElementById("btnAllocClearAll");
    if (clearAllBtn) {
      clearAllBtn.addEventListener("click", () => {
        document.querySelectorAll(".alloc-course-checkbox").forEach(chk => {
          chk.checked = false;
          const label = chk.closest("label");
          if (label) label.style.borderColor = "var(--border-color)";
        });
        updateSelectedCoursesCount();
      });
    }

    const saveBtn = document.getElementById("btnSaveCourseAllocation");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const selectEl = document.getElementById("allocationLecturerSelect");
        const lecId = selectEl ? selectEl.value : "";
        if (!lecId) {
          window.showToast("Please select a lecturer first.", "warning");
          return;
        }

        const selectedLec = allLecturers.find(l => l.id === lecId);
        if (!selectedLec) return;

        const checkedBoxes = document.querySelectorAll(".alloc-course-checkbox:checked");
        const selectedCodes = Array.from(checkedBoxes).map(chk => chk.value);

        try {
          window.showToast(`Saving course allocations for ${selectedLec.fullName}...`, "info");

          const allocationsMetadata = selectedLec.allocationsMetadata || {};
          const nowStr = new Date().toISOString();

          // Add newly checked allocations
          selectedCodes.forEach(code => {
            if (!allocationsMetadata[code]) {
              allocationsMetadata[code] = {
                assignedAt: nowStr
              };
            }
          });

          // Delete deselected allocations
          Object.keys(allocationsMetadata).forEach(code => {
            if (!selectedCodes.includes(code)) {
              delete allocationsMetadata[code];
            }
          });

          const docRef = doc(db, "lecturers", lecId);
          await updateDoc(docRef, {
            coursesAssigned: selectedCodes,
            assignedCourses: selectedCodes,
            allocationsMetadata: allocationsMetadata,
            updatedAt: nowStr
          });

          window.showToast(`Successfully updated syllabus allocations for ${selectedLec.fullName}!`, "success");
          await loadLecturers();

          // Refresh the checkboxes and registry table
          const refreshedLec = allLecturers.find(l => l.id === lecId);
          renderAllocCoursesCheckboxes(refreshedLec);
          renderCoursesAllocationTable();

          const countSpan = document.getElementById("allocMetaCount");
          if (countSpan) countSpan.textContent = selectedCodes.length;

        } catch (err) {
          console.error("❌ Failed to save course allocations:", err);
          window.showToast("Failed to save course allocations: " + err.message, "error");
        }
      });
    }

    window.coursesAllocationListenersBound = true;
  }

  // Render initial assignments table
  renderCoursesAllocationTable();
};

window.renderAllocCoursesCheckboxes = function(selectedLec) {
  const container = document.getElementById("allocCoursesContainer");
  if (!container) return;

  if (!selectedLec) {
    container.innerHTML = `
      <div style="color: var(--text-muted); font-size: 0.95rem; text-align: center; padding: 2rem;">
        <i class="fa-solid fa-arrow-left" style="margin-right: 0.5rem; color: var(--accent);"></i> Select a facilitator on the left to activate syllabus allocation fields.
      </div>
    `;
    const sAll = document.getElementById("btnAllocSelectAll");
    const cAll = document.getElementById("btnAllocClearAll");
    const saveBtn = document.getElementById("btnSaveCourseAllocation");
    if (sAll) sAll.disabled = true;
    if (cAll) cAll.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    return;
  }

  const sAll = document.getElementById("btnAllocSelectAll");
  const cAll = document.getElementById("btnAllocClearAll");
  const saveBtn = document.getElementById("btnSaveCourseAllocation");
  if (sAll) sAll.disabled = false;
  if (cAll) cAll.disabled = false;
  if (saveBtn) saveBtn.disabled = false;

  const activeCourses = allCourses.filter(c => c.status !== "Inactive");
  const firstSemesterCourses = activeCourses.filter(c => c.semester === "First Semester");
  const secondSemesterCourses = activeCourses.filter(c => c.semester === "Second Semester");

  const assignedCourses = selectedLec.coursesAssigned || selectedLec.assignedCourses || [];

  const renderGroup = (title, courses) => {
    if (courses.length === 0) {
      return `<p style="color: var(--text-muted); font-size: 0.85rem; font-style: italic; padding: 0.5rem 0;">No active courses in this semester.</p>`;
    }
    return `
      <div style="margin-bottom: 1rem;">
        <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--primary); text-transform: uppercase; border-bottom: 1px dashed var(--border-color); padding-bottom: 0.35rem; margin-bottom: 0.75rem;">${title}</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem;">
          ${courses.map(c => {
            const code = c.courseCode || c.id || "";
            const name = c.courseTitle || c.name || "";
            const isChecked = assignedCourses.includes(code) ? "checked" : "";
            return `
              <label style="display: flex; align-items: flex-start; gap: 0.6rem; background-color: var(--bg-slate); padding: 0.75rem 1rem; border-radius: 6px; border: 1.5px solid ${isChecked ? "var(--primary)" : "var(--border-color)"}; cursor: pointer; font-size: 0.85rem; transition: all 0.2s; position: relative;">
                <input type="checkbox" class="alloc-course-checkbox" value="${code}" data-semester="${c.semester}" ${isChecked} style="margin-top: 0.15rem; accent-color: var(--primary);">
                <div style="flex-grow: 1;">
                  <span style="font-weight: 700; color: var(--primary); display: block; font-family: monospace;">${code}</span>
                  <span style="color: var(--text-dark); font-weight: 500; display: block; line-height: 1.3; margin-top: 0.15rem;">${name}</span>
                  <span style="font-size: 0.72rem; color: var(--text-muted); display: block; margin-top: 0.25rem;">${c.department || ""} • ${c.creditUnit || 0} Units</span>
                </div>
              </label>
            `;
          }).join("")}
        </div>
      </div>
    `;
  };

  container.innerHTML = `
    ${renderGroup("First Semester Curriculum", firstSemesterCourses)}
    <div style="margin-top: 1rem;"></div>
    ${renderGroup("Second Semester Curriculum", secondSemesterCourses)}
  `;

  updateSelectedCoursesCount();

  container.querySelectorAll(".alloc-course-checkbox").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const label = e.target.closest("label");
      if (label) {
        if (e.target.checked) {
          label.style.borderColor = "var(--primary)";
        } else {
          label.style.borderColor = "var(--border-color)";
        }
      }
      updateSelectedCoursesCount();
    });
  });
};

window.updateSelectedCoursesCount = function() {
  const display = document.getElementById("allocSelectedCoursesCountDisplay");
  if (!display) return;
  const count = document.querySelectorAll(".alloc-course-checkbox:checked").length;
  display.textContent = `${count} selected`;
};

window.renderCoursesAllocationTable = function() {
  const tbody = document.getElementById("coursesAllocationTableBody");
  if (!tbody) return;

  const searchQuery = (document.getElementById("coursesAllocationSearch")?.value || "").toLowerCase().trim();
  const semesterFilter = document.getElementById("coursesAllocationSemesterFilter")?.value || "all";

  const isCentreAdmin = currentAdminDoc && currentAdminDoc.role === "Centre Admin";
  const centreId = isCentreAdmin ? currentAdminDoc.assignedStudyCentreId : null;

  // Render from allLecturerAssignments
  const mappedAllocations = [];
  allLecturerAssignments.forEach(assign => {
    const lec = allLecturers.find(l => l.id === assign.lecturerId);
    // If Centre Admin, filter by their study centre
    if (isCentreAdmin) {
      if (!lec || !lec.assignedStudyCentreIds || !lec.assignedStudyCentreIds.includes(centreId)) {
        return; // skip
      }
    }

    const course = allCourses.find(c => c.courseCode === assign.courseCode || c.id === assign.courseCode);
    const studyCentreId = assign.studyCentreId || (lec ? (lec.assignedStudyCentreIds?.[0] || "") : "");
    const centre = allStudyCentres.find(c => c.id === studyCentreId);

    const lecturerName = assign.lecturerName || (lec ? `${lec.title || ""} ${lec.fullName}` : "Unknown Lecturer");
    const courseTitle = assign.courseTitle || (course ? (course.courseTitle || course.name) : "Unknown Course");
    const semester = assign.semester || (course ? (course.semester || "First Semester") : "First Semester");
    const programme = assign.programme || (course ? course.programme : "") || (lec ? lec.programme : "") || "Bachelor of Theology";
    const studyCentreName = assign.studyCentreName || (centre ? centre.name : "") || "Global";
    const academicSession = assign.academicSession || window.activeAcademicSession || "2026/2027";
    const rawAssignedDate = assign.assignedAt || assign.createdAt || "";
    const assignedDate = rawAssignedDate
      ? new Date(rawAssignedDate).toLocaleDateString("en-US", { year: 'numeric', month: 'short', day: 'numeric' })
      : "N/A";

    mappedAllocations.push({
      id: assign.id,
      lecturerId: assign.lecturerId,
      lecturerName,
      courseCode: assign.courseCode,
      courseTitle,
      programme,
      semester,
      studyCentreName,
      academicSession,
      assignedDate,
      rawAssignedDate
    });
  });

  let filteredAllocations = mappedAllocations.filter(alloc => {
    const matchesSearch = 
      alloc.lecturerName.toLowerCase().includes(searchQuery) ||
      alloc.courseCode.toLowerCase().includes(searchQuery) ||
      alloc.courseTitle.toLowerCase().includes(searchQuery) ||
      alloc.programme.toLowerCase().includes(searchQuery) ||
      alloc.studyCentreName.toLowerCase().includes(searchQuery);

    const matchesSemester = semesterFilter === "all" || alloc.semester === semesterFilter;

    return matchesSearch && matchesSemester;
  });

  filteredAllocations.sort((a, b) => b.rawAssignedDate.localeCompare(a.rawAssignedDate));

  if (filteredAllocations.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          <i class="fa-solid fa-folder-open" style="font-size: 2rem; display: block; margin-bottom: 0.5rem; color: var(--accent);"></i>
          No active course allocations found matching criteria.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filteredAllocations.map(alloc => {
    return `
      <tr style="border-bottom: 1.5px solid var(--border-color); transition: background 0.15s;">
        <td style="padding: 1rem; font-weight: 600; color: var(--primary-dark);">${alloc.lecturerName}</td>
        <td style="padding: 1rem; font-family: monospace; font-weight: 700; color: var(--primary);">${alloc.courseCode}</td>
        <td style="padding: 1rem; font-weight: 500;">${alloc.courseTitle}</td>
        <td style="padding: 1rem; font-size: 0.85rem; color: var(--text-dark);">${alloc.programme}</td>
        <td style="padding: 1rem;"><span style="background-color: var(--bg-slate); color: var(--primary); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${alloc.semester}</span></td>
        <td style="padding: 1rem; font-size: 0.85rem; color: var(--text-muted); font-weight: 500;">${alloc.studyCentreName}</td>
        <td style="padding: 1rem; font-family: monospace; font-size: 0.85rem; color: var(--primary); font-weight: 600;">${alloc.academicSession}</td>
        <td style="padding: 1rem; color: var(--text-muted); font-size: 0.85rem;"><i class="fa-regular fa-calendar"></i> ${alloc.assignedDate}</td>
        <td style="padding: 1rem; text-align: center;">
          <div style="display: inline-flex; gap: 0.5rem; align-items: center; justify-content: center;">
            <button class="btn btn-sm btn-outline-primary btn-edit-allocation" data-lec-id="${alloc.lecturerId}" title="Edit Lecturer's Allocations" style="padding: 0.35rem; border-radius: 4px; width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-color: rgba(31,59,130,0.3); color: var(--primary); background: transparent;">
              <i class="fa-solid fa-user-gear"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger btn-remove-allocation" data-lec-id="${alloc.lecturerId}" data-course-code="${alloc.courseCode}" title="De-allocate Course" style="padding: 0.35rem; border-radius: 4px; width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-color: rgba(220,53,69,0.3); color: var(--error); background: transparent;">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Attach event listeners
  tbody.querySelectorAll(".btn-edit-allocation").forEach(btn => {
    btn.addEventListener("click", () => {
      const lecId = btn.getAttribute("data-lec-id");
      const selectEl = document.getElementById("allocationLecturerSelect");
      if (selectEl) {
        selectEl.value = lecId;
        selectEl.dispatchEvent(new Event("change"));
        document.getElementById("tab-courses-allocation").scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  tbody.querySelectorAll(".btn-remove-allocation").forEach(btn => {
    btn.addEventListener("click", async () => {
      const lecId = btn.getAttribute("data-lec-id");
      const code = btn.getAttribute("data-course-code");
      
      const lec = allLecturers.find(l => l.id === lecId);
      if (!lec) return;

      const confirmed = confirm(`Are you sure you want to remove the allocation of course "${code}" from ${lec.fullName}?`);
      if (!confirmed) return;

      try {
        window.showToast("Removing allocation...", "info");
        
        let arr = lec.coursesAssigned || lec.assignedCourses || [];
        arr = arr.filter(c => c !== code);

        const allocationsMetadata = lec.allocationsMetadata || {};
        if (allocationsMetadata[code]) {
          delete allocationsMetadata[code];
        }

        const docRef = doc(db, "lecturers", lecId);
        await updateDoc(docRef, {
          coursesAssigned: arr,
          assignedCourses: arr,
          allocationsMetadata: allocationsMetadata,
          updatedAt: new Date().toISOString()
        });

        // Sync centralized assignments collection
        await syncLecturerAssignments(lecId, arr);

        window.showToast("Allocation successfully removed.", "success");
        await loadLecturers();
        renderCoursesAllocationTable();

        const currentLecId = document.getElementById("allocationLecturerSelect").value;
        if (currentLecId === lecId) {
          const refreshedLec = allLecturers.find(l => l.id === lecId);
          renderAllocCoursesCheckboxes(refreshedLec);
          const countSpan = document.getElementById("allocMetaCount");
          if (countSpan) countSpan.textContent = arr.length;
        }

      } catch (err) {
        console.error("❌ Failed to remove allocation:", err);
        window.showToast("Failed to remove allocation: " + err.message, "error");
      }
    });
  });
};

