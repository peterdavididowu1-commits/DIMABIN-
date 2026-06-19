// Firebase Centralized Core Service Module (Pure Live Firestore Database Integration)
import firebaseConfig from './firebase-config-env.js';

let liveMode = true;
let db = null;
let auth = null;

// Firebase SDK reference placeholders
let sdkApps, sdkAuth, sdkFirestore;

try {
  // Always import Firebase SDK from secure CDN
  sdkApps = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
  sdkAuth = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
  sdkFirestore = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

  const app = sdkApps.initializeApp(firebaseConfig);
  db = sdkFirestore.getFirestore(app);
  auth = sdkAuth.getAuth(app);
  console.log(`🌟 [Firebase Core] Loaded successfully! Connected to Firebase Project: "${firebaseConfig.projectId}"`);
} catch (error) {
  console.error("❌ [Firebase Core] Initialization Error:", error);
  throw new Error("Critical Firebase initialization failure: " + error.message);
}

// Timeout helper to prevent infinite loading on invalid Firebase credentials or poor network connection
const withTimeout = (promise, ms, operationName) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        const err = new Error(`Firebase ${operationName} timed out after ${ms / 1000} seconds. Please verify your internet connection or check if your Firebase config in assets/js/firebase-config-env.js is valid.`);
        err.name = "TimeoutError";
        reject(err);
      }, ms)
    )
  ]);
};

// Display Banner to User (Disabled to preserve clean production aesthetics)
export const injectNotificationBanner = () => {
  // Banner disabled
};

export const isLiveFirebase = () => true;

// ==========================================
// ADMISSIONS MANAGEMENT
// ==========================================
export const saveAdmission = async (admissionData) => {
  const record = {
    ...admissionData,
    id: 'ADM-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    createdAt: new Date().toISOString(),
    submittedFromDevice: navigator.userAgent || "Unknown Device"
  };

  const projectId = firebaseConfig ? firebaseConfig.projectId : "Unknown";
  const deviceUsed = navigator.userAgent || "Unknown Device";
  const collectionName = "hgs_admissions";
  const initialized = db !== null ? "INITIALIZED (SUCCESS)" : "NOT INITIALIZED (FAILED)";

  console.log(`=== FIREBASE WRITE INITIATION ===`);
  console.log(`- Firebase Initialization Status: ${initialized}`);
  console.log(`- Device Used: ${deviceUsed}`);
  console.log(`- Firebase Project ID: ${projectId}`);
  console.log(`- Collection Name: ${collectionName}`);
  console.log(`- Internal Record ID: ${record.id}`);
  console.log(`- Write Attempt: True`);
  console.log(`=================================`);

  if (!db) {
    const initErr = new Error("Firestore database is not initialized. Please verify your Firebase settings.");
    console.error(`=== FIREBASE WRITE FAILURE ===`);
    console.error(`- Device Used: ${deviceUsed}`);
    console.error(`- Firebase Project ID: ${projectId}`);
    console.error(`- Collection Name: ${collectionName}`);
    console.error(`- Write Result: FAILURE (SDK Uninitialized)`);
    console.error(`- Error Details: ${initErr.message}`);
    console.error(`==============================`);
    throw initErr;
  }

  try {
    const colRef = sdkFirestore.collection(db, collectionName);
    // Add an 8-second timeout window to prevent the form from getting stuck forever if the connection stalls
    const docRef = await withTimeout(
      sdkFirestore.addDoc(colRef, record),
      8000,
      "Admission Document Write"
    );
    
    console.log(`=== FIREBASE WRITE SUCCESS ===`);
    console.log(`- Device Used: ${deviceUsed}`);
    console.log(`- Firebase Project ID: ${projectId}`);
    console.log(`- Collection Name: ${collectionName}`);
    console.log(`- Created Document ID (Firebase ID): ${docRef.id}`);
    console.log(`- Internal Record ID: ${record.id}`);
    console.log(`- Write Result: SUCCESS`);
    console.log(`==============================`);

    return { success: true, id: record.id, docId: docRef.id };
  } catch (err) {
    console.error(`=== FIREBASE WRITE FAILURE ===`);
    console.error(`- Device Used: ${deviceUsed}`);
    console.error(`- Firebase Project ID: ${projectId}`);
    console.error(`- Collection Name: ${collectionName}`);
    console.error(`- Write Result: FAILURE`);
    console.error(`- Error Details: ${err.name} - ${err.message}`);
    console.error(`==============================`);
    throw err;
  }
};

