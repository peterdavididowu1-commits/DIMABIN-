import { db, auth } from './firebase-init.js';

// Import Firebase SDK Firestore and Auth libraries
const {
  collection, doc, getDoc, getDocs, setDoc, query, where, orderBy, limit
} = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
const {
  onAuthStateChanged, signOut
} = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");

const SESSION_KEY = "dimabin_student_session";

let currentStudentDoc = null;
let studentCbtExamsList = [];
let activeCbtExam = null;
let activeCbtQuestions = [];
let currentQuestionIndex = 0;
let studentAnswers = {};
let flaggedQuestions = new Set();
let cbtTimerInterval = null;
let cbtSecondsLeft = 0;

// Initialize Toast alert helper on window if not present
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

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.style.animation = "fadeOut 0.5s ease forwards";
    setTimeout(() => {
      if (toast.parentNode === container) {
        container.removeChild(toast);
      }
    }, 500);
  }, 4000);
};

// Monitor Authentication State
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const q = query(collection(db, "students"), where("email", "==", user.email));
      const snap = await getDocs(q);
      
      if (!snap.empty) {
        currentStudentDoc = { id: snap.docs[0].id, ...snap.docs[0].data() };
        
        // Save session locally for persistence safety
        const sessionData = {
          matricNumber: currentStudentDoc.matricNumber,
          studentId: currentStudentDoc.studentId,
          fullName: currentStudentDoc.fullName,
          email: currentStudentDoc.email
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
        
        showDashboardView();
      } else {
        checkLocalStorageSession();
      }
    } catch (err) {
      console.error("Auth observer sync error:", err);
      checkLocalStorageSession();
    }
  } else {
    checkLocalStorageSession();
  }
});

// Fallback session checks
async function checkLocalStorageSession() {
  const localData = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      const q = query(collection(db, "students"), where("studentId", "==", parsed.studentId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        currentStudentDoc = { id: snap.docs[0].id, ...snap.docs[0].data() };
        showDashboardView();
        return;
      }
    } catch (err) {
      console.error("Failed to read student details from localStorage fallback:", err);
    }
  }
  showAnonymousView();
}

function showDashboardView() {
  document.getElementById("anonymousCbtView").style.display = "none";
  document.getElementById("authenticatedCbtView").style.display = "block";
  
  // Update header widgets
  document.getElementById("studentNameDisplay").textContent = currentStudentDoc.fullName || "Student Name";
  document.getElementById("studentEmailDisplay").textContent = currentStudentDoc.email || "No Registered Email";
  document.getElementById("studentIdDisplay").textContent = currentStudentDoc.studentId || "STU/ID";
  document.getElementById("matricNumberDisplay").textContent = currentStudentDoc.matricNumber || "MATRIC";
  document.getElementById("studentSessionDisplay").textContent = currentStudentDoc.academicSession || "2026/2027";
  
  // Render available list mapping registered courses
  renderCbtLists();
}

function showAnonymousView() {
  document.getElementById("authenticatedCbtView").style.display = "none";
  document.getElementById("anonymousCbtView").style.display = "block";
}

