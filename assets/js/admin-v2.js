// His Grace School - Administration Portal V2 Backend Service JS Module
import firebaseConfig from './firebase-config-env.js';

let db = null;
let auth = null;
let sdkAuth = null;
let sdkFirestore = null;

const initPromise = (async () => {
  try {
    const sdkApp = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
    sdkAuth = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
    sdkFirestore = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

    const app = sdkApp.initializeApp(firebaseConfig);
    auth = sdkAuth.getAuth(app);
    db = sdkFirestore.getFirestore(app);
    console.log("🌟 [Admin V2] Firebase SDK initialized successfully!");
    return { auth, db, sdkAuth, sdkFirestore };
  } catch (err) {
    console.error("❌ [Admin V2] Firebase SDK failed to initialize:", err);
    throw err;
  }
})();

// Helper to wait for SDK ready
export const getSDK = async () => {
  return await initPromise;
};

// Security check function
export const requireAuthentication = async () => {
  const { auth, sdkAuth } = await getSDK();
  return new Promise((resolve) => {
    sdkAuth.onAuthStateChanged(auth, (user) => {
      if (!user) {
        console.warn("🔐 [Admin V2] Access Denied: Redirecting to login...");
        window.location.replace("admin-v2-login.html");
        resolve(null);
      } else {
        // Double check details if needed
        resolve(user);
      }
    });
  });
};

// Check if user is logged in
export const checkAuthState = async (callback, onUnauth) => {
  const { auth, sdkAuth } = await getSDK();
  sdkAuth.onAuthStateChanged(auth, (user) => {
    if (user) {
      callback(user);
    } else if (onUnauth) {
      onUnauth();
    }
  });
};

// Audit logging
export const writeAuditLog = async (action, details) => {
  try {
    const { db, sdkFirestore, auth } = await getSDK();
    const currentUser = auth.currentUser;
    const operator = currentUser ? currentUser.email : "System / guest";
    
    const logObj = {
      action,
      details,
      operator,
      timestamp: new Date().toISOString()
    };
    
    const colRef = sdkFirestore.collection(db, "system_audit_logs");
    await sdkFirestore.addDoc(colRef, logObj);
    console.log(`📝 [Admin V2 Log] Saved: ${action} - ${details}`);
    return { success: true };
  } catch (err) {
    console.error("❌ [Admin V2 Log] Failed to save audit log:", err);
    return { success: false, error: err };
  }
};

// Authenticate Administrator
export const loginAdministrator = async (email, password) => {
  try {
    const { auth, sdkAuth } = await getSDK();
    
    // Strict requirement: Administrator account email
    const sanitizedEmail = email.trim().toLowerCase();
    if (sanitizedEmail !== "hisgraceschool.name.ng@gmail.com") {
      throw new Error("Unauthorized Access. Email is not registered as an Administration V2 Portal Operator.");
    }

    console.log(`🔑 [Admin V2 Login] Authenticating Firebase Auth...`);
    const authResult = await sdkAuth.signInWithEmailAndPassword(auth, sanitizedEmail, password);
    const user = authResult.user;
    
    await writeAuditLog("Login Event", `Administrator (${sanitizedEmail}) logged in successfully.`);
    return { success: true, user };
  } catch (err) {
    console.error("❌ [Admin V2 Login] Failed validation:", err);
    await writeAuditLog("Login Attempt Failed", `Security alert: Failed login attempt for "${email}". Error: ${err.message}`);
    throw err;
  }
};

// Sign Out
export const logoutAdministrator = async () => {
  try {
    const { auth, sdkAuth } = await getSDK();
    const email = auth.currentUser ? auth.currentUser.email : "Unknown";
    await writeAuditLog("Logout Event", `Administrator (${email}) logged out.`);
    await sdkAuth.signOut(auth);
    window.location.replace("admin-v2-login.html");
    return { success: true };
  } catch (err) {
    console.error("❌ [Admin V2 Logout] Error signing out:", err);
    window.location.replace("admin-v2-login.html");
    throw err;
  }
};

// Email Setup configuration loader
export const getEmailConfig = async () => {
  try {
    const { db, sdkFirestore } = await getSDK();
    const docRef = sdkFirestore.doc(db, "hgs_systems_config", "email_settings");
    const snap = await sdkFirestore.getDoc(docRef);
    if (snap.exists()) {
      return snap.data();
    }
  } catch (e) {
    console.warn("⚠️ [Admin V2] Failed to fetch remote EmailJS configuration, using local/demo parameters.");
  }
  return {
    emailjsServiceId: "service_8q6oxsm",
    emailjsTemplateId: "template_j89byb9",
    emailjsPublicKey: "bX46781-HIs7_C981"
  };
};

