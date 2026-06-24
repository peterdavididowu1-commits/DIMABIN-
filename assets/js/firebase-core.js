// Firebase Centralized Core Service Module (Pure Live Firestore Database Integration)
import firebaseConfig from './firebase-config-env.js';

// Centralized EmailJS Constants
export const EMAILJS_SERVICE_ID = "";
export const EMAILJS_TEMPLATE_ID = "";
export const EMAILJS_PUBLIC_KEY = "";

console.log("EmailJS Service:", EMAILJS_SERVICE_ID);
console.log("EmailJS Template:", EMAILJS_TEMPLATE_ID);

let liveMode = true;
let db = null;
let auth = null;
let firebaseInitError = null;

// Firebase SDK reference placeholders
let sdkApps, sdkAuth, sdkFirestore;

console.log("🚀 [Firebase Core] Executon started. Attempting Firebase SDK load...");

try {
  // Always import Firebase SDK from secure CDN
  sdkApps = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
  sdkAuth = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
  sdkFirestore = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

  const app = sdkApps.initializeApp(firebaseConfig);
  db = sdkFirestore.getFirestore(app);
  auth = sdkAuth.getAuth(app);
  console.log(`🌟 [Firebase Core] Loaded successfully! Connected to Firebase Project: "${firebaseConfig.projectId}"`);

  // Sync SDK user state with local administrator session if active
  sdkAuth.onAuthStateChanged(auth, async (user) => {
    const activeSession = localStorage.getItem('hgs_session');
    if (user && (!activeSession || activeSession === 'null')) {
      try {
        console.log("🔄 [Firebase Core] Syncing local session with active SDK auth state...");
        const docRef = sdkFirestore.doc(db, "hgs_administrators", user.uid);
        const docSnap = await sdkFirestore.getDoc(docRef);
        if (docSnap.exists()) {
          const profile = docSnap.data();
          const sessionObj = {
            uid: user.uid,
            email: profile.email || user.email,
            fullName: profile.fullName || "Administrator",
            role: profile.role || "Registrar"
          };
          localStorage.setItem('hgs_session', JSON.stringify(sessionObj));
          console.log("🌟 [Firebase Core] Local session fully synchronized with active SDK user successfully!");
        }
      } catch (err) {
        console.error("❌ [Firebase Core] Failed to sync local session with active SDK state:", err);
      }
    }
  });
} catch (error) {
  console.error("❌ [Firebase Core] Initialization Error:", error);
  firebaseInitError = error;
}

export const getFirebaseInitError = () => firebaseInitError;
export const hasInitializedSuccessfully = () => db !== null && auth !== null;

// Helper to wait until authentication state is fully established
export const onAdminAuthReady = (callback, onUnauthenticated) => {
  if (!auth) {
    console.log("⏳ [Firebase Core] Auth SDK not yet ready. Retrying in 100ms...");
    setTimeout(() => onAdminAuthReady(callback, onUnauthenticated), 100);
    return;
  }
  sdkAuth.onAuthStateChanged(auth, (user) => {
    if (user) {
      console.log("👤 [Firebase Core] onAdminAuthReady triggered: Auth is confirmed active for UID:", user.uid);
      callback(user);
    } else {
      console.log("👤 [Firebase Core] onAdminAuthReady state: Unauthenticated...");
      if (onUnauthenticated) {
        onUnauthenticated();
      }
    }
  });
};

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

