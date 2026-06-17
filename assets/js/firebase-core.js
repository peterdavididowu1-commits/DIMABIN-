// Firebase & Local Storage Unified Core Service Module
import firebaseConfig from './firebase-config-env.js';

// Detect if Live Firebase config has been entered
const isFirebaseConfigured = 
  firebaseConfig && 
  firebaseConfig.apiKey && 
  firebaseConfig.apiKey !== '' && 
  !firebaseConfig.apiKey.includes('YOUR_API_KEY_HERE');

let liveMode = false;
let db = null;
let auth = null;

// Firebase SDK reference placeholders
let sdkApps, sdkAuth, sdkFirestore;

// Safe Dynamic Imports
try {
  if (isFirebaseConfigured) {
    // Top-level imports for ES Modules
    sdkApps = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
    sdkAuth = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
    sdkFirestore = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

    const app = sdkApps.initializeApp(firebaseConfig);
    db = sdkFirestore.getFirestore(app);
    auth = sdkAuth.getAuth(app);
    liveMode = true;
    console.log("🌟 His Grace Core: Live Firebase Web Services Online!");
  } else {
    console.log("ℹ️ His Grace Core: Operating in standard offline repository mode.");
  }
} catch (error) {
  console.error("❌ His Grace Core: Failed to initialize web Firebase service.", error);
  liveMode = false;
}

// Ensure database state in local storage
const initLocalStorageDB = () => {
  if (!localStorage.getItem('hgs_admissions')) {
    localStorage.setItem('hgs_admissions', JSON.stringify([]));
  }
  if (!localStorage.getItem('hgs_messages')) {
    localStorage.setItem('hgs_messages', JSON.stringify([]));
  }
  if (!localStorage.getItem('hgs_administrators')) {
    localStorage.setItem('hgs_administrators', JSON.stringify([]));
  }
  if (!localStorage.getItem('hgs_students')) {
    // Seed initial high-fidelity student record for dynamic out-of-the-box local exploration
    localStorage.setItem('hgs_students', JSON.stringify([
      {
        id: 'STUD-DEFA-1234',
        admissionNumber: 'HGS-2026-001',
        studentName: 'Adebayo Daniel',
        gender: 'Male',
        dob: '2020-04-18',
        gradeApplying: 'Primary 1',
        parentName: 'Mr. Emmanuel Daniel',
        parentPhone: '08137606078',
        parentEmail: 'emmanuel.daniel@gmail.com',
        homeAddress: 'Agbugburu Village, Abeokuta',
        password: 'password123',
        status: 'Active',
        createdAt: new Date().toISOString(),
        grades: {
          english: 90,
          math: 95,
          computer: 88,
          civic: 96,
          agriculture: 82
        },
        coachRemarks: "Daniel continues to show remarkable godly growth, quantitative math logic, and deep obedience to our community guidelines. Approved for next phase!"
      }
    ]));
  }
  // Simulated Current Sessions
  if (!localStorage.getItem('hgs_session')) {
    localStorage.setItem('hgs_session', null);
  }
  if (!localStorage.getItem('hgs_student_session')) {
    localStorage.setItem('hgs_student_session', null);
  }
};
initLocalStorageDB();

// ==========================================
// UNIFIED MODE EXPORTS
// ==========================================
export const isLiveFirebase = () => liveMode;

// Display Banner to User (Disabled to preserve clean production aesthetics)
export const injectNotificationBanner = () => {
  // Banner disabled
};

// ==========================================
// ADMISSIONS MANAGEMENT
// ==========================================
export const saveAdmission = async (admissionData) => {
  const record = {
    ...admissionData,
    id: 'ADM-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    createdAt: new Date().toISOString()
  };

  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_admissions");
      await sdkFirestore.addDoc(colRef, record);
      return { success: true, id: record.id };
    } catch (err) {
      console.error("Firestore saveAdmission failed:", err);
      throw err;
    }
  } else {
    // Local storage fallback
    const list = JSON.parse(localStorage.getItem('hgs_admissions') || '[]');
    list.push(record);
    localStorage.setItem('hgs_admissions', JSON.stringify(list));
    return { success: true, id: record.id };
  }
};