// Map and Render lists of CBT Exams
async function renderCbtLists() {
  const activeContainer = document.getElementById("activeExamsContainer");
  const completedContainer = document.getElementById("completedExamsContainer");
  const upcomingContainer = document.getElementById("upcomingExamsContainer");

  try {
    // 1. Fetch registrations for student courses
    const regQuery = query(collection(db, "registrations"), where("studentId", "==", currentStudentDoc.studentId));
    const regSnap = await getDocs(regQuery);
    
    let registeredCourses = [];
    regSnap.forEach(d => {
      const data = d.data();
      if (Array.isArray(data.registeredCourses)) {
        data.registeredCourses.forEach(code => {
          if (!registeredCourses.includes(code)) {
            registeredCourses.push(code);
          }
        });
      }
    });

    if (registeredCourses.length === 0) {
      const emptyMsg = `
        <div style="text-align: center; padding: 2.5rem; color: var(--text-muted); width: 100%;">
          <i class="fa-solid fa-calendar-xmark" style="font-size: 2.5rem; opacity: 0.3; display: block; margin-bottom: 0.5rem; color: var(--primary);"></i>
          <h4 style="font-weight: 700; color: var(--primary-dark); margin: 0 0 0.25rem 0;">No CBT Assessments Scheduled</h4>
          <p style="font-size: 0.82rem; margin: 0;">You have not registered for any courses in this session or semester yet.</p>
        </div>
      `;
      activeContainer.innerHTML = emptyMsg;
      completedContainer.innerHTML = `<div style="padding: 1.5rem; text-align: center; width: 100%; color: var(--text-muted); font-size: 0.9rem;">No completed examination logs.</div>`;
      upcomingContainer.innerHTML = `<div style="padding: 1.5rem; text-align: center; width: 100%; color: var(--text-muted); font-size: 0.9rem;">No upcoming examinations scheduled.</div>`;
      return;
    }

    // Load courses metadata
    const coursesSnap = await getDocs(collection(db, "courses"));
    const coursesMap = {};
    coursesSnap.forEach(doc => {
      const data = doc.data();
      coursesMap[data.courseCode] = data.courseTitle || data.title || "";
    });

    // Load lecturers metadata
    const lecturersSnap = await getDocs(collection(db, "lecturers"));
    const lecturersMap = {};
    lecturersSnap.forEach(doc => {
      const data = doc.data();
      lecturersMap[data.lecturerId] = data.fullName || data.name || "N/A";
    });

    // Load questions cache to compute total possible marks
    const questionsSnap = await getDocs(collection(db, "cbtQuestions"));
    const examQuestionsMap = {};
    questionsSnap.forEach(doc => {
      const q = doc.data();
      const key = `${q.courseCode}_${q.academicSession}_${q.semester}`;
      if (!examQuestionsMap[key]) {
        examQuestionsMap[key] = [];
      }
      examQuestionsMap[key].push({ id: doc.id, ...q });
    });

    // Fetch published exams
    const examSnap = await getDocs(query(collection(db, "cbtExams"), where("status", "==", "Published")));
    const publishedExams = examSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filter matching courses
    studentCbtExamsList = publishedExams.filter(ex => registeredCourses.includes(ex.courseCode));

    if (studentCbtExamsList.length === 0) {
      const emptyMsg = `
        <div style="text-align: center; padding: 4rem 2rem; color: var(--text-muted); background: white; border-radius: var(--border-radius-lg); border: 1.5px solid var(--border-color); width: 100%;">
          <i class="fa-solid fa-calendar-xmark" style="font-size: 3.5rem; opacity: 0.3; display: block; margin-bottom: 1rem; color: var(--primary);"></i>
          <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--primary-dark); margin-bottom: 0.25rem;">No Published Examinations Available</h3>
          <p style="font-size: 0.88rem; max-width: 420px; margin: 0 auto; line-height: 1.5;">No CBT examination is currently available for your registered courses.</p>
        </div>
      `;
      activeContainer.innerHTML = emptyMsg;
      completedContainer.innerHTML = `<div style="padding: 1.5rem; text-align: center; width: 100%; color: var(--text-muted); font-size: 0.9rem;">No completed examination logs.</div>`;
      upcomingContainer.innerHTML = `<div style="padding: 1.5rem; text-align: center; width: 100%; color: var(--text-muted); font-size: 0.9rem;">No upcoming examinations scheduled.</div>`;
      return;
    }

    let activeHtml = "";
    let completedHtml = "";
    let upcomingHtml = "";

    let activeCount = 0;
    let completedCount = 0;
    let upcomingCount = 0;

    for (const ex of studentCbtExamsList) {
      const resDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${ex.id}`;
      const resSnap = await getDoc(doc(db, "cbtResults", resDocId));
      const hasCompleted = resSnap.exists();
      const completedData = hasCompleted ? resSnap.data() : null;

      const now = new Date();
      const startDate = new Date(ex.startDate);
      const endDate = new Date(ex.endDate);

      const isUpcoming = now < startDate;
      const isPast = now > endDate;
      const isOpen = !isUpcoming && !isPast;

      // Calculate total marks based on question bank
      const examKey = `${ex.courseCode}_${ex.academicSession}_${ex.semester}`;
      const examQs = examQuestionsMap[examKey] || [];
      let totalMarks = 0;
      if (examQs.length > 0) {
        const limitCount = Math.min(ex.numQuestions, examQs.length);
        for (let i = 0; i < limitCount; i++) {
          totalMarks += (examQs[i].marks || 1);
        }
      } else {
        totalMarks = ex.numQuestions * 1;
      }

      const courseTitle = coursesMap[ex.courseCode] || "Course Title Not Found";
      const lecturerName = lecturersMap[ex.lecturerId] || "Lecturer Not Specified";

      const cardHtml = `
        <div class="exam-card ${hasCompleted ? 'completed' : (isUpcoming ? 'upcoming' : 'live')}">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
              <span class="exam-badge ${hasCompleted ? 'badge-completed' : (isUpcoming ? 'badge-upcoming' : 'badge-live')}">
                ${hasCompleted ? 'Completed' : (isUpcoming ? 'Upcoming' : 'Live')}
              </span>
              <span style="font-weight: 800; font-size: 0.72rem; color: var(--primary); background-color: var(--bg-slate); padding: 0.15rem 0.4rem; border-radius: 4px;">
                ${ex.courseCode}
              </span>
            </div>

            <div class="exam-title-row">
              <h4 class="exam-title">${escapeHtml(ex.title)}</h4>
              <p class="exam-course-title">${escapeHtml(courseTitle)}</p>
            </div>

            <div class="exam-details-row">
              <div class="exam-detail-item">
                <i class="fa-solid fa-chalkboard-user"></i>
                <span style="font-size: 0.75rem; font-weight: 600;">Lecturer:</span>
                <span style="font-size: 0.75rem; display: block; font-weight: 700; color: var(--primary);">${escapeHtml(lecturerName)}</span>
              </div>
              <div class="exam-detail-item">
                <i class="fa-solid fa-hourglass-half"></i>
                <span style="font-size: 0.75rem; font-weight: 600;">Duration:</span>
                <span style="font-size: 0.75rem; display: block; font-weight: 700; color: var(--primary);">${ex.duration} Mins</span>
              </div>
              <div class="exam-detail-item" style="margin-top: 0.5rem;">
                <i class="fa-solid fa-circle-question"></i>
                <span style="font-size: 0.75rem; font-weight: 600;">Questions:</span>
                <span style="font-size: 0.75rem; display: block; font-weight: 700; color: var(--primary);">${ex.numQuestions} Questions</span>
              </div>
              <div class="exam-detail-item" style="margin-top: 0.5rem;">
                <i class="fa-solid fa-star"></i>
                <span style="font-size: 0.75rem; font-weight: 600;">Total Marks:</span>
                <span style="font-size: 0.75rem; display: block; font-weight: 700; color: var(--primary);">${totalMarks} Marks</span>
              </div>
            </div>
            
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.4;">
              <i class="fa-solid fa-calendar-days" style="color: var(--accent); margin-right: 4px;"></i> 
              Scheduled: <strong>${new Date(ex.startDate).toLocaleString(undefined, {dateStyle: 'short', timeStyle: 'short'})}</strong> 
              to <strong>${new Date(ex.endDate).toLocaleString(undefined, {dateStyle: 'short', timeStyle: 'short'})}</strong>
            </div>
          </div>

          <div class="exam-footer-action">
            ${hasCompleted ? `
              <div style="background-color: rgba(40,167,69,0.06); border: 1px solid rgba(40,167,69,0.2); padding: 0.5rem; border-radius: 6px; text-align: center;">
                <span style="font-size: 0.8rem; font-weight: 700; color: #28a745;">
                  <i class="fa-solid fa-circle-check"></i> Score: ${completedData.score} / ${completedData.totalQuestions} (${completedData.percentage}%) [${completedData.grade}]
                </span>
              </div>
            ` : (isUpcoming ? `
              <div style="background-color: rgba(244,176,0,0.06); border: 1px solid rgba(244,176,0,0.2); padding: 0.5rem; border-radius: 6px; text-align: center;">
                <span style="font-size: 0.78rem; font-weight: 700; color: #b77a00;">
                  <i class="fa-solid fa-lock"></i> Opens on Scheduled Time
                </span>
              </div>
            ` : (isOpen ? `
              <button class="btn-start-exam btn-start-cbt-exam" data-id="${ex.id}" style="background-color: #1F3B82; color: white;">
                <i class="fa-solid fa-circle-play"></i> START EXAMINATION
              </button>
            ` : `
              <div style="background-color: rgba(220,53,69,0.06); border: 1px solid rgba(220,53,69,0.2); padding: 0.5rem; border-radius: 6px; text-align: center;">
                <span style="font-size: 0.78rem; font-weight: 700; color: #dc3545;">
                  <i class="fa-solid fa-circle-xmark"></i> Exam Closed / Overdue
                </span>
              </div>
            `))}
          </div>
        </div>
      `;

      if (hasCompleted) {
        completedHtml += cardHtml;
        completedCount++;
      } else if (isUpcoming) {
        upcomingHtml += cardHtml;
        upcomingCount++;
      } else if (isOpen) {
        activeHtml += cardHtml;
        activeCount++;
      } else {
        completedHtml += cardHtml; // Closed exams can sit in completed/closed section
        completedCount++;
      }
    }

    activeContainer.innerHTML = activeHtml || `
      <div style="padding: 2.5rem; text-align: center; width: 100%; color: var(--text-muted); background: white; border-radius: 8px; border: 1.5px solid var(--border-color);">
        <i class="fa-solid fa-circle-exclamation" style="font-size: 2rem; color: var(--primary); margin-bottom: 0.5rem; opacity: 0.3;"></i>
        <p style="font-weight: 600; margin: 0; font-size: 0.9rem;">No active examinations are live at this time.</p>
      </div>
    `;

    completedContainer.innerHTML = completedHtml || `
      <div style="padding: 2.5rem; text-align: center; width: 100%; color: var(--text-muted); background: white; border-radius: 8px; border: 1.5px solid var(--border-color);">
        <p style="margin: 0; font-size: 0.9rem;">No completed examination records found.</p>
      </div>
    `;

    upcomingContainer.innerHTML = upcomingHtml || `
      <div style="padding: 2.5rem; text-align: center; width: 100%; color: var(--text-muted); background: white; border-radius: 8px; border: 1.5px solid var(--border-color);">
        <p style="margin: 0; font-size: 0.9rem;">No upcoming examinations scheduled.</p>
      </div>
    `;

    // Bind Start Exam button listeners
    document.querySelectorAll(".btn-start-cbt-exam").forEach(btn => {
      btn.addEventListener("click", () => {
        const examId = btn.getAttribute("data-id");
        const selectedExam = studentCbtExamsList.find(x => x.id === examId);
        if (selectedExam) {
          openExamInstructionsModal(selectedExam);
        }
      });
    });

  } catch (err) {
    console.error("Error fetching CBT listings:", err);
    activeContainer.innerHTML = `<div style="color: var(--danger-color); font-weight: 700; padding: 1rem;">Database link failed: ${err.message}</div>`;
  }
}

// Open Instructions Modal prior to launching exam
function openExamInstructionsModal(exam) {
  activeCbtExam = exam;

  document.getElementById("cbtModalTitle").textContent = exam.title;
  document.getElementById("cbtModalCourseCode").textContent = exam.courseCode;
  document.getElementById("cbtModalDuration").textContent = `${exam.duration} minutes`;
  document.getElementById("cbtModalQuestions").textContent = `${exam.numQuestions} Multiple-Choice Questions`;

  const modal = document.getElementById("cbtInstructionsModal");
  if (modal) modal.style.display = "flex";
}

// Bind Instructions Modal Controls
document.getElementById("btnCbtCloseModal")?.addEventListener("click", () => {
  const modal = document.getElementById("cbtInstructionsModal");
  if (modal) modal.style.display = "none";
  activeCbtExam = null;
});

document.getElementById("btnCbtConfirmStart")?.addEventListener("click", async () => {
  const modal = document.getElementById("cbtInstructionsModal");
  if (modal) modal.style.display = "none";

  if (activeCbtExam) {
    await initializeActiveExam();
  }
});

// Fetch and load questions, then launch full-screen focused interface
async function initializeActiveExam() {
  if (!activeCbtExam) return;

  // 1. Double check session completion status prior to start
  const resDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;
  const resSnap = await getDoc(doc(db, "cbtResults", resDocId));
  if (resSnap.exists()) {
    alert("⚠️ Security Violation: You have already completed this examination. Re-entry is strictly prohibited.");
    return;
  }

  const now = new Date();
  const startDate = new Date(activeCbtExam.startDate);
  const endDate = new Date(activeCbtExam.endDate);
  if (now < startDate || now > endDate || activeCbtExam.status !== "Published") {
    alert("⚠️ Security Violation: This examination is currently inactive, closed, or unpublished.");
    return;
  }

  // 2. Log Start Attempt
  const attemptDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;
  try {
    await setDoc(doc(db, "cbtAttempts", attemptDocId), {
      studentId: currentStudentDoc.studentId,
      studentName: currentStudentDoc.fullName,
      examId: activeCbtExam.id,
      courseCode: activeCbtExam.courseCode,
      startedAt: new Date().toISOString(),
      status: "started"
    }, { merge: true });
  } catch (err) {
    console.error("Failed to write cbt attempt tracker log:", err);
  }

  window.showToast("Cataloging test questions from cloud bank...", "info");

  try {
    // 3. Fetch Syllabus Questions
    const qSnap = await getDocs(query(
      collection(db, "cbtQuestions"),
      where("courseCode", "==", activeCbtExam.courseCode),
      where("academicSession", "==", activeCbtExam.academicSession),
      where("semester", "==", activeCbtExam.semester)
    ));

    const rawQuestions = qSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (rawQuestions.length < activeCbtExam.numQuestions) {
      alert(`⚠️ Course Syllabus Question Deficit!\n\nThe examination demands ${activeCbtExam.numQuestions} questions, but only ${rawQuestions.length} questions exist in the course question bank.\n\nPlease contact your course lecturer or coordinator.`);
      return;
    }

    // 4. Randomize and Subset
    let chosenQuestions = [...rawQuestions];
    if (activeCbtExam.randomizeQuestions) {
      shuffleCbtArray(chosenQuestions);
    }
    activeCbtQuestions = chosenQuestions.slice(0, activeCbtExam.numQuestions);

    // 5. Restore cache or clear state
    studentAnswers = {};
    flaggedQuestions.clear();

    const answerDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;
    const ansSnap = await getDoc(doc(db, "cbtAnswers", answerDocId));
    if (ansSnap.exists()) {
      studentAnswers = ansSnap.data().answers || {};
      window.showToast("Resumed from cloud-saved progression.", "success");
    } else {
      const localCache = localStorage.getItem(`cbt_temp_answers_${activeCbtExam.id}`);
      if (localCache) {
        try {
          studentAnswers = JSON.parse(localCache);
        } catch (e) {
          studentAnswers = {};
        }
      }
    }

    currentQuestionIndex = 0;

    // Set interactive labels
    document.getElementById("activeExamCourseBadge").textContent = activeCbtExam.courseCode;
    document.getElementById("activeExamTitle").textContent = activeCbtExam.title;

    // Start Clock
    cbtSecondsLeft = activeCbtExam.duration * 60;
    startCbtTimer();

    // Toggle Focus full-screen UI
    toggleCbtFocusLayout(true);

    // Initial renders
    renderCbtQuestionAndChoices();
    renderCbtMatrixGrid();

  } catch (err) {
    console.error("Initialize exam failure error:", err);
    window.showToast("Failed to compile examination data: " + err.message, "error");
  }
}

// Fullscreen focus toggles
function toggleCbtFocusLayout(isFocusOn) {
  const header = document.querySelector("header");
  const hero = document.querySelector(".portal-hero");
  const profileCard = document.querySelector(".profile-summary-card");
  const cbtDashboard = document.getElementById("cbtDashboardView");
  const cbtActiveScreen = document.getElementById("cbtActiveExamScreen");
  const footer = document.querySelector("footer");

  if (isFocusOn) {
    if (header) header.style.display = "none";
    if (hero) hero.style.display = "none";
    if (profileCard) profileCard.style.display = "none";
    if (cbtDashboard) cbtDashboard.style.display = "none";
    if (footer) footer.style.display = "none";
    if (cbtActiveScreen) cbtActiveScreen.style.display = "block";
  } else {
    if (header) header.style.display = "block";
    if (hero) hero.style.display = "block";
    if (profileCard) profileCard.style.display = "flex";
    if (cbtDashboard) cbtDashboard.style.display = "block";
    if (footer) footer.style.display = "block";
    if (cbtActiveScreen) cbtActiveScreen.style.display = "none";
  }
}

// Timer loops
function startCbtTimer() {
  if (cbtTimerInterval) clearInterval(cbtTimerInterval);
  updateCbtTimerDisplay();

  cbtTimerInterval = setInterval(() => {
    cbtSecondsLeft--;
    updateCbtTimerDisplay();

    // Warning at 5 minutes
    if (cbtSecondsLeft === 300) {
      alert("⚠️ Warning: Only 5 minutes remaining on your timer!");
    }

    if (cbtSecondsLeft <= 0) {
      clearInterval(cbtTimerInterval);
      alert("⏱️ Time is up! Your responses are being submitted automatically.");
      submitExamination(true);
    }
  }, 1000);
}

function updateCbtTimerDisplay() {
  const timerBox = document.getElementById("cbtExamTimer");
  if (!timerBox) return;

  const h = Math.floor(cbtSecondsLeft / 3600);
  const m = Math.floor((cbtSecondsLeft % 3600) / 60);
  const s = cbtSecondsLeft % 60;

  const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  timerBox.textContent = formatted;

  if (cbtSecondsLeft < 120) {
    timerBox.style.color = "#DC3545";
  } else {
    timerBox.style.color = "var(--accent)";
  }
}

// Render active question details
function renderCbtQuestionAndChoices() {
  if (activeCbtQuestions.length === 0) return;

  const q = activeCbtQuestions[currentQuestionIndex];
  
  document.getElementById("activeQuestionIndexText").textContent = `Question ${currentQuestionIndex + 1} of ${activeCbtQuestions.length}`;
  document.getElementById("activeQuestionMarksText").textContent = `${q.marks || 1} Marks`;
  document.getElementById("activeQuestionText").textContent = q.question;

  const container = document.getElementById("cbtOptionsContainer");
  if (!container) return;

  const currentSelection = studentAnswers[q.id] || "";
  const qType = q.qType || "MCQ";

  if (qType === "SA") {
    container.innerHTML = `
      <div style="width: 100%; padding: 0.5rem 0;">
        <label style="font-size: 0.75rem; font-weight: 700; color: var(--primary); text-transform: uppercase; display: block; margin-bottom: 0.5rem;">Your Answer Text (Exact string comparison):</label>
        <input type="text" id="cbt_sa_input" class="form-control" placeholder="Type your answer here..." value="${escapeHtml(currentSelection)}" style="width: 100%; padding: 1rem; font-family: 'Poppins'; font-size: 1rem; border-radius: 6px; border: 1.5px solid var(--border-color);">
      </div>
    `;

    const saInput = document.getElementById("cbt_sa_input");
    saInput.addEventListener("input", (e) => {
      studentAnswers[q.id] = e.target.value;
      syncStudentAnswers();
    });

  } else if (qType === "Essay") {
    container.innerHTML = `
      <div style="width: 100%; padding: 0.5rem 0;">
        <label style="font-size: 0.75rem; font-weight: 700; color: var(--primary); text-transform: uppercase; display: block; margin-bottom: 0.5rem;">Your Essay Response:</label>
        <textarea id="cbt_essay_input" class="form-control" rows="8" placeholder="Type your full structured answer text here..." style="width: 100%; padding: 1rem; font-family: 'Poppins'; font-size: 0.95rem; border-radius: 6px; border: 1.5px solid var(--border-color); resize: vertical;">${escapeHtml(currentSelection)}</textarea>
      </div>
    `;

    const essayInput = document.getElementById("cbt_essay_input");
    essayInput.addEventListener("input", (e) => {
      studentAnswers[q.id] = e.target.value;
      syncStudentAnswers();
    });

  } else {
    let choices = [];
    if (qType === "TF") {
      choices = [
        { key: "A", text: "True" },
        { key: "B", text: "False" }
      ];
    } else {
      choices = [
        { key: "A", text: q.optionA || "" },
        { key: "B", text: q.optionB || "" },
        { key: "C", text: q.optionC || "" },
        { key: "D", text: q.optionD || "" }
      ].filter(opt => opt.text !== "");
    }

    container.innerHTML = choices.map(opt => {
      const isChecked = currentSelection === opt.key;
      return `
        <label class="cbt-option-card ${isChecked ? 'active' : ''}" style="display: flex; align-items: center; gap: 1rem; padding: 1rem 1.25rem; border: 1.5px solid ${isChecked ? 'var(--primary)' : 'var(--border-color)'}; background-color: ${isChecked ? 'rgba(31,59,130,0.04)' : 'transparent'}; border-radius: var(--border-radius-md); cursor: pointer; transition: all 0.2s; margin-bottom: 0.5rem; width: 100%;">
          <input type="radio" name="cbt_answer" value="${opt.key}" ${isChecked ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--primary);">
          <span style="font-weight: 700; color: ${isChecked ? 'white' : 'var(--primary)'}; font-size: 1rem; background-color: ${isChecked ? 'var(--primary)' : 'var(--bg-slate)'}; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%;">${opt.key}</span>
          <span style="font-size: 0.95rem; font-weight: 500; color: var(--text-dark);">${escapeHtml(opt.text)}</span>
        </label>
      `;
    }).join("");

    const inputs = container.querySelectorAll('input[name="cbt_answer"]');
    inputs.forEach(input => {
      input.addEventListener("change", (e) => {
        studentAnswers[q.id] = e.target.value;
        syncStudentAnswers();

        container.querySelectorAll(".cbt-option-card").forEach(lbl => {
          lbl.style.border = "1.5px solid var(--border-color)";
          lbl.style.backgroundColor = "transparent";
          lbl.classList.remove("active");
          const badge = lbl.querySelector("span:nth-of-type(1)");
          badge.style.backgroundColor = "var(--bg-slate)";
          badge.style.color = "var(--primary)";
        });

        const selectedLabel = e.target.closest(".cbt-option-card");
        if (selectedLabel) {
          selectedLabel.style.border = "1.5px solid var(--primary)";
          selectedLabel.style.backgroundColor = "rgba(31,59,130,0.04)";
          selectedLabel.classList.add("active");
          const badge = selectedLabel.querySelector("span:nth-of-type(1)");
          badge.style.backgroundColor = "var(--primary)";
          badge.style.color = "white";
        }
      });
    });
  }

  document.getElementById("btnCbtPrev").disabled = currentQuestionIndex === 0;
  document.getElementById("btnCbtPrev").style.opacity = currentQuestionIndex === 0 ? "0.4" : "1";
  
  const isLast = currentQuestionIndex === activeCbtQuestions.length - 1;
  document.getElementById("btnCbtNext").innerHTML = isLast ? `Finish <i class="fa-solid fa-flag-checkered"></i>` : `Next <i class="fa-solid fa-circle-arrow-right"></i>`;
}

function syncStudentAnswers() {
  localStorage.setItem(`cbt_temp_answers_${activeCbtExam.id}`, JSON.stringify(studentAnswers));

  const answerDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;
  setDoc(doc(db, "cbtAnswers", answerDocId), {
    studentId: currentStudentDoc.studentId,
    examId: activeCbtExam.id,
    answers: studentAnswers,
    lastUpdated: new Date().toISOString()
  }, { merge: true }).catch(err => {
    console.error("Failed to sync student answers:", err);
  });

  renderCbtMatrixGrid();
}

function renderCbtMatrixGrid() {
  const grid = document.getElementById("cbtMatrixGrid");
  if (!grid) return;

  grid.innerHTML = activeCbtQuestions.map((q, idx) => {
    const isAnswered = !!studentAnswers[q.id];
    const isFlagged = flaggedQuestions.has(idx);
    const isCurrent = idx === currentQuestionIndex;

    let bgColor = "var(--bg-slate)";
    let textColor = "var(--text-dark)";
    let borderColor = "var(--border-color)";

    if (isAnswered) {
      bgColor = "var(--primary)";
      textColor = "white";
      borderColor = "var(--primary)";
    }
    if (isFlagged) {
      bgColor = "#F4B000";
      textColor = "var(--primary-dark)";
      borderColor = "#F4B000";
    }

    return `
      <button class="btn" data-idx="${idx}" style="background-color: ${bgColor}; color: ${textColor}; border: 2.5px solid ${borderColor}; height: 38px; width: 38px; padding: 0; font-weight: 800; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.82rem; cursor: pointer; transition: all 0.15s; outline: ${isCurrent ? '3px solid var(--accent)' : 'none'};">
        ${idx + 1}
      </button>
    `;
  }).join("");

  grid.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"));
      jumpToQuestion(idx);
    });
  });
}

function jumpToQuestion(idx) {
  if (idx < 0 || idx >= activeCbtQuestions.length) return;
  currentQuestionIndex = idx;
  renderCbtQuestionAndChoices();
  renderCbtMatrixGrid();
}

// Bind navigation keys
document.getElementById("btnCbtPrev")?.addEventListener("click", () => {
  if (currentQuestionIndex > 0) {
    jumpToQuestion(currentQuestionIndex - 1);
  }
});

document.getElementById("btnCbtNext")?.addEventListener("click", () => {
  if (currentQuestionIndex < activeCbtQuestions.length - 1) {
    jumpToQuestion(currentQuestionIndex + 1);
  } else {
    triggerFinalSubmissionRequest();
  }
});

document.getElementById("btnCbtFlag")?.addEventListener("click", () => {
  if (flaggedQuestions.has(currentQuestionIndex)) {
    flaggedQuestions.delete(currentQuestionIndex);
    window.showToast("Question unflagged.", "info");
  } else {
    flaggedQuestions.add(currentQuestionIndex);
    window.showToast("Question flagged for review.", "info");
  }
  renderCbtMatrixGrid();
});

document.getElementById("btnCbtSubmitExam")?.addEventListener("click", () => {
  triggerFinalSubmissionRequest();
});

function triggerFinalSubmissionRequest() {
  const total = activeCbtQuestions.length;
  const answered = Object.keys(studentAnswers).length;
  const unanswered = total - answered;

  let promptMsg = `⚠️ Submit Assessment Check\n\nYou have answered ${answered} out of ${total} questions.\n`;
  if (unanswered > 0) {
    promptMsg += `🚨 Notice: You have ${unanswered} UNANSWERED questions.\n`;
  }
  promptMsg += `\nAre you sure you want to finalize this exam submission? This action is absolute, and no re-takes are permitted.`;

  if (confirm(promptMsg)) {
    submitExamination(false);
  }
}

// Calculations and commits
async function submitExamination(isAutoTimeUp = false) {
  if (cbtTimerInterval) clearInterval(cbtTimerInterval);
  
  toggleCbtFocusLayout(false);

  const activeScreen = document.getElementById("cbtActiveExamScreen");
  if (activeScreen) activeScreen.style.display = "none";

  const resultPanel = document.getElementById("cbtResultReportPanel");
  if (resultPanel) {
    resultPanel.style.display = "block";
    resultPanel.innerHTML = `
      <div style="background: white; border-radius: var(--border-radius-lg); border: 1px solid var(--border-color); box-shadow: var(--shadow-md); padding: 3rem; text-align: center;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 3rem; color: var(--primary); margin-bottom: 1.5rem;"></i>
        <h2>Committing Grade Report...</h2>
        <p style="color: var(--text-muted);">Please do not refresh. Your assessment scores are being synchronized securely in the central academic database.</p>
      </div>
    `;
  }

  let score = 0;
  let totalPossibleMarks = 0;

  activeCbtQuestions.forEach(q => {
    const qMarks = q.marks || 1;
    totalPossibleMarks += qMarks;
    const selected = studentAnswers[q.id];
    if (selected) {
      if (q.qType === "SA") {
        const correctNorm = String(q.correctAnswer).trim().toLowerCase();
        const studentNorm = String(selected).trim().toLowerCase();
        if (correctNorm === studentNorm) {
          score += qMarks;
        }
      } else if (q.qType === "Essay") {
        // Essay graded manually
      } else {
        if (selected === q.correctAnswer) {
          score += qMarks;
        } else if (activeCbtExam.negativeMarking) {
          score -= 0.25;
        }
      }
    }
  });

  if (score < 0) score = 0;
  score = Math.round(score * 100) / 100;

  const percentage = totalPossibleMarks > 0 ? Math.round((score / totalPossibleMarks) * 100) : 0;
  
  let grade = "F";
  if (percentage >= 70) grade = "A";
  else if (percentage >= 60) grade = "B";
  else if (percentage >= 50) grade = "C";
  else if (percentage >= 45) grade = "D";

  const passed = percentage >= 45;

  const resultDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;

  const durationSeconds = activeCbtExam.duration * 60;
  const timeUsedSeconds = Math.max(0, durationSeconds - cbtSecondsLeft);
  const minsUsed = Math.floor(timeUsedSeconds / 60);
  const secsUsed = timeUsedSeconds % 60;
  const timeUsedStr = `${minsUsed}m ${secsUsed}s`;

  try {
    const resultRef = doc(db, "cbtResults", resultDocId);
    await setDoc(resultRef, {
      examId: activeCbtExam.id,
      courseCode: activeCbtExam.courseCode,
      title: activeCbtExam.title,
      studentId: currentStudentDoc.studentId,
      studentName: currentStudentDoc.fullName,
      studentMatric: currentStudentDoc.matricNumber,
      score: score,
      totalPossibleMarks: totalPossibleMarks,
      totalQuestions: activeCbtQuestions.length,
      percentage: percentage,
      grade: grade,
      passed: passed,
      timeUsed: timeUsedStr,
      timeUsedSeconds: timeUsedSeconds,
      submittedAt: new Date().toISOString()
    });

    const attemptDocId = `${currentStudentDoc.studentId.replace(/\//g, "-")}_${activeCbtExam.id}`;
    await setDoc(doc(db, "cbtAttempts", attemptDocId), {
      status: "submitted",
      submittedAt: new Date().toISOString()
    }, { merge: true });

    localStorage.removeItem(`cbt_temp_answers_${activeCbtExam.id}`);

    if (resultPanel) {
      const sealBgColor = passed ? 'rgba(40,167,69,0.1)' : 'rgba(220,53,69,0.1)';
      const sealIconColor = passed ? '#28a745' : '#dc3545';
      const statusBadgeBg = passed ? '#28A745' : '#DC3545';
      const statusText = passed ? 'EXCELLENT (PASS)' : 'FAIL';
      const showScore = activeCbtExam.showResultImmediately;

      resultPanel.innerHTML = `
        <div style="background: white; border-radius: var(--border-radius-lg); border: 1px solid var(--border-color); box-shadow: var(--shadow-md); padding: 3rem; border-top: 6px solid ${passed ? '#28A745' : '#DC3545'}; position: relative; overflow: hidden;">
          <div style="position: absolute; top: -15px; right: -15px; width: 100px; height: 100px; background-color: ${sealBgColor}; border-radius: 50%; display: flex; align-items: center; justify-content: center; transform: rotate(15deg);">
            <i class="fa-solid ${passed ? 'fa-award' : 'fa-circle-xmark'}" style="font-size: 3rem; color: ${sealIconColor}; opacity: 0.25;"></i>
          </div>

          <i class="fa-solid ${passed ? 'fa-circle-check' : 'fa-circle-exclamation'}" style="font-size: 4rem; color: ${passed ? '#28A745' : '#DC3545'}; margin-bottom: 1.5rem;"></i>
          <h2 style="font-size: 1.75rem; font-weight: 800; color: var(--primary-dark); margin-bottom: 0.25rem;">${isAutoTimeUp ? 'Assessment Terminated!' : 'Assessment Logged Successfully!'}</h2>
          <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 2rem;">Your responses have been successfully committed to the DIMABIN Central Registry.</p>

          ${showScore ? `
          <div style="background-color: var(--bg-slate); border: 1.5px solid var(--border-color); padding: 2rem; border-radius: var(--border-radius-lg); margin-bottom: 2.5rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; align-items: center;">
            <div style="border-right: 1px solid var(--border-color); padding-right: 1rem;">
              <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Your Grade Score</span>
              <div style="font-size: 2.5rem; font-weight: 900; color: var(--primary); margin: 0.25rem 0;">${score} / ${totalPossibleMarks}</div>
              <span style="font-size: 0.95rem; font-weight: 800; color: var(--accent);">${percentage}% Correct</span>
            </div>
            <div>
              <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Performance Class</span>
              <div style="font-size: 2.5rem; font-weight: 900; color: var(--accent); margin: 0.25rem 0;">${grade}</div>
              <span style="display: inline-block; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 800; font-size: 0.75rem; background-color: ${statusBadgeBg}; color: white;">${statusText}</span>
            </div>
          </div>
          ` : `
          <div style="background-color: var(--bg-slate); border: 1.5px solid var(--border-color); padding: 2rem; border-radius: var(--border-radius-lg); margin-bottom: 2.5rem; text-align: center; color: var(--text-dark); font-weight: 700;">
            <i class="fa-solid fa-lock" style="font-size: 1.5rem; color: var(--accent); margin-bottom: 0.5rem; display: block;"></i>
            Score Released Post-Moderation: Your answers have been safely received. Grades will be accessible once finalized by the Department.
          </div>
          `}

          <div style="display: flex; flex-direction: column; gap: 0.75rem; text-align: left; background-color: #fcf8e3; border: 1px solid #fbeed5; padding: 1rem; border-radius: var(--border-radius-md); font-size: 0.8rem; color: #c09853; line-height: 1.5; margin-bottom: 2rem;">
            <div><i class="fa-solid fa-info-circle"></i> <strong>Note:</strong> Under active academic policy rules, this immediate assessment score is subject to final lecturer audit and general moderation parameters before appearing on official registration transcripts.</div>
          </div>

          <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
            <button class="btn" id="btnCbtResultPrint" style="background-color: #28A745; color: white; min-width: 180px; padding: 0.75rem 1.5rem; border: none; border-radius: 4px; font-weight: 700; cursor: pointer;"><i class="fa-solid fa-print"></i> Print Result Slip</button>
            <button class="btn" id="btnCbtResultExit" style="background-color: var(--primary); color: white; min-width: 180px; padding: 0.75rem 1.5rem; border: none; border-radius: 4px; font-weight: 700; cursor: pointer;"><i class="fa-solid fa-house-user"></i> Exit to Dashboard</button>
          </div>
        </div>
      `;

      document.getElementById("btnCbtResultExit")?.addEventListener("click", () => {
        resultPanel.style.display = "none";
        renderCbtLists();
      });

      document.getElementById("btnCbtResultPrint")?.addEventListener("click", () => {
        const printWindow = window.open('', '_blank');
        const remark = passed ? "PASS" : "FAIL";
        printWindow.document.write(`
          <html>
            <head>
              <title>CBT Result Slip - ${activeCbtExam.courseCode}</title>
              <style>
                body { font-family: 'Poppins', sans-serif; padding: 30px; text-align: center; color: #333; }
                .slip-container { border: 2px solid #1F3B82; padding: 40px; border-radius: 8px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .logo { font-size: 24px; font-weight: 800; color: #1F3B82; text-transform: uppercase; margin-bottom: 5px; }
                .subtitle { font-size: 14px; color: #666; margin-bottom: 30px; }
                .header { border-bottom: 1px solid #ddd; padding-bottom: 15px; margin-bottom: 20px; text-align: left; }
                .row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 15px; }
                .label { font-weight: 600; color: #555; }
                .val { font-weight: 700; color: #111; }
                .score-box { background-color: #F5F7FA; border: 1.5px solid #1F3B82; padding: 20px; border-radius: 6px; margin: 30px 0; display: flex; justify-content: space-around; align-items: center; }
                .score-item { text-align: center; }
                .score-val { font-size: 28px; font-weight: 900; color: #1F3B82; }
                .score-lbl { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #666; margin-top: 5px; }
                .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 800; color: white; }
                .badge-pass { background-color: #28A745; }
                .badge-fail { background-color: #DC3545; }
                .footer { font-size: 12px; color: #888; margin-top: 40px; font-style: italic; }
              </style>
            </head>
            <body>
              <div class="slip-container">
                <div class="logo">DIMABIN CBT ENGINE</div>
                <div class="subtitle">Official Computer-Based Test Result Slip</div>
                
                <div class="header">
                  <div class="row"><span class="label">Candidate Name:</span><span class="val">${currentStudentDoc.fullName}</span></div>
                  <div class="row"><span class="label">Matric Number:</span><span class="val">${currentStudentDoc.matricNumber}</span></div>
                  <div class="row"><span class="label">Course Code:</span><span class="val">${activeCbtExam.courseCode}</span></div>
                  <div class="row"><span class="label">Examination:</span><span class="val">${activeCbtExam.title}</span></div>
                  <div class="row"><span class="label">Session / Semester:</span><span class="val">${activeCbtExam.academicSession} / ${activeCbtExam.semester}</span></div>
                  <div class="row"><span class="label">Date Submitted:</span><span class="val">${new Date().toLocaleString()}</span></div>
                </div>

                ${showScore ? `
                <div class="score-box">
                  <div class="score-item">
                    <div class="score-val">${score} / ${totalPossibleMarks}</div>
                    <div class="score-lbl">Total Score</div>
                  </div>
                  <div class="score-item">
                    <div class="score-val">${percentage}%</div>
                    <div class="score-lbl">Percentage</div>
                  </div>
                  <div class="score-item">
                    <div class="score-val">${grade}</div>
                    <div class="score-lbl">Grade</div>
                  </div>
                  <div class="score-item">
                    <span class="badge ${passed ? 'badge-pass' : 'badge-fail'}">${remark}</span>
                    <div class="score-lbl">Standing</div>
                  </div>
                </div>
                ` : `
                <div style="background-color: #F5F7FA; border: 1.5px dashed #F4B000; padding: 25px; border-radius: 6px; margin: 30px 0; font-weight: 700;">
                  <div style="font-size: 16px; color: #1F3B82; margin-bottom: 5px;">Result Pending Departmental Release</div>
                  <div style="font-size: 12px; color: #666; font-weight: normal;">Your exam coordinates have been securely saved. Scores are hidden until published by your lecturer.</div>
                </div>
                `}

                <div class="footer">
                  This slip was generated automatically from the DIMABIN Central Academic Registry. Verification Key: ${resultDocId}
                </div>
              </div>
              <script>
                window.onload = function() { window.print(); }
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();
      });
    }

    window.showToast("CBT score reported and finalized.", "success");

  } catch (err) {
    console.error("Result commit error:", err);
    alert(`⚠️ Critical Error!\n\nYour score is calculated: ${score}/${totalPossibleMarks} (${percentage}%), but we failed to synchronize it with the cloud database: ${err.message}.\n\nPlease do NOT close this window. Take a screenshot of this page immediately and submit it to your coordinator.`);
  }
}

// Helpers
function shuffleCbtArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
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
