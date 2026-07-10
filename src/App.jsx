import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { storage } from "./storage.js";
import {
  Gauge, Wrench, AlertTriangle, ClipboardList, Bell, BarChart3,
  LogOut, Plus, X, Clock, MapPin, Factory, Calendar, ChevronRight,
  CheckCircle2, Circle, PlayCircle, Zap, TrendingUp,
  Users, Building2, ChevronDown, RefreshCw, Loader2, History as HistoryIcon,
  Sparkles, ShieldAlert, Activity
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from "recharts";

/* ==========================================================================
   MEO — Maintenance Execution OS
   Tokens: bg #12161A · surface #1B2127 · raised #232B33 · line #2B333B
   text-hi #EAEEF1 · text-lo #8A96A3 · amber #F5A623 · red #E5484D
   green #34D399 · blue #4C9FE5
   Display: Space Grotesk · Body/UI: Inter · Data: IBM Plex Mono
   Signature: the AI Priority Queue — a stacked HUD-style decision console
   ========================================================================== */

function useFonts() {
  useEffect(() => {
    if (document.getElementById("meo-fonts")) return;
    const l = document.createElement("link");
    l.id = "meo-fonts";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(l);
  }, []);
}

const F_DISPLAY = "'Space Grotesk', sans-serif";
const F_BODY = "'Inter', sans-serif";
const F_MONO = "'IBM Plex Mono', monospace";

const SEVERITIES = ["Low", "Medium", "High", "Critical"];
const SEV_COLOR = { Low: "#4C9FE5", Medium: "#F5A623", High: "#FB7A3C", Critical: "#E5484D" };
const STATUS_COLOR = { Running: "#34D399", Maintenance: "#F5A623", Offline: "#E5484D" };
const TASK_STATUSES = ["Not Started", "In Progress", "Completed"];
const ROLES = ["Manager", "Operator", "Technician"];
const RISK_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function uid(p) { return p + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function fmtDate(iso) { if (!iso) return "—"; return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
function fmtDateTime(iso) { if (!iso) return "—"; const d = new Date(iso); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
function relTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.round(hrs / 24) + "d ago";
}
function isOverdue(dueDate, status) { return status !== "Completed" && new Date(dueDate) < new Date(new Date().toDateString()); }

function seedData() {
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
  const machines = [
    { id: uid("m"), name: "Stamping Press A", machineId: "SP-001", location: "Bay 1", manufacturer: "Komatsu", installDate: iso(900), interval: 30, status: "Running" },
    { id: uid("m"), name: "Conveyor Line C", machineId: "CV-014", location: "Bay 2", manufacturer: "Siemens", installDate: iso(600), interval: 14, status: "Maintenance" },
    { id: uid("m"), name: "CNC Mill D", machineId: "CNC-007", location: "Bay 3", manufacturer: "Haas", installDate: iso(1200), interval: 60, status: "Running" },
    { id: uid("m"), name: "Air Compressor B", machineId: "AC-002", location: "Utility Room", manufacturer: "Atlas Copco", installDate: iso(300), interval: 45, status: "Offline" },
  ];
  const issues = [
    { id: uid("i"), machineId: machines[1].id, description: "Unusual grinding noise from drive motor, intermittent.", severity: "High", photoNote: "", reportedBy: "J. Alvarez", reportedAt: iso(1), resolved: false },
    { id: uid("i"), machineId: machines[3].id, description: "Compressor tripped breaker twice this shift, won't hold pressure.", severity: "Critical", photoNote: "", reportedBy: "M. Chen", reportedAt: iso(0.2), resolved: false },
    { id: uid("i"), machineId: machines[0].id, description: "Minor hydraulic fluid seepage near base plate.", severity: "Low", photoNote: "", reportedBy: "J. Alvarez", reportedAt: iso(6), resolved: true },
  ];
  const tasks = [
    { id: uid("t"), title: "Inspect drive motor bearings", machineId: machines[1].id, assignedTo: "R. Novak", dueDate: iso(-1), priority: "High", status: "In Progress", createdAt: iso(1), relatedIssueId: issues[0].id, downtimeHours: null, technicianNotes: "", partsReplaced: "", completedAt: null },
    { id: uid("t"), title: "Replace hydraulic seal", machineId: machines[0].id, assignedTo: "R. Novak", dueDate: iso(-8), priority: "Low", status: "Completed", createdAt: iso(7), relatedIssueId: issues[2].id, downtimeHours: 2.5, technicianNotes: "Seal worn, replaced with OEM part. No further seepage.", partsReplaced: "Base plate seal kit", completedAt: iso(6) },
    { id: uid("t"), title: "Diagnose compressor trip fault", machineId: machines[3].id, assignedTo: "Unassigned", dueDate: iso(-0.2), priority: "Critical", status: "Not Started", createdAt: iso(0.2), relatedIssueId: issues[1].id, downtimeHours: null, technicianNotes: "", partsReplaced: "", completedAt: null },
  ];
  const activity = [
    { id: uid("a"), text: "Issue reported on Compressor B — Critical", at: iso(0.2) },
    { id: uid("a"), text: "Task created: Diagnose compressor trip fault", at: iso(0.2) },
    { id: uid("a"), text: "Issue reported on Conveyor Line C — High", at: iso(1) },
    { id: uid("a"), text: "Task completed: Replace hydraulic seal", at: iso(6) },
  ];
  return { machines, issues, tasks, activity, aiRun: null };
}
function emptyData() { return { machines: [], issues: [], tasks: [], activity: [], aiRun: null }; }

/* ---------------------------- small primitives ---------------------------- */

function Badge({ color, children, mono }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px",
      borderRadius: 5, fontSize: 11.5, fontWeight: 600, letterSpacing: 0.2,
      color, background: color + "1A", border: "1px solid " + color + "40",
      fontFamily: mono ? F_MONO : F_BODY, whiteSpace: "nowrap"
    }}>{children}</span>
  );
}