export const getAdmissions = async () => {
  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_admissions");
      const q = sdkFirestore.query(colRef, sdkFirestore.orderBy("createdAt", "desc"));
      const snapshot = await sdkFirestore.getDocs(q);
      const results = [];
      snapshot.forEach(docSnap => {
        results.push({ ...docSnap.data(), docId: docSnap.id });
      });
      return results;
    } catch (err) {
      console.error("Firestore getAdmissions failed:", err);
      // fallback to offline reading on failure
    }
  }
  // Local storage fallback
  const list = JSON.parse(localStorage.getItem('hgs_admissions') || '[]');
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

export const updateAdmission = async (id, updatedFields) => {
  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_admissions");
      const q = sdkFirestore.query(colRef, sdkFirestore.where("id", "==", id));
      const snapshot = await sdkFirestore.getDocs(q);
      if (!snapshot.empty) {
        const docId = snapshot.docs[0].id;
        const docRef = sdkFirestore.doc(db, "hgs_admissions", docId);
        await sdkFirestore.updateDoc(docRef, updatedFields);
        return { success: true };
      }
    } catch (err) {
      console.error("Firestore updateAdmission failed:", err);
      throw err;
    }
  }

  // Local storage fallback
  const list = JSON.parse(localStorage.getItem('hgs_admissions') || '[]');
  const idx = list.findIndex(item => item.id === id);
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...updatedFields };
    localStorage.setItem('hgs_admissions', JSON.stringify(list));
    return { success: true };
  }
  throw new Error("Admission record not found");
};

export const deleteAdmission = async (id) => {
  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_admissions");
      const q = sdkFirestore.query(colRef, sdkFirestore.where("id", "==", id));
      const snapshot = await sdkFirestore.getDocs(q);
      if (!snapshot.empty) {
        const docId = snapshot.docs[0].id;
        const docRef = sdkFirestore.doc(db, "hgs_admissions", docId);
        await sdkFirestore.deleteDoc(docRef);
        return { success: true };
      }
    } catch (err) {
      console.error("Firestore deleteAdmission failed:", err);
      throw err;
    }
  }

  // Local Storage fallback
  const list = JSON.parse(localStorage.getItem('hgs_admissions') || '[]');
  const filtered = list.filter(item => item.id !== id);
  localStorage.setItem('hgs_admissions', JSON.stringify(filtered));
  return { success: true };
};

// ==========================================
// CONTACT MESSAGES MANAGEMENT
// ==========================================
export const saveContactMessage = async (messageData) => {
  const record = {
    ...messageData,
    id: 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    createdAt: new Date().toISOString()
  };

  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_messages");
      await sdkFirestore.addDoc(colRef, record);
      return { success: true, id: record.id };
    } catch (err) {
      console.error("Firestore saveContactMessage failed:", err);
      throw err;
    }
  } else {
    const list = JSON.parse(localStorage.getItem('hgs_messages') || '[]');
    list.push(record);
    localStorage.setItem('hgs_messages', JSON.stringify(list));
    return { success: true, id: record.id };
  }
};

export const getContactMessages = async () => {
  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_messages");
      const q = sdkFirestore.query(colRef, sdkFirestore.orderBy("createdAt", "desc"));
      const snapshot = await sdkFirestore.getDocs(q);
      const results = [];
      snapshot.forEach(docSnap => {
        results.push({ ...docSnap.data(), docId: docSnap.id });
      });
      return results;
    } catch (err) {
      console.error("Firestore getContactMessages failed:", err);
    }
  }
  const list = JSON.parse(localStorage.getItem('hgs_messages') || '[]');
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

// ==========================================
// ADMINISTRATOR AUTHENTICATION & MANAGEMENT
// ==========================================

// Check if any admin exists in the entire database (for dynamic First Setup page)
export const checkAdminsExist = async () => {
  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_administrators");
      const snapshot = await sdkFirestore.getDocs(colRef);
      return !snapshot.empty;
    } catch (err) {
      console.error("Firestore checkAdminsExist failed:", err);
    }
  }
  // Local storage fallback
  const list = JSON.parse(localStorage.getItem('hgs_administrators') || '[]');
  return list.length > 0;
};

