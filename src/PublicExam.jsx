import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, Clock3, GraduationCap, LoaderCircle, Send } from "lucide-react";

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export default function PublicExam({ shareId }) {
  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
    let cancelled = false;
    async function loadExam() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/public-exam?shareId=${encodeURIComponent(shareId)}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "This exam link is not available.");
        if (!cancelled) {
          setExam(data.exam);
          setRemaining(Math.max(1, Number(data.exam.durationMinutes) || 20) * 60);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "This exam could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadExam();
    return () => { cancelled = true; };
  }, [shareId]);

  async function submitExam() {
    if (submittingRef.current || !exam) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/submit-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId, name, email, answers, sessionToken })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Your result could not be saved. Please try again.");
      setResult(data.result);
      try { sessionStorage.removeItem(`itest-session:${shareId}`); } catch { /* Session storage may be disabled. */ }
      setStarted(false);
    } catch (submitError) {
      setError(submitError.message || "Your result could not be saved. Please try again.");
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

  async function begin(event) {
    event.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError("Enter your name and email address to begin.");
      return;
    }
    setError("");
    setStarting(true);
    try {
      const storageKey = `itest-session:${shareId}`;
      let savedToken = "";
      try { savedToken = sessionStorage.getItem(storageKey) || ""; } catch { /* Session storage may be disabled. */ }
      const response = await fetch("/api/start-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId, name, email, sessionToken: savedToken })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "This exam could not be started.");
      setSessionToken(data.sessionToken);
      setName(data.name || name);
      try { sessionStorage.setItem(storageKey, data.sessionToken); } catch { /* Session storage may be disabled. */ }
      const seconds = Math.max(0, Number(data.remainingSeconds) || 0);
      setRemaining(seconds);
      clientDeadlineRef.current = Date.now() + seconds * 1000;
      setStarted(true);
    } catch (startError) {
      setError(startError.message || "This exam could not be started.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="public-exam-page">
      <header className="public-exam-header"><a className="public-exam-brand" href="/"><span>i</span>test<small>.</small></a><span>EDUCATOR INVITATION</span></header>
      <main className="public-exam-main">
        {loading ? <div className="public-exam-state"><LoaderCircle className="spin" size={22} /><p>Loading your exam…</p></div> : error && !exam ? <div className="public-exam-state public-exam-error"><AlertCircle size={25} /><h1>This exam isn’t available.</h1><p>{error}</p><a className="button button-dark" href="/">Go to iTest <ArrowRight size={15} /></a></div> : result ? <section className="public-result-card"><span className="public-result-icon"><Check size={24} /></span><span className="eyebrow">SUBMISSION COMPLETE</span><h1>Your result is in.</h1><div className="public-result-score">{result.score}<small>%</small></div><p>{result.feedback} Your educator can now see your name, email, exam, and score.</p><div className="public-result-points">{result.earned} of {result.totalPoints} points</div><a className="public-back-link" href="/">iTest · Learn with intention</a></section> : started ? <section className="public-exam-card">
          <div className="public-exam-overline"><span className="eyebrow">{exam.subject || "EXAM"} / {exam.questionCount} QUESTIONS</span><span className={`public-timer ${remaining < 60 ? "timer-low" : ""}`}><Clock3 size={15} /> {formatTime(remaining)}</span></div>
          <div className="public-exam-title"><h1>{exam.title}</h1><p>{exam.summary}</p></div>
          <div className="public-question-list">{exam.questions.map((question, index) => <section className="public-question-card" key={question.id}><div className="public-question-number">QUESTION {String(index + 1).padStart(2, "0")} <span>{question.points} {question.points === 1 ? "pt" : "pts"}</span></div><h2>{question.prompt}</h2>{question.type === "short_answer" ? <textarea value={answers[question.id] || ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Write your answer" maxLength={2000} rows={4} aria-label={`Answer for question ${index + 1}`} /> : <div className="public-options">{(question.options || []).map((option) => <label className={`public-option ${answers[question.id] === option ? "selected" : ""}`} key={option}><input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option }))} /><span className="public-option-mark" />{option}</label>)}</div>}</section>)}</div>
          {error && <div className="public-inline-error"><AlertCircle size={16} />{error}</div>}
          <div className="public-submit-row"><p>Your answers are saved securely for your educator.</p><button className="button button-dark" onClick={submitExam} disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} Submit exam</button></div>
        </section> : <section className="public-exam-card public-exam-welcome">
          <div className="public-exam-mark"><GraduationCap size={22} /></div><span className="eyebrow">YOU’RE INVITED TO LEARN</span><h1>{exam.title}</h1><p className="public-exam-summary">{exam.summary || "Take your time, work through each question, and submit your answers when you’re ready."}</p>
          <div className="public-exam-details"><span><FileIcon /> {exam.questionCount} questions</span><span><Clock3 size={15} /> {exam.durationMinutes} minutes</span><span>{exam.subject}</span></div>
          <form className="public-student-form" onSubmit={begin}><label className="field"><span>Your name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="First and last name" maxLength={100} autoComplete="name" required /></label><label className="field"><span>Email address</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" maxLength={254} autoComplete="email" required /></label>{error && <div className="public-inline-error"><AlertCircle size={16} />{error}</div>}<button className="button button-dark button-large" disabled={starting}>{starting ? <LoaderCircle className="spin" size={16} /> : <>Begin exam <ArrowRight size={16} /></>}</button></form>
          <p className="public-exam-privacy">Your name, email, and result will be shared with the educator who sent this exam.</p>
        </section>}
      </main>
      <footer className="public-exam-footer"><span>iTest / YOUR LEARNING, IN FOCUS</span><span>Take it one question at a time.</span></footer>
    </div>
  );
}

function FileIcon() {
  return <span className="public-file-icon"><GraduationCap size={14} /></span>;
}