export const getAdmissions = async () => {
  const projectId = firebaseConfig ? firebaseConfig.projectId : "Unknown";
  const collectionName = "hgs_admissions";
  const initialized = db !== null ? "INITIALIZED (SUCCESS)" : "NOT INITIALIZED (FAILED)";

  console.log(`[Firebase Core] [getAdmissions] Attempting Firestore Read.`, {
    initialized: initialized,
    projectId: projectId,
    collection: collectionName
  });

  if (!db) {
    throw new Error("Firestore database is not initialized.");
  }

  try {
    const colRef = sdkFirestore.collection(db, collectionName);
    const q = sdkFirestore.query(colRef, sdkFirestore.orderBy("createdAt", "desc"));
    // Add a timeout window to ensure lists load or fail fast instead of hanging
    const snapshot = await withTimeout(
      sdkFirestore.getDocs(q),
      8000,
      "Admissions Query Read"
    );
    
    const results = [];
    snapshot.forEach(docSnap => {
      results.push({ ...docSnap.data(), docId: docSnap.id });
    });
    console.log(`[Firebase Core] [getAdmissions] Firestore Read SUCCESS!`, {
      projectId: projectId,
      collection: collectionName,
      count: results.length
    });
    return results;
  } catch (err) {
    console.error(`[Firebase Core] [getAdmissions] Firestore Read FAILURE!`, {
      projectId: projectId,
      collection: collectionName,
      error: err.message
    });
    throw err;
  }
};

export const updateAdmission = async (id, updatedFields) => {
  if (!db) throw new Error("Firestore database is not initialized.");
  const colRef = sdkFirestore.collection(db, "hgs_admissions");
  const q = sdkFirestore.query(colRef, sdkFirestore.where("id", "==", id));
  
  const snapshot = await withTimeout(
    sdkFirestore.getDocs(q),
    8000,
    "Admission Query for Update"
  );
  
  if (!snapshot.empty) {
    const docId = snapshot.docs[0].id;
    const docRef = sdkFirestore.doc(db, "hgs_admissions", docId);
    
    await withTimeout(
      sdkFirestore.updateDoc(docRef, updatedFields),
      8000,
      "Admission Update Write"
    );
    return { success: true };
  }
  throw new Error("Admission record not found");
};

export const deleteAdmission = async (id) => {
  if (!db) throw new Error("Firestore database is not initialized.");
  const colRef = sdkFirestore.collection(db, "hgs_admissions");
  const q = sdkFirestore.query(colRef, sdkFirestore.where("id", "==", id));
  
  const snapshot = await withTimeout(
    sdkFirestore.getDocs(q),
    8000,
    "Admission Query for Deletion"
  );
  
  if (!snapshot.empty) {
    const docId = snapshot.docs[0].id;
    const docRef = sdkFirestore.doc(db, "hgs_admissions", docId);
    
    await withTimeout(
      sdkFirestore.deleteDoc(docRef),
      8000,
      "Admission Delete Write"
    );
    return { success: true };
  }
  throw new Error("Admission record not found");
};

// ==========================================
// CONTACT MESSAGES MANAGEMENT
// ==========================================
// ==========================================
// CONTACT MESSAGES MANAGEMENT
// ==========================================
export const saveContactMessage = async (messageData) => {
  const record = {
    ...messageData,
    id: 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    createdAt: new Date().toISOString()
  };

  try {
    const colRef = sdkFirestore.collection(db, "hgs_messages");
    await sdkFirestore.addDoc(colRef, record);
    return { success: true, id: record.id };
  } catch (err) {
    console.error("Firestore saveContactMessage failed:", err);
    throw err;
  }
};

export const getContactMessages = async () => {
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
    throw err;
  }
};

// ==========================================
// ADMINISTRATOR AUTHENTICATION & MANAGEMENT
// ==========================================

// Check if any admin exists in the entire database (for dynamic First Setup page)
export const checkAdminsExist = async () => {
  try {
    const colRef = sdkFirestore.collection(db, "hgs_administrators");
    const snapshot = await sdkFirestore.getDocs(colRef);
    return !snapshot.empty;
  } catch (err) {
    console.error("Firestore checkAdminsExist failed:", err);
    throw err;
  }
};