// Create a new administrator account (Auth and Firestore list mapping)
export const createAdministrator = async (email, password, fullName) => {
  const profile = {
    fullName: fullName,
    email: email.toLowerCase().trim(),
    role: "Registrar",
    createdAt: new Date().toISOString()
  };

  if (liveMode && auth && db) {
    try {
      // Create user inside Firebase Authentication
      const result = await sdkAuth.createUserWithEmailAndPassword(auth, email, password);
      const uid = result.user.uid;
      
      // Save metadata securely using Firestore (mapping uid to doc reference)
      const docRef = sdkFirestore.doc(db, "hgs_administrators", uid);
      await sdkFirestore.setDoc(docRef, { ...profile, uid });
      return { success: true, uid };
    } catch (err) {
      console.error("Firebase createAdministrator failed:", err);
      throw err;
    }
  } else {
    // Local storage fallback
    const list = JSON.parse(localStorage.getItem('hgs_administrators') || '[]');
    
    // Check if email already registered
    const exists = list.some(admin => admin.email === profile.email);
    if (exists) {
      throw new Error("This administrator email address is already registered.");
    }

    const newAdmin = {
      ...profile,
      uid: 'ADM-ACC-' + Date.now(),
      passwordHash: btoa(password) // simple mock base64 obfuscation for offline storage safety
    };

    list.push(newAdmin);
    localStorage.setItem('hgs_administrators', JSON.stringify(list));
    return { success: true, uid: newAdmin.uid };
  }
};

// Administrator Log-in
export const loginAdministrator = async (email, password) => {
  const sanitizedEmail = email.toLowerCase().trim();

  if (liveMode && auth) {
    try {
      const result = await sdkAuth.signInWithEmailAndPassword(auth, sanitizedEmail, password);
      const uid = result.user.uid;

      // Check if user has admin record in Firestore
      const docRef = sdkFirestore.doc(db, "hgs_administrators", uid);
      const docSnap = await sdkFirestore.getDoc(docRef);
      
      if (docSnap.exists()) {
        const profile = docSnap.data();
        localStorage.setItem('hgs_session', JSON.stringify({ uid, email: sanitizedEmail, fullName: profile.fullName || "Admin", role: profile.role || "Registrar" }));
        return { success: true, profile };
      } else {
        // Logged in but no mapping? Create a placeholder metadata instantly
        const profile = { fullName: "Admin Staff", email: sanitizedEmail, role: "Registrar", createdAt: new Date().toISOString(), uid };
        await sdkFirestore.setDoc(docRef, profile);
        localStorage.setItem('hgs_session', JSON.stringify(profile));
        return { success: true, profile };
      }
    } catch (err) {
      console.error("Firestore/Auth loginAdministrator failed:", err);
      throw err;
    }
  } else {
    // Local storage fallback
    const list = JSON.parse(localStorage.getItem('hgs_administrators') || '[]');
    
    // Check credentials matching
    const admin = list.find(item => item.email === sanitizedEmail && item.passwordHash === btoa(password));
    if (admin) {
      const sessionUser = { uid: admin.uid, email: admin.email, fullName: admin.fullName, role: admin.role || "Registrar" };
      localStorage.setItem('hgs_session', JSON.stringify(sessionUser));
      return { success: true, profile: admin };
    } else {
      // If there is absolutely NO admin registered yet,
      // instruct them to register first.
      if (list.length === 0) {
        throw new Error("No administrators exist yet. Please register the first administrator account first using the Registration system.");
      }
      throw new Error("Invalid administrator access email or secure password.");
    }
  }
};

// Admin Secure Log-out
export const logoutAdministrator = async () => {
  localStorage.setItem('hgs_session', 'null');
  if (liveMode && auth) {
    try {
      await sdkAuth.signOut(auth);
      return { success: true };
    } catch (err) {
      console.error("Firebase signOut failed:", err);
    }
  }
  return { success: true };
};

// Check active login state
export const getActiveAdminSession = () => {
  const session = localStorage.getItem('hgs_session');
  if (session && session !== 'null') {
    try {
      return JSON.parse(session);
    } catch (e) {
      return null;
    }
  }
  return null;
};

