// DIMABIN Management System - Firestore Database Schema & Seeding Module
// Adheres strictly to the official Divine Mandate Bible Institute specifications.

import { db } from './firebase-init.js';

// Define the courses metadata for the Diploma in Theology program
const OFFICIAL_THEOLOGY_COURSES = [
  // First Semester Courses
  {
    courseCode: "THY-101",
    courseTitle: "Christology",
    semester: "First Semester",
    creditUnit: 3,
    description: "A systematic study of the Person, nature, deity, and redemptive work of Jesus Christ as revealed in Scriptures."
  },
  {
    courseCode: "BIB-101",
    courseTitle: "Bibliology",
    semester: "First Semester",
    creditUnit: 3,
    description: "An in-depth study of the origin, inspiration, canonization, preservation, and divine authority of the Holy Scriptures."
  },
  {
    courseCode: "FND-101",
    courseTitle: "Christian Foundation",
    semester: "First Semester",
    creditUnit: 2,
    description: "An analysis of the fundamental doctrines of Christian theology, faith development, and spiritual maturation."
  },
  {
    courseCode: "CTH-101",
    courseTitle: "Faith",
    semester: "First Semester",
    creditUnit: 2,
    description: "The study of the biblical doctrine of faith, examining its nature, mechanism, application, and heroic scriptural templates."
  },
  {
    courseCode: "CTH-102",
    courseTitle: "Prayer",
    semester: "First Semester",
    creditUnit: 2,
    description: "A comprehensive investigation of the theology, protocols, dimensions, and practical disciplines of Christian prayer."
  },
  {
    courseCode: "CTH-103",
    courseTitle: "Fasting",
    semester: "First Semester",
    creditUnit: 2,
    description: "A biblically and historically grounded study of fasting as a spiritual weapon and a means of personal consecration."
  },
  {
    courseCode: "BIB-102",
    courseTitle: "Synoptic Gospel",
    semester: "First Semester",
    creditUnit: 3,
    description: "An analytical study of the Gospels of Matthew, Mark, and Luke, exploring their harmony, unique themes, and theological accents."
  },
  {
    courseCode: "THY-102",
    courseTitle: "Theology",
    semester: "First Semester",
    creditUnit: 3,
    description: "An introductory survey of systematic theology, outlining the methods and divisions of theological analysis."
  },

  // Second Semester Courses
  {
    courseCode: "THY-201",
    courseTitle: "Divinity",
    semester: "Second Semester",
    creditUnit: 3,
    description: "An exploration of the Triune Godhead, examining the attributes, names, character, and eternal plan of the Father, Son, and Holy Spirit."
  },
  {
    courseCode: "THY-202",
    courseTitle: "Anthropology",
    semester: "Second Semester",
    creditUnit: 2,
    description: "The theological study of humanity, covering the creation, moral constitution, fall, total depravity, and eternal destiny of mankind."
  },
  {
    courseCode: "THY-203",
    courseTitle: "Pneumatology",
    semester: "Second Semester",
    creditUnit: 3,
    description: "A systematic study of the Holy Spirit, His divine personhood, operational offices, spiritual gifts, and active ministry in the believer's life."
  },
  {
    courseCode: "THY-204",
    courseTitle: "Ecclesiology",
    semester: "Second Semester",
    creditUnit: 3,
    description: "The study of the Christian Church, its scriptural nature, institutional governance, ordinances, and ultimate redemptive mission."
  },
  {
    courseCode: "LDR-201",
    courseTitle: "Christian Leadership",
    semester: "Second Semester",
    creditUnit: 3,
    description: "Practical and biblical theology of leadership, analyzing character requirements, stewardship principles, and staff coordination strategies."
  },
  {
    courseCode: "MSN-201",
    courseTitle: "Mission",
    semester: "Second Semester",
    creditUnit: 2,
    description: "An examination of God's missionary heart, the historical growth of the global church, and cross-cultural mission methodologies."
  },
  {
    courseCode: "MSN-202",
    courseTitle: "Evangelism",
    semester: "Second Semester",
    creditUnit: 2,
    description: "Practical and apologetic tools for effective soul-winning, street witness, community crusades, and personal gospel communication."
  },
  {
    courseCode: "LDR-202",
    courseTitle: "Discipleship",
    semester: "Second Semester",
    creditUnit: 2,
    description: "The master-plan of spiritual mentoring, centering on Christ's pattern of multiplication, accountability structures, and spiritual multiplication."
  },
  {
    courseCode: "THY-205",
    courseTitle: "Homiletics",
    semester: "Second Semester",
    creditUnit: 3,
    description: "The art, science, and spiritual preparation required for constructing and preaching expository, textual, and topical sermons."
  }
];