function Dot({ color }) {
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 0 3px ${color}22` }} />;
}

function Card({ children, style, ...rest }) {
  return (
    <div style={{ background: "#1B2127", border: "1px solid #2B333B", borderRadius: 10, ...style }} {...rest}>
      {children}
    </div>
  );
}

function Button({ children, onClick, variant = "primary", style, disabled, type = "button" }) {
  const base = {
    fontFamily: F_BODY, fontWeight: 600, fontSize: 13.5, padding: "9px 16px",
    borderRadius: 7, border: "1px solid transparent", cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex", alignItems: "center", gap: 7, transition: "all .15s ease",
    opacity: disabled ? 0.5 : 1,
  };
  const variants = {
    primary: { background: "#F5A623", color: "#14181C", border: "1px solid #F5A623" },
    ghost: { background: "transparent", color: "#EAEEF1", border: "1px solid #2B333B" },
    danger: { background: "#E5484D1A", color: "#E5484D", border: "1px solid #E5484D40" },
    subtle: { background: "#232B33", color: "#EAEEF1", border: "1px solid #2B333B" },
  };
  return (
    <button type={type} disabled={disabled} onClick={onClick} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#8A96A3", fontWeight: 600 }}>
      {label}
      {children}
    </label>
  );
}

const inputStyle = {
  background: "#12161A", border: "1px solid #2B333B", borderRadius: 6, color: "#EAEEF1",
  padding: "9px 11px", fontSize: 13.5, fontFamily: F_BODY, outline: "none",
};

function Modal({ title, onClose, children, width = 480 }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "#080A0C99", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1B2127", border: "1px solid #2B333B", borderRadius: 12, width,
        maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px #00000066"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #2B333B", position: "sticky", top: 0, background: "#1B2127" }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 16, color: "#EAEEF1" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8A96A3", cursor: "pointer", padding: 4 }}><X size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div style={{ padding: "40px 20px", textAlign: "center", color: "#8A96A3" }}>
      <Icon size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
      <div style={{ fontSize: 13.5 }}>{text}</div>
    </div>
  );
}

function RoleGate({ role, allow, children }) {
  if (!allow.includes(role)) return null;
  return children;
}

/* ---------------------------------- App ----------------------------------- */

export default function App() {
  useFonts();
  const [session, setSession] = useState(null); // { workspace, name, role }
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const saveTimer = useRef(null);

  const workspaceKey = session ? "meo:data:" + session.workspace.trim().toLowerCase() : null;

  // Load workspace data on join
  useEffect(() => {
    if (!workspaceKey) return;
    setLoading(true);
    (async () => {
      try {
        const res = await storage.get(workspaceKey);
        setData(res && res.value ? JSON.parse(res.value) : emptyData());
      } catch (e) {
        setData(emptyData());
      } finally {
        setLoading(false);
      }
    })();
  }, [workspaceKey]);

  // Debounced persist
  useEffect(() => {
    if (!workspaceKey || !data) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await storage.set(workspaceKey, JSON.stringify(data)); } catch (e) { /* noop */ }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [data, workspaceKey]);

  const logActivity = useCallback((text) => {
    setData((d) => ({ ...d, activity: [{ id: uid("a"), text, at: new Date().toISOString() }, ...d.activity].slice(0, 50) }));
  }, []);

  if (!session) return <Login onJoin={setSession} />;
  if (loading || !data) return <LoadingScreen />;

  const notifications = computeNotifications(data);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#12161A", fontFamily: F_BODY, color: "#EAEEF1" }}>
      <Sidebar tab={tab} setTab={setTab} session={session} onLeave={() => setSession(null)} notifCount={notifications.length} />
      <main style={{ flex: 1, minWidth: 0, padding: "28px 32px", maxWidth: 1180 }}>
        {tab === "dashboard" && <Dashboard data={data} session={session} setTab={setTab} />}
        {tab === "assets" && <Assets data={data} setData={setData} session={session} logActivity={logActivity} />}
        {tab === "issues" && <Issues data={data} setData={setData} session={session} logActivity={logActivity} />}
        {tab === "history" && <MaintHistory data={data} />}
        {tab === "ai" && <AiAssistant data={data} setData={setData} logActivity={logActivity} />}
        {tab === "tasks" && <Tasks data={data} setData={setData} session={session} logActivity={logActivity} />}
        {tab === "notifications" && <Notifications items={notifications} />}
        {tab === "reports" && <Reports data={data} />}
      </main>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", background: "#12161A", display: "flex", alignItems: "center", justifyContent: "center", color: "#8A96A3" }}>
      <Loader2 className="spin" size={22} style={{ marginRight: 10, animation: "meo-spin 1s linear infinite" }} />
      Loading workspace…
      <style>{`@keyframes meo-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* --------------------------------- Login ---------------------------------- */

function Login({ onJoin }) {
  useFonts();
  const [workspace, setWorkspace] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("Manager");

  return (
    <div style={{
      minHeight: "100vh", background: "#12161A", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: F_BODY, color: "#EAEEF1", padding: 20
    }}>
      <div style={{ width: 420, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "#F5A623", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Gauge size={19} color="#14181C" />
          </div>
          <div>
            <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 18, letterSpacing: 0.2 }}>MEO</div>
            <div style={{ fontSize: 11, color: "#8A96A3", fontFamily: F_MONO, letterSpacing: 0.4 }}>MAINTENANCE EXECUTION OS</div>
          </div>
        </div>

        <Card style={{ padding: 24 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 17, marginBottom: 4 }}>Sign in to your workspace</div>
          <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 20 }}>
            Enter your company's workspace name to join or create it. Anyone using the same name shares the same floor data.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Company workspace">
              <input style={inputStyle} placeholder="e.g. northgate-plant-2" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
            </Field>
            <Field label="Your name">
              <input style={inputStyle} placeholder="e.g. J. Alvarez" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Your role">
              <div style={{ display: "flex", gap: 8 }}>
                {ROLES.map((r) => (
                  <button key={r} onClick={() => setRole(r)} style={{
                    flex: 1, padding: "8px 6px", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                    background: role === r ? "#F5A6231A" : "#12161A", color: role === r ? "#F5A623" : "#8A96A3",
                    border: "1px solid " + (role === r ? "#F5A62360" : "#2B333B")
                  }}>{r}</button>
                ))}
              </div>
            </Field>
            <Button
              disabled={!workspace.trim() || !name.trim()}
              onClick={() => onJoin({ workspace: workspace.trim(), name: name.trim(), role })}
              style={{ justifyContent: "center", marginTop: 6 }}
            >
              Enter workspace <ChevronRight size={15} />
            </Button>
          </div>
        </Card>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#5B6672", marginTop: 14 }}>
          Prototype auth — data is shared per workspace name, not password-protected.
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Sidebar ---------------------------------- */

function Sidebar({ tab, setTab, session, onLeave, notifCount }) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: Gauge },
    { id: "assets", label: "Assets", icon: Factory },
    { id: "issues", label: "Issues", icon: AlertTriangle },
    { id: "history", label: "Maintenance History", icon: HistoryIcon },
    { id: "ai", label: "AI Decision Assistant", icon: Sparkles, hot: true },
    { id: "tasks", label: "Tasks", icon: ClipboardList },
    { id: "notifications", label: "Notifications", icon: Bell, badge: notifCount },
    { id: "reports", label: "Reports", icon: BarChart3 },
  ];
  return (
    <aside style={{ width: 236, flexShrink: 0, background: "#161B20", borderRight: "1px solid #2B333B", padding: "20px 14px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px", marginBottom: 22 }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: "#F5A623", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Gauge size={16} color="#14181C" />
        </div>
        <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 15.5 }}>MEO</div>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {items.map((it) => {
          const active = tab === it.id;
          const Icon = it.icon;
          return (
            <button key={it.id} onClick={() => setTab(it.id)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 7,
              background: active ? "#232B33" : "transparent", border: "none", cursor: "pointer",
              color: active ? "#EAEEF1" : "#8A96A3", fontSize: 13.5, fontWeight: 500, textAlign: "left",
              borderLeft: active ? "2px solid #F5A623" : "2px solid transparent"
            }}>
              <Icon size={16} color={it.hot && !active ? "#F5A623" : undefined} />
              <span style={{ flex: 1 }}>{it.label}</span>
              {!!it.badge && <span style={{ background: "#E5484D", color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 10 }}>{it.badge}</span>}
            </button>
          );
        })}
      </nav>

      <div style={{ borderTop: "1px solid #2B333B", paddingTop: 12, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px", marginBottom: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#232B33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#F5A623" }}>
            {session.name.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.name}</div>
            <div style={{ fontSize: 10.5, color: "#8A96A3" }}>{session.role} · {session.workspace}</div>
          </div>
        </div>
        <button onClick={onLeave} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", color: "#8A96A3", fontSize: 12.5, cursor: "pointer", padding: "6px 8px" }}>
          <LogOut size={14} /> Leave workspace
        </button>
      </div>
    </aside>
  );
}