export const isLiveFirebase = () => {
  return db !== null && auth !== null && firebaseInitError === null;
};

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
    if (getFirebaseInitError()) {
      throw new Error("Firestore database is not initialized due to Core Error: " + getFirebaseInitError().message);
    }
    throw new Error("Firestore database is not initialized.");
  }

  try {
    const colRef = sdkFirestore.collection(db, collectionName);
    const q = sdkFirestore.query(colRef, sdkFirestore.orderBy("createdAt", "desc"));
    let snapshot;
    try {
      // Add a timeout window to ensure lists load or fail fast instead of hanging
      snapshot = await withTimeout(
        sdkFirestore.getDocs(q),
        8000,
        "Admissions Query Read"
      );
    } catch (orderErr) {
      console.warn("[Firebase Core] [getAdmissions] Ordered query failed. Trying fallback unordered query:", orderErr);
      snapshot = await withTimeout(
        sdkFirestore.getDocs(colRef),
        8000,
        "Admissions Unordered Backup Query Read"
      );
    }
    
    const results = [];
    snapshot.forEach(docSnap => {
      results.push({ ...docSnap.data(), docId: docSnap.id });
    });
    
    // Sort client-side by date descending
    results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

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

// Real-time auto-refresh implementation for Admissions
export const subscribeToAdmissions = (callback, onError) => {
  if (!db) {
    const initErr = getFirebaseInitError() || new Error("Firestore database is not initialized.");
    if (onError) onError(initErr);
    return () => {};
  }
  const collectionName = "hgs_admissions";
  const colRef = sdkFirestore.collection(db, collectionName);
  const q = sdkFirestore.query(colRef, sdkFirestore.orderBy("createdAt", "desc"));
  
  console.log("[Firebase Core] [subscribeToAdmissions] Initiating client dashboard real-time observer...");
  
  try {
    return sdkFirestore.onSnapshot(q, (snapshot) => {
      const results = [];
      snapshot.forEach(docSnap => {
        results.push({ ...docSnap.data(), docId: docSnap.id });
      });
      results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      console.log(`[Firebase Core] [subscribeToAdmissions] Real-time data update received successfully! Count: ${results.length}`);
      callback(results);
    }, (err) => {
      console.warn("[Firebase Core] [subscribeToAdmissions] Ordered listener failed, using unordered fallback listener:", err);
      try {
        return sdkFirestore.onSnapshot(colRef, (snapshot) => {
          const results = [];
          snapshot.forEach(docSnap => {
            results.push({ ...docSnap.data(), docId: docSnap.id });
          });
          results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
          console.log(`[Firebase Core] [subscribeToAdmissions (Fallback)] Real-time data update received successfully! Count: ${results.length}`);
          callback(results);
        }, (fallbackErr) => {
          console.error("[Firebase Core] [subscribeToAdmissions] Real-time fallback listener failed:", fallbackErr);
          if (onError) onError(fallbackErr);
        });
      } catch (innerErr) {
        if (onError) onError(innerErr);
      }
    });
  } catch (err) {
    console.error("[Firebase Core] [subscribeToAdmissions] Real-time setup exception:", err);
    if (onError) onError(err);
    return () => {};
  }
};

// Real-time auto-refresh implementation for Contact Messages
export const subscribeToContactMessages = (callback, onError) => {
  if (!db) {
    const initErr = getFirebaseInitError() || new Error("Firestore database is not initialized.");
    if (onError) onError(initErr);
    return () => {};
  }
  const collectionName = "hgs_messages";
  const colRef = sdkFirestore.collection(db, collectionName);
  const q = sdkFirestore.query(colRef, sdkFirestore.orderBy("createdAt", "desc"));
  
  console.log("[Firebase Core] [subscribeToContactMessages] Initiating client message real-time observer...");
  
  try {
    return sdkFirestore.onSnapshot(q, (snapshot) => {
      const results = [];
      snapshot.forEach(docSnap => {
        results.push({ ...docSnap.data(), docId: docSnap.id });
      });
      results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      console.log(`[Firebase Core] [subscribeToContactMessages] Real-time message update received. Count: ${results.length}`);
      callback(results);
    }, (err) => {
      console.warn("[Firebase Core] [subscribeToContactMessages] Ordered listener failed, using unordered fallback listener:", err);
      try {
        return sdkFirestore.onSnapshot(colRef, (snapshot) => {
          const results = [];
          snapshot.forEach(docSnap => {
            results.push({ ...docSnap.data(), docId: docSnap.id });
          });
          results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
          console.log(`[Firebase Core] [subscribeToContactMessages (Fallback)] Real-time messages list updated. Count: ${results.length}`);
          callback(results);
        }, (fallbackErr) => {
          console.error("[Firebase Core] [subscribeToContactMessages] Fallback messaging listener failed:", fallbackErr);
          if (onError) onError(fallbackErr);
        });
      } catch (innerErr) {
        if (onError) onError(innerErr);
      }
    });
  } catch (err) {
    console.error("[Firebase Core] [subscribeToContactMessages] Real-time message setup exception:", err);
    if (onError) onError(err);
    return () => {};
  }
};

export const updateAdmission = async (id, updatedFields) => {
  if (!db) throw new Error("Firestore database is not initialized.");
  
  // Try treating id as direct Firestore Document ID
  const directDocRef = sdkFirestore.doc(db, "hgs_admissions", id);
  try {
    const directSnap = await sdkFirestore.getDoc(directDocRef);
    if (directSnap.exists()) {
      await withTimeout(
        sdkFirestore.updateDoc(directDocRef, updatedFields),
        8000,
        "Admission Update Write Direct"
      );
      return { success: true };
    }
  } catch (e) {
    console.warn("Direct update doc lookup failed, trying query:", e);
  }

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
  const collectionName = "hgs_messages";
  if (!db) {
    if (getFirebaseInitError()) {
      throw new Error("Firestore database is not initialized due to Core Error: " + getFirebaseInitError().message);
    }
    throw new Error("Firestore database is not initialized.");
  }
  try {
    const colRef = sdkFirestore.collection(db, collectionName);
    const q = sdkFirestore.query(colRef, sdkFirestore.orderBy("createdAt", "desc"));
    let snapshot;
    try {
      snapshot = await sdkFirestore.getDocs(q);
    } catch (err) {
      console.warn("Ordered hgs_messages query failed, searching unordered fallback:", err);
      snapshot = await sdkFirestore.getDocs(colRef);
    }
    const results = [];
    snapshot.forEach(docSnap => {
      results.push({ ...docSnap.data(), docId: docSnap.id });
    });
    
    // Sort client side
    results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    
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

    // Establish active localStorage session
    const sessionObj = {
      uid: uid,
      email: profile.email,
      fullName: profile.fullName,
      role: profile.role || "Registrar"
    };
    localStorage.setItem('hgs_session', JSON.stringify(sessionObj));

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
  console.log(`📡 [Firebase Core] [loginAdministrator] Initiated. ID: ${attemptId} | Email: ${sanitizedEmail}`);

  if (!auth) {
    throw new Error("Firebase Authentication service has not been successfully initialized.");
  }

  try {
    // 1. Authenticate with Firebase Authentication
    console.log(`- Step 1: Requesting credentials verification from Firebase Auth for ${sanitizedEmail}...`);
    const authResult = await sdkAuth.signInWithEmailAndPassword(auth, sanitizedEmail, password);
    const user = authResult.user;
    const uid = user.uid;
    console.log(`- Step 1 Success! Authenticated user UID: ${uid}`);

    // 2. Query matching admin document in Firestore
    console.log(`- Step 2: Querying profile in [hgs_administrators] for UID: ${uid}...`);
    const docRef = sdkFirestore.doc(db, "hgs_administrators", uid);
    const docSnap = await sdkFirestore.getDoc(docRef);

    let profile;
    if (docSnap.exists()) {
      profile = docSnap.data();
      console.log(`- Step 2 Success! Found admin profile:`, profile);
      // Ensure role and email match user guidelines
      if (profile.email !== sanitizedEmail || profile.role !== "Registrar") {
        console.log("- Step 2.5: Correcting email/role fields in the admin profile...");
        profile.email = sanitizedEmail;
        profile.role = "Registrar";
        await sdkFirestore.setDoc(docRef, {
          email: sanitizedEmail,
          role: "Registrar",
          uid: uid,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    } else {
      console.warn(`- Step 2 Warning: No profile document exists in hgs_administrators. Provisioning dynamically...`);
      profile = {
        fullName: "Pastor Adebayo",
        email: sanitizedEmail,
        role: "Registrar",
        uid: uid
      };
      await sdkFirestore.setDoc(docRef, {
        ...profile,
        createdAt: new Date().toISOString()
      });
      console.log(`- Dynamically provisioned missing admin document.`);
    }

    // 3. Build state session object
    const sessionObj = {
      uid: uid,
      email: profile.email || sanitizedEmail,
      fullName: profile.fullName || "Pastor Adebayo",
      role: profile.role || "Registrar"
    };

    localStorage.setItem('hgs_session', JSON.stringify(sessionObj));
    console.log(`- Step 3 Success! Local admin session created and saved.`);

    return {
      success: true,
      profile: sessionObj,
      trace: {
        email: sanitizedEmail,
        authResult: "SUCCESS",
        queryResult: "SUCCESS",
        adminDocFound: true,
        passwordMatch: true,
        sessionCreated: true,
        redirectResult: "SUCCESS"
      }
    };
  } catch (err) {
    console.error(`❌ [Firebase Core] [loginAdministrator] Authentication Exception with code [${err.code}]:`, err.message);
    throw err;
  }
};

// Admin Secure Log-out
export const logoutAdministrator = async () => {
  localStorage.setItem('hgs_session', 'null');
  try {
    await sdkAuth.signOut(auth);
    return { success: true };
  } catch (err) {
    console.error("Firebase signOut failed:", err);
    return { success: true };
  }
};

// Check active login state
export const getActiveAdminSession = () => {
  const session = localStorage.getItem('hgs_session');
  if (session && session !== 'null') {
    try {
      const parsed = JSON.parse(session);
      if (parsed && parsed.uid) {
        return parsed;
      }
    } catch (e) {}
  }
  return null;
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

export const getStudentProfileByAdmission = async (admissionNumber) => {
  try {
    if (!db) throw new Error("Firestore database is not initialized.");
    const colRef = sdkFirestore.collection(db, "hgs_students");
    const q = sdkFirestore.query(colRef, sdkFirestore.where("admissionNumber", "==", admissionNumber));
    const snapshot = await sdkFirestore.getDocs(q);
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      return { ...doc.data(), docId: doc.id };
    }
    return null;
  } catch (err) {
    console.error("Firestore getStudentProfileByAdmission failed:", err);
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
    (s.admissionNumber && s.admissionNumber.toUpperCase().trim() === sanitizedNum) ||
    (s.username && s.username.toUpperCase().trim() === sanitizedNum)
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

  // Locate the matching admission record in hgs_admissions
  if (!db) throw new Error("Firestore database is not initialized.");
  const adColRef = sdkFirestore.collection(db, "hgs_admissions");
  let admissionDocId = null;
  let matchingDoc = null;

  // Tier 1: Try exact match on admissionNumber
  if (student.admissionNumber) {
    const q1 = sdkFirestore.query(adColRef, sdkFirestore.where("admissionNumber", "==", student.admissionNumber));
    const snap1 = await sdkFirestore.getDocs(q1);
    if (!snap1.empty) {
      matchingDoc = snap1.docs[0];
    }
  }

  // Tier 2: Try exact match on username or id reference
  if (!matchingDoc && student.username) {
    const q2 = sdkFirestore.query(adColRef, sdkFirestore.where("username", "==", student.username));
    const snap2 = await sdkFirestore.getDocs(q2);
    if (!snap2.empty) {
      matchingDoc = snap2.docs[0];
    }
  }

  // Tier 3: Scan all admissions for case-insensitive match on admissionNumber or username
  if (!matchingDoc) {
    const allSnap = await sdkFirestore.getDocs(adColRef);
    const targetAdm = (student.admissionNumber || "").toUpperCase().trim();
    const targetUser = (student.username || "").toUpperCase().trim();
    const targetName = (student.studentName || student.fullName || "").toUpperCase().trim();

    for (const d of allSnap.docs) {
      const data = d.data();
      const docAdm = (data.admissionNumber || "").toUpperCase().trim();
      const docUser = (data.username || "").toUpperCase().trim();
      const docName = (data.studentName || "").toUpperCase().trim();

      if (targetAdm && docAdm === targetAdm) {
        matchingDoc = d;
        break;
      }
      if (targetUser && docUser === targetUser) {
        matchingDoc = d;
        break;
      }
      if (targetName && docName === targetName) {
        matchingDoc = d;
        break;
      }
    }
  }

  if (!matchingDoc) {
    throw new Error("Student admission record could not be matched. Please contact support.");
  }

  admissionDocId = matchingDoc.id;
  localStorage.setItem('hgs_student_admission_doc_id', admissionDocId);

  const sessionObj = {
    id: student.id,
    admissionNumber: student.admissionNumber,
    studentName: student.studentName,
    gradeApplying: student.gradeApplying || 'Primary 1',
    status: student.status,
    admissionDocId: admissionDocId,
    role: "Student"
  };

  localStorage.setItem('hgs_student_session', JSON.stringify(sessionObj));
  return { success: true, profile: student };
};

export const logoutStudent = () => {
  localStorage.setItem('hgs_student_session', 'null');
  localStorage.removeItem('hgs_student_admission_doc_id');
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

export const getAdmissionByDocId = async (docId) => {
  if (!db) throw new Error("Firestore database is not initialized.");
  const docRef = sdkFirestore.doc(db, "hgs_admissions", docId);
  const docSnap = await sdkFirestore.getDoc(docRef);
  if (docSnap.exists()) {
    return { ...docSnap.data(), docId: docSnap.id };
  }
  return null;
};

export const getAdmissionByNumber = async (admissionNumber) => {
  if (!db) throw new Error("Firestore database is not initialized.");
  const colRef = sdkFirestore.collection(db, "hgs_admissions");
  const q = sdkFirestore.query(colRef, sdkFirestore.where("admissionNumber", "==", admissionNumber));
  const snapshot = await sdkFirestore.getDocs(q);
  if (!snapshot.empty) {
    return { ...snapshot.docs[0].data(), docId: snapshot.docs[0].id };
  }
  return null;
};

export const getAdmissionForStudent = async (studentSession) => {
  if (!db) throw new Error("Firestore database is not initialized.");
  const colRef = sdkFirestore.collection(db, "hgs_admissions");

  // 1. Try by document ID
  const savedDocId = studentSession.admissionDocId || localStorage.getItem('hgs_student_admission_doc_id');
  if (savedDocId) {
    const docRef = sdkFirestore.doc(db, "hgs_admissions", savedDocId);
    const docSnap = await sdkFirestore.getDoc(docRef);
    if (docSnap.exists()) {
      return { ...docSnap.data(), docId: docSnap.id };
    }
  }

  // 2. Try exact query by admissionNumber
  if (studentSession.admissionNumber) {
    const q1 = sdkFirestore.query(colRef, sdkFirestore.where("admissionNumber", "==", studentSession.admissionNumber));
    const snap1 = await sdkFirestore.getDocs(q1);
    if (!snap1.empty) {
      return { ...snap1.docs[0].data(), docId: snap1.docs[0].id };
    }
  }

  // 3. Fallback scan matching case-insensitive admissionNumber, username, or name
  const allSnap = await sdkFirestore.getDocs(colRef);
  const targetAdm = (studentSession.admissionNumber || "").toUpperCase().trim();
  const targetUser = (studentSession.username || "").toUpperCase().trim();
  const targetName = (studentSession.studentName || "").toUpperCase().trim();

  for (const d of allSnap.docs) {
    const data = d.data();
    const docAdm = (data.admissionNumber || "").toUpperCase().trim();
    const docUser = (data.username || "").toUpperCase().trim();
    const docName = (data.studentName || "").toUpperCase().trim();

    if (targetAdm && docAdm === targetAdm) {
      return { ...data, docId: d.id };
    }
    if (targetUser && docUser === targetUser) {
      return { ...data, docId: d.id };
    }
    if (targetName && docName === targetName) {
      return { ...data, docId: d.id };
    }
  }

  return null;
};

export const subscribeToAdmissionRecord = (docId, callback, onError) => {
  if (!db) {
    const initErr = getFirebaseInitError() || new Error("Firestore database is not initialized.");
    if (onError) onError(initErr);
    return () => {};
  }
  const docRef = sdkFirestore.doc(db, "hgs_admissions", docId);
  try {
    return sdkFirestore.onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        callback({ ...docSnap.data(), docId: docSnap.id });
      } else {
        callback(null);
      }
    }, (err) => {
      console.error("[Firebase Core] [subscribeToAdmissionRecord] Error:", err);
      if (onError) onError(err);
    });
  } catch (err) {
    console.error("[Firebase Core] [subscribeToAdmissionRecord] Setup error:", err);
    if (onError) onError(err);
    return () => {};
  }
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

  // Automatically generate unique admission number sequentially
  const students = await getStudents();
  let uniqueNum = "";
  let isUnique = false;
  let attempts = 0;
  const count = students.length + 1;
  while (!isUnique && attempts < 100) {
    const idxStr = String(count + attempts).padStart(4, '0');
    uniqueNum = `HGS2026-${idxStr}`;
    isUnique = !students.some(s => s.admissionNumber === uniqueNum);
    attempts++;
  }

  // Generate secure temporary password
  const tempPassword = `Temp${Math.floor(10000 + Math.random() * 90000)}`;
  const portalUrl = "https://peterdavididowu1-commits.github.io/His-Grace-School-Agbugburu-/student-portal-v2.html";
  const schoolWeb = "https://peterdavididowu1-commits.github.io/His-Grace-School-Agbugburu-/";

  // 1 & 2. Save values into the student's Firestore admission record before sending the email.
  const admissionUpdateData = {
    status: "Approved",
    admissionNumber: uniqueNum,
    username: uniqueNum,
    password: tempPassword,
    studentName: targetApplication.studentName || targetApplication.fullName || "Pupil",
    portalLink: portalUrl
  };
  await updateAdmission(admissionId, admissionUpdateData);

  const emailInfo = getRecipientEmail(targetApplication);
  const recipientEmail = emailInfo.email;
  const fullName = targetApplication.studentName || targetApplication.fullName || "Pupil";

  // 4. Create standard student entity payload (saving both parentEmail and guardianEmail to be robust)
  const studentPayload = {
    admissionNumber: uniqueNum,
    username: uniqueNum,
    studentName: fullName,
    fullName: fullName,
    gender: targetApplication.studentGender || "Male",
    dob: targetApplication.studentDob || "",
    gradeApplying: targetApplication.gradeApplying || "Primary 1",
    class: targetApplication.gradeApplying || "Primary 1",
    parentName: targetApplication.parentName || "Unspecified Parent",
    parentPhone: targetApplication.parentPhone || "N/A",
    parentEmail: recipientEmail,
    guardianEmail: recipientEmail, 
    email: recipientEmail,
    portalLink: portalUrl,
    homeAddress: targetApplication.homeAddress || "",
    password: tempPassword,
    status: 'Active',
    createdAt: new Date().toISOString(),
    grades: {
      english: 85,
      math: 85,
      computer: 85,
      civic: 85,
      agriculture: 85
    },
    coachRemarks: `Account automatically formulated and approved on ${new Date().toLocaleDateString()}. System onboarding sequence initialized.`
  };

  // Add to hgs_students
  await saveStudent(studentPayload);
  
  // Add to students collection for absolute runtime compatibility
  try {
    const studentsCol = sdkFirestore.collection(db, "students");
    await sdkFirestore.addDoc(studentsCol, studentPayload);
  } catch (err) {
    console.warn("Adding to legacy students collection failed:", err);
  }

  // 5. Build notifications payloads
  const emailPayloadObj = {
    student_name: fullName,
    admission_number: uniqueNum,
    student_username: uniqueNum,
    student_password: tempPassword,
    portal_link: portalUrl,
    school_website: schoolWeb
  };

  // 6. Send live Email alert automatically (SMS is temporarily disabled)
  if (!recipientEmail) {
    console.warn("[Approval Notification] guardianEmail / recipient email is empty, skipping email dispatch.");
  } else {
    const subject = "Congratulations! Your Admission Has Been Approved";
    await sendEmailNotification(recipientEmail, subject, emailPayloadObj);
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

  const portalUrl = "https://peterdavididowu1-commits.github.io/His-Grace-School-Agbugburu-/student-portal-v2.html";
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
    emailjsServiceId: EMAILJS_SERVICE_ID,
    emailjsTemplateId: EMAILJS_TEMPLATE_ID,
    emailjsPublicKey: EMAILJS_PUBLIC_KEY,
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

  const portalUrlFixed = "https://peterdavididowu1-commits.github.io/His-Grace-School-Agbugburu-/student-portal-v2.html";
  const webUrlFixed = "https://peterdavididowu1-commits.github.io/His-Grace-School-Agbugburu-/";

  const config = configOverride || await fetchGlobalEmailSettings();

  const isConfigInvalid = !config.emailjsServiceId || 
                           !config.emailjsTemplateId || 
                           !config.emailjsPublicKey ||
                           config.emailjsServiceId.trim() === "" ||
                           config.emailjsTemplateId.trim() === "" ||
                           config.emailjsPublicKey.trim() === "" ||
                           config.emailjsServiceId.includes("xxxxxx") ||
                           config.emailjsTemplateId.includes("xxxxxx") ||
                           config.emailjsPublicKey.includes("your_public_key");

  if (isConfigInvalid) {
    throw new Error("EmailJS is not configured. Please enter Service ID, Template ID, and Public Key in Email Configuration.");
  }

  // Resolve variables
  let studentNameVal = "Pupil";
  let admissionNo = "";
  let userVal = "";
  let passVal = "";
  let linkVal = portalUrlFixed;
  let schoolWebVal = webUrlFixed;

  if (payload && typeof payload === "object") {
    studentNameVal = payload.student_name || payload.studentName || "Pupil";
    admissionNo = payload.admission_number || payload.admissionNumber || "";
    userVal = payload.student_username || payload.username || "";
    passVal = payload.student_password || payload.password || "";
    linkVal = payload.portal_link || payload.portalUrl || payload.portal_url || linkVal;
    if (payload.school_website) {
      schoolWebVal = payload.school_website;
    }
  } else if (typeof payload === "string") {
    const matchAdm = payload.match(/Admission Number:\s*([^\n\r]+)/i);
    if (matchAdm) admissionNo = matchAdm[1].trim();
    const matchPass = payload.match(/Password:\s*([^\n\r]+)/i) || payload.match(/Secure Entry Password:\s*([^\n\r]+)/i);
    if (matchPass) passVal = matchPass[1].trim();
    userVal = admissionNo;
  }

  // 8. Before sending the email, validate that:
  // - admission_number exists
  // - student_username exists
  // - student_password exists
  // - portal_link exists
  // If any value is missing, stop the email process and display an error.
  if (!admissionNo || admissionNo.trim() === "") {
    throw new Error("EmailJS dispatch aborted: Required 'admission_number' value is missing or blank.");
  }
  if (!userVal || userVal.trim() === "") {
    throw new Error("EmailJS dispatch aborted: Required 'student_username' value is missing or blank.");
  }
  if (!passVal || passVal.trim() === "") {
    throw new Error("EmailJS dispatch aborted: Required 'student_password' value is missing or blank.");
  }
  if (!linkVal || linkVal.trim() === "") {
    throw new Error("EmailJS dispatch aborted: Required 'portal_link' value is missing or blank.");
  }

  // Email Body construction matching exactly the requested format (Requirements section 7)
  const exactBodyText = `Dear ${studentNameVal},

Congratulations.

Your application to His Grace School has been approved.

Admission Number:
${admissionNo}

Username:
${userVal}

Password:
${passVal}

Student Portal:
${linkVal}

School Website:
${schoolWebVal}

Please keep these credentials safe and use them to access your student portal.

Regards,

His Grace School Registry`;

  const payloadBody = {
    service_id: config.emailjsServiceId,
    template_id: config.emailjsTemplateId,
    user_id: config.emailjsPublicKey,
    template_params: {
      subject: subject,
      recipient_email: recipientEmail.trim(),
      to_email: recipientEmail.trim(),
      email: recipientEmail.trim(),
      guardianEmail: recipientEmail.trim(),
      
      // Exact requested variables
      student_name: studentNameVal,
      admission_number: admissionNo,
      student_username: userVal,
      student_password: passVal,
      portal_link: linkVal,
      
      // Legacy templates backup compatibility
      username: userVal,
      password: passVal,
      admissionNumber: admissionNo,
      studentName: studentNameVal,
      portal_url: linkVal,

      message: exactBodyText,
      date_time: new Date().toLocaleString()
    }
  };

  // 9. Log the complete EmailJS payload to the browser console before sending for debugging purposes
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
      `Successfully transferred admission notification email to EmailJS relay for "${studentNameVal}" (${recipientEmail}). Response: ${resText}`
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

// Fetch bulletins count and details
export const getNotices = async () => {
  if (!db) return [];
  try {
    const colRef = sdkFirestore.collection(db, "hgs_notices");
    const snap = await sdkFirestore.getDocs(colRef);
    const list = [];
    snap.forEach(doc => {
      list.push({ id: doc.id, ...doc.data() });
    });
    return list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } catch (err) {
    console.error("Error fetching notices:", err);
    return [];
  }
};

// ==========================================
// CENTRAL TEACHER PORTAL & RESULTS ENGINE
// ==========================================

export const getSubjects = async () => {
  if (!db) {
    return [
      "Mathematics", "English Language", "Verbal Reasoning", "Quantitative Reasoning",
      "Basic Science", "Social Studies", "Civic Education", "Agricultural Science",
      "Computer Studies", "Physical and Health Education", "Christian Religious Studies",
      "Cultural and Creative Arts", "Home Economics", "Yoruba"
    ];
  }
  try {
    const docRef = sdkFirestore.doc(db, "hgs_systems_config", "subjects_config");
    const snap = await sdkFirestore.getDoc(docRef);
    if (snap.exists() && snap.data().subjects) {
      return snap.data().subjects;
    }
  } catch (err) {
    console.error("Error fetching subjects from Firestore:", err);
  }
  return [
    "Mathematics", "English Language", "Verbal Reasoning", "Quantitative Reasoning",
    "Basic Science", "Social Studies", "Civic Education", "Agricultural Science",
    "Computer Studies", "Physical and Health Education", "Christian Religious Studies",
    "Cultural and Creative Arts", "Home Economics", "Yoruba"
  ];
};

export const addSubjectToConfig = async (subjectName) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const docRef = sdkFirestore.doc(db, "hgs_systems_config", "subjects_config");
    const snap = await sdkFirestore.getDoc(docRef);
    let subjects = [
      "Mathematics", "English Language", "Verbal Reasoning", "Quantitative Reasoning",
      "Basic Science", "Social Studies", "Civic Education", "Agricultural Science",
      "Computer Studies", "Physical and Health Education", "Christian Religious Studies",
      "Cultural and Creative Arts", "Home Economics", "Yoruba"
    ];
    if (snap.exists() && snap.data().subjects) {
      subjects = snap.data().subjects;
    }
    const cleanSub = subjectName.trim();
    if (!subjects.includes(cleanSub)) {
      subjects.push(cleanSub);
      await sdkFirestore.setDoc(docRef, { subjects }, { merge: true });
    }
    return { success: true, subjects };
  } catch (err) {
    console.error("Error adding subject to configuration:", err);
    throw err;
  }
};

export const saveSubjectsList = async (subjects) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const docRef = sdkFirestore.doc(db, "hgs_systems_config", "subjects_config");
    await sdkFirestore.setDoc(docRef, { subjects }, { merge: true });
    return { success: true, subjects };
  } catch (err) {
    console.error("Error saving subjects list to Firestore:", err);
    throw err;
  }
};

export const getResultsByClassAndSubject = async (studentClass, subject) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const colRef = sdkFirestore.collection(db, "teacher_results");
    const q1 = sdkFirestore.query(
      colRef,
      sdkFirestore.where("class", "==", studentClass),
      sdkFirestore.where("subject", "==", subject)
    );
    const snap = await sdkFirestore.getDocs(q1);
    const results = {};
    snap.forEach(doc => {
      results[doc.data().admissionNumber] = { id: doc.id, ...doc.data() };
    });
    return results;
  } catch (err) {
    console.error("Error fetching teacher results:", err);
    throw err;
  }
};

