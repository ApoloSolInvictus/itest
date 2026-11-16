import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowRight, ArrowUpRight, Award, BookMarked, BookOpen, Check,
  CheckCircle2, ChevronDown, ChevronRight, Clock3, CloudUpload, Download,
  ExternalLink, FileText, FileUp, GraduationCap, Home, Languages, Library,
  Lightbulb, LoaderCircle, LockKeyhole, LogOut, Menu, MoreHorizontal,
  NotebookPen, PanelLeftClose, Play, Plus, Search, Send, ShieldCheck, Sparkles,
  Target, Timer, Trash2, Upload, UserRound, X, Zap
} from "lucide-react";
import {
  createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, signOut as firebaseSignOut,
  sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile
} from "firebase/auth";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, setDoc
} from "firebase/firestore";
import { deleteObject, ref, uploadBytes } from "firebase/storage";
import { auth, db, firebaseReady, storage } from "./lib/firebase.js";
import { callAi } from "./lib/ai.js";
import { extractDocumentText } from "./lib/documents.js";
import { requestProfile } from "./lib/profile.js";
import EducatorWorkspace from "./EducatorWorkspace.jsx";
import StudentWorkspace from "./StudentWorkspace.jsx";

const DEMO_KEY = "itest-demo-v1";
const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "create", label: "Create an exam", icon: Sparkles },
  { id: "practice", label: "Exam room", icon: Timer },
  { id: "assigned", label: "Assigned courses", icon: BookOpen },
  { id: "educator", label: "Educator workspace", icon: GraduationCap },
  { id: "study", label: "Study & research", icon: Lightbulb },
  { id: "library", label: "My documents", icon: Library }
];
const PROFILE_OPTIONS = [
  { id: "student", label: "Student", description: "Build courses and practice exams.", icon: BookOpen },
  { id: "educator", label: "Educator", description: "Create assignments and track classes.", icon: GraduationCap },
  { id: "employer", label: "HR & hiring", description: "Assess candidates and review results.", icon: Target }
];

function starterExam() {
  return {
    id: "demo-biology",
    title: "Foundations of biology",
    subject: "Biology",
    summary: "A short sample assessment on cells, energy, and living systems.",
    difficulty: "Foundations",
    cognitiveFocus: "Understanding",
    durationMinutes: 12,
    questionCount: 4,
    createdAt: Date.now() - 86_400_000,
    questions: [
      { id: "d1", prompt: "Which structure contains most of a eukaryotic cell’s genetic material?", type: "multiple_choice", options: ["The nucleus", "The cell wall", "The ribosome", "The vacuole"], answer: "The nucleus", explanation: "The nucleus stores most of the DNA in eukaryotic cells.", points: 1 },
      { id: "d2", prompt: "What is the primary role of mitochondria?", type: "multiple_choice", options: ["Protein storage", "ATP production", "Water transport", "DNA replication"], answer: "ATP production", explanation: "Mitochondria convert energy from nutrients into ATP.", points: 1 },
      { id: "d3", prompt: "Plants use sunlight to help convert carbon dioxide and water into sugars.", type: "true_false", options: ["True", "False"], answer: "True", explanation: "This process is photosynthesis.", points: 1 },
      { id: "d4", prompt: "Name one way the cell membrane helps a cell maintain balance.", type: "short_answer", options: [], answer: "It controls what enters and leaves the cell.", explanation: "The membrane is selectively permeable and regulates exchange with the environment.", points: 2 }
    ]
  };
}

function readDemo() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_KEY) || "null");
    if (saved) return { documents: saved.documents || [], exams: saved.exams || [starterExam()], attempts: saved.attempts || [] };
  } catch { /* Ignore an invalid local preview cache. */ }
  return { documents: [], exams: [starterExam()], attempts: [] };
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(timestamp || Date.now()));
}

function todayLabel() {
  return new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()).toUpperCase();
}