// Official DIMABIN Settings template
const DEFAULT_INSTITUTE_SETTINGS = {
  instituteName: "Divine Mandate Bible Institute",
  motto: "Fear of God Without a Mess",
  rector: "Sorinola J.O.",
  email: "olalekan16650@gmail.com",
  phoneNumbers: [
    "08038194611",
    "08138194611",
    "08062186974",
    "08037282082"
  ],
  address: "Divine Mandate Bible Institute Central Campus, Nigeria",
  currentAcademicSession: "2026/2027",
  currentSemester: "First Semester"
};

// Default Academic Session template
const DEFAULT_ACADEMIC_SESSION = {
  sessionId: "2026_2027_first",
  sessionName: "2026/2027",
  semester: "First Semester",
  startDate: "2026-09-01",
  endDate: "2027-01-30",
  registrationStart: "2026-08-01",
  registrationEnd: "2026-09-15",
  examinationStart: "2027-01-15",
  examinationEnd: "2027-01-25",
  resultReleaseDate: "2027-02-10",
  isCurrent: true,
  status: "Active", // Active, Inactive, Archived
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/**
 * Initializes/Seeds the Firestore database with the official DIMABIN metadata,
 * current active academic session, and the entire 17-course curriculum.
 * Safe to call repeatedly; uses merge writes to preserve existing data.
 */
export async function seedFirestoreDatabaseSchema() {
  if (!db) {
    throw new Error("❌ Firestore (db) is not initialized. Ensure firebase-init.js was configured successfully.");
  }

  const { doc, setDoc, collection, writeBatch } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
  
  console.log("🚀 [Firestore Setup] Beginning formal collection structure and seeding operation...");
  const results = { courses: 0, settings: false, session: false };

  try {
    // 1. Seed global settings document
    const settingsDocRef = doc(db, "settings", "institute_settings");
    await setDoc(settingsDocRef, DEFAULT_INSTITUTE_SETTINGS, { merge: true });
    console.log("✅ [Firestore Setup] 'settings/institute_settings' successfully seeded.");
    results.settings = true;

    // 2. Seed active academic session document
    const sessionDocRef = doc(db, "academicSessions", DEFAULT_ACADEMIC_SESSION.sessionId);
    await setDoc(sessionDocRef, DEFAULT_ACADEMIC_SESSION, { merge: true });
    console.log(`✅ [Firestore Setup] 'academicSessions/${DEFAULT_ACADEMIC_SESSION.sessionId}' successfully seeded.`);
    results.session = true;

    // 3. Seed official 17 theology courses
    const batch = writeBatch(db);
    for (const course of OFFICIAL_THEOLOGY_COURSES) {
      const courseDocRef = doc(db, "courses", course.courseCode);
      const courseData = {
        ...course,
        lecturerId: null, // Initialized to null as facilitators will be assigned later
        createdAt: new Date().toISOString()
      };
      batch.set(courseDocRef, courseData, { merge: true });
    }
    await batch.commit();
    console.log(`✅ [Firestore Setup] 'courses' collection successfully populated with ${OFFICIAL_THEOLOGY_COURSES.length} official subjects.`);
    results.courses = OFFICIAL_THEOLOGY_COURSES.length;

    console.log("🌟 [Firestore Setup] Database setup and schema preparation finished successfully!");
    return { success: true, results };
  } catch (error) {
    console.error("❌ [Firestore Setup] Database seeding failed:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Formal documentation of the Firestore collection layout and document models
 * for developers and the application modules.
 */
export const FirestoreSchemaRegistry = {
  admins: {
    collectionPath: "admins",
    description: "Designated institutional operators with central management system credentials.",
    documentId: "adminId (e.g., 'DIMABIN/ADM/2026/01')",
    modelFields: {
      adminId: "String - Central unique administrator identification parameter",
      fullName: "String - Registered administrator full name",
      email: "String - Central institutional communication email address",
      phone: "String - System administrator contact telephone number",
      role: "String - Operational access tier ('Super Admin', 'Admin', 'Registrar')",
      passwordHash: "String - Secure cryptographically-hashed passcode representation",
      createdAt: "String (ISO 8601) - Document creation timestamp coordinate",
      lastLogin: "String (ISO 8601) - Last logged session transaction date",
      status: "String - Current state authorization status ('Active', 'Inactive')"
    }
  },
  
  lecturers: {
    collectionPath: "lecturers",
    description: "Academic facilitators, researchers, and theological guides.",
    documentId: "lecturerId (e.g., 'DIMABIN/FAC/2026/01')",
    modelFields: {
      lecturerId: "String - Facuty member identifier",
      title: "String - Formal honorific title (e.g., 'Rev.', 'Dr.', 'Pastor')",
      fullName: "String - Registered facilitator name credentials",
      gender: "String - Gender identity parameter",
      phone: "String - Direct facilitator phone coordinate",
      email: "String - Primary facilitator email contact",
      address: "String - Residential location description",
      qualification: "String - Faculy member academic degree and ministerial endorsements",
      coursesAssigned: "Array of Strings - Codes matching courses they are authorized to facilitate",
      employmentDate: "String (ISO Date) - Date of employment",
      status: "String - Status level ('Active', 'On Leave', 'Inactive')",
      createdAt: "String (ISO 8601) - Record registration date"
    }
  },

  students: {
    collectionPath: "students",
    description: "Registered learners currently undergoing theological training paths.",
    documentId: "studentId (e.g., 'DIMABIN/STU/2026/102')",
    modelFields: {
      studentId: "String - Unique student profile index parameter",
      matricNumber: "String - Matriculation register identity format",
      fullName: "String - Registered student name",
      gender: "String - Gender identity designation",
      dateOfBirth: "String (ISO Date) - Date of birth reference",
      phone: "String - Direct student telephone contact",
      email: "String - Primary student communications email",
      address: "String - Student residential coordinates",
      programme: "String - Major program tracking ('Diploma in Theology')",
      academicSession: "String - Session of enrollment reference (e.g. '2026/2027')",
      semester: "String - Current active semester tracking ('First Semester', 'Second Semester')",
      passportUrl: "String - Secure cloud image path URL for identity passport",
      status: "String - Student academic standing ('Active', 'Suspended', 'Graduated')",
      createdAt: "String (ISO 8601) - Document creation time"
    }
  },

  applications: {
    collectionPath: "applications",
    description: "Incoming applications submitted for academic enrollment consideration.",
    documentId: "applicationNumber (e.g., 'DIMABIN/APP/2026/0045')",
    modelFields: {
      applicationNumber: "String - Unique application index identifier",
      fullName: "String - Prospective student name",
      gender: "String - Gender designation",
      phone: "String - Prospect telephone contact coordinate",
      email: "String - Prospect contact email address",
      address: "String - Prospect residential description",
      programme: "String - Target program field ('Diploma in Theology')",
      submittedAt: "String (ISO 8601) - Time application was received",
      admissionStatus: "String - Review state ('Pending', 'Approved', 'Rejected')",
      reviewedBy: "String - ID reference of reviewing administrator, or null",
      remarks: "String - Evaluator notes, comments, or follow-up feedback details"
    }
  },

  courses: {
    collectionPath: "courses",
    description: "Theology courses matching the official Diploma in Theology curricula.",
    documentId: "courseCode (e.g., 'THY-101')",
    modelFields: {
      courseCode: "String - Unique catalog code",
      courseTitle: "String - Formal course heading",
      semester: "String - Study term categorization ('First Semester', 'Second Semester')",
      creditUnit: "Number - Credit unit weighting value (e.g. 2, 3)",
      description: "String - Detailed course catalog description outline",
      lecturerId: "String - Staff ID reference of assigned instructor, or null",
      createdAt: "String (ISO 8601) - Record creation time"
    }
  },

  results: {
    collectionPath: "results",
    description: "Student cumulative academic performance score matrices.",
    documentId: "studentId_courseCode_sessionId",
    modelFields: {
      studentId: "String - Target student ID matching the students collection",
      courseCode: "String - Target course catalog code matching the courses collection",
      score: "Number - Accumulated marks achieved (0 to 100)",
      grade: "String - Computed grade letter score (e.g., 'A', 'B', 'C', 'D', 'F')",
      semester: "String - Semester of result evaluation ('First Semester', 'Second Semester')",
      academicSession: "String - Academic session code reference (e.g. '2026/2027')",
      uploadedBy: "String - ID of the lecturer/administrator who submitted the scores",
      uploadedAt: "String (ISO 8601) - Upload timestamp log coordinate"
    }
  },

  notifications: {
    collectionPath: "notifications",
    description: "Administrative announcements and board broadcasts for portal users.",
    documentId: "Auto-generated UUID document identifier",
    modelFields: {
      title: "String - Broadcast message header",
      message: "String - Editorial broadcast message content",
      audience: "String - Recipient tier indicator ('all', 'students', 'lecturers')",
      createdBy: "String - ID of dispatching admin operator",
      createdAt: "String (ISO 8601) - Dispatch timestamp log",
      status: "String - Visibility state status ('Active', 'Archived')"
    }
  },

  settings: {
    collectionPath: "settings",
    description: "Global metadata variables managing central system defaults.",
    documentId: "institute_settings (Single Document Configuration)",
    modelFields: {
      instituteName: "String - Divine Mandate Bible Institute legal name",
      motto: "String - Institutional motto code",
      rector: "String - Serving Rector name reference",
      email: "String - Primary contact email address",
      phoneNumbers: "Array of Strings - Authorized help desk coordinates",
      address: "String - Institutional central campus location details",
      currentAcademicSession: "String - Session identifier controlling automatic workflows",
      currentSemester: "String - Active semester parameter ('First Semester', 'Second Semester')"
    }
  },

  academicSessions: {
    collectionPath: "academicSessions",
    description: "Calendar milestones controlling registrations, lecture spans, exams, and results.",
    documentId: "sessionId (e.g., '2026_2027_first')",
    modelFields: {
      sessionId: "String - ID matching the target academic session and semester",
      sessionName: "String - Text representation (e.g. '2026/2027')",
      semester: "String - Active semester scope ('First Semester', 'Second Semester')",
      startDate: "String (ISO Date) - Semester term start date",
      endDate: "String (ISO Date) - Semester term end date",
      registrationStart: "String (ISO Date) - Course registration start date",
      registrationEnd: "String (ISO Date) - Course registration closing milestone",
      examinationStart: "String (ISO Date) - Academic examination opening milestone",
      examinationEnd: "String (ISO Date) - Academic examination closing milestone",
      resultReleaseDate: "String (ISO Date) - Date results are approved for publication",
      isCurrent: "Boolean - Status indicator for the active system-wide timeline session",
      status: "String - Execution status ('Active', 'Inactive', 'Archived')",
      createdAt: "String (ISO 8601) - Record date of registration",
      updatedAt: "String (ISO 8601) - Last timestamp log update"
    }
  }
};