// Dispatch Email Notification (Approval, Rejection, Custom)
export const sendEmailNotification = async (recipientEmail, subject, textMessage, studentName = "Pupil") => {
  try {
    if (!recipientEmail || recipientEmail.trim() === "") {
      throw new Error("Recipient email cannot be blank.");
    }
    
    const config = await getEmailConfig();
    const portalUrl = "https://ais-dev-ekckh44s3rnajaoptnewrq-954755939199.europe-west2.run.app/login.html"; // Default or dynamic relative login page
    
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
        student_name: studentName,
        portal_url: portalUrl,
        message: textMessage,
        date_time: new Date().toLocaleString()
      }
    };

    console.log("📨 [Admin V2 Email] Dispatching to:", recipientEmail);
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadBody)
    });

    const resText = await response.text();
    if (!response.ok) {
      throw new Error(`EmailJS failed: ${resText} (HTTP: ${response.status})`);
    }

    await writeAuditLog("Email Dispatched", `Notification sent to "${recipientEmail}" (Subj: ${subject}) in relation to pupil "${studentName}".`);
    return { success: true };
  } catch (err) {
    console.error("❌ [Admin V2 Email] Failed sending email:", err);
    await writeAuditLog("Email Send Failed", `Failed to deliver email to "${recipientEmail}". Error: ${err.message}`);
    throw err;
  }
};

// Get Dashboard Data (Total counters, Recent arrays)
export const getDashboardStats = async () => {
  try {
    const { db, sdkFirestore } = await getSDK();
    
    // 1. Fetch Admissions
    const admissionsCol = sdkFirestore.collection(db, "hgs_admissions");
    const admSnap = await sdkFirestore.getDocs(admissionsCol);
    const admissions = [];
    admSnap.forEach(d => admissions.push({ id: d.id, ...d.data() }));

    // 2. Fetch Messages
    const messagesCol = sdkFirestore.collection(db, "hgs_messages");
    const msgSnap = await sdkFirestore.getDocs(messagesCol);
    const messages = [];
    msgSnap.forEach(d => messages.push({ id: d.id, ...d.data() }));

    // Calculations
    const totalAdmissions = admissions.length;
    const totalApproved = admissions.filter(a => a.status === "Approved").length;
    const totalPending = admissions.filter(a => a.status === "Pending" || !a.status).length;
    const totalContactMessages = messages.length;

    // Sorting recents
    const recentAdmissions = [...admissions]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 5);

    const recentMessages = [...messages]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 5);

    return {
      stats: {
        totalAdmissions,
        totalApproved,
        totalPending,
        totalContactMessages
      },
      recentAdmissions,
      recentMessages
    };
  } catch (err) {
    console.error("❌ [Admin V2 Stats] Failed:", err);
    throw err;
  }
};

// Admissions Module API
export const getAdmissions = async () => {
  const { db, sdkFirestore } = await getSDK();
  const colRef = sdkFirestore.collection(db, "hgs_admissions");
  const snap = await sdkFirestore.getDocs(colRef);
  const data = [];
  snap.forEach(d => data.push({ id: d.id, ...d.data() }));
  return data.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
};