// Edit Active Admin Password
export const changeAdministratorPassword = async (newPassword) => {
  const session = getActiveAdminSession();
  if (!session) throw new Error("No authenticated session available");

  if (liveMode && auth) {
    try {
      const currentUser = auth.currentUser;
      if (currentUser) {
        await sdkAuth.updatePassword(currentUser, newPassword);
        return { success: true };
      } else {
        throw new Error("Session expired. Please log in again.");
      }
    } catch (err) {
      console.error("Firebase updatePassword failed:", err);
      throw err;
    }
  } else {
    // Local storage fallback
    const list = JSON.parse(localStorage.getItem('hgs_administrators') || '[]');
    const idx = list.findIndex(item => item.uid === session.uid);
    if (idx !== -1) {
      list[idx].passwordHash = btoa(newPassword);
      localStorage.setItem('hgs_administrators', JSON.stringify(list));
      return { success: true };
    }
    throw new Error("Admin session matching record not found in storage.");
  }
};

// Forgot password reset helper
export const resetAdministratorPasswordByEmail = async (email) => {
  if (liveMode && auth) {
    try {
      await sdkAuth.sendPasswordResetEmail(auth, email);
      return { success: true };
    } catch (err) {
      console.error("Firebase sendPasswordResetEmail failed:", err);
      throw err;
    }
  } else {
    // Simulate reset for local storage persistence
    const list = JSON.parse(localStorage.getItem('hgs_administrators') || '[]');
    const exists = list.some(item => item.email === email.toLowerCase().trim());
    if (exists) {
      return { success: true, simulated: true };
    } else {
      throw new Error("No administrator account associated with this email address.");
    }
  }
};

// Fetch current statistics
export const getAdministrativeStats = async () => {
  const admissions = await getAdmissions();
  const messages = await getContactMessages();

  // Sort by Class totals
  const classBreakdown = {};
  admissions.forEach(item => {
    const cls = item.gradeApplying || "Unspecified";
    classBreakdown[cls] = (classBreakdown[cls] || 0) + 1;
  });

  return {
    totalAdmissionsCount: admissions.length,
    totalMessagesCount: messages.length,
    recentAdmissions: admissions.slice(0, 5),
    recentMessages: messages.slice(0, 5),
    classBreakdown
  };
};

// ==========================================
// STUDENT PROFILE & ACCOUNTS MANAGEMENT
// ==========================================

export const saveStudent = async (studentData) => {
  const record = {
    ...studentData,
    id: studentData.id || 'STUD-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    createdAt: studentData.createdAt || new Date().toISOString()
  };

  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_students");
      // Check if editing or creating
      const q = sdkFirestore.query(colRef, sdkFirestore.where("id", "==", record.id));
      const snapshot = await sdkFirestore.getDocs(q);
      
      if (!snapshot.empty) {
        // Edit existing doc
        const docId = snapshot.docs[0].id;
        const docRef = sdkFirestore.doc(db, "hgs_students", docId);
        await sdkFirestore.updateDoc(docRef, record);
      } else {
        // Create new doc
        await sdkFirestore.addDoc(colRef, record);
      }
      return { success: true, id: record.id };
    } catch (err) {
      console.error("Firestore saveStudent failed:", err);
      throw err;
    }
  } else {
    // Local storage fallback
    const list = JSON.parse(localStorage.getItem('hgs_students') || '[]');
    const idx = list.findIndex(item => item.id === record.id);
    if (idx !== -1) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    localStorage.setItem('hgs_students', JSON.stringify(list));
    return { success: true, id: record.id };
  }
};

export const getStudents = async () => {
  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_students");
      const q = sdkFirestore.query(colRef, sdkFirestore.orderBy("createdAt", "desc"));
      const snapshot = await sdkFirestore.getDocs(q);
      const results = [];
      snapshot.forEach(docSnap => {
        results.push({ ...docSnap.data(), docId: docSnap.id });
      });
      return results;
    } catch (err) {
      console.error("Firestore getStudents failed:", err);
    }
  }
  // Local storage fallback
  const list = JSON.parse(localStorage.getItem('hgs_students') || '[]');
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

export const updateStudent = async (id, updatedFields) => {
  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_students");
      const q = sdkFirestore.query(colRef, sdkFirestore.where("id", "==", id));
      const snapshot = await sdkFirestore.getDocs(q);
      if (!snapshot.empty) {
        const docId = snapshot.docs[0].id;
        const docRef = sdkFirestore.doc(db, "hgs_students", docId);
        await sdkFirestore.updateDoc(docRef, updatedFields);
        return { success: true };
      }
    } catch (err) {
      console.error("Firestore updateStudent failed:", err);
      throw err;
    }
  }

  // Local storage fallback
  const list = JSON.parse(localStorage.getItem('hgs_students') || '[]');
  const idx = list.findIndex(item => item.id === id);
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...updatedFields };
    localStorage.setItem('hgs_students', JSON.stringify(list));
    return { success: true };
  }
  throw new Error("Student account record not found");
};