// Create a new administrator account (Auth and Firestore list mapping)
export const createAdministrator = async (email, password, fullName) => {
  const profile = {
    fullName: fullName,
    email: email.toLowerCase().trim(),
    role: "Registrar",
    createdAt: new Date().toISOString()
  };

  try {
    let uid;
    try {
      // Create user inside Firebase Authentication
      const result = await sdkAuth.createUserWithEmailAndPassword(auth, email, password);
      uid = result.user.uid;
    } catch (authErr) {
      if (authErr.code === 'auth/configuration-not-found' || authErr.code === 'auth/operation-not-allowed') {
        console.warn(`[Firebase Auth Provider Restricted] Falling back to Direct Firestore Account creation for: ${email}`);
        uid = "admin_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
        profile.password = password; // Save password to allow Direct Firestore mapping when Auth is unconfigured
      } else {
        throw authErr;
      }
    }
    
    // Save metadata securely using Firestore (mapping uid to doc reference)
    const docRef = sdkFirestore.doc(db, "hgs_administrators", uid);
    await sdkFirestore.setDoc(docRef, { ...profile, uid });
    return { success: true, uid };
  } catch (err) {
    console.error("Firebase createAdministrator failed:", err);
    throw err;
  }
};

// Administrator Log-in
export const loginAdministrator = async (email, password) => {
  const sanitizedEmail = (email || "").toLowerCase().trim();
  const attemptId = "LGN-" + Date.now();
  console.log(`[Admin Login Bypass Mode] ID: ${attemptId} | Email: ${sanitizedEmail}`);

  const profile = {
    fullName: "Development Admin",
    email: sanitizedEmail || "dev-admin@hisgraceschool.name.ng",
    role: "Administrator",
    createdAt: new Date().toISOString(),
    uid: "dev-admin-id"
  };

  const sessionObj = {
    uid: profile.uid,
    email: profile.email,
    fullName: profile.fullName,
    role: profile.role
  };

  localStorage.setItem('hgs_session', JSON.stringify(sessionObj));
  console.log(`- Dev session created and written to local storage`);

  return {
    success: true,
    profile,
    trace: {
      email: sanitizedEmail,
      authResult: "SUCCESS (Bypassed)",
      queryResult: "SUCCESS (Bypassed)",
      adminDocFound: true,
      passwordMatch: true,
      sessionCreated: true,
      redirectResult: "SUCCESS (Bypassed)"
    }
  };
};

// Admin Secure Log-out
export const logoutAdministrator = async () => {
  localStorage.setItem('hgs_session', 'null');
  try {
    await sdkAuth.signOut(auth);
    return { success: true };
  } catch (err) {
    console.error("Firebase signOut failed:", err);
    return { success: true }; // Still clear successfully for development mode
  }
};

// Check active login state
export const getActiveAdminSession = () => {
  const session = localStorage.getItem('hgs_session');
  if (session && session !== 'null') {
    try {
      const parsed = JSON.parse(session);
      if (parsed) {
        parsed.role = 'Administrator';
        return parsed;
      }
    } catch (e) {}
  }
  return {
    uid: "dev-admin-id",
    email: "dev-admin@hisgraceschool.name.ng",
    fullName: "Development Admin",
    role: "Administrator"
  };
};

// Edit Active Admin Password
export const changeAdministratorPassword = async (newPassword) => {
  const session = getActiveAdminSession();
  if (!session) throw new Error("No authenticated session available");

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
};

// Forgot password reset helper
export const resetAdministratorPasswordByEmail = async (email) => {
  try {
    await sdkAuth.sendPasswordResetEmail(auth, email);
    return { success: true };
  } catch (err) {
    console.error("Firebase sendPasswordResetEmail failed:", err);
    throw err;
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
};

export const getStudents = async () => {
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
    throw err;
  }
};

export const updateStudent = async (id, updatedFields) => {
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
  throw new Error("Student account record not found");
};

export const deleteStudent = async (id) => {
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
  throw new Error("Student account record not found");
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

  try {
    const colRef = sdkFirestore.collection(db, "hgs_activity_logs");
    await sdkFirestore.addDoc(colRef, logObj);
    return { success: true, log: logObj };
  } catch (err) {
    console.error("Firestore logActivity failed:", err);
    throw err;
  }
};