// Approve Admission Function
export const approveAdmission = async (admissionId, applicantEmail) => {
  try {
    const { db, sdkFirestore } = await getSDK();
    
    // 1. Fetch exact admission document
    const docRef = sdkFirestore.doc(db, "hgs_admissions", admissionId);
    const snap = await sdkFirestore.getDoc(docRef);
    if (!snap.exists()) {
      throw new Error("Admission record not found.");
    }
    const admission = snap.data();

    // 2. Update admission status
    await sdkFirestore.updateDoc(docRef, { status: "Approved" });

    // 3. Auto-generate Student Number and Record
    const studentsCol = sdkFirestore.collection(db, "students");
    const studSnap = await sdkFirestore.getDocs(studentsCol);
    const studentsList = [];
    studSnap.forEach(s => studentsList.push(s.data()));

    let uniqueNum = "";
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 100) {
      const idx = Math.floor(1000 + Math.random() * 9000);
      uniqueNum = `HGS-2026-${idx}`;
      isUnique = !studentsList.some(s => s.admissionNumber === uniqueNum);
      attempts++;
    }

    const tempPassword = Math.random().toString(36).slice(-8).toUpperCase();
    
    // Extract Student details safely
    const fullName = admission.studentName || admission.fullName || "Unspecified Pupil";
    const classVal = admission.gradeApplying || admission.classRequested || admission.class || "Primary 1";
    const parentName = admission.parentName || admission.guardianName || "Unspecified Parent";
    const parentPhone = admission.parentPhone || admission.guardianPhone || "N/A";
    const resolvedEmail = (applicantEmail || admission.guardianEmail || admission.parentEmail || admission.email || "").trim();

    // Fields: Full Name, Class, Admission Number, Parent Details, Contact Details
    const studentPayload = {
      fullName: fullName,
      studentName: fullName, // backup for older layouts
      class: classVal,
      gradeApplying: classVal, // backup for older layouts
      admissionNumber: uniqueNum,
      parentDetails: {
        parentName: parentName,
        parentPhone: parentPhone
      },
      parentName: parentName, // backup for older layouts
      parentPhone: parentPhone, // backup for older layouts
      contactDetails: {
        guardianEmail: resolvedEmail,
        guardianPhone: parentPhone
      },
      parentEmail: resolvedEmail, // backup
      guardianEmail: resolvedEmail, // backup
      password: tempPassword,
      status: "Active",
      createdAt: new Date().toISOString()
    };

    // Save student profile
    await sdkFirestore.addDoc(studentsCol, studentPayload);
    await writeAuditLog("Student Creation", `Profile generated and added to 'students' database for "${fullName}" (Adm No: ${uniqueNum}).`);

    // 4. Send email notification
    if (resolvedEmail) {
      const subject = `Congratulations! - Admission Approved for ${fullName}`;
      const emailText = `Congratulations. Your admission into His Grace School has been approved.\n\nHere are your access details for the student portal:\n- Link: https://ais-dev-ekckh44s3rnajaoptnewrq-954755939199.europe-west2.run.app/login.html\n- Admission Number: ${uniqueNum}\n- Password: ${tempPassword}\n\nWarm Regards,\nHis Grace School Admission Office`;
      
      await sendEmailNotification(resolvedEmail, subject, emailText, fullName);
    }

    await writeAuditLog("Admission Approved", `Approved enrolment request for candidate "${fullName}". Status changed to 'Approved'.`);
    return { success: true, uniqueNum };
  } catch (err) {
    console.error("❌ [Admin V2 Approve] Error:", err);
    throw err;
  }
};

// Reject Admission Function
export const rejectAdmission = async (admissionId, reason = "Credentials did not meet entry requirements.") => {
  try {
    const { db, sdkFirestore } = await getSDK();
    const docRef = sdkFirestore.doc(db, "hgs_admissions", admissionId);
    const snap = await sdkFirestore.getDoc(docRef);
    if (!snap.exists()) {
      throw new Error("Admission record not found.");
    }
    const admission = snap.data();
    const fullName = admission.studentName || admission.fullName || "Pupil";
    const resolvedEmail = (admission.guardianEmail || admission.parentEmail || admission.email || "").trim();

    // Update status to Rejected
    await sdkFirestore.updateDoc(docRef, { status: "Rejected" });

    // Send Rejection email
    if (resolvedEmail) {
      const subject = `Admission Status Update - ${fullName}`;
      const emailText = `We appreciate your application. Unfortunately, admission was not approved.\n\nFeedback:\n"${reason}"\n\nIf you have any questions, you can contact the registrar.\n\nWarm Regards,\nHis Grace School Office`;
      
      await sendEmailNotification(resolvedEmail, subject, emailText, fullName);
    }

    await writeAuditLog("Admission Rejected", `Enrollment request for pupil "${fullName}" rejected. Reason: ${reason}`);
    return { success: true };
  } catch (err) {
    console.error("❌ [Admin V2 Reject] Error:", err);
    throw err;
  }
};

// Set Admission Status to Pending
export const markAdmissionAsPending = async (admissionId) => {
  try {
    const { db, sdkFirestore } = await getSDK();
    const docRef = sdkFirestore.doc(db, "hgs_admissions", admissionId);
    const snap = await sdkFirestore.getDoc(docRef);
    if (!snap.exists()) {
      throw new Error("Admission record not found.");
    }
    const admission = snap.data();
    const fullName = admission.studentName || admission.fullName || "Pupil";

    await sdkFirestore.updateDoc(docRef, { status: "Pending" });
    await writeAuditLog("Admission Pending Status", `Admission request for "${fullName}" set to Pending.`);
    return { success: true };
  } catch (err) {
    console.error("❌ [Admin V2 Pending] Error:", err);
    throw err;
  }
};