function formatClock(seconds) {
  const minutes = Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0");
  const remainder = (Math.max(0, seconds) % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function safeFileName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "document";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function sampleGeneratedExam(form) {
  const examples = starterExam().questions;
  const count = Math.min(Number(form.questionCount) || 8, 12);
  return {
    title: form.title.trim() || form.topic.trim() || "Practice exam",
    summary: "Sample preview questions. Connect Firebase and OpenAI to generate questions from your own material.",
    questions: Array.from({ length: count }, (_, index) => ({ ...examples[index % examples.length], id: `preview-${Date.now()}-${index}` }))
  };
}

function Logo({ compact = false }) {
  return <span className={`brand ${compact ? "brand-compact" : ""}`}><span className="brand-mark">i</span><span>test</span><span className="brand-period">.</span></span>;
}

function TranslateMenu({ landing = false }) {
  const languages = [["Spanish", "es"], ["French", "fr"], ["Portuguese", "pt"], ["German", "de"], ["Italian", "it"], ["Japanese", "ja"], ["Korean", "ko"], ["Chinese", "zh-CN"], ["Arabic", "ar"], ["Hindi", "hi"], ["Dutch", "nl"], ["Swahili", "sw"]];
  return <details className={`translate-menu ${landing ? "translate-menu-landing" : ""}`}><summary aria-label="Translate page"><Languages size={17} /><span>EN</span><ChevronDown size={12} /></summary><div className="translate-popover"><strong>Translate with Google</strong><p>Open this page in another language.</p>{languages.map(([label, code]) => <a key={code} href={`https://translate.google.com/translate?sl=en&tl=${code}&u=${encodeURIComponent(window.location.href)}`} target="_blank" rel="noreferrer">{label}<ExternalLink size={12} /></a>)}<a href="https://translate.google.com/" target="_blank" rel="noreferrer">More languages<ExternalLink size={12} /></a></div></details>;
}

function Landing({ onLogin, onDemo }) {
  return (
    <div className="landing">
      <header className="landing-header shell">
        <a className="brand-link" href="#top" aria-label="iTest home"><Logo /></a>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#for-teachers">For educators</a>
          <a href="#for-learners">For learners</a>
          <a href="#for-employers">For hiring teams</a>
        </nav>
        <div className="landing-actions">
          <TranslateMenu landing />
          <button className="button button-quiet" onClick={() => onLogin(null, "login")}>Sign in</button>
          <button className="button button-dark button-small" onClick={onDemo}>Explore the demo <ArrowUpRight size={15} /></button>
        </div>
      </header>

      <main id="top">
        <section className="hero shell">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> A more considered way to study</div>
            <h1>Make the next<br /><span>exam count.</span></h1>
            <p className="hero-lede">Turn course material into clear, focused exams. Practice on your own time. Learn from every answer.</p>
            <div className="hero-buttons">
              <button className="button button-dark button-large" onClick={() => onLogin("student", "signup")}>Create your workspace <ArrowRight size={17} /></button>
              <a className="text-link" href="#how-it-works">See how it works <ArrowRight size={15} /></a>
            </div>
            <div className="hero-footnote"><ShieldCheck size={15} /> Your materials stay in your workspace.</div>
          </div>

          <div className="hero-visual" aria-label="iTest sample exam dashboard">
            <div className="visual-caption"><span>01 / YOUR STUDY DESK</span><span>DESIGNED FOR FOCUS</span></div>
            <div className="study-card">
              <div className="study-card-top"><div><span className="mini-label">NEXT UP</span><h2>Cell biology<br />essentials</h2></div><span className="card-icon"><BookOpen size={19} /></span></div>
              <div className="card-divider" />
              <div className="study-progress-row"><span>Study progress</span><span>68%</span></div>
              <div className="progress-track"><span style={{ width: "68%" }} /></div>
              <div className="study-card-bottom"><div><span className="mini-label">12 QUESTIONS</span><strong>18 minutes</strong></div><button className="round-arrow" aria-label="Open sample exam"><ArrowUpRight size={18} /></button></div>
            </div>
            <div className="floating-note"><span className="floating-note-icon"><Sparkles size={15} /></span><span><strong>Practice with purpose.</strong><small>Every answer moves you forward.</small></span></div>
            <div className="hero-scribble" aria-hidden="true">iT</div>
          </div>
        </section>

        <section className="trust-strip shell">
          <span>ONE SPACE FOR</span><div><BookMarked size={15} /> Source materials</div><div><Zap size={15} /> Exam creation</div><div><Target size={15} /> Focused practice</div><div><NotebookPen size={15} /> Better study habits</div>
        </section>

        <section className="story-section shell" id="how-it-works">
          <div className="section-intro"><span className="eyebrow">THE iTEST METHOD</span><h2>From first read<br />to ready.</h2><p>Bring your material, decide what matters, then work through a practice exam built around your goals.</p></div>
          <div className="story-steps">
            <article className="story-step"><span className="step-index">01</span><div className="step-icon"><FileUp size={21} /></div><h3>Bring your materials</h3><p>Upload a PDF or Word document, or start with a subject you want to explore.</p><span className="step-line" /></article>
            <article className="story-step"><span className="step-index">02</span><div className="step-icon"><Sparkles size={21} /></div><h3>Shape the exam</h3><p>Choose the question count, time limit, difficulty, and kind of thinking you want to practice.</p><span className="step-line" /></article>
            <article className="story-step"><span className="step-index">03</span><div className="step-icon"><GraduationCap size={22} /></div><h3>Learn by doing</h3><p>Take a timed exam, review explanations, and return to the ideas that need another pass.</p><span className="step-line" /></article>
          </div>
        </section>

        <section className="audience-section shell" id="for-teachers">
          <div className="audience-panel educator-panel"><span className="eyebrow">FOR EDUCATORS</span><h2>Thoughtful exams,<br />without the busywork.</h2><p>Build exams from course materials, invite verified students, set a passing score, and follow every attempt.</p><button className="button button-light" onClick={() => onLogin("educator", "signup")}>Create educator profile <ArrowRight size={16} /></button><div className="panel-index">iTEST / 01</div></div>
          <div className="audience-panel learner-panel" id="for-learners"><span className="eyebrow">FOR STUDENTS</span><h2>Practice until<br />it feels familiar.</h2><p>Build your own courses and practice exams, then keep teacher-assigned work and every score in one place.</p><button className="button button-outline-light" onClick={() => onLogin("student", "signup")}>Create student profile <ArrowRight size={16} /></button><div className="panel-index">iTEST / 02</div></div>
          <div className="audience-panel employer-panel" id="for-employers"><span className="eyebrow">FOR HR & HIRING TEAMS</span><h2>Assess skills.<br />Keep people in the loop.</h2><p>Create role-related assessments, set a benchmark, and review each candidate’s attempts as evidence for your hiring team.</p><button className="button button-outline" onClick={() => onLogin("employer", "signup")}>Create hiring profile <ArrowRight size={16} /></button><div className="panel-index">iTEST / 03</div><span className="employer-human-review">Human review stays with your team.</span></div>
        </section>

      <section className="closing-cta shell"><div><span className="eyebrow">YOUR STUDY DESK, READY WHEN YOU ARE</span><h2>Start with what<br />you’re learning.</h2></div><button className="button button-dark button-large" onClick={() => onLogin("student", "signup")}>Get started with iTest <ArrowUpRight size={17} /></button></section>
      </main>
      <footer className="landing-footer shell"><Logo compact /><span>Made for curious minds.</span><span>iTest · 2026</span></footer>
    </div>
  );
}

function AuthModal({ mode, setMode, onClose, onSignedIn, notify, initialProfileType }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [profileType, setProfileType] = useState(initialProfileType || "student");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialProfileType) setProfileType(initialProfileType);
  }, [initialProfileType]);

  const requestedProfileType = mode === "signup" ? profileType : initialProfileType || "";

  async function completeSignIn(firebaseUser, displayName = "") {
    const profile = await requestProfile(firebaseUser, requestedProfileType, displayName || firebaseUser.displayName || name);
    onSignedIn(firebaseUser, profile.type);
    if (requestedProfileType && profile.type && profile.type !== requestedProfileType) {
      notify(`This account already has a ${profile.type} profile. We opened that workspace.`, "info");
    }
    return profile.type;
  }

  async function submit(event) {
    event.preventDefault();
    if (!firebaseReady) {
      notify("Add the Firebase web settings to enable sign in. You can explore the demo now.", "info");
      return;
    }
    setBusy(true);
    try {
      let credential;
      if (mode === "signup") {
        credential = await createUserWithEmailAndPassword(auth, email, password);
        if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
        await sendEmailVerification(credential.user, { url: window.location.origin, handleCodeInApp: false });
      } else {
        credential = await signInWithEmailAndPassword(auth, email, password);
      }
      await completeSignIn(credential.user, name.trim());
      if (mode === "signup") {
        const roleLabel = profileType === "employer" ? "hiring" : profileType;
        notify(`Your ${roleLabel} profile is ready. Verify your email before opening assigned exams.`, "info");
      }
      onClose();
    } catch (error) {
      notify(error.message || "Could not save your profile. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function googleSignIn() {
    if (!firebaseReady) return notify("Add the Firebase web settings to enable sign in.", "info");
    setBusy(true);
    try {
      const credential = await signInWithPopup(auth, new GoogleAuthProvider());
      await completeSignIn(credential.user);
      onClose();
    } catch (error) {
      notify(error.message || "Google sign in or profile setup could not be completed.", "error");
    } finally { setBusy(false); }
  }

  async function resetPassword() {
    if (!firebaseReady || !email) return notify("Enter your email address first.", "info");
    try {
      await sendPasswordResetEmail(auth, email);
      notify("Password reset email sent.", "success");
    } catch (error) { notify(error.message || "Could not send the reset email.", "error"); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <Logo />
        <span className="eyebrow">YOUR iTEST PROFILE</span>
        <h2 id="auth-title">{mode === "signup" ? "Choose your workspace." : "Welcome back."}</h2>
        <p className="auth-subtitle">{mode === "signup" ? "Each account has its own workspace and tools." : "Sign in to continue to your saved workspace."}</p>
        {!firebaseReady && <div className="auth-setup-note"><AlertCircle size={17} /><span>Firebase isn’t connected yet. Set the web app values from <code>.env.example</code>, or use the sample workspace.</span></div>}
        {mode === "signup" && <div className="profile-choice-grid" role="radiogroup" aria-label="Choose your iTest profile">
          {PROFILE_OPTIONS.map((option) => {
            const Icon = option.icon;
            return <button type="button" key={option.id} className={`profile-choice ${profileType === option.id ? "selected" : ""}`} aria-pressed={profileType === option.id} onClick={() => setProfileType(option.id)}><Icon size={18} /><strong>{option.label}</strong><span>{option.description}</span></button>;
          })}
        </div>}
        <form onSubmit={submit} className="auth-form">
          {mode === "signup" && <label>Your name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Jordan Lee" /></label>}
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@school.edu" required /></label>
          <label>Password<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength="6" placeholder="At least 6 characters" required /></label>
          {mode === "login" && <button type="button" className="forgot-link" onClick={resetPassword}>Forgot password?</button>}
          <button className="button button-dark button-full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : mode === "signup" ? `Create ${profileType === "employer" ? "HR & hiring" : profileType} profile` : "Sign in"}</button>
        </form>
        <div className="auth-separator"><span />or<span /></div>
        <button className="button button-google button-full" onClick={googleSignIn} disabled={busy}><span className="google-g">G</span> Continue with Google</button>
        <p className="auth-switch">{mode === "signup" ? "Already have an account?" : "New to iTest?"} <button onClick={() => setMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Sign in" : "Create an account"}</button></p>
        <p className="auth-legal"><LockKeyhole size={13} /> Your profile type is saved to your iTest account.</p>
      </section>
    </div>
  );
}

function ProfileSetup({ user, onComplete, notify }) {
  const [busyType, setBusyType] = useState("");

  async function chooseProfile(profileType) {
    setBusyType(profileType);
    try {
      const profile = await requestProfile(user, profileType, user.displayName || "");
      if (!profile.type) throw new Error("The selected profile could not be saved.");
      onComplete(profile.type);
      notify(`${PROFILE_OPTIONS.find((item) => item.id === profile.type)?.label || "iTest"} profile ready.`, "success");
    } catch (error) {
      notify(error.message || "Could not save this profile. Please try again.", "error");
    } finally {
      setBusyType("");
    }
  }

  return <section className="profile-setup-page">
    <div className="profile-setup-intro"><span className="eyebrow">ONE ACCOUNT, ONE WORKSPACE</span><h1>Choose your iTest profile.</h1><p>This account has no workspace type yet. Choose how you’ll use iTest; it will be saved to your profile.</p></div>
    <div className="profile-setup-grid">
      {PROFILE_OPTIONS.map((option) => {
        const Icon = option.icon;
        return <article className="profile-setup-card" key={option.id}><span className="profile-setup-icon"><Icon size={19} /></span><h2>{option.label}</h2><p>{option.description}</p><button className="button button-dark" onClick={() => chooseProfile(option.id)} disabled={Boolean(busyType)}>{busyType === option.id ? <LoaderCircle className="spin" size={15} /> : null}Use {option.label} workspace <ArrowRight size={15} /></button></article>;
      })}
    </div>
  </section>;
}

function App() {
  const [screen, setScreen] = useState("landing");
  const [section, setSection] = useState("overview");
  const [user, setUser] = useState(null);
  const [profileType, setProfileType] = useState("");
  const [isEducator, setIsEducator] = useState(false);
  const [isEmployer, setIsEmployer] = useState(false);
  const [createReturnSection, setCreateReturnSection] = useState("practice");
  const [demo, setDemo] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authProfileType, setAuthProfileType] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [exams, setExams] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [toast, setToast] = useState(null);
  const [activeExam, setActiveExam] = useState(null);
  const [examSession, setExamSession] = useState(null);
  const [query, setQuery] = useState("");
  const [printExam, setPrintExam] = useState(null);
  const finishExamRef = useRef(null);
  const gradingRef = useRef(false);
  const authUidRef = useRef(null);
  const profileRevisionRef = useRef(0);

  function notify(message, type = "success") {
    setToast({ message, type });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 4200);
  }

  function openAuth(profile = "", mode = "login") {
    setAuthProfileType(profile);
    setAuthMode(firebaseReady ? mode : "signup");
    setAuthOpen(true);
  }

  useEffect(() => {
    if (!auth) return undefined;
    return onAuthStateChanged(auth, async (currentUser) => {
      const profileRevision = ++profileRevisionRef.current;
      authUidRef.current = currentUser?.uid || null;
      setUser(currentUser);
      if (currentUser) {
        let roleFromClaims = "";
        try {
          const tokenResult = await currentUser.getIdTokenResult(true);
          roleFromClaims = tokenResult.claims.employer === true ? "employer" : tokenResult.claims.educator === true ? "educator" : "";
        } catch {
          roleFromClaims = "";
        }
        let resolvedProfile = roleFromClaims;
        try {
          const savedProfile = await requestProfile(currentUser);
          resolvedProfile = savedProfile.type || roleFromClaims;
        } catch {
          resolvedProfile = roleFromClaims;
        }
        if (authUidRef.current === currentUser.uid && profileRevisionRef.current === profileRevision) {
          setProfileType(resolvedProfile);
          setIsEducator(resolvedProfile === "educator");
          setIsEmployer(resolvedProfile === "employer");
        }
        setDemo(false);
        setScreen("dashboard");
        setDoc(doc(db, "users", currentUser.uid), {
          uid: currentUser.uid,
          email: currentUser.email || "",
          displayName: currentUser.displayName || "Student",
          photoURL: currentUser.photoURL || "",
          updatedAt: Date.now()
        }, { merge: true }).catch(() => {});
      } else {
        setProfileType("");
        setIsEducator(false);
        setIsEmployer(false);
        setDemo(false);
        setScreen("landing");
      }
    });
  }, []);

  useEffect(() => {
    if (demo) localStorage.setItem(DEMO_KEY, JSON.stringify({ documents, exams, attempts }));
  }, [demo, documents, exams, attempts]);

  useEffect(() => {
    if (!user || !db) return undefined;
    const unsubs = [];
    for (const [bucket, setter] of [["documents", setDocuments], ["exams", setExams], ["attempts", setAttempts]]) {
      unsubs.push(onSnapshot(collection(db, "users", user.uid, bucket), (snapshot) => {
        const values = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
        values.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
        setter(values);
      }, () => notify("Firebase couldn’t read this workspace. Check the Firestore rules in the setup guide.", "error")));
    }
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [user]);

  useEffect(() => {
    if (printExam) {
      const timer = window.setTimeout(() => window.print(), 150);
      window.onafterprint = () => setPrintExam(null);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [printExam]);

  async function saveToCollection(bucket, id, value) {
    if (user) {
      await setDoc(doc(db, "users", user.uid, bucket, id), value);
      return;
    }
    if (bucket === "documents") setDocuments((current) => [value, ...current.filter((item) => item.id !== id)]);
    if (bucket === "exams") setExams((current) => [value, ...current.filter((item) => item.id !== id)]);
    if (bucket === "attempts") setAttempts((current) => [value, ...current.filter((item) => item.id !== id)]);
  }

  function enterDemo() {
    const saved = readDemo();
    setDocuments(saved.documents);
    setExams(saved.exams);
    setAttempts(saved.attempts);
    setDemo(true);
    setScreen("dashboard");
    setSection("overview");
    notify("Sample workspace opened. Demo content stays in this browser.", "info");
  }

  function openExamBuilder(returnTo = "practice") {
    setCreateReturnSection(returnTo);
    setSection("create");
  }

  function signedIn(signedInUser, savedProfileType = "") {
    profileRevisionRef.current += 1;
    setUser(signedInUser);
    setProfileType(savedProfileType);
    setIsEducator(savedProfileType === "educator");
    setIsEmployer(savedProfileType === "employer");
    setDemo(false);
    setScreen("dashboard");
    setSection(savedProfileType === "educator" || savedProfileType === "employer" ? "educator" : "overview");
  }

  async function signOut() {
    if (user && auth) await firebaseSignOut(auth);
    profileRevisionRef.current += 1;
    setDemo(false);
    setUser(null);
    setProfileType("");
    setIsEducator(false);
    setIsEmployer(false);
    setScreen("landing");
    setSection("overview");
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const file of files) {
      const extension = file.name.toLowerCase().split(".").pop();
      const limit = extension === "doc" ? 3_000_000 : 10_000_000;
      if (!(["pdf", "doc", "docx"].includes(extension))) {
        notify(`${file.name}: use a PDF, DOC, or DOCX file.`, "error");
        continue;
      }
      if (file.size > limit) {
        notify(`${file.name}: this file is above the ${extension === "doc" ? "3 MB" : "10 MB"} upload limit.`, "error");
        continue;
      }
      try {
        const text = await extractDocumentText(file);
        if (!text.trim()) throw new Error("No readable text was found in this file.");
        const id = crypto.randomUUID();
        let storagePath = "";
        if (user && storage) {
          storagePath = `users/${user.uid}/documents/${id}-${safeFileName(file.name)}`;
          await uploadBytes(ref(storage, storagePath), file, { contentType: file.type || "application/octet-stream" });
        }
        const entry = {
          id, name: file.name, type: extension.toUpperCase(), size: file.size,
          storagePath, text, createdAt: Date.now(), pages: null
        };
        await saveToCollection("documents", id, entry);
        notify(`${file.name} is ready to use.`, "success");
      } catch (error) {
        notify(`${file.name}: ${error.message || "could not be uploaded."}`, "error");
      }
    }
  }

  async function removeDocument(item) {
    try {
      if (user) {
        if (item.storagePath) await deleteObject(ref(storage, item.storagePath));
        await deleteDoc(doc(db, "users", user.uid, "documents", item.id));
      } else {
        setDocuments((current) => current.filter((documentItem) => documentItem.id !== item.id));
      }
      notify("Document removed.");
    } catch (error) { notify(error.message || "Could not remove the document.", "error"); }
  }

  async function createExam(form, sourceIds) {
    const selected = documents.filter((item) => sourceIds.includes(item.id));
    const sourceText = selected.map((item) => `SOURCE: ${item.name}\n${item.text}`).join("\n\n").slice(0, 26000);
    try {
      let generated;
      if (demo) {
        generated = sampleGeneratedExam(form);
        notify("Sample questions added. Connect Firebase and OpenAI for a source-based exam.", "info");
      } else {
        const result = await callAi({
          action: "generate-exam", topic: form.topic, subject: form.subject,
          questionCount: Number(form.questionCount), durationMinutes: Number(form.durationMinutes),
          difficulty: form.difficulty, cognitiveFocus: form.cognitiveFocus,
          questionType: form.questionType, language: form.language, sourceText
        });
        generated = result.exam;
      }
      const exam = {
        ...generated,
        id: crypto.randomUUID(),
        subject: form.subject || form.topic || "General study",
        difficulty: form.difficulty,
        cognitiveFocus: form.cognitiveFocus,
        durationMinutes: Number(form.durationMinutes),
        questionCount: generated.questions.length,
        documentIds: sourceIds,
        createdAt: Date.now(),
        status: "Ready"
      };
      await saveToCollection("exams", exam.id, exam);
      setActiveExam(exam);
      setExamSession(null);
      setSection(createReturnSection);
      setCreateReturnSection("practice");
      notify("Your exam is ready.");
    } catch (error) {
      notify(error.message || "Could not create this exam.", "error");
    }
  }

  async function askTutor(question, sourceIds) {
    const selected = documents.filter((item) => sourceIds.includes(item.id));
    const sourceText = selected.map((item) => `SOURCE: ${item.name}\n${item.text}`).join("\n\n").slice(0, 26000);
    if (demo) return `This is the sample workspace. Your question was: “${question}”\n\nConnect Firebase and add an OpenAI server key in Vercel to ask the tutor questions about your documents. In the full workspace, iTest will explain the concept and separate what your source says from additional context.`;
    const result = await callAi({ action: "study", question, sourceText, language: "English" });
    return result.answer;
  }

  async function finishExam(session) {
    if (!session || session.finished || gradingRef.current) return;
    gradingRef.current = true;
    const questions = session.exam.questions || [];
    const answers = session.answers || {};
    const totalPoints = questions.reduce((sum, question) => sum + (Number(question.points) || 1), 0);
    let grading = null;
    if (!demo && questions.length) {
      try {
        const result = await callAi({ action: "grade", questions, answers });
        grading = result.result;
      } catch { /* Objective grading below keeps the result available if AI grading is unavailable. */ }
    }
    const earned = grading ? Number(grading.score) : questions.reduce((sum, question) => {
      const submitted = String(answers[question.id] || "").trim().toLowerCase();
      const expected = String(question.answer || "").trim().toLowerCase();
      const correct = submitted && (question.type === "short_answer" ? submitted.includes(expected) || expected.includes(submitted) : submitted === expected);
      return sum + (correct ? Number(question.points) || 1 : 0);
    }, 0);
    const result = {
      score: Math.max(0, Math.min(100, Math.round((earned / Math.max(totalPoints, 1)) * 100))),
      earned, totalPoints, feedback: grading?.feedback || "Review the explanations, then try another short session.",
      itemFeedback: grading?.results || [], finishedAt: Date.now()
    };
    const completed = { ...session, finished: true, remainingSeconds: 0, result };
    setExamSession(completed);
    const attempt = { id: crypto.randomUUID(), examId: session.exam.id, examTitle: session.exam.title, score: result.score, createdAt: Date.now() };
    try { await saveToCollection("attempts", attempt.id, attempt); } catch { /* Keep the result visible even if saving fails. */ }
    gradingRef.current = false;
  }
  finishExamRef.current = finishExam;

  useEffect(() => {
    if (!examSession || examSession.finished) return undefined;
    const interval = window.setInterval(() => {
      setExamSession((current) => {
        if (!current || current.finished) return current;
        if (current.remainingSeconds <= 1) {
          window.setTimeout(() => finishExamRef.current?.(current), 0);
          return { ...current, remainingSeconds: 0 };
        }
        return { ...current, remainingSeconds: current.remainingSeconds - 1 };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [examSession?.exam?.id, examSession?.finished]);

  function exportExam(exam, format) {
    const lines = [exam.title, exam.summary || "", `Subject: ${exam.subject || "General study"}`, `Time: ${exam.durationMinutes || 20} minutes`, "", ...exam.questions.flatMap((question, index) => [
      `${index + 1}. ${question.prompt}`,
      ...(question.options || []).map((option, optionIndex) => `   ${String.fromCharCode(65 + optionIndex)}. ${option}`),
      ""
    ]), "ANSWER KEY", ...exam.questions.map((question, index) => `${index + 1}. ${question.answer}${question.explanation ? ` — ${question.explanation}` : ""}`)];
    if (format === "pdf") {
      setPrintExam(exam);
      return;
    }
    const content = format === "doc"
      ? `<html><meta charset="utf-8"><body style="font-family:Arial,sans-serif"><h1>${escapeHtml(exam.title)}</h1><p>${escapeHtml(exam.summary || "")}</p><p>${escapeHtml(exam.subject || "General study")} · ${exam.durationMinutes || 20} minutes</p><h2>Questions</h2>${exam.questions.map((question, index) => `<p><b>${index + 1}. ${escapeHtml(question.prompt)}</b></p>${(question.options || []).map((option, optionIndex) => `<p>${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</p>`).join("")}`).join("")}<h2>Answer key</h2>${exam.questions.map((question, index) => `<p>${index + 1}. ${escapeHtml(question.answer)}${question.explanation ? ` — ${escapeHtml(question.explanation)}` : ""}</p>`).join("")}</body></html>`
      : lines.join("\n");
    const blob = new Blob([content], { type: format === "doc" ? "application/msword;charset=utf-8" : "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeFileName(exam.title)}.${format === "doc" ? "doc" : "txt"}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (screen === "landing") {
    return <>
      <Landing onLogin={(profile, mode) => openAuth(profile || "", mode || "login")} onDemo={enterDemo} />
      {authOpen && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthOpen(false)} onSignedIn={signedIn} notify={notify} initialProfileType={authProfileType} />}
      {toast && <Toast toast={toast} />}
    </>;
  }

  const displayName = user?.displayName || user?.email?.split("@")[0] || "Alex Morgan";
  const firstName = displayName.split(" ")[0];
  const matchingExams = exams.filter((exam) => `${exam.title || ""} ${exam.subject || ""}`.toLowerCase().includes(query.toLowerCase()));
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (user && !demo && !profileType) return false;
    if (item.id === "educator") return isEducator || isEmployer;
    if (item.id === "assigned") return Boolean(user) && profileType === "student";
    return true;
  });

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand-row"><a href="#home" onClick={(event) => { event.preventDefault(); setSection("overview"); }}><Logo /></a><button className="icon-button sidebar-mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
        <div className="workspace-switch"><div className="workspace-avatar">{demo ? "S" : (firstName[0] || "i").toUpperCase()}</div><span><strong>{demo ? "Sample workspace" : `${firstName}’s workspace`}</strong><small>{demo ? "PREVIEW MODE" : profileType === "employer" ? "HIRING PROFILE" : profileType === "educator" ? "EDUCATOR PROFILE" : profileType === "student" ? "STUDENT PROFILE" : "PROFILE SETUP"}</small></span><ChevronDown size={15} /></div>
        <span className="sidebar-label">WORKSPACE</span>
        <nav className="side-nav" aria-label="Workspace">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const label = item.id === "educator" ? (isEmployer && isEducator ? "Educator & hiring workspace" : isEmployer ? "Hiring workspace" : "Educator workspace") : item.label;
            return <button key={item.id} className={`nav-item ${section === item.id ? "active" : ""}`} onClick={() => { if (item.id === "create") openExamBuilder("practice"); else setSection(item.id); setSidebarOpen(false); }}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{item.id === "create" && <span className="nav-kbd">⌘ K</span>}</button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help"><span className="help-mark"><GraduationCap size={18} /></span><strong>Keep learning.</strong><p>Small sessions make a difference.</p><button onClick={() => setSection("study")}>Open study desk <ArrowRight size={14} /></button></div>
          {demo && <div className="demo-tag"><span /> Demo data stays in this browser</div>}
          <button className="nav-item sidebar-account" onClick={signOut}><LogOut size={17} /><span>{demo ? "Exit sample workspace" : "Sign out"}</span></button>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <main className="main-panel">
        <header className="dashboard-header">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{visibleNavItems.find((item) => item.id === section)?.label || "Overview"}</strong></div>
          <div className="header-right">
            <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search exams" aria-label="Search exams" /><kbd>⌘ K</kbd></label>
            <TranslateMenu />
            <span className="header-divider" />
            <div className="user-chip"><span className="user-avatar">{firstName[0]?.toUpperCase()}</span><span className="user-chip-name">{firstName}</span></div>
          </div>
        </header>

        {demo && <div className="demo-banner"><div><Sparkles size={16} /><span><strong>Sample workspace</strong> — explore the product with local demo data.</span></div><button onClick={() => openAuth("student", "signup")}>Create your profile <ArrowRight size={14} /></button></div>}

        <div className="page-content">
          {section === "overview" && <Overview firstName={firstName} exams={matchingExams} documents={documents} attempts={attempts} setSection={setSection} setActiveExam={setActiveExam} onCreate={() => openExamBuilder("practice")} onOpenExam={(exam) => { setActiveExam(exam); setSection("practice"); }} />}
          {section === "create" && <CreateExam documents={documents} onUpload={uploadFiles} onGenerate={createExam} notify={notify} />}
          {user && !demo && !profileType ? <ProfileSetup user={user} onComplete={(type) => { setProfileType(type); setIsEducator(type === "educator"); setIsEmployer(type === "employer"); setSection(type === "educator" || type === "employer" ? "educator" : "overview"); }} notify={notify} /> : <>
          {section === "assigned" && user && profileType === "student" && <StudentWorkspace user={user} onCreateExam={() => openExamBuilder("practice")} notify={notify} />}
          {section === "educator" && (isEducator || isEmployer) && user && <EducatorWorkspace user={user} exams={exams} workspaceKind={profileType === "employer" ? "employer" : "educator"} onCreateExam={() => openExamBuilder("educator")} notify={notify} />}
          {section === "library" && <DocumentLibrary documents={documents} onUpload={uploadFiles} onRemove={removeDocument} />}
          {section === "study" && <StudyDesk documents={documents} onAsk={askTutor} notify={notify} />}
          {section === "practice" && <ExamRoom exams={matchingExams} activeExam={activeExam} session={examSession} setSession={setExamSession} onCreate={() => setSection("create")} onStart={(exam) => { setActiveExam(exam); setExamSession({ exam, answers: {}, remainingSeconds: (Number(exam.durationMinutes) || 20) * 60, finished: false }); }} onSubmit={() => finishExam(examSession)} onExport={exportExam} />}
          </>}
        </div>
      </main>

      {authOpen && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthOpen(false)} onSignedIn={signedIn} notify={notify} initialProfileType={authProfileType} />}
      {toast && <Toast toast={toast} />}
      {printExam && <PrintExam exam={printExam} />}
    </div>
  );
}

function Toast({ toast }) {
  const Icon = toast.type === "error" ? AlertCircle : toast.type === "info" ? Sparkles : CheckCircle2;
  return <div className={`toast toast-${toast.type}`} role="status"><Icon size={17} /><span>{toast.message}</span></div>;
}

function Overview({ firstName, exams, documents, attempts, setSection, onCreate, onOpenExam }) {
  const latestExam = exams[0];
  const latestAttempt = attempts[0];
  return (
    <div className="overview-page">
      <div className="welcome-row"><div><span className="eyebrow">{todayLabel()}</span><h1>Good morning, {firstName}<span className="period">.</span></h1><p>A calm place to plan what you’ll learn today.</p></div><button className="button button-dark" onClick={onCreate}><Plus size={17} /> Build an exam</button></div>
      <div className="dashboard-grid">
        <section className="welcome-card">
          <div className="welcome-card-copy"><span className="mini-label">YOUR STUDY DESK</span><h2>Make time for<br />one good question.</h2><p>Start with a topic, a document, or a little curiosity.</p><button className="button button-light" onClick={() => setSection("study")}>Open study desk <ArrowRight size={15} /></button></div>
          <div className="welcome-card-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core"><GraduationCap size={32} /></div><span className="orbit-note">ONE STEP<br />AT A TIME</span><span className="orbit-dot" /></div>
        </section>
        <section className="metric-card"><div className="metric-card-head"><span className="metric-icon"><FileText size={16} /></span><MoreHorizontal size={17} /></div><span className="metric-value">{exams.length.toString().padStart(2, "0")}</span><span className="metric-label">Exams ready</span><button onClick={() => setSection("practice")}>Open exam room <ArrowRight size={14} /></button></section>
        <section className="metric-card"><div className="metric-card-head"><span className="metric-icon metric-icon-gray"><BookMarked size={16} /></span><MoreHorizontal size={17} /></div><span className="metric-value">{documents.length.toString().padStart(2, "0")}</span><span className="metric-label">Source documents</span><button onClick={() => setSection("library")}>View library <ArrowRight size={14} /></button></section>

        <section className="content-card recent-exams-card"><div className="card-heading"><div><span className="eyebrow">YOUR WORK</span><h3>Recent exams</h3></div><button className="text-link-small" onClick={() => setSection("practice")}>View all <ArrowRight size={14} /></button></div>
          {exams.length ? <div className="recent-list">{exams.slice(0, 3).map((exam, index) => <button className="recent-exam-row" key={exam.id} onClick={() => onOpenExam(exam)}><span className={`exam-index exam-index-${index % 3}`}>{String(index + 1).padStart(2, "0")}</span><span className="recent-exam-title"><strong>{exam.title}</strong><small>{exam.subject || "General study"} <span>·</span> {exam.questionCount || exam.questions?.length || 0} questions</small></span><span className="recent-exam-date">{formatDate(exam.createdAt)}</span><ChevronRight size={16} /></button>)}</div> : <EmptyState title="Your first exam starts here" text="Choose a topic or upload course materials to build one." action="Create an exam" onClick={onCreate} />}
        </section>

        <section className="content-card focus-card"><div className="card-heading"><div><span className="eyebrow">A GOOD NEXT STEP</span><h3>Choose your focus</h3></div><span className="focus-star"><Sparkles size={17} /></span></div><div className="focus-options"><button onClick={onCreate}><span className="focus-number">01</span><span><strong>Create</strong><small>Make an exam from your material</small></span><ArrowUpRight size={15} /></button><button onClick={() => setSection("study")}><span className="focus-number">02</span><span><strong>Explore</strong><small>Ask a question and build context</small></span><ArrowUpRight size={15} /></button><button onClick={() => setSection("practice")}><span className="focus-number">03</span><span><strong>Practice</strong><small>Take a short timed assessment</small></span><ArrowUpRight size={15} /></button></div></section>

        <section className="quote-card"><span className="quote-mark">“</span><blockquote>It always seems impossible until it’s done.</blockquote><span className="quote-attribution">A NOTE TO KEEP GOING</span><div className="quote-decoration">✳</div></section>
        <section className="streak-card"><div className="streak-head"><span className="eyebrow">YOUR PRACTICE</span><span><Award size={17} /></span></div><strong>{latestAttempt ? `${latestAttempt.score}%` : "A fresh start"}</strong><p>{latestAttempt ? `Last result · ${latestAttempt.examTitle}` : "One session is enough to begin."}</p><div className="week-row">{["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span key={`${day}-${index}`} className={index === 6 && latestAttempt ? "week-day done" : "week-day"}>{day}<i /></span>)}</div><button onClick={() => setSection("practice")}>Go to exam room <ArrowRight size={14} /></button></section>
      </div>
      <div className="page-footer"><span>iTest / YOUR LEARNING, IN FOCUS</span><span>Take it one question at a time.</span></div>
    </div>
  );
}

function EmptyState({ title, text, action, onClick }) {
  return <div className="empty-state"><span className="empty-icon"><BookOpen size={20} /></span><strong>{title}</strong><p>{text}</p>{action && <button className="button button-outline" onClick={onClick}>{action} <ArrowRight size={14} /></button>}</div>;
}

function PageHeading({ eyebrow, title, text, action, onAction }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action && <button className="button button-dark" onClick={onAction}><Plus size={16} />{action}</button>}</div>;
}

function CreateExam({ documents, onUpload, onGenerate, notify }) {
  const [form, setForm] = useState({ title: "", topic: "", subject: "", questionCount: 10, durationMinutes: 20, difficulty: "Intermediate", cognitiveFocus: "Application", questionType: "Mixed", language: "English" });
  const [sourceIds, setSourceIds] = useState([]);
  const [busy, setBusy] = useState(false);
  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  async function submit(event) {
    event.preventDefault();
    if (!form.topic.trim() && sourceIds.length === 0) return notify("Add a subject or select a source document first.", "error");
    setBusy(true);
    await onGenerate(form, sourceIds);
    setBusy(false);
  }
  return (
    <div className="create-page">
      <PageHeading eyebrow="EXAM BUILDER / 01" title="Build an exam." text="Set the goal. iTest will shape a first draft around it." />
      <form className="builder-layout" onSubmit={submit}>
        <div className="builder-main">
          <section className="form-card"><div className="form-card-title"><span className="form-step">01</span><div><h2>Start with a subject</h2><p>What should this exam cover?</p></div></div><div className="form-grid"><label className="field field-wide">Exam title <input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="e.g. Cell biology — midterm review" /></label><label className="field">Topic or learning goal <input value={form.topic} onChange={(event) => update("topic", event.target.value)} placeholder="e.g. Cell structure and energy" /></label><label className="field">Subject area <input value={form.subject} onChange={(event) => update("subject", event.target.value)} placeholder="e.g. Biology 101" /></label></div></section>

          <section className="form-card"><div className="form-card-title"><span className="form-step">02</span><div><h2>Choose your format</h2><p>Set a pace and a level that fits the moment.</p></div></div><div className="form-grid"><label className="field">Number of questions <select value={form.questionCount} onChange={(event) => update("questionCount", event.target.value)}>{[5, 10, 15, 20, 25, 30].map((value) => <option key={value} value={value}>{value} questions</option>)}</select></label><label className="field">Time limit <select value={form.durationMinutes} onChange={(event) => update("durationMinutes", event.target.value)}>{[5, 10, 15, 20, 30, 45, 60, 90].map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></label><label className="field">Knowledge level <select value={form.difficulty} onChange={(event) => update("difficulty", event.target.value)}><option>Foundations</option><option>Intermediate</option><option>Advanced</option><option>Graduate</option></select></label><label className="field">Thinking focus <select value={form.cognitiveFocus} onChange={(event) => update("cognitiveFocus", event.target.value)}><option>Recall</option><option>Understanding</option><option>Application</option><option>Analysis</option><option>Evaluation</option><option>Creation</option></select></label><label className="field">Question style <select value={form.questionType} onChange={(event) => update("questionType", event.target.value)}><option>Mixed</option><option>Multiple choice</option><option>True / false</option><option>Short answer</option></select></label><label className="field">Exam language <select value={form.language} onChange={(event) => update("language", event.target.value)}>{["English", "Spanish", "French", "Portuguese", "German", "Italian", "Japanese", "Korean", "Chinese", "Arabic", "Hindi", "Dutch", "Swahili"].map((language) => <option key={language}>{language}</option>)}</select></label></div></section>

          <section className="form-card"><div className="form-card-title"><span className="form-step">03</span><div><h2>Ground it in your material</h2><p>Choose the documents iTest should use as its source.</p></div><span className="optional-label">OPTIONAL</span>{documents.length > 0 && <label className="add-source-button"><Plus size={13} /> Add<input type="file" accept=".pdf,.doc,.docx" multiple onChange={(event) => { onUpload(event.target.files); event.target.value = ""; }} /></label>}</div><div className="source-pick-list">{documents.length ? documents.map((item) => <label key={item.id} className={`source-pick ${sourceIds.includes(item.id) ? "source-picked" : ""}`}><input type="checkbox" checked={sourceIds.includes(item.id)} onChange={() => setSourceIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span className="source-pick-icon"><FileText size={16} /></span><span className="source-pick-name"><strong>{item.name}</strong><small>{item.type} · {formatDate(item.createdAt)}</small></span>{sourceIds.includes(item.id) && <Check size={16} />}</label>) : <div className="no-sources"><span>No source documents yet.</span><label className="text-link-small upload-inline"><Upload size={14} /> Upload a PDF or Word file<input type="file" accept=".pdf,.doc,.docx" multiple onChange={(event) => { onUpload(event.target.files); event.target.value = ""; }} /></label></div>}</div></section>
          <div className="builder-mobile-submit"><button className="button button-dark button-full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />} Generate exam</button><small>Review and edit your exam after it’s created.</small></div>
        </div>

        <aside className="builder-aside"><div className="builder-summary"><span className="eyebrow">EXAM SNAPSHOT</span><h3>A clear goal<br />makes a good start.</h3><p>iTest uses your choices to shape the exam’s length, difficulty, and style.</p><div className="snapshot-row"><span><Clock3 size={15} /> Time</span><strong>{form.durationMinutes} min</strong></div><div className="snapshot-row"><span><FileText size={15} /> Questions</span><strong>{form.questionCount}</strong></div><div className="snapshot-row"><span><Target size={15} /> Focus</span><strong>{form.cognitiveFocus}</strong></div><div className="snapshot-row"><span><Languages size={15} /> Language</span><strong>{form.language}</strong></div><button className="button button-dark button-full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />} Generate exam</button><small className="snapshot-note"><ShieldCheck size={13} /> Your source is treated as study material, not as instructions.</small></div><div className="aside-tip"><Lightbulb size={17} /><span><strong>Helpful hint</strong><br />A focused topic often makes for clearer questions.</span></div></aside>
      </form>
    </div>
  );
}

function DocumentLibrary({ documents, onUpload, onRemove }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="library-page">
      <PageHeading eyebrow="YOUR LIBRARY / 04" title="Keep your sources close." text="Store the material you study from, then bring it into a new exam when you’re ready." />
      <label className={`upload-dropzone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); onUpload(event.dataTransfer.files); }}>
        <input type="file" accept=".pdf,.doc,.docx" multiple onChange={(event) => { onUpload(event.target.files); event.target.value = ""; }} />
        <span className="upload-drop-icon"><CloudUpload size={24} /></span><strong>Drop a document here, or <span>browse files</span></strong><small>PDF, DOC, or DOCX · up to 10 MB per file (legacy DOC: 3 MB)</small>
      </label>
      <section className="library-list-card"><div className="card-heading"><div><span className="eyebrow">SOURCE MATERIAL</span><h3>{documents.length} {documents.length === 1 ? "document" : "documents"}</h3></div><span className="library-count">{documents.length.toString().padStart(2, "0")}</span></div>
        {documents.length ? <div className="document-table"><div className="document-table-head"><span>NAME</span><span>TYPE</span><span>ADDED</span><span>SIZE</span><span /></div>{documents.map((item) => <div className="document-row" key={item.id}><span className="document-name"><span className="file-icon"><FileText size={17} /></span><strong>{item.name}</strong></span><span className="doc-type">{item.type}</span><span>{formatDate(item.createdAt)}</span><span>{(Number(item.size || 0) / 1024).toFixed(0)} KB</span><button className="icon-button delete-button" onClick={() => onRemove(item)} aria-label={`Remove ${item.name}`}><Trash2 size={16} /></button></div>)}</div> : <EmptyState title="Your library is ready" text="Add course notes, reading materials, or a study guide to get started." />}
      </section>
      <div className="privacy-note"><ShieldCheck size={16} /><span><strong>Your study materials stay private.</strong> Signed-in users can only access files in their own account.</span></div>
    </div>
  );
}

function StudyDesk({ documents, onAsk, notify }) {
  const [question, setQuestion] = useState("");
  const [sourceIds, setSourceIds] = useState([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setAnswer("");
    try { setAnswer(await onAsk(question.trim(), sourceIds)); }
    catch (error) { notify(error.message || "iTest could not answer that yet.", "error"); }
    finally { setBusy(false); }
  }
  return (
    <div className="study-page">
      <PageHeading eyebrow="STUDY DESK / 03" title="Stay curious." text="Ask a question, clarify an idea, or work through your course material." />
      <div className="study-layout"><section className="tutor-card"><div className="tutor-header"><div className="tutor-avatar"><Sparkles size={20} /></div><div><span className="eyebrow">iTEST STUDY GUIDE</span><h2>What are you working through?</h2></div><span className="online-mark"><i /> READY</span></div><form onSubmit={submit}><label className="tutor-input-label" htmlFor="tutor-question">Ask a question or name a concept</label><textarea id="tutor-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. How does cellular respiration relate to photosynthesis?" rows={4} /><div className="tutor-controls"><label className="tutor-source-select"><BookMarked size={15} /><select value={sourceIds[0] || ""} onChange={(event) => setSourceIds(event.target.value ? [event.target.value] : [])}><option value="">General knowledge</option>{documents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={13} /></label><button className="button button-dark" disabled={busy || !question.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />} Ask iTest</button></div></form>
          {answer && <div className="tutor-answer"><span className="answer-label"><Sparkles size={14} /> A PLACE TO START</span><div>{answer.split("\n").map((line, index) => <p key={index}>{line || <br />}</p>)}</div><button className="text-link-small" onClick={() => { navigator.clipboard?.writeText(answer); notify("Answer copied."); }}>Copy answer</button></div>}
        </section><aside className="study-aside"><div className="study-aside-art"><span className="eyebrow">KEEP GOING</span><div className="study-orb"><div><BookOpen size={24} /></div></div><h3>Understanding<br />takes practice.</h3><p>Ask for an example, a simpler explanation, or a new way to look at a difficult idea.</p></div><div className="prompt-card"><span className="eyebrow">TRY A PROMPT</span>{["Explain this in simpler terms", "Give me a real-world example", "What should I review next?"].map((prompt) => <button key={prompt} onClick={() => setQuestion(prompt)}>{prompt}<ArrowUpRight size={14} /></button>)}</div></aside></div>
    </div>
  );
}

function ExamRoom({ exams, activeExam, session, setSession, onCreate, onStart, onSubmit, onExport }) {
  const exam = session?.exam || activeExam;
  if (session && exam) {
    const questions = exam.questions || [];
    const answered = Object.values(session.answers || {}).filter(Boolean).length;
    return <div className="exam-session-page">
      <div className="session-topline"><button className="text-link-small" onClick={() => setSession(null)}>← Back to exam room</button><span className="session-exam-tag"><Timer size={14} /> TIMED SESSION</span></div>
      <div className="session-heading"><div><span className="eyebrow">{exam.subject || "PRACTICE EXAM"}</span><h1>{exam.title}</h1><p>{exam.summary}</p></div><div className={`timer-badge ${session.remainingSeconds <= 60 && !session.finished ? "timer-urgent" : ""}`}><Clock3 size={19} /><div><small>TIME REMAINING</small><strong>{session.finished ? "DONE" : formatClock(session.remainingSeconds)}</strong></div></div></div>
      <div className="session-progress"><span>{answered} of {questions.length} answered</span><span>{questions.length ? Math.round(answered / questions.length * 100) : 0}%</span><div className="progress-track"><span style={{ width: `${questions.length ? answered / questions.length * 100 : 0}%` }} /></div></div>
      {session.finished && <div className="result-banner"><div className="result-score">{session.result?.score ?? 0}<small>%</small></div><div><span className="eyebrow">SESSION COMPLETE</span><h2>{session.result?.feedback || "Well done for seeing it through."}</h2><p>{session.result?.earned ?? 0} of {session.result?.totalPoints ?? 0} points · Review each explanation below.</p></div><Award size={25} /></div>}
      <div className="question-stack">{questions.map((question, index) => {
        const selected = session.answers?.[question.id] || "";
        const graded = session.result?.itemFeedback?.find((item) => item.questionId === question.id);
        const correct = graded ? Number(graded.pointsAwarded) >= Number(question.points || 1) : selected.trim().toLowerCase() === String(question.answer || "").trim().toLowerCase();
        return <section className={`question-card ${session.finished ? correct ? "question-correct" : "question-missed" : ""}`} key={question.id}><div className="question-card-head"><span className="question-number">{String(index + 1).padStart(2, "0")}</span><div className="question-meta"><span>{question.type === "short_answer" ? "SHORT ANSWER" : question.type === "true_false" ? "TRUE / FALSE" : "MULTIPLE CHOICE"}</span><span>{question.points || 1} {question.points === 1 ? "POINT" : "POINTS"}</span></div>{session.finished && (correct ? <CheckCircle2 className="answer-status answer-status-correct" size={18} /> : <AlertCircle className="answer-status answer-status-missed" size={18} />)}</div><h3>{question.prompt}</h3>
          {question.type === "short_answer" ? <textarea className="short-answer-input" rows={3} value={selected} disabled={session.finished} onChange={(event) => setSession((current) => ({ ...current, answers: { ...current.answers, [question.id]: event.target.value } }))} placeholder="Write your answer here…" /> : <div className="answer-options">{(question.options || []).map((option, optionIndex) => <button key={option} className={`answer-option ${selected === option ? "selected" : ""} ${session.finished && option === question.answer ? "correct-option" : ""}`} disabled={session.finished} onClick={() => setSession((current) => ({ ...current, answers: { ...current.answers, [question.id]: option } }))}><span>{String.fromCharCode(65 + optionIndex)}</span>{option}{session.finished && option === question.answer && <Check size={15} />}</button>)}</div>}
          {session.finished && <div className="explanation-box"><span><Lightbulb size={14} /> EXPLANATION</span><p>{question.explanation || `A strong answer is: ${question.answer}`}</p>{graded?.feedback && <p className="answer-feedback">Your answer: {graded.feedback}</p>}</div>}
        </section>;
      })}</div>
      {!session.finished ? <div className="session-submit-row"><span>Take your time. You can review every answer after you submit.</span><button className="button button-dark" onClick={onSubmit}>Submit exam <ArrowRight size={15} /></button></div> : <div className="session-submit-row"><span>You can take this exam again whenever you’re ready.</span><button className="button button-dark" onClick={() => onStart(exam)}><Play size={15} /> Try again</button></div>}
    </div>;
  }

  return <div className="practice-page"><PageHeading eyebrow="EXAM ROOM / 02" title="Find your rhythm." text="Choose an exam, set aside a few minutes, and see what you know." />
    {activeExam && <section className="ready-exam-card"><div className="ready-exam-stamp"><Play size={20} fill="currentColor" /></div><div className="ready-exam-copy"><span className="eyebrow">READY TO BEGIN</span><h2>{activeExam.title}</h2><p>{activeExam.subject} <span>·</span> {activeExam.questions?.length || activeExam.questionCount} questions <span>·</span> {activeExam.durationMinutes} minutes</p></div><button className="button button-dark" onClick={() => onStart(activeExam)}>Start exam <ArrowRight size={15} /></button></section>}
    <section className="exam-list-section"><div className="card-heading"><div><span className="eyebrow">YOUR PRACTICE SET</span><h3>Saved exams</h3></div><span className="library-count">{exams.length.toString().padStart(2, "0")}</span></div>
      {exams.length ? <div className="practice-exam-list">{exams.map((item, index) => <article className="practice-exam-row" key={item.id}><span className={`practice-exam-icon practice-exam-icon-${index % 3}`}><FileText size={18} /></span><div className="practice-exam-main"><strong>{item.title}</strong><span>{item.subject} <i>·</i> {item.questions?.length || item.questionCount} questions <i>·</i> {item.durationMinutes} min</span></div><span className="difficulty-chip">{item.difficulty || "Practice"}</span><button className="icon-button" onClick={() => onExport(item, "pdf")} aria-label={`Export ${item.title} as PDF`}><Download size={16} /></button><button className="button button-outline button-small" onClick={() => onStart(item)}><Play size={14} /> Start</button></article>)}</div> : <EmptyState title="Your exam room is waiting" text="Create an exam from a subject or a source document." action="Build an exam" onClick={onCreate} />}
    </section><p className="practice-note"><ShieldCheck size={15} /> Your timer begins when you start. Your answers stay with this workspace.</p>
  </div>;
}

function PrintExam({ exam }) {
  return <div className="print-area"><div className="print-brand">iTest <span>·</span> LEARN WITH INTENTION</div><h1>{exam.title}</h1><p className="print-summary">{exam.summary}</p><div className="print-meta">Name: ___________________________________ <span>Date: __________________</span></div><div className="print-meta">Subject: {exam.subject || "General study"} <span>Time: {exam.durationMinutes || 20} minutes</span></div><h2>Questions</h2>{(exam.questions || []).map((question, index) => <section className="print-question" key={question.id}><strong>{index + 1}. {question.prompt}</strong>{(question.options || []).map((option, optionIndex) => <p key={option}>□ {String.fromCharCode(65 + optionIndex)}. {option}</p>)}{question.type === "short_answer" && <div className="print-answer-lines" />}</section>)}<div className="print-answer-key"><h2>Answer key</h2>{(exam.questions || []).map((question, index) => <p key={question.id}><strong>{index + 1}. {question.answer}</strong> — {question.explanation}</p>)}</div></div>;
}

export default App;