export const deleteStudent = async (id) => {
  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_students");
      const q = sdkFirestore.query(colRef, sdkFirestore.where("id", "==", id));
      const snapshot = await sdkFirestore.getDocs(q);
      if (!snapshot.empty) {
        const docId = snapshot.docs[0].id;
        const docRef = sdkFirestore.doc(db, "hgs_students", docId);
        await sdkFirestore.deleteDoc(docRef);
        return { success: true };
      }
    } catch (err) {
      console.error("Firestore deleteStudent failed:", err);
      throw err;
    }
  }

  // Local Storage fallback
  const list = JSON.parse(localStorage.getItem('hgs_students') || '[]');
  const filtered = list.filter(item => item.id !== id);
  localStorage.setItem('hgs_students', JSON.stringify(filtered));
  return { success: true };
};

export const loginStudent = async (admissionNumber, password) => {
  const sanitizedNum = admissionNumber.toUpperCase().trim();
  const studentsList = await getStudents();
  
  const student = studentsList.find(s => 
    s.admissionNumber && s.admissionNumber.toUpperCase().trim() === sanitizedNum
  );

  if (!student) {
    throw new Error("No student record found with this Admission / Registration Number.");
  }

  if (student.password !== password) {
    throw new Error("The password you specified is incorrect.");
  }

  if (student.status === 'Deactivated') {
    throw new Error("This student portal account is currently Deactivated by School Admin. Please contact registry desk.");
  }

  const sessionObj = {
    id: student.id,
    admissionNumber: student.admissionNumber,
    studentName: student.studentName,
    gradeApplying: student.gradeApplying || 'Primary 1',
    status: student.status,
    role: "Student"
  };

  localStorage.setItem('hgs_student_session', JSON.stringify(sessionObj));
  return { success: true, profile: student };
};

export const logoutStudent = () => {
  localStorage.setItem('hgs_student_session', 'null');
};

export const getActiveStudentSession = () => {
  const session = localStorage.getItem('hgs_student_session');
  if (session && session !== 'null') {
    try {
      return JSON.parse(session);
    } catch (e) {
      return null;
    }
  }
  return null;
};

// ==========================================
// ACTIVITY LOGGING, APPROVAL WORKFLOW & REJECTION ENGINES
// ==========================================

export const logActivity = async (action, details, operatorName = "System / Registrar") => {
  const logObj = {
    id: 'LOG-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    action,
    details,
    operator: operatorName,
    createdAt: new Date().toISOString()
  };

  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_activity_logs");
      await sdkFirestore.addDoc(colRef, logObj);
    } catch (err) {
      console.error("Firestore logActivity failed:", err);
    }
  }

  // Fallback to local storage persistence
  const list = JSON.parse(localStorage.getItem('hgs_activity_logs') || '[]');
  list.unshift(logObj);
  localStorage.setItem('hgs_activity_logs', JSON.stringify(list));
  return { success: true, log: logObj };
};