function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, gap: 12 }}>
      <div>
        <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 22, marginBottom: 4 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: "#8A96A3" }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------- Dashboard --------------------------------- */

function computeNotifications(data) {
  const items = [];
  data.issues.filter((i) => !i.resolved && (Date.now() - new Date(i.reportedAt)) < 86400000 * 2).forEach((i) => {
    const m = data.machines.find((m) => m.id === i.machineId);
    items.push({ id: i.id, kind: "issue", severity: i.severity, text: `New issue reported on ${m ? m.name : "a machine"} — ${i.severity}`, at: i.reportedAt });
  });
  data.tasks.filter((t) => isOverdue(t.dueDate, t.status)).forEach((t) => {
    items.push({ id: t.id, kind: "overdue", severity: t.priority, text: `Task overdue: ${t.title}`, at: t.dueDate });
  });
  data.tasks.filter((t) => t.status === "Not Started").slice(0, 5).forEach((t) => {
    if (t.assignedTo && t.assignedTo !== "Unassigned") items.push({ id: t.id + "-a", kind: "assigned", severity: t.priority, text: `Task assigned to ${t.assignedTo}: ${t.title}`, at: t.createdAt });
  });
  if (data.aiRun) {
    (data.aiRun.recommendations || []).filter((r) => r.risk === "High" || r.risk === "Critical").forEach((r) => {
      items.push({ id: r.machineId + "-ai", kind: "ai", severity: r.risk, text: `High-risk recommendation: ${r.action}`, at: data.aiRun.generatedAt });
    });
  }
  return items.sort((a, b) => new Date(b.at) - new Date(a.at));
}

