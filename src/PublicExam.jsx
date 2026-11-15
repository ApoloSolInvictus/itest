import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, ArrowRight, Check, Clock3, GraduationCap, LoaderCircle,
  LogOut, RefreshCw, Send, ShieldCheck, Target
} from "lucide-react";
import {
  createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged,
  reload, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup,
  signOut, updateProfile
} from "firebase/auth";
import { auth, firebaseReady } from "./lib/firebase.js";

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function humanError(message) {
  if (message?.includes("Different email") || message?.includes("different email") || message?.includes("verified iTest account")) {
    return "This invitation belongs to the verified email address on the educator’s list. Sign out and use that iTest account.";
  }
  return message || "This exam could not be loaded. Please try again.";
}

export default function PublicExam({ shareId }) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authRevision, setAuthRevision] = useState(0);
  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sessionToken, setSessionToken] = useState("");
  const [answers, setAnswers] = useState({});
  const [remaining, setRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const submittingRef = useRef(false);
  const clientDeadlineRef = useRef(0);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      setLoading(false);
      setError("iTest sign-in is not configured for this site.");
      return undefined;
    }
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser?.email) setAuthEmail(currentUser.email);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadExam() {
      if (!authReady) return;
      if (!user || !user.emailVerified) {
        setExam(null);
        setLoading(false);
        setError("");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/public-exam?shareId=${encodeURIComponent(shareId)}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(humanError(data.error));
        if (!cancelled) setExam(data.exam);
      } catch (loadError) {
        if (!cancelled) setError(humanError(loadError.message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadExam();
    return () => { cancelled = true; };
  }, [authReady, authRevision, shareId, user]);

  async function authenticate(event) {
    event.preventDefault();
    if (!firebaseReady) {
      setError("Firebase sign-in is not available right now. Please try again later.");
      return;
    }
    setAuthBusy(true);
    setError("");
    setAuthMessage("");
    try {
      if (authMode === "signup") {
        const credential = await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        if (authName.trim()) await updateProfile(credential.user, { displayName: authName.trim() });
        await sendEmailVerification(credential.user, { url: window.location.href, handleCodeInApp: false });
        setAuthMessage("Check your inbox and verify this email address. Return here after verification to open the invitation.");
      } else {
        await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
      }
    } catch (authError) {
      setError(authError.message || "iTest could not sign you in.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function googleSignIn() {
    if (!firebaseReady) return setError("Firebase sign-in is not available right now.");
    setAuthBusy(true);
    setError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (authError) {
      setError(authError.message || "Google sign-in could not be completed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function resendVerification() {
    if (!auth?.currentUser) return;
    setAuthBusy(true);
    setError("");
    try {
      await sendEmailVerification(auth.currentUser, { url: window.location.href, handleCodeInApp: false });
      setAuthMessage("Verification email sent. Open it, verify your address, then return here.");
    } catch (verificationError) {
      setError(verificationError.message || "Could not send a verification email.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function refreshVerification() {
    if (!auth?.currentUser) return;
    setAuthBusy(true);
    setError("");
    try {
      await reload(auth.currentUser);
      await auth.currentUser.getIdToken(true);
      setUser(auth.currentUser);
      setAuthRevision((value) => value + 1);
      if (!auth.currentUser.emailVerified) setAuthMessage("This address is not verified yet. Open the email link and try again.");
      else setAuthMessage("");
    } catch (verificationError) {
      setError(verificationError.message || "Could not refresh your email verification status.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signedInRequest(url, options = {}) {
    if (!user) throw new Error("Sign in with your invited email address first.");
    const token = await user.getIdToken();
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(humanError(data.error || "The exam could not be opened."));
    return data;
  }

  async function submitExam() {
    if (submittingRef.current || !exam) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const data = await signedInRequest("/api/submit-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId, answers, sessionToken })
      });
      setResult(data.result);
      setStarted(false);
      setExam((current) => current ? {
        ...current,
        attemptCount: data.result.attemptNumber,
        bestScore: Math.max(Number(current.bestScore) || 0, Number(data.result.score) || 0),
        passed: data.result.passed
      } : current);
      try { sessionStorage.removeItem(`itest-session:${shareId}`); } catch { /* Session storage may be disabled. */ }
    } catch (submitError) {
      setError(humanError(submitError.message || "Your result could not be saved. Please try again."));
      submittingRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }
  const submitRef = useRef(submitExam);
  submitRef.current = submitExam;

  useEffect(() => {
    if (!started || result) return undefined;
    const interval = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((clientDeadlineRef.current - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds <= 0) {
        window.clearInterval(interval);
        window.setTimeout(() => submitRef.current(), 0);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [started, result]);

  async function begin() {
    setError("");
    setStarting(true);
    setAnswers({});
    try {
      const data = await signedInRequest("/api/start-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId })
      });
      const nextExam = { ...exam, ...(data.exam || {}), attemptNumber: data.attemptNumber, questions: data.questions || [] };
      setExam(nextExam);
      setSessionToken(data.sessionToken);
      try { sessionStorage.setItem(`itest-session:${shareId}`, data.sessionToken); } catch { /* Session storage may be disabled. */ }
      const seconds = Math.max(0, Number(data.remainingSeconds) || 0);
      setRemaining(seconds);
      clientDeadlineRef.current = Number(data.deadlineAt) || Date.now() + seconds * 1000;
      setResult(null);
      submittingRef.current = false;
      setStarted(true);
    } catch (startError) {
      setError(humanError(startError.message || "This exam could not be started."));
      setExam((current) => current && startError.message?.includes("passing score") ? { ...current, passed: true } : current);
    } finally {
      setStarting(false);
    }
  }

  const authGate = !authReady ? <div className="public-exam-state"><LoaderCircle className="spin" size={22} /><p>Checking your iTest account…</p></div>
    : !user ? <section className="public-exam-card public-auth-card">
      <div className="public-exam-mark"><ShieldCheck size={22} /></div><span className="eyebrow">SECURE STUDENT ACCESS</span><h1>{authMode === "signup" ? "Create your iTest account." : "Sign in to your invitation."}</h1>
      <p className="public-exam-summary">Use the exact email address this invitation was sent to. It must be verified before the exam is added to your workspace.</p>
      <form className="public-auth-form" onSubmit={authenticate}>
        {authMode === "signup" && <label className="field"><span>Your name</span><input value={authName} onChange={(event) => setAuthName(event.target.value)} autoComplete="name" maxLength={100} placeholder="First and last name" required /></label>}
        <label className="field"><span>Email address</span><input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" maxLength={254} placeholder="you@example.com" required /></label>
        <label className="field"><span>Password</span><input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete={authMode === "signup" ? "new-password" : "current-password"} minLength={6} placeholder="At least 6 characters" required /></label>
        {error && <div className="public-inline-error"><AlertCircle size={16} />{error}</div>}
        <button className="button button-dark button-large" disabled={authBusy}>{authBusy ? <LoaderCircle className="spin" size={16} /> : authMode === "signup" ? "Create account" : "Sign in"}<ArrowRight size={16} /></button>
      </form>
      {authMessage && <p className="public-auth-message">{authMessage}</p>}
      <div className="public-auth-divider"><span />or<span /></div>
      <button className="button button-outline button-full" onClick={googleSignIn} disabled={authBusy}>Continue with Google</button>
      <p className="public-auth-switch">{authMode === "signup" ? "Already have an account?" : "New to iTest?"} <button onClick={() => { setAuthMode(authMode === "signup" ? "login" : "signup"); setError(""); setAuthMessage(""); }}>{authMode === "signup" ? "Sign in" : "Create an account"}</button></p>
    </section>
    : !user.emailVerified ? <section className="public-exam-card public-auth-card">
      <div className="public-exam-mark"><ShieldCheck size={22} /></div><span className="eyebrow">VERIFY YOUR EMAIL</span><h1>One step before the exam.</h1>
      <p className="public-exam-summary">We sent a verification link to <strong>{user.email}</strong>. Verify that address to connect this invitation to your iTest workspace.</p>
      {authMessage && <p className="public-auth-message">{authMessage}</p>}{error && <div className="public-inline-error"><AlertCircle size={16} />{error}</div>}
      <div className="public-auth-actions"><button className="button button-dark" onClick={refreshVerification} disabled={authBusy}>{authBusy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} I verified my email</button><button className="button button-outline" onClick={resendVerification} disabled={authBusy}>Resend verification</button></div>
      <button className="public-auth-signout" onClick={() => signOut(auth)}><LogOut size={14} /> Use another account</button>
    </section> : null;

  return (
    <div className="public-exam-page">
      <header className="public-exam-header"><a className="public-exam-brand" href="/"><span>i</span>test<small>.</small></a><span>{exam?.workspaceKind === "employer" ? "HIRING ASSESSMENT" : "ASSIGNED EXAM"}</span></header>
      <main className="public-exam-main">
        {authGate ? authGate : loading ? <div className="public-exam-state"><LoaderCircle className="spin" size={22} /><p>Loading your exam…</p></div>
          : error && !exam ? <div className="public-exam-state public-exam-error"><AlertCircle size={25} /><h1>This invitation isn’t available.</h1><p>{error}</p><button className="button button-outline" onClick={() => signOut(auth)}><LogOut size={15} /> Switch account</button></div>
            : result ? <section className="public-result-card"><span className="public-result-icon">{result.passed ? <Check size={24} /> : <Target size={24} />}</span><span className="eyebrow">ATTEMPT {result.attemptNumber} COMPLETE</span><h1>{result.passed ? "You reached the goal." : "Keep building your score."}</h1><div className="public-result-score">{result.score}<small>%</small></div><p>{result.feedback}</p><div className="public-result-points">{result.earned} of {result.totalPoints} points · passing score {result.passingScore}%</div>{result.canRetry ? <button className="button button-dark public-result-action" onClick={begin} disabled={starting}>{starting ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} Try another randomized attempt</button> : <a className="button button-dark public-result-action" href="/">Continue to your iTest workspace <ArrowRight size={15} /></a>}</section>
              : started ? <section className="public-exam-card">
                <div className="public-exam-overline"><span className="eyebrow">{exam.subject || "EXAM"} / ATTEMPT {exam.attemptNumber || ""}</span><span className={`public-timer ${remaining < 60 ? "timer-low" : ""}`}><Clock3 size={15} /> {formatTime(remaining)}</span></div>
                <div className="public-exam-title"><h1>{exam.title}</h1><p>{exam.ownerName || "Your educator"} · passing score {exam.passingScore}% · {exam.questionBankCount} questions in the bank</p></div>
                <div className="public-question-list">{exam.questions.map((question, index) => <section className="public-question-card" key={question.id}><div className="public-question-number">QUESTION {String(index + 1).padStart(2, "0")} <span>{question.points} {question.points === 1 ? "pt" : "pts"}</span></div><h2>{question.prompt}</h2>{question.type === "short_answer" ? <textarea value={answers[question.id] || ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Write your answer" maxLength={2000} rows={4} aria-label={`Answer for question ${index + 1}`} /> : <div className="public-options">{(question.options || []).map((option) => <label className={`public-option ${answers[question.id] === option ? "selected" : ""}`} key={option}><input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option }))} /><span className="public-option-mark" />{option}</label>)}</div>}</section>)}</div>
                {error && <div className="public-inline-error"><AlertCircle size={16} />{error}</div>}
                <div className="public-submit-row"><p>Your score will be saved to both workspaces.</p><button className="button button-dark" onClick={submitExam} disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} Submit attempt</button></div>
              </section> : <section className="public-exam-card public-exam-welcome">
                <div className="public-exam-mark"><GraduationCap size={22} /></div><span className="eyebrow">{exam.workspaceKind === "employer" ? "HIRING ASSESSMENT" : "YOU’RE INVITED TO LEARN"}</span><h1>{exam.title}</h1><p className="public-exam-summary">{exam.summary || "Work through the questions, review your score, and retry until you reach the required result."}</p>
                <div className="public-exam-details"><span><FileIcon /> {exam.questionCount} per attempt</span><span><Clock3 size={15} /> {exam.durationMinutes} minutes</span><span>{exam.subject}</span><span><Target size={15} /> {exam.passingScore}% to pass</span></div>
                <p className="public-exam-owner">From <strong>{exam.ownerName}</strong> · signed in as <strong>{exam.studentName}</strong></p>
                {exam.passed ? <div className="public-already-passed"><Check size={16} /> Requirement met with a best score of {exam.bestScore}%.</div> : <>
                  <div className="public-attempt-note">{exam.attemptCount ? `Your best score is ${exam.bestScore ?? 0}%. This attempt will use a new question selection and shuffled order.` : "Each attempt uses a fresh selection from the question bank and shuffles question and answer order."}</div>
                  {error && <div className="public-inline-error"><AlertCircle size={16} />{error}</div>}
                  <button className="button button-dark button-large public-begin-button" onClick={begin} disabled={starting}>{starting ? <LoaderCircle className="spin" size={16} /> : <>Begin attempt <ArrowRight size={16} /></>}</button>
                </>}
                <p className="public-exam-privacy">This link is connected to your verified email. Your attempt history appears in your iTest workspace and is shared with {exam.workspaceKind === "employer" ? "the hiring team" : "your educator"}.</p>
              </section>}
      </main>
      <footer className="public-exam-footer"><span>iTest / YOUR LEARNING, IN FOCUS</span><span>Take it one question at a time.</span></footer>
    </div>
  );
}

function FileIcon() {
  return <span className="public-file-icon"><GraduationCap size={14} /></span>;
}