export const getActivityLogs = async () => {
  if (liveMode && db) {
    try {
      const colRef = sdkFirestore.collection(db, "hgs_activity_logs");
      const q = sdkFirestore.query(colRef, sdkFirestore.orderBy("createdAt", "desc"));
      const snapshot = await sdkFirestore.getDocs(q);
      const results = [];
      snapshot.forEach(docSnap => {
        results.push({ ...docSnap.data(), docId: docSnap.id });
      });
      return results;
    } catch (err) {
      console.error("Firestore getActivityLogs failed:", err);
    }
  }
  const list = JSON.parse(localStorage.getItem('hgs_activity_logs') || '[]');
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

// Generate high-strength password
const generateTempPassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // readable chars
  let pass = "";
  for (let i = 0; i < 8; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
};

// Approval Workflow Logic
export const approveAdmission = async (admissionId, operatorName = "Registrar") => {
  const admissions = await getAdmissions();
  const targetApplication = admissions.find(app => app.id === admissionId);
  if (!targetApplication) {
    throw new Error("Admission application record not found.");
  }

  // 1. Update application status in database
  await updateAdmission(admissionId, { status: "Approved" });

  // 2. Automatically generate unique admission number
  const students = await getStudents();
  let uniqueNum = "";
  let isUnique = false;
  let attempts = 0;
  while (!isUnique && attempts < 50) {
    const randomDigits = Math.floor(1000 + Math.random() * 9000); // 4 digit
    uniqueNum = `HGS-2026-${randomDigits}`;
    isUnique = !students.some(s => s.admissionNumber === uniqueNum);
    attempts++;
  }

  // 3. Generate secure temporary password
  const tempPassword = generateTempPassword();

  // 4. Create standard student entity payload
  const studentPayload = {
    admissionNumber: uniqueNum,
    studentName: targetApplication.studentName,
    gender: targetApplication.studentGender || "Male",
    dob: targetApplication.studentDob || "",
    gradeApplying: targetApplication.gradeApplying || "Primary 1",
    parentName: targetApplication.parentName,
    parentPhone: targetApplication.parentPhone,
    parentEmail: targetApplication.parentEmail || "",
    homeAddress: targetApplication.homeAddress || "",
    password: tempPassword,
    status: 'Active',
    grades: {
      english: 85,
      math: 85,
      computer: 85,
      civic: 85,
      agriculture: 85
    },
    coachRemarks: `Account automatically formulated and approved by the registrar on ${new Date().toLocaleDateString()}. System onboarding sequence initialized.`
  };

  await saveStudent(studentPayload);

  // 5. Build notifications payloads
  const portalUrl = window.location.origin + "/login.html";
  const notificationContent = {
    studentName: targetApplication.studentName,
    admissionNumber: uniqueNum,
    username: uniqueNum,
    password: tempPassword,
    portalUrl: portalUrl,
    guardianPhone: targetApplication.parentPhone,
    guardianEmail: targetApplication.parentEmail
  };

  // 6. Log activity
  await logActivity(
    "Admission Approved & Student Onboarded",
    `Approved admission request for pupil "${targetApplication.studentName}" (Target Grade: ${targetApplication.gradeApplying}). Outfitted credentials: Portal UID [${uniqueNum}], Temp Password [${tempPassword}]. Dispatched notifications to guardian ${targetApplication.parentPhone} / ${targetApplication.parentEmail || 'N/A'}.`,
    operatorName
  );

  return {
    success: true,
    admissionNumber: uniqueNum,
    temporaryPassword: tempPassword,
    notification: notificationContent
  };
};

// Rejection Logic
export const rejectAdmission = async (admissionId, reason, operatorName = "Registrar") => {
  const admissions = await getAdmissions();
  const targetApplication = admissions.find(app => app.id === admissionId);
  if (!targetApplication) {
    throw new Error("Admission application record not found.");
  }

  // 1. Update application status
  await updateAdmission(admissionId, { status: "Rejected", rejectionReason: reason });

  // 2. Dispatched notification details logged
  await logActivity(
    "Admission Rejected",
    `Rejected admission request for pupil "${targetApplication.studentName}". Explanation specified: "${reason}". Notification dispatch saved for Guardian Contact: ${targetApplication.parentPhone}.`,
    operatorName
  );

  return {
    success: true,
    details: {
      studentName: targetApplication.studentName,
      reason,
      guardianPhone: targetApplication.parentPhone,
      guardianEmail: targetApplication.parentEmail
    }
  };
};

// Credentials Resend Handler
export const resendStudentCredentials = async (studentId, operatorName = "Registrar") => {
  const students = await getStudents();
  const student = students.find(s => s.id === studentId);
  if (!student) {
    throw new Error("Student account matching record not found.");
  }

  const portalUrl = window.location.origin + "/login.html";
  const notificationContent = {
    studentName: student.studentName,
    admissionNumber: student.admissionNumber,
    username: student.admissionNumber,
    password: student.password,
    portalUrl: portalUrl,
    guardianPhone: student.parentPhone,
    guardianEmail: student.parentEmail
  };

  await logActivity(
    "Credentials Respatched",
    `Resubmitted portal entry credentials card for pupil "${student.studentName}" (${student.admissionNumber}). Destination Phone: ${student.parentPhone}, Destination Email: ${student.parentEmail || 'N/A'}.`,
    operatorName
  );

  return {
    success: true,
    notification: notificationContent
  };
};