// Students Module API
export const getStudents = async () => {
  const { db, sdkFirestore } = await getSDK();
  const colRef = sdkFirestore.collection(db, "students");
  const snap = await sdkFirestore.getDocs(colRef);
  const data = [];
  snap.forEach(d => data.push({ id: d.id, ...d.data() }));
  return data.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
};

// Messages Module API
export const getMessages = async () => {
  const { db, sdkFirestore } = await getSDK();
  const colRef = sdkFirestore.collection(db, "hgs_messages");
  const snap = await sdkFirestore.getDocs(colRef);
  const data = [];
  snap.forEach(d => data.push({ id: d.id, ...d.data() }));
  return data.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
};

// Resolve Message
export const markMessageAsResolved = async (messageId) => {
  try {
    const { db, sdkFirestore } = await getSDK();
    const docRef = sdkFirestore.doc(db, "hgs_messages", messageId);
    const snap = await sdkFirestore.getDoc(docRef);
    if (!snap.exists()) {
      throw new Error("Message not found.");
    }
    const msg = snap.data();
    await sdkFirestore.updateDoc(docRef, { status: "Resolved", resolvedAt: new Date().toISOString() });
    
    await writeAuditLog("Message Resolved", `Contact inquiry from "${msg.fullName || msg.name || 'Anonymous'}" marked as 'Resolved'.`);
    return { success: true };
  } catch (err) {
    console.error("❌ [Admin V2 Resolve Msg] Error:", err);
    throw err;
  }
};

// Delete Message
export const deleteMessage = async (messageId) => {
  try {
    const { db, sdkFirestore } = await getSDK();
    const docRef = sdkFirestore.doc(db, "hgs_messages", messageId);
    const snap = await sdkFirestore.getDoc(docRef);
    if (!snap.exists()) {
      throw new Error("Message not found.");
    }
    const msg = snap.data();
    await sdkFirestore.deleteDoc(docRef);
    
    await writeAuditLog("Message Erased", `Contact message from "${msg.fullName || msg.name || 'Anonymous'}" was permanently deleted.`);
    return { success: true };
  } catch (err) {
    console.error("❌ [Admin V2 Delete Msg] Error:", err);
    throw err;
  }
};

// Reply to Message by Email
export const replyByEmail = async (messageId, replyText, recipientEmail, senderSubject = "Response from His Grace School") => {
  try {
    const { db, sdkFirestore } = await getSDK();
    const docRef = sdkFirestore.doc(db, "hgs_messages", messageId);
    const snap = await sdkFirestore.getDoc(docRef);
    if (!snap.exists()) {
      throw new Error("Message not found.");
    }
    const msg = snap.data();
    const senderName = msg.fullName || msg.name || "Enquirer";

    await sendEmailNotification(recipientEmail, senderSubject, replyText, senderName);
    await sdkFirestore.updateDoc(docRef, { status: "Replied", replyText, repliedAt: new Date().toISOString() });
    
    await writeAuditLog("Contact Message Replied", `Dispatched response email to "${recipientEmail}" answering their messages.`);
    return { success: true };
  } catch (err) {
    console.error("❌ [Admin V2 Reply] Error:", err);
    throw err;
  }
};

// Audit logs fetching
export const getAuditLogs = async () => {
  const { db, sdkFirestore } = await getSDK();
  const colRef = sdkFirestore.collection(db, "system_audit_logs");
  const snap = await sdkFirestore.getDocs(colRef);
  const data = [];
  snap.forEach(d => data.push({ id: d.id, ...d.data() }));
  return data.sort((a, b) => new Date(b.timestamp || b.createdAt || 0) - new Date(a.timestamp || a.createdAt || 0));
};

// Export to Global window namespace to be readily accessible in simple HTML files
window.AdminV2 = {
  getSDK,
  requireAuthentication,
  checkAuthState,
  loginAdministrator,
  logoutAdministrator,
  getDashboardStats,
  getAdmissions,
  approveAdmission,
  rejectAdmission,
  markAdmissionAsPending,
  getStudents,
  getMessages,
  markMessageAsResolved,
  deleteMessage,
  replyByEmail,
  sendEmailNotification,
  getAuditLogs,
  writeAuditLog
};
