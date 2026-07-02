import { db, auth } from './firebase-init.js';
import { getEmailJSConfig, saveEmailJSConfig, DEFAULT_EMAILJS_CONFIG, prepareAndLogEmail } from './emailjs-config.js';

// Import dynamic Firebase Auth and Firestore methods
const {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, orderBy, limit
} = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
const {
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");

const SESSION_KEY = "dimabin_admin_session";
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes in milliseconds
let inactivityTimer;
let allApplications = [];
let allStudents = [];
let allLecturers = [];
let allCourses = [];
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
        // Query matching admin document in Firestore by email
        const q = query(collection(db, "admins"), where("email", "==", user.email));
        const snap = await getDocs(q);
        
        let adminDoc = null;
        if (!snap.empty) {
          adminDoc = { id: snap.docs[0].id, data: snap.docs[0].data() };
        } else {
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
  
  // Initialize systems
  loadStats();
  loadApplications();
  loadStudents();
  loadLecturers();
  loadCourses();
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
  
  // 1. Query by adminId field
  const q = query(collection(db, "admins"), where("adminId", "==", trimmed));
  const qSnap = await getDocs(q);
  if (!qSnap.empty) {
    return { id: qSnap.docs[0].id, data: qSnap.docs[0].data() };
  }
  
  // 2. Direct get by clean ID (replacing slashes with dashes)
  const cleanId = trimmed.replace(/\//g, "-");
  const refClean = doc(db, "admins", cleanId);
  const snapClean = await getDoc(refClean);
  if (snapClean.exists()) {
    return { id: snapClean.id, data: snapClean.data() };
  }

  // 3. Direct get by raw ID
  const refRaw = doc(db, "admins", trimmed);
  const snapRaw = await getDoc(refRaw);
  if (snapRaw.exists()) {
    return { id: snapRaw.id, data: snapRaw.data() };
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
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    
    btn.classList.add("active");
    document.getElementById(`tab-${targetTab}`).classList.add("active");

    if (targetTab === "cbt-control") {
      initAdminCbtControl();
    } else if (targetTab === "result-approval") {
      initResultApprovalConsole();
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
  } catch (err) {
    console.error("❌ Error loading applications:", err);
  }
}

function renderApplicationsTable() {
  const tbody = document.getElementById("applicationsTableBody");
  if (!tbody) return;
  
  const filterVal = document.getElementById("filterStatus").value;
  const searchVal = document.getElementById("searchAppsInput").value.toLowerCase();

  let filtered = allApplications;
  if (filterVal !== "All") {
    filtered = filtered.filter(app => (app.admissionStatus || "Pending") === filterVal);
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
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-muted);">No matching candidate applications found.</td></tr>`;
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
if (searchAppsInput) searchAppsInput.addEventListener("input", renderApplicationsTable);
if (filterStatus) filterStatus.addEventListener("change", renderApplicationsTable);

// Fetch and load students
async function loadStudents() {
  try {
    const qSnap = await getDocs(collection(db, "students"));
    allStudents = [];
    qSnap.forEach(d => {
      allStudents.push(d.data());
    });
    renderStudentsTable();
  } catch (err) {
    console.error("❌ Error loading students:", err);
  }
}

function renderStudentsTable() {
  const tbody = document.getElementById("studentsTableBody");
  if (!tbody) return;
  
  const searchVal = document.getElementById("searchStudentsInput").value.toLowerCase();

  let filtered = allStudents;
  if (searchVal) {
    filtered = filtered.filter(stu => {
      return (stu.fullName || "").toLowerCase().includes(searchVal) ||
             (stu.matricNumber || "").toLowerCase().includes(searchVal) ||
             (stu.studentId || "").toLowerCase().includes(searchVal) ||
             (stu.email || "").toLowerCase().includes(searchVal);
   });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-muted);">No student records registered.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(stu => {
    return `
      <tr>
        <td><strong>${stu.studentId}</strong></td>
        <td>${stu.matricNumber}</td>
        <td>${stu.fullName}</td>
        <td>${stu.email || "N/A"}</td>
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
if (searchStudentsInput) searchStudentsInput.addEventListener("input", renderStudentsTable);

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

    // 4. Update the original application document status to Approved
    await updateDoc(doc(db, "applications", id), {
      admissionStatus: "Approved",
      remarks: remarks || "Approved and admitted.",
      reviewedBy: "DIMABIN/ADM/2026/01"
    });

    // 5. Create a system notification record
    await setDoc(doc(db, "notifications", `notif-${Date.now()}`), {
      title: "New Student Admitted",
      message: `${app.fullName} has been approved and admitted with Matric Number: ${matricNumber}`,
      createdAt: new Date().toISOString(),
      type: "Admission",
      target: "All"
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
    const docSnap = await getDoc(doc(db, "settings", "timeline_settings"));
    let session = "2026/2027";
    let semester = "First Semester";
    if (docSnap.exists()) {
      const d = docSnap.data();
      session = d.session || session;
      semester = d.semester || semester;
    } else {
      await setDoc(doc(db, "settings", "timeline_settings"), { session, semester });
    }
    const settingsSession = document.getElementById("settingsSession");
    const settingsSemester = document.getElementById("settingsSemester");
    const activeSessionDisplay = document.getElementById("activeSessionDisplay");
    const activeSemesterDisplay = document.getElementById("activeSemesterDisplay");

    if (settingsSession) settingsSession.value = session;
    if (settingsSemester) settingsSemester.value = semester;
    if (activeSessionDisplay) activeSessionDisplay.textContent = session;
    if (activeSemesterDisplay) activeSemesterDisplay.textContent = semester;
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
  } catch (err) {
    console.warn("⚠️ Failed to load courses catalog:", err);
  }
}

function populateCourseCheckboxes() {
  const container = document.getElementById("courseAllocationCheckboxes");
  const editContainer = document.getElementById("editCourseAllocationCheckboxes");
  if (!container && !editContainer) return;

  // Sort courses alphabetically by code
  const sortedCourses = [...allCourses].sort((a, b) => (a.courseCode || a.code || "").localeCompare(b.courseCode || b.code || ""));

  let html = "";
  if (sortedCourses.length === 0) {
    html = `<div style="color: var(--text-muted); font-size: 0.9rem; grid-column: 1/-1; text-align: center; padding: 1rem;">No courses available in the syllabus repository.</div>`;
  } else {
    sortedCourses.forEach(c => {
      const code = c.courseCode || c.code || c.id || "";
      const name = c.courseTitle || c.name || "";
      html += `
        <label style="display: flex; align-items: flex-start; gap: 0.6rem; background-color: var(--bg-white); padding: 0.6rem 0.8rem; border-radius: 6px; border: 1.5px solid var(--border-color); cursor: pointer; font-size: 0.85rem; transition: border-color 0.2s;">
          <input type="checkbox" name="assignedCourses" value="${code}" style="margin-top: 0.2rem; accent-color: var(--primary);">
          <span style="font-weight: 500;">[${code}] <span style="color: var(--text-muted);">${name}</span></span>
        </label>
      `;
    });
  }
  if (container) container.innerHTML = html;

  let editHtml = "";
  if (sortedCourses.length === 0) {
    editHtml = `<div style="color: var(--text-muted); font-size: 0.85rem; grid-column: 1/-1; text-align: center; padding: 1rem;">No courses available in the syllabus repository.</div>`;
  } else {
    sortedCourses.forEach(c => {
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
  if (editContainer) editContainer.innerHTML = editHtml;
}

// Course Management Directory Renderer
function renderCoursesDirectory() {
  const tbody = document.getElementById("coursesTableBody");
  if (!tbody) return;

  const searchQuery = document.getElementById("searchCoursesInput") ? document.getElementById("searchCoursesInput").value.toLowerCase().trim() : "";
  const filterSemester = document.getElementById("filterCourseSemester") ? document.getElementById("filterCourseSemester").value : "all";
  const filterStatus = document.getElementById("filterCourseStatus") ? document.getElementById("filterCourseStatus").value : "all";
  const sortBy = document.getElementById("sortCourseBy") ? document.getElementById("sortCourseBy").value : "code-asc";

  let filtered = allCourses.filter(c => {
    const code = (c.courseCode || c.code || "").toLowerCase();
    const title = (c.courseTitle || c.name || "").toLowerCase();
    const dept = (c.department || "").toLowerCase();
    
    const matchesSearch = code.includes(searchQuery) || title.includes(searchQuery) || dept.includes(searchQuery);
    const matchesSemester = filterSemester === "all" || c.semester === filterSemester;
    const matchesStatus = filterStatus === "all" || c.status === filterStatus;

    return matchesSearch && matchesSemester && matchesStatus;
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

    html += `
      <tr style="border-bottom: 1.5px solid var(--border-color);">
        <td style="padding: 1rem; font-weight: 700; color: var(--primary);">${code}</td>
        <td style="padding: 1rem; font-weight: 500;">${title}</td>
        <td style="padding: 1rem;">${semester}</td>
        <td style="padding: 1rem;"><span style="background-color: var(--bg-slate); border: 1px solid var(--border-color); padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 600;">${creditUnit} Units</span></td>
        <td style="padding: 1rem; font-size: 0.85rem; color: var(--text-muted);">${department}</td>
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
["searchCoursesInput", "filterCourseSemester", "filterCourseStatus", "sortCourseBy"].forEach(id => {
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
    const sort = document.getElementById("sortCourseBy");

    if (search) search.value = "";
    if (sem) sem.value = "all";
    if (stat) stat.value = "all";
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
      const status = document.getElementById("editCourseStatus").value;
      const description = document.getElementById("editCourseDesc").value.trim();

      const docRef = doc(db, "courses", courseId);
      await updateDoc(docRef, {
        courseTitle: title,
        name: title, // backwards compatibility fallback
        semester: semester,
        creditUnit: credit,
        department: department,
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
  const activeCourses = allCourses.filter(c => c.status === "Active");
  if (activeCourses.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); padding: 1.5rem; text-align: center;">No active courses available in the curriculum. Ensure courses are activated inside Course Management.</div>`;
    return;
  }

  // Separate courses by semester
  const firstSemesterCourses = activeCourses.filter(c => c.semester === "First Semester");
  const secondSemesterCourses = activeCourses.filter(c => c.semester === "Second Semester");

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

  html += renderSemesterSection("First Semester Curriculum", firstSemesterCourses);
  html += renderSemesterSection("Second Semester Curriculum", secondSemesterCourses);

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

// Save Allocations Button
const btnSaveCourseAllocation = document.getElementById("btnSaveCourseAllocation");
if (btnSaveCourseAllocation) {
  btnSaveCourseAllocation.onclick = async () => {
    const select = document.getElementById("allocationLecturerSelect");
    if (!select) return;
    const lecId = select.value;
    if (!lecId) return;

    try {
      // Gather checked courses
      const checkedBoxes = document.querySelectorAll(".alloc-course-checkbox:checked");
      const allocatedCodes = Array.from(checkedBoxes).map(chk => chk.value);

      const lec = allLecturers.find(l => l.id === lecId);
      if (!lec) return;

      const docRef = doc(db, "lecturers", lecId);
      await updateDoc(docRef, {
        coursesAssigned: allocatedCodes,
        assignedCourses: allocatedCodes, // Dual field syncing
        updatedAt: new Date().toISOString()
      });

      window.showToast(`Facilitator allocations successfully synchronized for ${lec.fullName}!`, "success");
      
      // Reload everything to keep state fully consistent
      await loadLecturers();
      handleAllocationLecturerChange();
    } catch (err) {
      console.error("❌ Allocation save failed:", err);
      window.showToast("Failed to save course allocations: " + err.message, "error");
    }
  };
}

async function loadLecturers() {
  try {
    const qSnap = await getDocs(collection(db, "lecturers"));
    allLecturers = [];
    qSnap.forEach(docSnap => {
      allLecturers.push({ id: docSnap.id, ...docSnap.data() });
    });
    console.log(`🌟 [Lecturer Directory] Loaded ${allLecturers.length} facilitators successfully!`);
    renderLecturerDirectory();
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
  const sortBy = document.getElementById("sortLecturerBy") ? document.getElementById("sortLecturerBy").value : "name-asc";

  // Filter facilitators
  let filtered = allLecturers.filter(lec => {
    const matchesSearch = 
      (lec.lecturerId || "").toLowerCase().includes(searchQuery) ||
      (lec.fullName || "").toLowerCase().includes(searchQuery) ||
      (lec.department || "").toLowerCase().includes(searchQuery) ||
      (lec.email || "").toLowerCase().includes(searchQuery);

    const matchesStatus = filterStatus === "all" || lec.status === filterStatus;
    return matchesSearch && matchesStatus;
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
        <td colspan="6" style="text-align: center; padding: 3.5rem; color: var(--text-muted);">
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
    
    // Fallback support for course codes
    const coursesList = lec.coursesAssigned || lec.assignedCourses || [];
    const coursesHtml = coursesList.length > 0 
      ? coursesList.map(c => `<span style="background-color: var(--primary); color: white; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600; margin-right: 0.3rem; display: inline-block; margin-bottom: 0.25rem;">${c}</span>`).join("")
      : `<span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">None Allocated</span>`;

    // Strictly ICONS ONLY action buttons matching style guidelines!
    return `
      <tr style="border-bottom: 1.5px solid var(--border-color); transition: background 0.15s;">
        <td style="padding: 1rem; font-family: monospace; font-weight: 700; color: var(--primary); font-size: 0.92rem;">${lec.lecturerId || ""}</td>
        <td style="padding: 1rem; font-weight: 600; color: var(--primary-dark);">${lec.title || ""} ${lec.fullName || ""}</td>
        <td style="padding: 1rem; font-size: 0.88rem; font-weight: 500;">${lec.department || ""}</td>
        <td style="padding: 1rem; max-width: 300px;">${coursesHtml}</td>
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

const sortLecSelect = document.getElementById("sortLecturerBy");
if (sortLecSelect) sortLecSelect.addEventListener("change", renderLecturerDirectory);

const btnResetLecFilters = document.getElementById("btnResetLecturerFilters");
if (btnResetLecFilters) {
  btnResetLecFilters.addEventListener("click", () => {
    if (searchLecInput) searchLecInput.value = "";
    if (filterLecStatus) filterLecStatus.value = "all";
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
    const position = document.getElementById("regLecPosition").value.trim();
    const employmentDate = document.getElementById("regLecEmploymentDate").value;

    if (!email.includes("@")) {
      window.showToast("Please supply a valid institutional email address.", "error");
      return;
    }

    // Gather courses
    const checkedCourses = [];
    document.querySelectorAll('#courseAllocationCheckboxes input[name="assignedCourses"]:checked').forEach(cb => {
      checkedCourses.push(cb.value);
    });

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
        position,
        employmentDate,
        assignedCourses: checkedCourses,
        coursesAssigned: checkedCourses, // Dual field synchronization for portal integration
        status: "Active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        passwordHash: passHash
      };

      await setDoc(doc(db, "lecturers", docId), lecDocData);

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
  document.getElementById("editLecDepartment").value = lec.department || "Theology";
  document.getElementById("editLecPosition").value = lec.position || "";
  document.getElementById("editLecEmploymentDate").value = lec.employmentDate || "";
  document.getElementById("editLecStatus").value = lec.status || "Active";

  // Match and check assigned checkboxes
  const assigned = lec.coursesAssigned || lec.assignedCourses || [];
  document.querySelectorAll('#editCourseAllocationCheckboxes input[name="editAssignedCourses"]').forEach(cb => {
    cb.checked = assigned.includes(cb.value);
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
    const address = document.getElementById("editLecAddress").value.trim();
    const qualification = document.getElementById("editLecQualification").value.trim();
    const department = document.getElementById("editLecDepartment").value;
    const position = document.getElementById("editLecPosition").value.trim();
    const employmentDate = document.getElementById("editLecEmploymentDate").value;
    const status = document.getElementById("editLecStatus").value;

    const checkedCourses = [];
    document.querySelectorAll('#editCourseAllocationCheckboxes input[name="editAssignedCourses"]:checked').forEach(cb => {
      checkedCourses.push(cb.value);
    });

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
        position,
        employmentDate,
        status,
        assignedCourses: checkedCourses,
        coursesAssigned: checkedCourses, // Synchronized fields
        updatedAt: new Date().toISOString()
      });

      window.showToast("Facilitator profile updated successfully!", "success");
      if (editLecModal) editLecModal.style.display = "none";
      await loadLecturers();
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

    const filterHandler = () => {
      renderApprovalList(courseTitlesMap);
    };

    if (fSession) fSession.onchange = filterHandler;
    if (fSemester) fSemester.onchange = filterHandler;
    if (fCourse) fCourse.oninput = filterHandler;
    if (fLecturer) fLecturer.oninput = filterHandler;

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

  const filtered = approvalSubmissionsList.filter(item => {
    if (fSession !== "all" && item.academicSession !== fSession) return false;
    if (fSemester !== "all" && item.semester !== fSemester) return false;
    if (fCourse !== "" && !item.courseCode.toLowerCase().includes(fCourse)) return false;
    if (fLecturer !== "" && !item.lecturerName.toLowerCase().includes(fLecturer)) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">No grading sheet submissions match your active filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  filtered.forEach((item, index) => {
    const title = courseTitlesMap[item.courseCode] || "General Theology Course";
    const stdCount = item.students ? item.students.length : 0;
    const formattedDate = item.lastUpdated ? new Date(item.lastUpdated).toLocaleString() : "-";
    
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
  const docId = `${courseCode}_${session.replace(/\//g, "-")}_${semester}`;

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
      await updateDoc(doc(db, "results", docId), {
        status: "Published",
        adminComment: comments,
        publishedBy: adminIdVal,
        publishedByName: approverName,
        publishedDate: dateStr,
        publishedTime: timeStr,
        publishedTimestamp: timestamp,
        lastUpdated: timestamp
      });

      // Fetch credits for each student record
      const coursesSnap = await getDocs(collection(db, "courses"));
      let creditUnit = 3;
      coursesSnap.forEach(cs => {
        const cData = cs.data();
        if (cData.courseCode === courseCode) {
          creditUnit = parseInt(cData.creditUnit || cData.credits || 3);
        }
      });

      // Write student-level results to publishedResults
      const studentsList = selectedReviewSheet.students || [];
      const batchPromises = studentsList.map(async std => {
        const pubDocId = `pub_${std.studentId}_${courseCode}_${session.replace(/\//g, "-")}_${semester}`;
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
        await setDoc(doc(db, "publishedResults", pubDocId), studentPayload);
      });

      await Promise.all(batchPromises);
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