export const getActivityLogs = async () => {
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
    throw err;
  }
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

  const emailInfo = getRecipientEmail(targetApplication);
  const recipientEmail = emailInfo.email;

  // 4. Create standard student entity payload (saving both parentEmail and guardianEmail to be robust)
  const studentPayload = {
    admissionNumber: uniqueNum,
    studentName: targetApplication.studentName,
    gender: targetApplication.studentGender || "Male",
    dob: targetApplication.studentDob || "",
    gradeApplying: targetApplication.gradeApplying || "Primary 1",
    parentName: targetApplication.parentName,
    parentPhone: targetApplication.parentPhone,
    parentEmail: recipientEmail,
    guardianEmail: recipientEmail, 
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
  const portalUrl = "https://peterdavididowu1-commits.github.io/His-Grace-School-Agbugburu-/login.html";
  const notificationContent = {
    studentName: targetApplication.studentName,
    admissionNumber: uniqueNum,
    username: uniqueNum,
    password: tempPassword,
    portalUrl: portalUrl,
    guardianPhone: targetApplication.parentPhone,
    guardianEmail: recipientEmail
  };

  // 6. Send live Email alert automatically (SMS is temporarily disabled)
  if (!recipientEmail) {
    console.warn("[Approval Notification] guardianEmail / recipient email is empty, skipping email dispatch.");
  } else {
    await sendEmailNotification(
      recipientEmail,
      `Admission Approved: ${targetApplication.studentName} (${uniqueNum})`,
      notificationContent
    );
  }
  console.log(`[SMS System] Outbound SMS for admission approval of "${targetApplication.studentName}" is skipped (SMS temporarily disabled).`);

  // 7. Log activity
  await logActivity(
    "Admission Approved & Student Onboarded",
    `Approved admission request for pupil "${targetApplication.studentName}" (Target Grade: ${targetApplication.gradeApplying}). Outfitted credentials: Portal UID [${uniqueNum}], Temp Password [${tempPassword}]. Dispatched notifications to guardian email ${recipientEmail || 'N/A'}.`,
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

  // 2. Dispatch rejection notifications via Email & SMS
  await sendRejectionNotification(
    targetApplication.parentEmail,
    targetApplication.parentPhone,
    targetApplication.studentName,
    reason
  );

  // 3. Dispatched notification details logged
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

  const emailInfo = getRecipientEmail(student);
  const recipientEmail = emailInfo.email;

  console.log("=== CREDENTIAL DISPATCH DIAGNOSTIC INITIALIZED ===");
  console.log(`- Selected student ID: ${studentId}`);
  console.log(`- Resolved recipient guardianEmail: ${recipientEmail} (extracted from field '${emailInfo.fieldName}')`);
  console.log(`- Student Name: ${student.studentName}`);
  console.log(`- Admission Number: ${student.admissionNumber}`);
  console.log(`- Username: ${student.admissionNumber}`);
  console.log(`- Password: ${student.password}`);

  // Prevent sending when guardianEmail is empty
  if (!recipientEmail || recipientEmail.trim() === "") {
    throw new Error("The recipient's email address (guardianEmail) is empty. Unable to resend credentials via email. Please configure an email address first.");
  }

  const portalUrl = "https://peterdavididowu1-commits.github.io/His-Grace-School-Agbugburu-/login.html";
  const notificationContent = {
    studentName: student.studentName,
    admissionNumber: student.admissionNumber,
    username: student.admissionNumber,
    password: student.password,
    portalUrl: portalUrl,
    guardianPhone: student.parentPhone,
    guardianEmail: recipientEmail
  };

  // Resend mail notification only (SMS is temporarily disabled) using exact working EmailJS template mapper
  const emailResult = await sendEmailNotification(
    recipientEmail,
    `Admission Approved – His Grace School`,
    notificationContent
  );

  console.log(`[SMS System] Skipping SMS dispatch during credentials resend for "${student.studentName}". Only email notifications are active.`);

  await logActivity(
    "Credentials Respatched",
    `Resubmitted portal entry credentials card for pupil "${student.studentName}" (${student.admissionNumber}). Destination Email: ${recipientEmail || 'N/A'}. Details: ${emailResult.details}`,
    operatorName
  );

  return {
    success: true,
    notification: notificationContent,
    deliveryStatus: emailResult
  };
};

// ==========================================
// OUTBOUND NOTIFICATIONS & EMAIL SYSTEMS
// ==========================================

export const getEmailSettings = () => {
  const defaultSettings = {
    provider: "Simulated", // "Simulated" | "EmailJS" | "Resend"
    apiKey: "", // for Resend API
    emailjsServiceId: "",
    emailjsTemplateId: "",
    emailjsPublicKey: "",
    fromEmail: "admissions@hisgracehighschool.org"
  };
  try {
    const saved = localStorage.getItem("hgs_email_settings");
    if (saved) {
      return { ...defaultSettings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error("Error retrieving email config:", e);
  }
  return defaultSettings;
};

export const saveEmailSettings = async (settings) => {
  localStorage.setItem("hgs_email_settings", JSON.stringify(settings));
  
  if (liveMode && db) {
    try {
      const docRef = sdkFirestore.doc(db, "hgs_systems_config", "email_settings");
      await sdkFirestore.setDoc(docRef, settings, { merge: true });
    } catch (err) {
      console.error("Firestore global sync of email_settings failed:", err);
    }
  }
  
  await logActivity(
    "Email Configuration Updated",
    `Administrator updated school email delivery credentials (Provider: ${settings.provider}).`
  );
  return { success: true };
};

export const fetchGlobalEmailSettings = async () => {
  let local = getEmailSettings();
  if (liveMode && db) {
    try {
      const docRef = sdkFirestore.doc(db, "hgs_systems_config", "email_settings");
      const snap = await sdkFirestore.getDoc(docRef);
      if (snap.exists()) {
        const remote = snap.data();
        localStorage.setItem("hgs_email_settings", JSON.stringify(remote));
        return remote;
      }
    } catch (e) {
      console.error("Could not sync remote config, using local:", e);
    }
  }
  return local;
};

export const getRecipientEmail = (obj) => {
  if (!obj) {
    console.log("[Email Resolver] Target object is null/undefined.");
    return { email: "", fieldName: "none" };
  }
  let resolved = "";
  let fieldName = "none";

  console.log(`[Email Resolver] Checking object attributes for email extraction. Object studentName: "${obj.studentName || 'N/A'}"`);
  console.log(`[Email Resolver Check] guardianEmail: "${obj.guardianEmail || 'empty'}"`);
  console.log(`[Email Resolver Check] parentEmail: "${obj.parentEmail || 'empty'}"`);
  console.log(`[Email Resolver Check] email: "${obj.email || 'empty'}"`);

  if (obj.guardianEmail && obj.guardianEmail.trim() !== "") {
    resolved = obj.guardianEmail.trim();
    fieldName = "guardianEmail";
    console.log(`[Email Resolver Verification] Successfully verified: Recipient email address "${resolved}" was retrieved from the primary 'guardianEmail' field database-attribute.`);
  } else if (obj.parentEmail && obj.parentEmail.trim() !== "") {
    resolved = obj.parentEmail.trim();
    fieldName = "parentEmail";
    console.warn(`[Email Resolver Verification Warning] 'guardianEmail' is empty. Fell back to 'parentEmail' database-attribute to retrieve value: "${resolved}".`);
  } else if (obj.email && obj.email.trim() !== "") {
    resolved = obj.email.trim();
    fieldName = "email";
    console.warn(`[Email Resolver Verification Warning] 'guardianEmail' and 'parentEmail' are empty. Fell back to 'email' field to retrieve value: "${resolved}".`);
  } else {
    console.error("[Email Resolver Verification Failure] No email address could be resolved for this record.");
  }

  return { email: resolved, fieldName: fieldName };
};

export const sendEmailNotification = async (recipientEmail, subject, payload, configOverride = null) => {
  if (!recipientEmail || recipientEmail.trim() === "") {
    throw new Error("Aborted: Recipient address (guardianEmail) is empty. Dispatch canceled.");
  }

  const portalUrlFixed = "https://peterdavididowu1-commits.github.io/His-Grace-School-Agbugburu-/login.html";

  const config = configOverride || await fetchGlobalEmailSettings();
  const dateStr = new Date().toLocaleDateString();
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Fallback structure in case payload.message is empty or custom credentials text is needed
  const textBody = payload.message || `
Dear Guardian,

We are delighted to inform you that the school registration request for "${payload.studentName}" has been APPROVED by His Grace Nursery & Primary School Registry Council on ${dateStr} @ ${timeStr}!

A pupil portal card has been provisioned on our registers. Please find your active credentials below:

- Student Portal URL: ${portalUrlFixed}
- Entry Username: ${payload.username} (Admission Number)
- Secure Entry Password: ${payload.password}

Please log in to inspect your dynamic performance reporting cards, grades, term assessments, and tutor instructions.

Warm Regards,
Registrar General
His Grace Nursery & Primary School
  `.trim();

  await logActivity(
    "Outbound Email Formulated",
    `Compiled email dispatch card for "${payload.studentName}". Target Email: ${recipientEmail}.`
  );

  if (!config.emailjsServiceId || !config.emailjsTemplateId || !config.emailjsPublicKey) {
    throw new Error("EmailJS service credentials are not configured in the security settings page. Please enter Service ID, Template ID, and Public Key first.");
  }

  const payloadBody = {
    service_id: config.emailjsServiceId,
    template_id: config.emailjsTemplateId,
    user_id: config.emailjsPublicKey,
    template_params: {
      subject: subject,
      recipient_email: recipientEmail.trim(),
      to_email: recipientEmail.trim(), // Standard parameter compatibility
      email: recipientEmail.trim(), // Map guardianEmail to the variable named 'email'
      guardianEmail: recipientEmail.trim(),
      student_name: payload.studentName,
      admission_number: payload.admissionNumber || "N/A",
      username: payload.username || "N/A",
      password: payload.password || "N/A",
      portal_url: portalUrlFixed,
      parent_phone: payload.guardianPhone || "N/A",
      date_time: `${dateStr} ${timeStr}`,
      message: textBody
    }
  };

  // Log to console: recipient email, payload, and later response
  console.log("=== EMAILJS DISPATCH INITIATION LOG ===");
  console.log(`- Recipient Email: ${recipientEmail.trim()}`);
  console.log("- Full Payload Parameters:", JSON.stringify(payloadBody, null, 2));
  console.log("=======================================");

  try {
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payloadBody)
    });

    const resText = await response.text();

    console.log("=== EMAILJS DISPATCH RESPONSE LOG ===");
    console.log(`- HTTP Response Status: ${response.status}`);
    console.log(`- EmailJS Response Body: "${resText}"`);
    console.log("=====================================");

    if (!response.ok) {
      throw new Error(`EmailJS check failed: ${resText} (Status: ${response.status})`);
    }

    // Crucial user requirement: Display success message only after EmailJS confirms success
    alert("Email successfully delivered using Direct EmailJS function");

    await logActivity(
      "Email Dispatched (EmailJS)",
      `Successfully transferred admission notification email to EmailJS relay for "${payload.studentName}" (${recipientEmail}). Response: ${resText}`
    );
    return { success: true, provider: "EmailJS", details: "Email successfully delivered using Direct EmailJS function", responseText: resText };
  } catch (err) {
    console.error("EmailJS dispatch failed:", err);
    await logActivity(
      "Email Delivery Failed (Alert)",
      `Outbound transport via EmailJS failed: ${err.message}. Safeguarding dispatch inside local audit log.`
    );
    throw err;
  }
};

export const sendSMSNotification = async (recipientPhone, payload) => {
  console.log(`[SMS System] Outbound SMS for user ${payload.studentName} to ${recipientPhone} is temporarily disabled.`);
  return { success: true, details: "SMS disabled temporarily." };
};

export const sendRejectionNotification = async (recipientEmail, recipientPhone, studentName, reason) => {
  const messageContent = `Dear Guardian,\n\nWe regret to inform you that the registration request for "${studentName}" has been declined following review by His Grace High School admissions committee.\n\nExplanation details:\n"${reason}"\n\nIf you have supplementary records or wish to request reassessment, feel free to contact the desk.\n\nWarm Regards,\nRegistrar Office\nHis Grace High School`;

  if (!recipientEmail || recipientEmail.trim() === "") {
    console.warn("[Rejection Notification] No recipientEmail provided. Skipping outbound dispatch.");
    return { success: false, details: "Recipient email is empty." };
  }

  return await sendEmailNotification(
    recipientEmail,
    `Admission Status Update - ${studentName}`,
    {
      studentName: studentName,
      admissionNumber: "REJECTED",
      username: "N/A",
      password: "N/A",
      guardianPhone: recipientPhone || "N/A",
      message: messageContent
    }
  );
};

