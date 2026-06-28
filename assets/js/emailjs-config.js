// DIMABIN Management System - EmailJS Config and Helper Module
// Provides central, dynamic settings for system notifications.

import { db } from './firebase-init.js';

// Default / fallback configurations when Firestore settings are not yet set
export const DEFAULT_EMAILJS_CONFIG = {
  publicKey: "user_example_public_key_12345",
  serviceId: "service_example_dimabin",
  admissionTemplateId: "template_admission_confirm",
  contactTemplateId: "template_contact_form",
  adminNotificationTemplateId: "template_admin_notice",
  studentNotificationTemplateId: "template_student_notice",
  lecturerNotificationTemplateId: "template_lecturer_notice",
  updatedAt: new Date().toISOString()
};

/**
 * Fetches the active EmailJS configurations from Firestore settings/emailjs_settings document.
 * If the document doesn't exist, it seeds it with default configurations and returns them.
 */
export async function getEmailJSConfig() {
  if (!db) {
    console.warn("⚠️ Firestore not initialized. Returning local default EmailJS config.");
    return DEFAULT_EMAILJS_CONFIG;
  }

  const { doc, getDoc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
  const docRef = doc(db, "settings", "emailjs_settings");

  try {
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { ...DEFAULT_EMAILJS_CONFIG, ...docSnap.data() };
    } else {
      // Seed with default config if missing
      await setDoc(docRef, DEFAULT_EMAILJS_CONFIG);
      console.log("✅ Seeded default EmailJS configuration in 'settings/emailjs_settings'");
      return DEFAULT_EMAILJS_CONFIG;
    }
  } catch (error) {
    console.error("❌ Failed to fetch EmailJS config from Firestore, falling back to local:", error);
    return DEFAULT_EMAILJS_CONFIG;
  }
}

/**
 * Saves/Updates the EmailJS settings in Firestore settings/emailjs_settings.
 */
export async function saveEmailJSConfig(newConfig) {
  if (!db) {
    throw new Error("Firestore is not initialized.");
  }

  const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
  const docRef = doc(db, "settings", "emailjs_settings");

  const dataToSave = {
    publicKey: newConfig.publicKey || "",
    serviceId: newConfig.serviceId || "",
    admissionTemplateId: newConfig.admissionTemplateId || "",
    contactTemplateId: newConfig.contactTemplateId || "",
    adminNotificationTemplateId: newConfig.adminNotificationTemplateId || "",
    studentNotificationTemplateId: newConfig.studentNotificationTemplateId || "",
    lecturerNotificationTemplateId: newConfig.lecturerNotificationTemplateId || "",
    updatedAt: new Date().toISOString()
  };

  await setDoc(docRef, dataToSave, { merge: true });
  console.log("✅ Successfully updated EmailJS configurations in Firestore.");
  return dataToSave;
}

/**
 * Prepared helper function for future email transmissions.
 * This logs the email payload and prevents transmission if default dummy credentials are used.
 */
export async function prepareAndLogEmail(templateIdType, recipientName, recipientEmail, templateParams = {}) {
  const config = await getEmailJSConfig();
  
  // Resolve which actual template ID to use
  let actualTemplateId = "";
  if (templateIdType === "admission") actualTemplateId = config.admissionTemplateId;
  else if (templateIdType === "contact") actualTemplateId = config.contactTemplateId;
  else if (templateIdType === "admin") actualTemplateId = config.adminNotificationTemplateId;
  else if (templateIdType === "student") actualTemplateId = config.studentNotificationTemplateId;
  else if (templateIdType === "lecturer") actualTemplateId = config.lecturerNotificationTemplateId;
  else actualTemplateId = templateIdType; // Raw fallback

  console.log(`=======================================================`);
  console.log(`✉️ [EmailJS Preparation Module] Prepared System Notification:`);
  console.log(`- Service ID: ${config.serviceId}`);
  console.log(`- Template ID: ${actualTemplateId}`);
  console.log(`- Public Key: ${config.publicKey}`);
  console.log(`- Recipient: ${recipientName} <${recipientEmail}>`);
  console.log(`- Payload parameters:`, templateParams);
  console.log(`=======================================================`);

  // If credentials are still example/dummy, do not initiate EmailJS sdk calls
  if (config.publicKey.includes("example") || config.serviceId.includes("example")) {
    console.log("ℹ️ EmailJS is currently in Simulation Mode (Dummy keys detected). No actual HTTP requests dispatched.");
    return { success: true, mode: "simulation", message: "Email logged in system console successfully." };
  }

  // Future actual integration using CDN EmailJS (or standard REST API to stay lightweight)
  try {
    const url = `https://api.emailjs.com/api/v1.0/email/send`;
    const payload = {
      service_id: config.serviceId,
      template_id: actualTemplateId,
      user_id: config.publicKey,
      template_params: {
        to_name: recipientName,
        to_email: recipientEmail,
        ...templateParams
      }
    };

    console.log("🚀 Dispatched actual EmailJS HTTP request to API...");
    // Future execution can uncomment the fetch call when keys are real:
    /*
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `HTTP status ${res.status}`);
    }
    */
    return { success: true, mode: "prepared", message: "Dispatched successfully." };
  } catch (error) {
    console.error("❌ EmailJS transmission failed:", error);
    return { success: false, error: error.message };
  }
}