export const getResultsByStudent = async (admissionNumber) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const colRef = sdkFirestore.collection(db, "teacher_results");
    const q = sdkFirestore.query(
      colRef,
      sdkFirestore.where("admissionNumber", "==", admissionNumber.toUpperCase().trim())
    );
    const snap = await sdkFirestore.getDocs(q);
    const results = [];
    snap.forEach(doc => {
      results.push({ id: doc.id, ...doc.data() });
    });
    return results;
  } catch (err) {
    console.error("Error fetching student results:", err);
    throw err;
  }
};

export const saveTeacherResult = async (payload) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const colRef = sdkFirestore.collection(db, "teacher_results");
    const docId = `${payload.admissionNumber.toUpperCase().trim()}_${payload.subject.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
    const docRef = sdkFirestore.doc(db, "teacher_results", docId);
    
    const docPayload = {
      studentId: payload.studentId || "",
      studentName: payload.studentName || "Unspecified",
      admissionNumber: payload.admissionNumber.toUpperCase().trim(),
      class: payload.class,
      subject: payload.subject,
      firstTerm: payload.firstTerm || null,
      secondTerm: payload.secondTerm || null,
      thirdTerm: payload.thirdTerm || null,
      annualAverage: payload.annualAverage !== undefined ? payload.annualAverage : null,
      promotionStatus: payload.promotionStatus || null,
      updatedAt: new Date().toISOString()
    };
    
    await sdkFirestore.setDoc(docRef, docPayload, { merge: true });
    return { success: true, docId };
  } catch (err) {
    console.error("Error saving teacher result:", err);
    throw err;
  }
};

// ==========================================
// CBT COMPUTER-BASED TEST SYSTEM HELPERS
// ==========================================

export const normalizeQuestion = (qData) => {
  if (!qData) return qData;
  if (!qData.options) {
    qData.options = {
      A: qData.optionA || "",
      B: qData.optionB || "",
      C: qData.optionC || "",
      D: qData.optionD || ""
    };
  } else {
    if (!qData.options.A) qData.options.A = qData.optionA || "";
    if (!qData.options.B) qData.options.B = qData.optionB || "";
    if (!qData.options.C) qData.options.C = qData.optionC || "";
    if (!qData.options.D) qData.options.D = qData.optionD || "";
  }
  if (!qData.optionA) qData.optionA = qData.options.A;
  if (!qData.optionB) qData.optionB = qData.options.B;
  if (!qData.optionC) qData.optionC = qData.options.C;
  if (!qData.optionD) qData.optionD = qData.options.D;
  
  if (!qData.questionText) qData.questionText = qData.text || qData.question || "";
  if (!qData.correctAnswer) qData.correctAnswer = qData.correct || "A";
  
  return qData;
};

export const saveCbtExam = async (examPayload) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const colRef = sdkFirestore.collection(db, "cbt_exams");
    let docId = examPayload.id;
    if (!docId) {
      docId = 'EXAM-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    }
    const docRef = sdkFirestore.doc(db, "cbt_exams", docId);
    
    // Fetch associated questions to populate questions array as per requirement 4
    let questions = examPayload.questions || [];
    if (questions.length === 0) {
      try {
        const qColRef = sdkFirestore.collection(db, "cbt_questions");
        const qQuery = sdkFirestore.query(qColRef, sdkFirestore.where("examId", "==", docId));
        const qSnap = await sdkFirestore.getDocs(qQuery);
        qSnap.forEach(qDoc => {
          questions.push(normalizeQuestion(qDoc.data()));
        });
      } catch (err) {
        console.warn("Could not fetch associated questions during save:", err);
      }
    } else {
      questions = questions.map(q => normalizeQuestion(q));
    }

    const titleVal = examPayload.title || examPayload.examTitle || "";
    const classVal = examPayload.class || examPayload.targetClass || "";
    const sessionVal = examPayload.session || examPayload.academicSession || "2025/2026";
    
    const record = {
      id: docId,
      examTitle: titleVal,
      title: titleVal,
      subject: examPayload.subject || "",
      class: classVal,
      targetClass: classVal,
      academicSession: sessionVal,
      session: sessionVal,
      term: examPayload.term || "First Term",
      examDate: examPayload.examDate || "",
      startTime: examPayload.startTime || "",
      endTime: examPayload.endTime || "",
      duration: Number(examPayload.duration) || 60,
      status: "Published", // Requirement 6: Automatically save: status = "Published"
      published: true,
      questions: questions,
      createdAt: examPayload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await sdkFirestore.setDoc(docRef, record, { merge: true });
    return { success: true, docId };
  } catch (err) {
    console.error("Error saving CBT Exam:", err);
    throw err;
  }
};

export const deleteCbtExam = async (examId) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const docRef = sdkFirestore.doc(db, "cbt_exams", examId);
    await sdkFirestore.deleteDoc(docRef);
    
    // Also delete any associated questions in cbt_questions
    const colRef = sdkFirestore.collection(db, "cbt_questions");
    const q1 = sdkFirestore.query(colRef, sdkFirestore.where("examId", "==", examId));
    const snap = await sdkFirestore.getDocs(q1);
    const deletePromises = [];
    snap.forEach(doc => {
      deletePromises.push(sdkFirestore.deleteDoc(doc.ref));
    });
    await Promise.all(deletePromises);
    
    return { success: true };
  } catch (err) {
    console.error("Error deleting CBT Exam and questions:", err);
    throw err;
  }
};

export const getCbtExams = async () => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const colRef = sdkFirestore.collection(db, "cbt_exams");
    const snap = await sdkFirestore.getDocs(colRef);
    const exams = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const titleVal = data.examTitle || data.title || "";
      const classVal = data.class || data.targetClass || "";
      const sessionVal = data.academicSession || data.session || "2025/2026";
      
      let questions = data.questions || [];
      if (questions.length === 0) {
        try {
          const qColRef = sdkFirestore.collection(db, "cbt_questions");
          const qQuery = sdkFirestore.query(qColRef, sdkFirestore.where("examId", "==", data.id));
          const qSnap = await sdkFirestore.getDocs(qQuery);
          qSnap.forEach(qDoc => {
            questions.push(normalizeQuestion(qDoc.data()));
          });
        } catch (err) {
          console.warn("Could not fetch associated questions:", err);
        }
      } else {
        questions = questions.map(qData => normalizeQuestion(qData));
      }

      const unifiedExam = {
        ...data,
        examTitle: titleVal,
        title: titleVal,
        class: classVal,
        targetClass: classVal,
        academicSession: sessionVal,
        session: sessionVal,
        status: data.status || "Published",
        published: data.published !== undefined ? data.published : true,
        questions: questions
      };
      exams.push(unifiedExam);
    }
    return exams;
  } catch (err) {
    console.error("Error getting CBT Exams:", err);
    throw err;
  }
};

export const getCbtExamsByClass = async (studentClass) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const colRef = sdkFirestore.collection(db, "cbt_exams");
    const q1 = sdkFirestore.query(colRef, sdkFirestore.where("class", "==", studentClass));
    const snap = await sdkFirestore.getDocs(q1);
    const exams = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const titleVal = data.examTitle || data.title || "";
      const classVal = data.class || data.targetClass || "";
      const sessionVal = data.academicSession || data.session || "2025/2026";
      
      let questions = data.questions || [];
      if (questions.length === 0) {
        try {
          const qColRef = sdkFirestore.collection(db, "cbt_questions");
          const qQuery = sdkFirestore.query(qColRef, sdkFirestore.where("examId", "==", data.id));
          const qSnap = await sdkFirestore.getDocs(qQuery);
          qSnap.forEach(qDoc => {
            questions.push(normalizeQuestion(qDoc.data()));
          });
        } catch (err) {
          console.warn("Could not fetch associated questions:", err);
        }
      } else {
        questions = questions.map(qData => normalizeQuestion(qData));
      }

      const unifiedExam = {
        ...data,
        examTitle: titleVal,
        title: titleVal,
        class: classVal,
        targetClass: classVal,
        academicSession: sessionVal,
        session: sessionVal,
        status: data.status || "Published",
        published: data.published !== undefined ? data.published : true,
        questions: questions
      };
      exams.push(unifiedExam);
    }
    return exams;
  } catch (err) {
    console.error("Error getting CBT Exams by Class:", err);
    throw err;
  }
};

export const saveCbtQuestion = async (questionPayload) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const colRef = sdkFirestore.collection(db, "cbt_questions");
    let docId = questionPayload.id;
    if (!docId) {
      docId = 'QUES-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
    }
    const docRef = sdkFirestore.doc(db, "cbt_questions", docId);
    
    const optionsObj = {
      A: (questionPayload.options && questionPayload.options.A) || questionPayload.optionA || "",
      B: (questionPayload.options && questionPayload.options.B) || questionPayload.optionB || "",
      C: (questionPayload.options && questionPayload.options.C) || questionPayload.optionC || "",
      D: (questionPayload.options && questionPayload.options.D) || questionPayload.optionD || ""
    };

    const record = {
      id: docId,
      examId: questionPayload.examId,
      questionText: questionPayload.questionText || "",
      options: optionsObj,
      optionA: optionsObj.A,
      optionB: optionsObj.B,
      optionC: optionsObj.C,
      optionD: optionsObj.D,
      correctAnswer: questionPayload.correctAnswer || "A", // A, B, C, D
      updatedAt: new Date().toISOString()
    };
    
    await sdkFirestore.setDoc(docRef, record, { merge: true });

    // Update parent exam record questions array as well
    try {
      const examDocRef = sdkFirestore.doc(db, "cbt_exams", questionPayload.examId);
      const examSnap = await sdkFirestore.getDoc(examDocRef);
      if (examSnap.exists()) {
        const examData = examSnap.data();
        let currentQuestions = examData.questions || [];
        const existingIdx = currentQuestions.findIndex(q => q.id === docId);
        if (existingIdx !== -1) {
          currentQuestions[existingIdx] = record;
        } else {
          currentQuestions.push(record);
        }
        await sdkFirestore.setDoc(examDocRef, { questions: currentQuestions }, { merge: true });
      }
    } catch (eErr) {
      console.warn("Parent exam update after question save failed:", eErr);
    }
    
    return { success: true, docId };
  } catch (err) {
    console.error("Error saving CBT Question:", err);
    throw err;
  }
};

export const deleteCbtQuestion = async (questionId) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const qDocRef = sdkFirestore.doc(db, "cbt_questions", questionId);
    const qSnap = await sdkFirestore.getDoc(qDocRef);
    let examId = null;
    if (qSnap.exists()) {
      examId = qSnap.data().examId;
    }

    await sdkFirestore.deleteDoc(qDocRef);

    if (examId) {
      try {
        const examDocRef = sdkFirestore.doc(db, "cbt_exams", examId);
        const examSnap = await sdkFirestore.getDoc(examDocRef);
        if (examSnap.exists()) {
          const examData = examSnap.data();
          let currentQuestions = examData.questions || [];
          currentQuestions = currentQuestions.filter(q => q.id !== questionId);
          await sdkFirestore.setDoc(examDocRef, { questions: currentQuestions }, { merge: true });
        }
      } catch (eErr) {
        console.warn("Parent exam update after question delete failed:", eErr);
      }
    }

    return { success: true };
  } catch (err) {
    console.error("Error deleting CBT Question:", err);
    throw err;
  }
};

export const getCbtQuestionsForExam = async (examId) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const colRef = sdkFirestore.collection(db, "cbt_questions");
    const q1 = sdkFirestore.query(colRef, sdkFirestore.where("examId", "==", examId));
    const snap = await sdkFirestore.getDocs(q1);
    const questions = [];
    snap.forEach(doc => {
      questions.push(normalizeQuestion(doc.data()));
    });
    return questions;
  } catch (err) {
    console.error("Error getting CBT Questions for Exam:", err);
    throw err;
  }
};

export const saveCbtAnswers = async (answerPayload) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const docId = `${answerPayload.admissionNumber.toUpperCase().trim()}_${answerPayload.examId}`;
    const docRef = sdkFirestore.doc(db, "cbt_answers", docId);
    
    const record = {
      id: docId,
      admissionNumber: answerPayload.admissionNumber.toUpperCase().trim(),
      examId: answerPayload.examId,
      answers: answerPayload.answers || {}, // questionId -> chosen answer mapping
      status: answerPayload.status || "saved", // "saved" or "submitted"
      lastUpdatedAt: new Date().toISOString()
    };
    
    await sdkFirestore.setDoc(docRef, record, { merge: true });
    return { success: true, docId };
  } catch (err) {
    console.error("Error saving CBT Answers:", err);
    throw err;
  }
};

export const getCbtAnswersForStudentAndExam = async (admissionNumber, examId) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const docId = `${admissionNumber.toUpperCase().trim()}_${examId}`;
    const docRef = sdkFirestore.doc(db, "cbt_answers", docId);
    const snap = await sdkFirestore.getDoc(docRef);
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (err) {
    console.error("Error getting CBT Answers for Student:", err);
    throw err;
  }
};

export const normalizeCbtResult = (rData) => {
  if (!rData) return rData;
  
  // Total questions
  const totalQuestions = Number(rData.totalQuestions) || 0;
  
  // Correct answers
  let correctAnswers = 0;
  if (rData.correctAnswers !== undefined) {
    correctAnswers = Number(rData.correctAnswers);
  } else if (rData.score !== undefined) {
    correctAnswers = Number(rData.score);
  }
  
  // Wrong answers
  let wrongAnswers = 0;
  if (rData.wrongAnswers !== undefined) {
    wrongAnswers = Number(rData.wrongAnswers);
  } else {
    wrongAnswers = totalQuestions - correctAnswers;
    if (wrongAnswers < 0) wrongAnswers = 0;
  }
  
  // Percentage
  let percentageScore = 0;
  if (rData.percentageScore !== undefined) {
    percentageScore = Number(rData.percentageScore);
  } else if (rData.percentage !== undefined) {
    percentageScore = Number(rData.percentage);
  } else if (totalQuestions > 0) {
    percentageScore = Math.round((correctAnswers / totalQuestions) * 100);
  }
  
  // Class
  const studentClass = rData.class || rData.studentClass || "";
  
  // Session
  const academicSession = rData.academicSession || rData.session || "2025/2026";
  
  // Grade
  let grade = rData.grade || "";
  if (!grade) {
    if (percentageScore >= 80) grade = "A";
    else if (percentageScore >= 70) grade = "B";
    else if (percentageScore >= 60) grade = "C";
    else if (percentageScore >= 50) grade = "D";
    else if (percentageScore >= 40) grade = "E";
    else grade = "F";
  }
  
  // Status
  let status = rData.status || "";
  if (!status) {
    status = percentageScore >= 50 ? "PASS" : "FAIL";
  }
  
  // Date written
  const dateWritten = rData.dateWritten || rData.timestamp || new Date().toISOString();
  
  // Update/set all properties on the object for maximum redundancy/compatibility
  rData.totalQuestions = totalQuestions;
  rData.correctAnswers = correctAnswers;
  rData.score = correctAnswers;
  rData.wrongAnswers = wrongAnswers;
  rData.percentageScore = percentageScore;
  rData.percentage = percentageScore;
  rData.class = studentClass;
  rData.studentClass = studentClass;
  rData.academicSession = academicSession;
  rData.session = academicSession;
  rData.grade = grade;
  rData.status = status;
  rData.dateWritten = dateWritten;
  rData.timestamp = dateWritten;
  
  return rData;
};

export const saveCbtResult = async (resultPayload) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const docId = `${resultPayload.admissionNumber.toUpperCase().trim()}_${resultPayload.examId}`;
    const docRef = sdkFirestore.doc(db, "cbt_results", docId);
    
    const rawRecord = {
      ...resultPayload,
      id: docId
    };
    
    const record = normalizeCbtResult(rawRecord);
    record.updatedAt = new Date().toISOString();
    
    await sdkFirestore.setDoc(docRef, record, { merge: true });
    return { success: true, docId, record };
  } catch (err) {
    console.error("Error saving CBT Result:", err);
    throw err;
  }
};

export const getCbtResultsForStudent = async (admissionNumber) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const colRef = sdkFirestore.collection(db, "cbt_results");
    const q1 = sdkFirestore.query(colRef, sdkFirestore.where("admissionNumber", "==", admissionNumber.toUpperCase().trim()));
    const snap = await sdkFirestore.getDocs(q1);
    const results = [];
    snap.forEach(doc => {
      results.push(normalizeCbtResult(doc.data()));
    });
    return results;
  } catch (err) {
    console.error("Error getting CBT Results for Student:", err);
    throw err;
  }
};

export const getCbtResultsForExam = async (examId) => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const colRef = sdkFirestore.collection(db, "cbt_results");
    const q1 = sdkFirestore.query(colRef, sdkFirestore.where("examId", "==", examId));
    const snap = await sdkFirestore.getDocs(q1);
    const results = [];
    snap.forEach(doc => {
      results.push(normalizeCbtResult(doc.data()));
    });
    return results;
  } catch (err) {
    console.error("Error getting CBT Results for Exam:", err);
    throw err;
  }
};

export const getAllCbtResults = async () => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    const colRef = sdkFirestore.collection(db, "cbt_results");
    const snap = await sdkFirestore.getDocs(colRef);
    const results = [];
    snap.forEach(doc => {
      results.push(normalizeCbtResult(doc.data()));
    });
    return results;
  } catch (err) {
    console.error("Error getting All CBT Results:", err);
    throw err;
  }
};

export const repairCbtRecords = async () => {
  if (!db) throw new Error("Firestore not initialized.");
  try {
    console.log("Starting full CBT records self-repair audit...");
    
    // 1. Repair CBT questions collection
    const qColRef = sdkFirestore.collection(db, "cbt_questions");
    const qSnap = await sdkFirestore.getDocs(qColRef);
    const questionsMap = {}; // Keep a copy of repaired questions by ID
    
    for (const qDoc of qSnap.docs) {
      const qData = qDoc.data();
      let updated = false;
      
      if (!qData.options) {
        qData.options = {};
      }
      
      const optionAVal = qData.options.A || qData.optionA || "";
      const optionBVal = qData.options.B || qData.optionB || "";
      const optionCVal = qData.options.C || qData.optionC || "";
      const optionDVal = qData.options.D || qData.optionD || "";
      
      if (qData.options.A !== optionAVal || !qData.options.A) { qData.options.A = optionAVal; updated = true; }
      if (qData.options.B !== optionBVal || !qData.options.B) { qData.options.B = optionBVal; updated = true; }
      if (qData.options.C !== optionCVal || !qData.options.C) { qData.options.C = optionCVal; updated = true; }
      if (qData.options.D !== optionDVal || !qData.options.D) { qData.options.D = optionDVal; updated = true; }
      
      if (qData.optionA !== optionAVal) { qData.optionA = optionAVal; updated = true; }
      if (qData.optionB !== optionBVal) { qData.optionB = optionBVal; updated = true; }
      if (qData.optionC !== optionCVal) { qData.optionC = optionCVal; updated = true; }
      if (qData.optionD !== optionDVal) { qData.optionD = optionDVal; updated = true; }
      
      if (updated) {
        console.log(`Repairing CBT Question record: ${qDoc.id}`);
        await sdkFirestore.setDoc(qDoc.ref, qData, { merge: true });
      }
      
      questionsMap[qDoc.id] = qData;
    }
    
    // 2. Repair CBT exams collection questions array
    const eColRef = sdkFirestore.collection(db, "cbt_exams");
    const eSnap = await sdkFirestore.getDocs(eColRef);
    for (const eDoc of eSnap.docs) {
      const eData = eDoc.data();
      let updated = false;
      
      let questionsArr = eData.questions || [];
      if (questionsArr.length > 0) {
        const repairedQs = questionsArr.map(q => {
          if (questionsMap[q.id]) {
            return questionsMap[q.id];
          }
          
          let qUpdated = false;
          if (!q.options) {
            q.options = {};
          }
          const opA = q.options.A || q.optionA || "";
          const opB = q.options.B || q.optionB || "";
          const opC = q.options.C || q.optionC || "";
          const opD = q.options.D || q.optionD || "";
          
          if (q.options.A !== opA || !q.options.A) { q.options.A = opA; qUpdated = true; }
          if (q.options.B !== opB || !q.options.B) { q.options.B = opB; qUpdated = true; }
          if (q.options.C !== opC || !q.options.C) { q.options.C = opC; qUpdated = true; }
          if (q.options.D !== opD || !q.options.D) { q.options.D = opD; qUpdated = true; }
          
          if (q.optionA !== opA) { q.optionA = opA; qUpdated = true; }
          if (q.optionB !== opB) { q.optionB = opB; qUpdated = true; }
          if (q.optionC !== opC) { q.optionC = opC; qUpdated = true; }
          if (q.optionD !== opD) { q.optionD = opD; qUpdated = true; }
          
          if (qUpdated) {
            updated = true;
          }
          return q;
        });
        
        if (updated) {
          console.log(`Repairing embedded questions in CBT Exam: ${eDoc.id}`);
          await sdkFirestore.setDoc(eDoc.ref, { questions: repairedQs }, { merge: true });
        }
      }
    }
    console.log("CBT records self-repair audit completed successfully!");
    return { success: true };
  } catch (err) {
    console.error("Failed to run CBT self-repair audit:", err);
    return { success: false, error: err.message };
  }
};

