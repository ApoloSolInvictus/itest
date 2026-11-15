import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Check, Clock3, Copy, ExternalLink, FileText, FileUp,
  LoaderCircle, Mail, Pencil, Plus, RefreshCw, Send, Trash2, Users, X
} from "lucide-react";

const TABS = [
  { id: "assignments", label: "Exams & links" },
  { id: "lists", label: "Student lists" },
  { id: "results", label: "Results" }
];

function dateLabel(value) {
  const date = new Date(Number(value) || 0);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function statusLabel(status) {
  if (status === "sent") return "Invitations sent";
  if (status === "failed") return "Email delivery failed";
  if (status === "not-configured") return "Email setup needed";
  return "Link ready";
}

export default function EducatorWorkspace({ user, exams, onCreateExam, notify }) {
  const [data, setData] = useState({ lists: [], assignments: [], hasMoreAssignments: false, nextAssignmentCursor: "" });
  const [resultData, setResultData] = useState({ results: [], hasMore: false, nextCursor: "" });
  const [tab, setTab] = useState("assignments");
  const [loading, setLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedExam, setSelectedExam] = useState("");
  const [selectedList, setSelectedList] = useState("");
  const [listDialog, setListDialog] = useState(null);
  const [listName, setListName] = useState("");
  const [students, setStudents] = useState([]);
  const [studentImport, setStudentImport] = useState("");
  const [search, setSearch] = useState("");

  const callApi = useCallback(async (method = "GET", payload = null, query = "") => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/educator${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload ? { "Content-Type": "application/json" } : {})
      },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The educator workspace could not be updated.");
    return result;
  }, [user]);

  const refresh = useCallback(async (showNotice = false) => {
    setLoading(true);
    try {
      const result = await callApi();
      setData({
        lists: result.lists || [],
        assignments: result.assignments || [],
        hasMoreAssignments: result.hasMoreAssignments === true,
        nextAssignmentCursor: result.nextAssignmentCursor || ""
      });
      if (showNotice) notify("Educator workspace refreshed.", "info");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setLoading(false);
    }
  }, [callApi, notify]);

  useEffect(() => { refresh(); }, [refresh]);

  const loadResults = useCallback(async (cursor = "", append = false) => {
    setResultsLoading(true);
    try {
      const query = `?view=results${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const result = await callApi("GET", null, query);
      setResultData((current) => ({
        results: append ? [...current.results, ...(result.results || [])] : (result.results || []),
        hasMore: result.hasMore === true,
        nextCursor: result.nextCursor || ""
      }));
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setResultsLoading(false);
    }
  }, [callApi, notify]);

  useEffect(() => { loadResults(); }, [loadResults]);
  useEffect(() => { if (tab === "results") loadResults(); }, [tab, loadResults]);

  async function loadMoreAssignments() {
    if (!data.nextAssignmentCursor) return;
    setLoading(true);
    try {
      const result = await callApi("GET", null, `?cursor=${encodeURIComponent(data.nextAssignmentCursor)}`);
      setData((current) => ({
        ...current,
        lists: result.lists || current.lists,
        assignments: [...current.assignments, ...(result.assignments || [])],
        hasMoreAssignments: result.hasMoreAssignments === true,
        nextAssignmentCursor: result.nextAssignmentCursor || ""
      }));
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedExam && exams.length) setSelectedExam(exams[0].id);
  }, [exams, selectedExam]);

  useEffect(() => {
    if (!selectedList && data.lists.length) setSelectedList(data.lists[0].id);
  }, [data.lists, selectedList]);

  const results = resultData.results;

  const visibleResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return results;
    return results.filter((result) => `${result.name} ${result.email} ${result.examTitle} ${result.subject}`.toLowerCase().includes(term));
  }, [results, search]);

  const totalContacts = data.lists.reduce((sum, list) => sum + Number(list.studentCount || list.students?.length || 0), 0);
  const averageScore = results.length
    ? Math.round(results.reduce((sum, result) => sum + Number(result.score || 0), 0) / results.length)
    : 0;

  async function createAssignment(event) {
    event.preventDefault();
    if (!selectedExam || !selectedList) return notify("Choose an exam and a student list first.", "info");
    setBusy(true);
    try {
      const result = await callApi("POST", { action: "create-assignment", examId: selectedExam, listId: selectedList });
      if (!result.assignment?.id) throw new Error("The exam link could not be created.");
      let delivery;
      try {
        delivery = await callApi("POST", { action: "send-assignment", id: result.assignment.id });
      } catch (error) {
        await refresh();
        notify(`The exam link was created, but the invitations could not be sent: ${error.message}`, "error");
        return;
      }
      await refresh();
      if (delivery.emailStatus === "sent") {
        notify(`Exam link created and sent to ${Number(delivery.sentCount || 0)} students.`, "success");
      } else if (delivery.emailStatus === "failed") {
        notify("The exam link was saved, but email delivery failed. You can copy the link and try sending again.", "error");
      } else {
        notify("Exam link created. Add the email service settings to send invitations; you can copy the link now.", "info");
      }
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function openListEditor(list = null) {
    setBusy(true);
    try {
      const savedList = list?.id
        ? (await callApi("GET", null, `?listId=${encodeURIComponent(list.id)}`)).list
        : null;
      if (list?.id && !savedList) throw new Error("That student list could not be found.");
      setListDialog(savedList?.id || "new");
      setListName(savedList?.name || "");
      setStudentImport("");
      setStudents(savedList?.students?.length
        ? savedList.students.map((student) => ({ ...student }))
        : [{ id: crypto.randomUUID(), name: "", email: "" }]);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function importStudents() {
    const parseRow = (line) => {
      const cells = [];
      let cell = "";
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"' && line[index + 1] === '"' && quoted) {
          cell += '"';
          index += 1;
        } else if (character === '"') {
          quoted = !quoted;
        } else if ((character === "," || character === "\t" || character === ";") && !quoted) {
          cells.push(cell.trim());
          cell = "";
        } else {
          cell += character;
        }
      }
      cells.push(cell.trim());
      return cells;
    };
    const rows = studentImport.split(/\r?\n/).map(parseRow).filter((cells) => cells.some(Boolean));
    if (!rows.length) return notify("Paste a name and email address for each student.", "info");
    const header = rows[0].map((cell) => cell.toLowerCase());
    const emailColumn = header.findIndex((cell) => cell === "email" || cell.startsWith("email "));
    const hasHeader = emailColumn >= 0;
    const emailIndex = hasHeader ? emailColumn : 1;
    const nameIndex = hasHeader ? header.findIndex((cell) => cell === "name" || cell.includes("student")) : 0;
    const imported = rows.slice(hasHeader ? 1 : 0).map((cells) => ({
      id: crypto.randomUUID(),
      name: cells[Math.max(0, nameIndex)] || "",
      email: cells[emailIndex] || ""
    })).filter((student) => student.name && student.email);
    const known = new Set(students.map((student) => student.email.trim().toLowerCase()).filter(Boolean));
    const unique = imported.filter((student) => {
      const normalized = student.email.trim().toLowerCase();
      if (known.has(normalized)) return false;
      known.add(normalized);
      return true;
    });
    if (!unique.length) return notify("No new name and email pairs were found in that text.", "info");
    if (students.filter((student) => student.name || student.email).length + unique.length > 1000) {
      return notify("This list can contain up to 1,000 students.", "error");
    }
    setStudents((current) => [...current.filter((student) => student.name || student.email), ...unique]);
    setStudentImport("");
    notify(`${unique.length.toLocaleString("en")} students added. Review the list before saving.`, "success");
  }

  async function saveList(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await callApi("POST", {
        action: "save-list",
        id: listDialog && listDialog !== "new" ? listDialog : "",
        name: listName,
        students
      });
      await refresh();
      setSelectedList(result.list.id);
      setListDialog(null);
      notify("Student list saved to your educator workspace.");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteList(list) {
    if (!window.confirm(`Delete “${list.name}”? Existing exam links and results will remain.`)) return;
    setBusy(true);
    try {
      await callApi("POST", { action: "delete-list", id: list.id });
      setSelectedList((current) => current === list.id ? "" : current);
      await refresh();
      notify("Student list deleted.");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function sendAgain(assignment) {
    setBusy(true);
    try {
      const result = await callApi("POST", { action: "send-assignment", id: assignment.id });
      await refresh();
      if (result.emailStatus === "not-configured") {
        notify("Add the email service settings in Vercel before sending invitations.", "info");
      } else {
        notify(`Invitation sent to ${result.sentCount} students.`, "success");
      }
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAssignment(assignment) {
    if (!window.confirm(`Delete the link for “${assignment.title}” and its saved results?`)) return;
    setBusy(true);
    try {
      await callApi("POST", { action: "delete-assignment", id: assignment.id });
      await refresh();
      await loadResults();
      notify("Exam link and its results deleted.");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(link) {
    try {
      await navigator.clipboard.writeText(link);
      notify("Exam link copied.", "success");
    } catch {
      notify("Could not copy the link. Open it and copy the address from your browser.", "error");
    }
  }

  return (
    <div className="educator-page">
      <div className="educator-heading">
        <div><span className="eyebrow">TEACHING WORKSPACE</span><h1>Your class, in focus.</h1><p>Create exam links, invite students, and follow every submitted result.</p></div>
        <div className="educator-heading-actions">
          <button className="button button-outline" onClick={async () => { await refresh(true); if (tab === "results") await loadResults(); }} disabled={loading || busy}><RefreshCw size={15} /> Refresh</button>
          <button className="button button-dark" onClick={onCreateExam}><Plus size={16} /> Create an exam</button>
        </div>
      </div>

      <div className="educator-metrics">
        <article><span className="educator-metric-icon"><FileText size={17} /></span><strong>{data.assignments.length.toString().padStart(2, "0")}</strong><small>Exam links</small></article>
        <article><span className="educator-metric-icon"><Users size={17} /></span><strong>{totalContacts.toLocaleString("en")}</strong><small>Students in lists</small></article>
        <article><span className="educator-metric-icon"><Check size={17} /></span><strong>{results.length.toString().padStart(2, "0")}</strong><small>Results received</small></article>
        <article><span className="educator-metric-icon"><ArrowRight size={17} /></span><strong>{results.length ? `${averageScore}%` : "—"}</strong><small>Average score</small></article>
      </div>

      <div className="educator-tabs" role="tablist" aria-label="Educator workspace sections">
        {TABS.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </div>

      {tab === "assignments" && <section className="educator-section">
        <div className="educator-section-heading"><div><span className="eyebrow">ASSESS & INVITE</span><h2>Create an exam link</h2><p>Each link is unique. Students see the exam, and their answer key stays private.</p></div></div>
        <form className="assignment-create-card" onSubmit={createAssignment}>
          <label className="field"><span>Exam</span><select value={selectedExam} onChange={(event) => setSelectedExam(event.target.value)} disabled={!exams.length}><option value="">{exams.length ? "Choose an exam" : "Create an exam first"}</option>{exams.map((exam) => <option value={exam.id} key={exam.id}>{exam.title} · {exam.subject || "General study"}</option>)}</select></label>
          <label className="field"><span>Student list</span><select value={selectedList} onChange={(event) => setSelectedList(event.target.value)} disabled={!data.lists.length}><option value="">{data.lists.length ? "Choose a saved list" : "Create a student list first"}</option>{data.lists.map((list) => <option value={list.id} key={list.id}>{list.name} · {list.studentCount || list.students?.length || 0}</option>)}</select></label>
          <button className="button button-dark" disabled={busy || loading || !exams.length || !data.lists.length}><Send size={15} /> {busy ? "Preparing…" : "Create link & send"}</button>
        </form>

        <div className="educator-section-heading educator-list-heading"><div><span className="eyebrow">YOUR ACTIVE LINKS</span><h2>Assigned exams</h2></div><span className="educator-count">{data.assignments.length.toLocaleString("en")} shown</span></div>
        {loading ? <div className="educator-loading"><LoaderCircle size={18} className="spin" /> Loading your assignments…</div> : data.assignments.length ? <div className="educator-assignment-list">
          {data.assignments.map((assignment) => <article className="educator-assignment-card" key={assignment.id}>
            <div className="educator-assignment-top"><span className="educator-assignment-icon"><FileText size={17} /></span><div className="educator-assignment-main"><strong>{assignment.title}</strong><span>{assignment.subject} <i>·</i> {assignment.questionCount} questions <i>·</i> {assignment.durationMinutes} min</span></div><span className={`delivery-status delivery-${assignment.emailStatus || "not-sent"}`}><i />{statusLabel(assignment.emailStatus)}</span></div>
            <p className="educator-assignment-meta">Sent to <strong>{assignment.listName || "student list"}</strong> · {Number(assignment.recipientCount || 0).toLocaleString("en")} students · {Number(assignment.totalSubmissions || assignment.results?.length || 0).toLocaleString("en")} results · Created {dateLabel(assignment.createdAt)}</p>
            <div className="educator-link-row"><a href={assignment.shareUrl} target="_blank" rel="noreferrer"><span>{assignment.shareUrl}</span><ExternalLink size={14} /></a><button className="button button-outline button-small" onClick={() => copyLink(assignment.shareUrl)}><Copy size={14} /> Copy</button><button className="button button-outline button-small" onClick={() => sendAgain(assignment)} disabled={busy}><Mail size={14} /> Send again</button><button className="icon-button educator-delete" onClick={() => deleteAssignment(assignment)} aria-label={`Delete link for ${assignment.title}`} disabled={busy}><Trash2 size={15} /></button></div>
          </article>)}
        </div> : <div className="educator-empty"><span className="educator-empty-icon"><Send size={19} /></span><h3>Your first exam link starts here.</h3><p>Choose a saved exam and a student list to create a private, shareable exam link.</p></div>}
        {data.hasMoreAssignments && <div className="educator-load-more"><button className="button button-outline" onClick={loadMoreAssignments} disabled={loading}><ArrowRight size={15} /> {loading ? "Loading…" : "Load more exam links"}</button></div>}
      </section>}

      {tab === "lists" && <section className="educator-section">
        <div className="educator-section-heading"><div><span className="eyebrow">CLASS ROSTERS</span><h2>Student lists</h2><p>Save names and email addresses, then reuse each list for any exam.</p></div><button className="button button-dark" onClick={() => openListEditor()}><Plus size={15} /> New list</button></div>
        {loading ? <div className="educator-loading"><LoaderCircle size={18} className="spin" /> Loading your student lists…</div> : data.lists.length ? <div className="student-list-grid">
          {data.lists.map((list) => <article className="student-list-card" key={list.id}><div className="student-list-head"><span className="student-list-icon"><Users size={17} /></span><button className="icon-button" onClick={() => openListEditor(list)} aria-label={`Edit ${list.name}`}><Pencil size={15} /></button></div><h3>{list.name}</h3><p>{Number(list.studentCount || list.students?.length || 0).toLocaleString("en")} students · Updated {dateLabel(list.updatedAt)}</p><div className="student-list-preview">{list.students?.slice(0, 3).map((student) => <span key={student.id}><strong>{student.name}</strong><small>{student.email}</small></span>)}{Number(list.studentCount || 0) > (list.students?.length || 0) && <small>+ {(Number(list.studentCount) - (list.students?.length || 0)).toLocaleString("en")} more</small>}</div><div className="student-list-actions"><button className="button button-outline button-small" onClick={() => openListEditor(list)}><Pencil size={13} /> Edit list</button><button className="button button-outline button-small" onClick={() => deleteList(list)} disabled={busy}><Trash2 size={13} /> Delete</button></div></article>)}
        </div> : <div className="educator-empty"><span className="educator-empty-icon"><Users size={19} /></span><h3>Build your first student list.</h3><p>Give the list a name, add each student’s name and email, and save it to your workspace.</p><button className="button button-dark" onClick={() => openListEditor()}><Plus size={15} /> Create a list</button></div>}
      </section>}

      {tab === "results" && <section className="educator-section">
        <div className="educator-section-heading"><div><span className="eyebrow">STUDENT PROGRESS</span><h2>Exam results</h2><p>Each submitted score is saved with the student, exam, and subject.</p></div><label className="educator-search"><Users size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a student or exam" aria-label="Search results" /></label></div>
        {resultsLoading && !results.length ? <div className="educator-loading"><LoaderCircle size={18} className="spin" /> Loading results…</div> : visibleResults.length ? <><div className="educator-results-table-wrap"><table className="educator-results-table"><thead><tr><th>STUDENT</th><th>EXAM</th><th>SUBJECT</th><th>RESULT</th><th>SUBMITTED</th></tr></thead><tbody>{visibleResults.map((result) => <tr key={`${result.assignmentId}-${result.id}`}><td><strong>{result.name}</strong><small>{result.email}</small></td><td>{result.examTitle}</td><td>{result.subject || "—"}</td><td><span className="score-pill">{result.score}%</span><small>{result.earned} / {result.totalPoints} points</small></td><td>{dateLabel(result.submittedAt)}</td></tr>)}</tbody></table></div>{resultData.hasMore && <div className="educator-load-more"><button className="button button-outline" onClick={() => loadResults(resultData.nextCursor, true)} disabled={resultsLoading}><ArrowRight size={15} /> {resultsLoading ? "Loading…" : "Load more results"}</button></div>}</> : <div className="educator-empty"><span className="educator-empty-icon"><Check size={19} /></span><h3>No results yet.</h3><p>When a student finishes an assigned exam, their name, email, subject, and score will appear here.</p></div>}
      </section>}

      {listDialog && <div className="educator-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setListDialog(null); }}>
        <form className="educator-modal" onSubmit={saveList}>
          <button type="button" className="icon-button educator-modal-close" onClick={() => setListDialog(null)} aria-label="Close list editor"><X size={18} /></button>
          <span className="eyebrow">STUDENT ROSTER</span><h2>{listDialog === "new" ? "Create a list." : "Edit your list."}</h2><p>Names and email addresses are private to your educator account. Each list supports up to 1,000 students.</p>
          <label className="field"><span>List name</span><input value={listName} onChange={(event) => setListName(event.target.value)} placeholder="e.g. Biology 101 · Spring" maxLength={100} required /></label>
          <div className="student-editor-head"><strong>Students</strong><span>{students.length} rows</span></div>
          <div className="student-import"><label className="field"><span>Paste a roster (name, email)</span><textarea value={studentImport} onChange={(event) => setStudentImport(event.target.value)} placeholder={'Name, email\nAvery Chen, avery@example.com\nJordan Lee, jordan@example.com'} rows={4} /></label><button type="button" className="button button-outline button-small" onClick={importStudents} disabled={!studentImport.trim()}><FileUp size={14} /> Add pasted rows</button></div>
          <div className="student-editor-rows">{students.map((student, index) => <div className="student-editor-row" key={student.id || index}><label className="field"><span>Name</span><input value={student.name} onChange={(event) => setStudents((current) => current.map((item, row) => row === index ? { ...item, name: event.target.value } : item))} placeholder="Student name" maxLength={100} /></label><label className="field"><span>Email</span><input type="email" value={student.email} onChange={(event) => setStudents((current) => current.map((item, row) => row === index ? { ...item, email: event.target.value } : item))} placeholder="student@example.com" maxLength={254} /></label><button type="button" className="icon-button" onClick={() => setStudents((current) => current.filter((_, row) => row !== index))} aria-label={`Remove student ${index + 1}`}><Trash2 size={15} /></button></div>)}</div>
          <button type="button" className="educator-add-student" onClick={() => setStudents((current) => [...current, { id: crypto.randomUUID(), name: "", email: "" }])}><Plus size={15} /> Add a student</button>
          <div className="educator-modal-actions"><button type="button" className="button button-outline" onClick={() => setListDialog(null)} disabled={busy}>Cancel</button><button className="button button-dark" disabled={busy || !listName.trim()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Save list</button></div>
        </form>
      </div>}
      <p className="educator-privacy-note"><Clock3 size={14} /> Exam links stay active until you delete them. Results and rosters are visible only to your educator account.</p>
    </div>
  );
}