function Dashboard({ data, session, setTab }) {
  const running = data.machines.filter((m) => m.status === "Running").length;
  const needsAttention = data.machines.filter((m) => m.status !== "Running" ||
    data.issues.some((i) => i.machineId === m.id && !i.resolved && (i.severity === "High" || i.severity === "Critical"))).length;
  const openTasks = data.tasks.filter((t) => t.status !== "Completed").length;
  const overdueTasks = data.tasks.filter((t) => isOverdue(t.dueDate, t.status)).length;
  const priorities = (data.aiRun?.recommendations || []).slice().sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk]).slice(0, 3);

  const stats = [
    { label: "Machines running", value: running, total: data.machines.length, color: "#34D399", icon: Factory },
    { label: "Need attention", value: needsAttention, color: "#F5A623", icon: AlertTriangle },
    { label: "Open tasks", value: openTasks, color: "#4C9FE5", icon: ClipboardList },
    { label: "Overdue tasks", value: overdueTasks, color: "#E5484D", icon: Clock },
  ];

  return (
    <div>
      <PageHeader title={`Good ${greeting()}, ${session.name.split(" ")[0]}`} subtitle="Here's where the floor stands right now." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 22 }}>
        {stats.map((s) => (
          <Card key={s.label} style={{ padding: "16px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <s.icon size={16} color={s.color} />
            </div>
            <div style={{ fontFamily: F_MONO, fontSize: 26, fontWeight: 600 }}>{s.value}{s.total !== undefined ? <span style={{ fontSize: 14, color: "#5B6672" }}> /{s.total}</span> : null}</div>
            <div style={{ fontSize: 12, color: "#8A96A3", marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
        <Card style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15 }}>
              <Sparkles size={16} color="#F5A623" /> Today's Priorities
            </div>
            <button onClick={() => setTab("ai")} style={{ background: "none", border: "none", color: "#F5A623", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              Open assistant <ChevronRight size={13} />
            </button>
          </div>
          {priorities.length === 0 ? (
            <EmptyState icon={Sparkles} text="No recommendations yet. Run the AI Decision Assistant to generate today's priorities." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {priorities.map((r, idx) => <PriorityRow key={idx} r={r} compact />)}
            </div>
          )}
        </Card>

        <Card style={{ padding: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <Activity size={16} color="#4C9FE5" /> Recent activity
          </div>
          {data.activity.length === 0 ? <EmptyState icon={Activity} text="Nothing has happened yet." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.activity.slice(0, 8).map((a) => (
                <div key={a.id} style={{ display: "flex", gap: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4C9FE5", marginTop: 6, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 12.5 }}>{a.text}</div>
                    <div style={{ fontSize: 11, color: "#5B6672", fontFamily: F_MONO }}>{relTime(a.at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning"; if (h < 17) return "afternoon"; return "evening";
}

/* --------------------------------- Assets ----------------------------------- */

function Assets({ data, setData, session, logActivity }) {
  const [modal, setModal] = useState(null); // machine or null-for-new, or false
  const canEdit = session.role === "Manager";

  function save(machine) {
    setData((d) => {
      const exists = d.machines.some((m) => m.id === machine.id);
      const machines = exists ? d.machines.map((m) => (m.id === machine.id ? machine : m)) : [...d.machines, machine];
      return { ...d, machines };
    });
    logActivity(`${modal && modal.id ? "Updated" : "Registered"} machine ${machine.name} (${machine.machineId})`);
    setModal(null);
  }

  return (
    <div>
      <PageHeader title="Assets" subtitle="Every machine your team is responsible for." action={
        <RoleGate role={session.role} allow={["Manager"]}>
          <Button onClick={() => setModal({})}><Plus size={15} /> Register machine</Button>
        </RoleGate>
      } />
      {data.machines.length === 0 ? (
        <Card style={{ padding: 32, textAlign: "center" }}>
          <Factory size={28} style={{ opacity: 0.4, marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No machines registered yet</div>
          <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 18, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
            Register your real machines to get started — the AI assistant works off exactly what your team logs here, nothing pre-filled.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <RoleGate role={session.role} allow={["Manager"]}>
              <Button onClick={() => setModal({})}><Plus size={15} /> Register your first machine</Button>
              <Button variant="ghost" onClick={() => {
                const sample = seedData();
                setData((d) => ({ ...d, ...sample }));
                logActivity("Loaded sample data for demo purposes");
              }}>Load sample data instead</Button>
            </RoleGate>
          </div>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
          {data.machines.map((m) => {
            const openIssues = data.issues.filter((i) => i.machineId === m.id && !i.resolved).length;
            return (
              <Card key={m.id} style={{ padding: 18, cursor: canEdit ? "pointer" : "default" }} onClick={() => canEdit && setModal(m)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15.5 }}>{m.name}</div>
                    <div style={{ fontFamily: F_MONO, fontSize: 11.5, color: "#8A96A3", marginTop: 2 }}>{m.machineId}</div>
                  </div>
                  <Badge color={STATUS_COLOR[m.status]}><Dot color={STATUS_COLOR[m.status]} />{m.status}</Badge>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12, color: "#8A96A3" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}><MapPin size={12} /> {m.location}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Factory size={12} /> {m.manufacturer}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Calendar size={12} /> Installed {fmtDate(m.installDate)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Clock size={12} /> Every {m.interval}d</span>
                </div>
                {openIssues > 0 && <div style={{ marginTop: 10 }}><Badge color="#E5484D">{openIssues} open issue{openIssues > 1 ? "s" : ""}</Badge></div>}
              </Card>
            );
          })}
        </div>
      )}
      {modal !== null && <MachineModal machine={modal} onClose={() => setModal(null)} onSave={save} />}
    </div>
  );
}

function MachineModal({ machine, onClose, onSave }) {
  const [form, setForm] = useState({
    id: machine.id || uid("m"), name: machine.name || "", machineId: machine.machineId || "",
    location: machine.location || "", manufacturer: machine.manufacturer || "",
    installDate: machine.installDate ? machine.installDate.slice(0, 10) : "", interval: machine.interval || 30,
    status: machine.status || "Running",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Modal title={machine.id ? "Edit machine" : "Register machine"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Machine name"><input style={inputStyle} value={form.name} onChange={set("name")} placeholder="Stamping Press A" /></Field>
        <Field label="Machine ID"><input style={{ ...inputStyle, fontFamily: F_MONO }} value={form.machineId} onChange={set("machineId")} placeholder="SP-001" /></Field>
        <Field label="Location"><input style={inputStyle} value={form.location} onChange={set("location")} placeholder="Bay 1" /></Field>
        <Field label="Manufacturer"><input style={inputStyle} value={form.manufacturer} onChange={set("manufacturer")} placeholder="Komatsu" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Installation date"><input type="date" style={inputStyle} value={form.installDate} onChange={set("installDate")} /></Field>
          <Field label="Maintenance interval (days)"><input type="number" style={inputStyle} value={form.interval} onChange={set("interval")} /></Field>
        </div>
        <Field label="Status">
          <div style={{ display: "flex", gap: 8 }}>
            {["Running", "Maintenance", "Offline"].map((s) => (
              <button key={s} onClick={() => setForm((f) => ({ ...f, status: s }))} style={{
                flex: 1, padding: "8px 6px", borderRadius: 6, cursor: "pointer", fontSize: 12,
                background: form.status === s ? STATUS_COLOR[s] + "1A" : "#12161A",
                color: form.status === s ? STATUS_COLOR[s] : "#8A96A3", border: "1px solid " + (form.status === s ? STATUS_COLOR[s] + "60" : "#2B333B")
              }}>{s}</button>
            ))}
          </div>
        </Field>
        <Button style={{ justifyContent: "center", marginTop: 6 }} disabled={!form.name || !form.machineId}
          onClick={() => onSave({ ...form, installDate: form.installDate ? new Date(form.installDate).toISOString() : new Date().toISOString(), interval: Number(form.interval) || 30 })}>
          Save machine
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------------- Issues ------------------------------------ */

function Issues({ data, setData, session, logActivity }) {
  const [modal, setModal] = useState(false);
  const sorted = data.issues.slice().sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));

  function addIssue(issue) {
    setData((d) => ({ ...d, issues: [issue, ...d.issues] }));
    const m = data.machines.find((m) => m.id === issue.machineId);
    logActivity(`Issue reported on ${m ? m.name : "a machine"} — ${issue.severity}`);
    setModal(false);
  }
  function toggleResolved(issue) {
    setData((d) => ({ ...d, issues: d.issues.map((i) => (i.id === issue.id ? { ...i, resolved: !i.resolved } : i)) }));
  }

  return (
    <div>
      <PageHeader title="Issues" subtitle="What operators are seeing on the floor." action={<Button onClick={() => setModal(true)}><Plus size={15} /> Report issue</Button>} />
      {sorted.length === 0 ? <EmptyState icon={AlertTriangle} text="No issues reported." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((i) => {
            const m = data.machines.find((m) => m.id === i.machineId);
            return (
              <Card key={i.id} style={{ padding: 16, opacity: i.resolved ? 0.55 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <Badge color={SEV_COLOR[i.severity]}>{i.severity}</Badge>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{m ? m.name : "Unknown machine"}</span>
                      <span style={{ fontFamily: F_MONO, fontSize: 11, color: "#5B6672" }}>{m?.machineId}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#C7CED5", marginBottom: 8 }}>{i.description}</div>
                    <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "#8A96A3" }}>
                      <span>Reported by {i.reportedBy}</span>
                      <span>{fmtDateTime(i.reportedAt)}</span>
                      {i.photoNote && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><ImageIcon size={12} /> Photo noted</span>}
                    </div>
                  </div>
                  <button onClick={() => toggleResolved(i)} style={{ background: "none", border: "1px solid #2B333B", borderRadius: 6, padding: "6px 10px", color: i.resolved ? "#34D399" : "#8A96A3", fontSize: 11.5, cursor: "pointer", height: "fit-content", whiteSpace: "nowrap" }}>
                    {i.resolved ? "Resolved" : "Mark resolved"}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {modal && <IssueModal machines={data.machines} session={session} onClose={() => setModal(false)} onSave={addIssue} />}
    </div>
  );
}

function ImageIcon(props) { // lightweight inline fallback if lucide name changes
  return <span {...props}>📷</span>;
}

function IssueModal({ machines, session, onClose, onSave }) {
  const [form, setForm] = useState({ machineId: machines[0]?.id || "", description: "", severity: "Medium", photoNote: "" });
  return (
    <Modal title="Report an issue" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Machine">
          <select style={inputStyle} value={form.machineId} onChange={(e) => setForm((f) => ({ ...f, machineId: e.target.value }))}>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.machineId})</option>)}
          </select>
        </Field>
        <Field label="Problem description">
          <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Describe what you're seeing…" />
        </Field>
        <Field label="Severity">
          <div style={{ display: "flex", gap: 8 }}>
            {SEVERITIES.map((s) => (
              <button key={s} onClick={() => setForm((f) => ({ ...f, severity: s }))} style={{
                flex: 1, padding: "8px 4px", borderRadius: 6, cursor: "pointer", fontSize: 12,
                background: form.severity === s ? SEV_COLOR[s] + "1A" : "#12161A",
                color: form.severity === s ? SEV_COLOR[s] : "#8A96A3", border: "1px solid " + (form.severity === s ? SEV_COLOR[s] + "60" : "#2B333B")
              }}>{s}</button>
            ))}
          </div>
        </Field>
        <Field label="Photo note (optional)">
          <input style={inputStyle} value={form.photoNote} onChange={(e) => setForm((f) => ({ ...f, photoNote: e.target.value }))} placeholder="Describe attached photo (uploads not wired in this prototype)" />
        </Field>
        <Button disabled={!form.machineId || !form.description.trim()} style={{ justifyContent: "center", marginTop: 6 }}
          onClick={() => onSave({ id: uid("i"), ...form, reportedBy: session.name, reportedAt: new Date().toISOString(), resolved: false })}>
          Submit report
        </Button>
      </div>
    </Modal>
  );
}

/* ---------------------------- Maintenance History ----------------------------- */

function MaintHistory({ data }) {
  const [sel, setSel] = useState(data.machines[0]?.id || "");
  const machine = data.machines.find((m) => m.id === sel);
  const timeline = useMemo(() => {
    if (!machine) return [];
    const items = [];
    data.issues.filter((i) => i.machineId === machine.id).forEach((i) => items.push({ type: "issue", at: i.reportedAt, data: i }));
    data.tasks.filter((t) => t.machineId === machine.id && t.status === "Completed").forEach((t) => items.push({ type: "repair", at: t.completedAt || t.dueDate, data: t }));
    return items.sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [data, machine]);

  return (
    <div>
      <PageHeader title="Maintenance History" subtitle="A full timeline for each machine — failures, repairs, parts, and downtime." />
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}>
        <Card style={{ padding: 8 }}>
          {data.machines.map((m) => (
            <button key={m.id} onClick={() => setSel(m.id)} style={{
              display: "block", width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 7, marginBottom: 2,
              background: sel === m.id ? "#232B33" : "transparent", border: "none", color: sel === m.id ? "#EAEEF1" : "#8A96A3", cursor: "pointer"
            }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{m.name}</div>
              <div style={{ fontFamily: F_MONO, fontSize: 10.5, color: "#5B6672" }}>{m.machineId}</div>
            </button>
          ))}
        </Card>
        <Card style={{ padding: 20 }}>
          {!machine ? <EmptyState icon={HistoryIcon} text="No machine selected." /> : timeline.length === 0 ? (
            <EmptyState icon={HistoryIcon} text={`No history yet for ${machine.name}.`} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {timeline.map((item, idx) => (
                <div key={idx} style={{ display: "flex", gap: 14, paddingBottom: 18, position: "relative" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ width: 9, height: 9, borderRadius: "50%", background: item.type === "issue" ? SEV_COLOR[item.data.severity] : "#34D399", flexShrink: 0, marginTop: 4 }} />
                    {idx < timeline.length - 1 && <div style={{ width: 1, flex: 1, background: "#2B333B", marginTop: 4 }} />}
                  </div>
                  <div style={{ paddingBottom: 4 }}>
                    <div style={{ fontSize: 11, color: "#5B6672", fontFamily: F_MONO, marginBottom: 2 }}>{fmtDateTime(item.at)}</div>
                    {item.type === "issue" ? (
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Reported: {item.data.description}</div>
                        <Badge color={SEV_COLOR[item.data.severity]}>{item.data.severity}</Badge> <span style={{ fontSize: 11.5, color: "#8A96A3" }}>by {item.data.reportedBy}</span>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>Repaired: {item.data.title}</div>
                        <div style={{ fontSize: 12, color: "#8A96A3", marginBottom: 2 }}>Technician: {item.data.assignedTo}{item.data.downtimeHours != null ? ` · Downtime: ${item.data.downtimeHours}h` : ""}</div>
                        {item.data.partsReplaced && <div style={{ fontSize: 12, color: "#8A96A3" }}>Parts: {item.data.partsReplaced}</div>}
                        {item.data.technicianNotes && <div style={{ fontSize: 12, color: "#C7CED5", marginTop: 4, fontStyle: "italic" }}>"{item.data.technicianNotes}"</div>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------- AI Decision Assistant ----------------------------- */

function PriorityRow({ r, compact }) {
  const color = SEV_COLOR[r.risk] || "#8A96A3";
  return (
    <div style={{ display: "flex", gap: 12, padding: compact ? "10px 12px" : "14px 16px", background: "#12161A", borderRadius: 8, borderLeft: `3px solid ${color}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <Badge color={color}>{r.risk} risk</Badge>
          <span style={{ fontWeight: 600, fontSize: compact ? 13 : 14 }}>{r.action}</span>
        </div>
        {!compact && (
          <>
            <div style={{ fontSize: 12.5, color: "#C7CED5", marginBottom: 8 }}>{r.why}</div>
            <div style={{ display: "flex", gap: 16, fontSize: 11.5, color: "#8A96A3", flexWrap: "wrap" }}>
              <span>Est. business impact: <b style={{ color: "#EAEEF1" }}>{r.impact}</b></span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                Confidence:
                <span style={{ width: 60, height: 5, background: "#2B333B", borderRadius: 3, overflow: "hidden", display: "inline-block" }}>
                  <span style={{ display: "block", height: "100%", width: `${r.confidence}%`, background: color }} />
                </span>
                {r.confidence}%
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function buildAiPrompt(data) {
  const machines = data.machines.map((m) => {
    const allIssues = data.issues.filter((i) => i.machineId === m.id);
    const openIssues = allIssues.filter((i) => !i.resolved);
    const completedRepairs = data.tasks.filter((t) => t.machineId === m.id && t.status === "Completed").sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    const lastRepair = completedRepairs[0];
    const daysSinceInstall = Math.round((Date.now() - new Date(m.installDate)) / 86400000);
    const daysSinceLastRepair = lastRepair?.completedAt ? Math.round((Date.now() - new Date(lastRepair.completedAt)) / 86400000) : null;
    const issuesLast30Days = allIssues.filter((i) => (Date.now() - new Date(i.reportedAt)) < 86400000 * 30).length;
    const avgDowntimeHours = completedRepairs.length
      ? +(completedRepairs.reduce((s, t) => s + (t.downtimeHours || 0), 0) / completedRepairs.length).toFixed(1)
      : null;
    return {
      name: m.name, machineId: m.machineId, status: m.status, location: m.location,
      maintenanceIntervalDays: m.interval, daysSinceInstall,
      history: {
        totalIssuesLoggedAllTime: allIssues.length,
        issuesLoggedLast30Days: issuesLast30Days,
        completedRepairsAllTime: completedRepairs.length,
        daysSinceLastRepair,
        avgDowntimeHoursPerRepair: avgDowntimeHours,
      },
      openIssues: openIssues.map((i) => ({ severity: i.severity, description: i.description, reportedAt: i.reportedAt })),
      lastRepair: lastRepair ? { title: lastRepair.title, completedAt: lastRepair.completedAt, downtimeHours: lastRepair.downtimeHours, notes: lastRepair.technicianNotes || null } : null,
    };
  });
  const openTasks = data.tasks.filter((t) => t.status !== "Completed").map((t) => ({ title: t.title, machineId: t.machineId, priority: t.priority, dueDate: t.dueDate, status: t.status }));

  return `You are the AI Decision Assistant inside a factory maintenance execution system. Given the current state of machines plus each machine's accumulated maintenance history (issue frequency, repeat failures, downtime trend, time since last repair), produce a short prioritized list (3-6 items) of what the maintenance team should do next.

Use the history fields, not just today's snapshot: a machine with rising issuesLoggedLast30Days, a long daysSinceLastRepair relative to maintenanceIntervalDays, or climbing avgDowntimeHoursPerRepair should be weighted as higher risk even if no open issue exists yet. A machine with a clean, low-frequency history should be weighted lower even if it currently has a minor issue. As more real repairs and issues get logged over time, let that trend — not just the newest event — drive the ranking.

DATA:
${JSON.stringify({ machines, openTasks }, null, 2)}

Respond with ONLY a raw JSON array (no markdown fences, no prose) of objects with this exact shape:
[{"machineId": "<the machine's machineId field>", "machineName": "<name>", "action": "<short imperative action, e.g. 'Repair Machine A today'>", "risk": "<one of Low, Medium, High, Critical>", "why": "<1-2 sentence plain-language reason citing the specific evidence, including trend/history where relevant>", "impact": "<short phrase estimating business impact, e.g. 'Line stoppage risk, ~$4k/hr'>", "confidence": <integer 0-100>}]

Order by descending urgency. Base risk and confidence on the actual data given — recent high/critical issues, overdue maintenance intervals, and repeat failures should raise risk; a clean recent history should lower it. Be specific and concrete, not generic.`;
}

function AiAssistant({ data, setData, logActivity }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const run = data.aiRun;

  async function generate() {
    setRunning(true);
    setError("");
    try {
      const prompt = buildAiPrompt(data);
      // Calls our own serverless function (api/generate-priorities.js) rather than
      // Anthropic directly — a browser can't safely hold an API key, so the real
      // Claude call happens server-side. See README.md for the required env var.
      const res = await fetch("/api/generate-priorities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      const text = (json.text || "").trim();
      const clean = text.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
      const recs = JSON.parse(clean);
      setData((d) => ({ ...d, aiRun: { generatedAt: new Date().toISOString(), recommendations: recs } }));
      logActivity(`AI Decision Assistant generated ${recs.length} priorities`);
    } catch (e) {
      setError("Couldn't generate recommendations right now. Try again in a moment.");
    } finally {
      setRunning(false);
    }
  }

  const sorted = (run?.recommendations || []).slice().sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk]);

  return (
    <div>
      <PageHeader
        title="AI Decision Assistant"
        subtitle="One ranked list instead of a hundred alerts — what to do next, and why."
        action={<Button onClick={generate} disabled={running}>{running ? <Loader2 size={15} style={{ animation: "meo-spin 1s linear infinite" }} /> : <RefreshCw size={15} />} {running ? "Analyzing…" : run ? "Regenerate" : "Generate today's priorities"}</Button>}
      />
      <style>{`@keyframes meo-spin{to{transform:rotate(360deg)}}`}</style>
      {error && <div style={{ marginBottom: 14, color: "#E5484D", fontSize: 13 }}>{error}</div>}

      <Card style={{ padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 16 }}>
            <ShieldAlert size={17} color="#F5A623" /> Today's Top Priorities
          </div>
          {run && <div style={{ fontSize: 11, color: "#5B6672", fontFamily: F_MONO }}>generated {relTime(run.generatedAt)}</div>}
        </div>
        {!run ? (
          <EmptyState icon={Sparkles} text="Nothing generated yet. Click 'Generate today's priorities' to have the assistant read current machine, issue, and task data and rank what needs attention." />
        ) : sorted.length === 0 ? (
          <EmptyState icon={CheckCircle2} text="No priorities right now — the floor looks clear." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sorted.map((r, idx) => <PriorityRow key={idx} r={r} />)}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ----------------------------------- Tasks -------------------------------------- */

function Tasks({ data, setData, session, logActivity }) {
  const [modal, setModal] = useState(false);
  const canCreate = session.role === "Manager";
  const grouped = TASK_STATUSES.map((s) => ({ status: s, items: data.tasks.filter((t) => t.status === s) }));

  function addTask(task) {
    setData((d) => ({ ...d, tasks: [task, ...d.tasks] }));
    logActivity(`Task created: ${task.title}`);
    setModal(false);
  }
  function updateStatus(task, status) {
    setData((d) => ({
      ...d, tasks: d.tasks.map((t) => t.id === task.id ? { ...t, status, completedAt: status === "Completed" ? new Date().toISOString() : t.completedAt } : t)
    }));
    logActivity(`Task "${task.title}" marked ${status}`);
  }

  return (
    <div>
      <PageHeader title="Tasks" subtitle="Work orders, assigned and tracked to close." action={
        <RoleGate role={session.role} allow={["Manager"]}><Button onClick={() => setModal(true)}><Plus size={15} /> Create task</Button></RoleGate>
      } />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {grouped.map((g) => (
          <div key={g.status}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#8A96A3", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{g.status} · {g.items.length}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {g.items.length === 0 && <Card style={{ padding: 14 }}><div style={{ fontSize: 12, color: "#5B6672" }}>Nothing here.</div></Card>}
              {g.items.map((t) => {
                const m = data.machines.find((m) => m.id === t.machineId);
                const overdue = isOverdue(t.dueDate, t.status);
                return (
                  <Card key={t.id} style={{ padding: 14, borderColor: overdue ? "#E5484D50" : "#2B333B" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                      <Badge color={SEV_COLOR[t.priority] || "#8A96A3"}>{t.priority}</Badge>
                      {overdue && <Badge color="#E5484D">Overdue</Badge>}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>{t.title}</div>
                    <div style={{ fontSize: 11.5, color: "#8A96A3", marginBottom: 10 }}>{m ? m.name : "—"} · due {fmtDate(t.dueDate)}</div>
                    <div style={{ fontSize: 11.5, color: "#8A96A3", marginBottom: 10 }}>Assigned: {t.assignedTo}</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {TASK_STATUSES.filter((s) => s !== t.status).map((s) => (
                        <button key={s} onClick={() => updateStatus(t, s)} style={{
                          flex: 1, fontSize: 10.5, padding: "6px 4px", borderRadius: 5, background: "#12161A",
                          border: "1px solid #2B333B", color: "#8A96A3", cursor: "pointer"
                        }}>{s}</button>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {modal && <TaskModal machines={data.machines} issues={data.issues} onClose={() => setModal(false)} onSave={addTask} />}
    </div>
  );
}

function TaskModal({ machines, issues, onClose, onSave }) {
  const [form, setForm] = useState({ title: "", machineId: machines[0]?.id || "", assignedTo: "", dueDate: new Date().toISOString().slice(0, 10), priority: "Medium" });
  return (
    <Modal title="Create task" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Task title"><input style={inputStyle} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Inspect bearing assembly" /></Field>
        <Field label="Machine">
          <select style={inputStyle} value={form.machineId} onChange={(e) => setForm((f) => ({ ...f, machineId: e.target.value }))}>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.machineId})</option>)}
          </select>
        </Field>
        <Field label="Assign to technician"><input style={inputStyle} value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))} placeholder="R. Novak" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Due date"><input type="date" style={inputStyle} value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} /></Field>
          <Field label="Priority">
            <select style={inputStyle} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Button disabled={!form.title.trim() || !form.assignedTo.trim()} style={{ justifyContent: "center", marginTop: 6 }}
          onClick={() => onSave({ id: uid("t"), ...form, dueDate: new Date(form.dueDate).toISOString(), status: "Not Started", createdAt: new Date().toISOString(), relatedIssueId: null, downtimeHours: null, technicianNotes: "", partsReplaced: "", completedAt: null })}>
          Create task
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------- Notifications ---------------------------------- */

function Notifications({ items }) {
  const kindIcon = { issue: AlertTriangle, overdue: Clock, assigned: ClipboardList, ai: Sparkles };
  const kindColorFallback = { issue: "#F5A623", overdue: "#E5484D", assigned: "#4C9FE5", ai: "#F5A623" };
  return (
    <div>
      <PageHeader title="Notifications" subtitle="New issues, assignments, overdue work, and high-risk AI calls." />
      {items.length === 0 ? <EmptyState icon={Bell} text="You're all caught up." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((n) => {
            const Icon = kindIcon[n.kind] || Bell;
            const color = SEV_COLOR[n.severity] || kindColorFallback[n.kind] || "#8A96A3";
            return (
              <Card key={n.id} style={{ padding: 14, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ width: 30, height: 30, borderRadius: 7, background: color + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={15} color={color} />
                </div>
                <div>
                  <div style={{ fontSize: 13 }}>{n.text}</div>
                  <div style={{ fontSize: 11, color: "#5B6672", fontFamily: F_MONO, marginTop: 2 }}>{relTime(n.at)}</div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------- Reports ------------------------------------- */

function Reports({ data }) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const completedThisMonth = data.tasks.filter((t) => t.status === "Completed" && t.completedAt && new Date(t.completedAt) >= startOfMonth);
  const downtimeThisMonth = completedThisMonth.reduce((sum, t) => sum + (t.downtimeHours || 0), 0);
  const avgRepairTime = completedThisMonth.length ? (downtimeThisMonth / completedThisMonth.length) : 0;

  const problemCounts = {};
  data.issues.forEach((i) => { problemCounts[i.machineId] = (problemCounts[i.machineId] || 0) + 1; });
  const problemData = Object.entries(problemCounts)
    .map(([machineId, count]) => ({ name: data.machines.find((m) => m.id === machineId)?.name || "Unknown", count }))
    .sort((a, b) => b.count - a.count).slice(0, 5);

  const stats = [
    { label: "Downtime this month", value: `${downtimeThisMonth.toFixed(1)}h`, icon: Clock, color: "#E5484D" },
    { label: "Completed maintenance", value: completedThisMonth.length, icon: CheckCircle2, color: "#34D399" },
    { label: "Avg. repair time", value: `${avgRepairTime.toFixed(1)}h`, icon: TrendingUp, color: "#4C9FE5" },
    { label: "Machines tracked", value: data.machines.length, icon: Factory, color: "#F5A623" },
  ];

  return (
    <div>
      <PageHeader title="Reports" subtitle="Roll-ups your manager actually wants to see." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {stats.map((s) => (
          <Card key={s.label} style={{ padding: "16px 18px" }}>
            <s.icon size={16} color={s.color} style={{ marginBottom: 10 }} />
            <div style={{ fontFamily: F_MONO, fontSize: 22, fontWeight: 600 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "#8A96A3", marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>
      <Card style={{ padding: 20 }}>
        <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Most problematic machines</div>
        {problemData.length === 0 ? <EmptyState icon={BarChart3} text="No issue data yet." /> : (
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={problemData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2B333B" horizontal={false} />
                <XAxis type="number" stroke="#8A96A3" fontSize={11} allowDecimals={false} />
                <YAxis type="category" dataKey="name" stroke="#8A96A3" fontSize={11.5} width={130} />
                <Tooltip contentStyle={{ background: "#1B2127", border: "1px solid #2B333B", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#EAEEF1" }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {problemData.map((_, i) => <Cell key={i} fill="#F5A623" opacity={1 - i * 0.12} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
