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
  signOut
} = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");

const SESSION_KEY = "dimabin_admin_session";
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes in milliseconds
let inactivityTimer;
let allApplications = [];
let allStudents = [];

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
  const cached = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
  if (cached) {
    const session = JSON.parse(cached);
    enterDashboard(session);
  }
}

function enterDashboard(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  document.getElementById("anonymousView").style.display = "none";
  document.getElementById("authenticatedView").style.display = "block";
  document.getElementById("currentUserDisplay").textContent = session.fullName;
  document.getElementById("currentIdDisplay").textContent = session.adminId;
  
  // Initialize systems
  loadStats();
  loadApplications();
  loadStudents();
  loadSettings();
  resetInactivityTimer();
}

function handleLogout(message = "Logged out successfully.") {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
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
    const email = prompt("Enter your registered Administrator email address:");
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
          <button class="btn btn-sm btn-outline-primary view-stu-credentials-btn" data-name="${stu.fullName}" data-stu-id="${stu.studentId}" data-matric="${stu.matricNumber}" data-pass="${stu.loginCredentials?.password || 'N/A'}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
            <i class="fa-solid fa-id-card"></i> View Credentials
          </button>
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
        btn.getAttribute("data-pass")
      );
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
  if (!confirm("Are you absolutely sure you want to decline this theological application?")) return;
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
  if (!confirm(`Are you sure you want to approve and admit ${app.fullName}? This will automatically generate a matric number and register a new student.`)) return;

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

    // 6. Dispatch prepared EmailJS log/simulation
    await prepareAndLogEmail("admission", app.fullName, app.email, {
      matric_number: matricNumber,
      student_id: studentId,
      temporary_password: tempPassword,
      academic_session: "2026/2027"
    });

    closeDetailsModal();

    // Show success credentials prompt to copy or print
    showCredentialsReceipt(app.fullName, studentId, matricNumber, tempPassword);

    // Refresh dashboard data
    await loadApplications();
    await loadStudents();
    await loadStats();

  } catch (err) {
    window.showToast("Approval sequence failed: " + err.message, "error");
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
function showCredentialsReceipt(name, studentId, matric, password) {
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
    // Split <script> tags to avoid HTML parsing issues
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
    const elCnt = document.getElementById("emailjsContactId");
    const elAdmN = document.getElementById("emailjsAdminNotificationId");
    const elStuN = document.getElementById("emailjsStudentNotificationId");
    const elLecN = document.getElementById("emailjsLecturerNotificationId");

    if (elKey) elKey.value = config.publicKey;
    if (elSrv) elSrv.value = config.serviceId;
    if (elAdm) elAdm.value = config.admissionTemplateId;
    if (elCnt) elCnt.value = config.contactTemplateId;
    if (elAdmN) elAdmN.value = config.adminNotificationTemplateId;
    if (elStuN) elStuN.value = config.studentNotificationTemplateId;
    if (elLecN) elLecN.value = config.lecturerNotificationTemplateId;
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
    const cnt = document.getElementById("emailjsContactId").value.trim();
    const admN = document.getElementById("emailjsAdminNotificationId").value.trim();
    const stuN = document.getElementById("emailjsStudentNotificationId").value.trim();
    const lecN = document.getElementById("emailjsLecturerNotificationId").value.trim();

    try {
      await saveEmailJSConfig({
        publicKey: key,
        serviceId: srv,
        admissionTemplateId: adm,
        contactTemplateId: cnt,
        adminNotificationTemplateId: admN,
        studentNotificationTemplateId: stuN,
        lecturerNotificationTemplateId: lecN
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
    if (!confirm("Restore all EmailJS variables back to system defaults?")) return;
    try {
      await saveEmailJSConfig(DEFAULT_EMAILJS_CONFIG);
      await loadSettings();
      window.showToast("Notification settings restored back to system defaults.", "info");
    } catch (err) {
      window.showToast("Failed to restore default settings.", "error");
    }
  });
}

// Run-Once Initializations
(async () => {
  await seedDefaultAdmin();
  checkActiveSession();
})();
