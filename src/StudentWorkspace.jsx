import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Award, BookOpen, Check, Clock3, ExternalLink, LoaderCircle, RefreshCw, Target } from "lucide-react";

function dateLabel(value) {
  const date = new Date(Number(value) || 0);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function scoreProgress(score, target) {
  if (score == null) return 0;
  if (Number(target) <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((Number(score) / Number(target)) * 100)));
}

export default function StudentWorkspace({ user, onCreateExam, notify }) {
  const [assignments, setAssignments] = useState([]);
  const [attemptPages, setAttemptPages] = useState({});
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");

  const callApi = useCallback(async (query = "") => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/student${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The student workspace could not be loaded.");
    return data;
  }, [user]);

  const refresh = useCallback(async (showNotice = false) => {
    setLoading(true);
    try {
      const data = await callApi();
      setAssignments(data.assignments || []);
      if (showNotice) notify("Assigned exams refreshed.", "info");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setLoading(false);
    }
  }, [callApi, notify]);

  useEffect(() => { refresh(); }, [refresh]);

  async function toggleAttempts(assignment) {
    const key = assignment.id;
    if (expandedId === key) {
      setExpandedId("");
      return;
    }
    setExpandedId(key);
    if (attemptPages[key]) return;
    setBusyKey(key);
    try {
      const query = `?view=attempts&assignmentKey=${encodeURIComponent(key)}`;
      const data = await callApi(query);
      setAttemptPages((current) => ({
        ...current,
        [key]: { attempts: data.attempts || [], hasMore: data.hasMore === true, nextCursor: data.nextCursor || "" }
      }));
    } catch (error) {
      notify(error.message, "error");
      setExpandedId("");
    } finally {
      setBusyKey("");
    }
  }

  async function loadMoreAttempts(assignment) {
    const current = attemptPages[assignment.id];
    if (!current?.nextCursor) return;
    setBusyKey(assignment.id);
    try {
      const query = `?view=attempts&assignmentKey=${encodeURIComponent(assignment.id)}&cursor=${encodeURIComponent(current.nextCursor)}`;
      const data = await callApi(query);
      setAttemptPages((pages) => ({
        ...pages,
        [assignment.id]: {
          attempts: [...(pages[assignment.id]?.attempts || []), ...(data.attempts || [])],
          hasMore: data.hasMore === true,
          nextCursor: data.nextCursor || ""
        }
      }));
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusyKey("");
    }
  }

  const completedAttempts = assignments.reduce((sum, item) => sum + Number(item.attemptCount || 0), 0);
  const passedCount = assignments.filter((item) => item.passed === true).length;
  const averageBest = assignments.filter((item) => item.bestScore != null && Number.isFinite(Number(item.bestScore)))
    .map((item) => Number(item.bestScore));
  const meanScore = averageBest.length
    ? Math.round(averageBest.reduce((sum, score) => sum + score, 0) / averageBest.length)
    : null;

  return (
    <div className="student-workspace">
      <div className="student-workspace-heading">
        <div><span className="eyebrow">YOUR COURSEWORK</span><h1>Learn, retry, and make it stick.</h1><p>Teacher and hiring assessments appear here after you open their invitation with your verified iTest email.</p></div>
        <button className="button button-outline" onClick={() => refresh(true)} disabled={loading}><RefreshCw size={15} /> Refresh</button>
      </div>

      <div className="student-workspace-metrics">
        <article><span><BookOpen size={17} /></span><strong>{assignments.length.toString().padStart(2, "0")}</strong><small>Assigned subjects</small></article>
        <article><span><Clock3 size={17} /></span><strong>{completedAttempts.toString().padStart(2, "0")}</strong><small>Attempts completed</small></article>
        <article><span><Award size={17} /></span><strong>{meanScore == null ? "—" : `${meanScore}%`}</strong><small>Average best score</small></article>
      </div>

      {loading && !assignments.length ? <div className="student-workspace-empty"><LoaderCircle className="spin" size={19} /><p>Loading your assigned courses…</p></div> : assignments.length ? <div className="student-course-grid">
        {assignments.map((assignment) => {
          const history = attemptPages[assignment.id];
          const target = Number(assignment.passingScore ?? 70);
          const progress = scoreProgress(assignment.bestScore, target);
          const passed = assignment.passed === true;
          const hiring = assignment.workspaceKind === "employer";
          return <article className={`student-course-card ${passed ? "student-course-passed" : ""}`} key={assignment.id}>
            <div className="student-course-top"><span className="student-course-icon">{passed ? <Check size={18} /> : hiring ? <Target size={18} /> : <BookOpen size={18} />}</span><span className={`student-course-status ${passed ? "is-passed" : ""}`}>{passed ? "PASSED" : assignment.attemptCount ? "IN PROGRESS" : "READY"}</span></div>
            <span className="eyebrow">{hiring ? "HIRING ASSESSMENT" : "ASSIGNED COURSE"}</span>
            <h2>{assignment.title}</h2>
            <p className="student-course-subject">{assignment.subject || "General study"}</p>
            <p className="student-course-teacher">{hiring ? "Hiring team" : "Educator"}: <strong>{assignment.teacherName || "iTest educator"}</strong></p>
            <div className="student-course-progress-label"><span>Best score</span><strong>{assignment.bestScore == null ? "Not taken" : `${assignment.bestScore}%`}</strong></div>
            <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
            <div className="student-course-meta"><span>{Number(assignment.attemptCount || 0)} {Number(assignment.attemptCount || 0) === 1 ? "attempt" : "attempts"}</span><span>{target}% to pass</span></div>
            <div className="student-course-actions">
              {passed ? <span className="student-passed-label"><Check size={14} /> Requirement met</span> : <a className="button button-dark button-small" href={`/exam/${encodeURIComponent(assignment.shareId)}`}>{assignment.attemptCount ? "Try again" : "Start exam"} <ArrowRight size={14} /></a>}
              <button className="button button-outline button-small" onClick={() => toggleAttempts(assignment)}>{expandedId === assignment.id ? "Hide attempts" : "View attempts"}</button>
            </div>
            {hiring && <p className="student-course-note">Your assessment score is one part of the employer’s review.</p>}
            {expandedId === assignment.id && <div className="student-attempt-history">
              <h3>Score history</h3>
              {busyKey === assignment.id && !history ? <p className="student-history-empty"><LoaderCircle className="spin" size={14} /> Loading attempts…</p> : history?.attempts?.length ? <ol>{history.attempts.map((attempt) => <li key={attempt.id}><span>Attempt {attempt.attemptNumber}</span><strong className={attempt.passed ? "attempt-passed" : ""}>{attempt.score}%</strong><small>{dateLabel(attempt.submittedAt)} · {attempt.earned}/{attempt.totalPoints} points</small></li>)}</ol> : <p className="student-history-empty">Your first score will appear here after you submit.</p>}
              {history?.hasMore && <button className="student-history-more" onClick={() => loadMoreAttempts(assignment)} disabled={busyKey === assignment.id}>{busyKey === assignment.id ? <LoaderCircle className="spin" size={13} /> : <ArrowRight size={13} />} Load more attempts</button>}
            </div>}
          </article>;
        })}
      </div> : <div className="student-workspace-empty">
        <span className="student-course-icon"><BookOpen size={19} /></span><h2>No assigned courses yet.</h2><p>When an educator or hiring team invites you, open the email link while signed in with the same verified email address. It will then appear here.</p><button className="button button-dark" onClick={onCreateExam}>Create a practice exam <ArrowRight size={15} /></button>
      </div>}
      {assignments.some((item) => item.workspaceKind === "employer") && <p className="student-workspace-note"><ExternalLink size={14} /> Hiring scores are assessment evidence for human review; iTest does not make employment decisions.</p>}
    </div>
  );
}
