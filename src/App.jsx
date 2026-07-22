import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { storage, auth, isSupabaseConfigured, getWorkspaceMembers, addWorkspaceMember, removeWorkspaceMember } from "./storage.js";
import {
  Gauge, AlertTriangle, ClipboardList, Bell, BarChart3, LogOut, Plus, X,
  Clock, MapPin, Factory, Calendar, ChevronRight, CheckCircle2, TrendingUp,
  ChevronDown, RefreshCw, Loader2, Sparkles, ShieldAlert, Activity, Wrench,
  Package, Users, Settings as SettingsIcon, Hammer, PauseCircle, XCircle,
  CheckCheck, ArrowRight, Camera, FileText, Plug, Radio, GitBranch, Map,
  LineChart, MessageCircle, Send, HelpCircle, Building2, Search, ExternalLink
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";

/* ============================================================================
   MEO — Maintenance Execution OS (v2)
   Mission: prove MEO helps managers decide faster and better — not build IBM Maximo.
   Flagship page: Decision Center. Everything else supports it.
   Tokens: bg #12161A · surface #1B2127 · raised #232B33 · line #2B333B
   text-hi #EAEEF1 · text-lo #8A96A3 · amber #F5A623 · red #E5484D
   green #34D399 · blue #4C9FE5 · purple #A78BFA
   Display: Space Grotesk · Body: Inter · Data: IBM Plex Mono
   ============================================================================ */

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

const RISK_LEVELS = ["Low", "Medium", "High", "Critical"];
const RISK_COLOR = { Low: "#4C9FE5", Medium: "#F5A623", High: "#FB7A3C", Critical: "#E5484D" };
const RISK_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const MACHINE_STATUSES = ["Running", "At Risk", "Maintenance", "Offline"];
const STATUS_COLOR = { Running: "#34D399", "At Risk": "#F5A623", Maintenance: "#4C9FE5", Offline: "#E5484D" };
const WO_STATUSES = ["Pending", "Approved", "Assigned", "In Progress", "Waiting for Parts", "Completed", "Closed"];
const WO_STATUS_COLOR = {
  Pending: "#8A96A3", Approved: "#4C9FE5", Assigned: "#A78BFA", "In Progress": "#F5A623",
  "Waiting for Parts": "#FB7A3C", Completed: "#34D399", Closed: "#5B6672",
};
const DECISION_STATUS_COLOR = { Pending: "#F5A623", Approved: "#34D399", Delayed: "#4C9FE5", Rejected: "#E5484D" };
const ROLES = ["Manager", "Supervisor", "Technician", "Administrator", "Executive"];

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
function fmtMoney(n) {
  if (n == null) return "—";
  return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function isOverdue(dueDate, status) { return status !== "Completed" && status !== "Closed" && new Date(dueDate) < new Date(new Date().toDateString()); }
function daysUntil(iso) { return Math.round((new Date(iso) - Date.now()) / 86400000); }

const JUNK_WORDS = new Set(["hi", "hello", "test", "testing", "asdf", "abc", "xxx", "none", "na", "n/a", "idk", "unknown", "machine", "robot", "sample", "demo", "temp", "xyz", "123", "aaa", "111"]);

function validateMachineId(value, existingIds = [], currentId = null) {
  const v = (value || "").trim();
  if (!v) return "Machine ID is required.";
  if (v.length < 4) return "Too short to be a real machine ID (needs at least 4 characters).";
  if (JUNK_WORDS.has(v.toLowerCase())) return `"${v}" looks like a placeholder, not a real machine ID.`;
  if (!/[0-9]/.test(v)) return "Real machine IDs almost always include a number (e.g. BLR-001) — this one has none.";
  if (!/[a-zA-Z]/.test(v)) return "This looks like just numbers — most machine IDs include letters too (e.g. BLR-001).";
  const dupe = existingIds.some((id) => id.id !== currentId && id.machineId.trim().toLowerCase() === v.toLowerCase());
  if (dupe) return `"${v}" is already used by another registered machine.`;
  return "";
}

function validateMachineName(value) {
  const v = (value || "").trim();
  if (!v) return "Machine name is required.";
  if (v.length < 2) return "Name is too short.";
  if (JUNK_WORDS.has(v.toLowerCase())) return `"${v}" looks like a placeholder, not a real machine name.`;
  return "";
}

/* -------- Technician matching engine (rule-based, real data only) --------
   Ranks real registered technicians against a machine using: current open
   workload (fewer active work orders = better), skill tag overlap with the
   machine's name/manufacturer/asset type, and prior hands-on experience
   (completed work orders on this exact machine). Never invents a technician
   that isn't in the team roster. */
function computeTechnicianMatch(machine, data) {
  const technicians = (data.team || []).filter((t) => t.role === "Technician");
  if (technicians.length === 0) return [];
  const haystack = `${machine?.name || ""} ${machine?.manufacturer || ""}`.toLowerCase();

  return technicians.map((t) => {
    const activeWOs = data.workOrders.filter((w) => w.assignedTech === t.name && w.status !== "Completed" && w.status !== "Closed").length;
    const priorWOs = data.workOrders.filter((w) => w.assignedTech === t.name && w.machineId === machine?.id && (w.status === "Completed" || w.status === "Closed"));
    const skills = (t.skills || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const skillMatch = skills.some((s) => s && haystack.includes(s));
    let score = 0;
    const reasons = [];
    if (priorWOs.length > 0) { score += 40; reasons.push(`worked on this machine before (${priorWOs.length}x)`); }
    if (skillMatch) { score += 30; reasons.push("skill tags match this equipment"); }
    score += Math.max(0, 20 - activeWOs * 7);
    reasons.push(activeWOs === 0 ? "currently free" : `${activeWOs} active job${activeWOs > 1 ? "s" : ""} in progress`);
    if (t.shift) reasons.push(`${t.shift} shift`);
    return { name: t.name, score, activeWOs, reason: reasons.join(", ") };
  }).sort((a, b) => b.score - a.score);
}

/* Creates a work order from an approved decision — unless an active (not
   completed/closed) work order already exists for that machine, in which
   case it links to the existing one instead of creating a duplicate. */
function createWorkOrderForDecision(d, decision, chosenTechnician) {
  const existingActive = d.workOrders.find((w) => w.machineId === decision.machineId && w.status !== "Completed" && w.status !== "Closed");
  if (existingActive) {
    return { workOrders: d.workOrders, woCounter: d.woCounter || 0, workOrderId: existingActive.id, duplicatePrevented: true, woNumber: existingActive.woNumber };
  }
  const woCounter = (d.woCounter || 0) + 1;
  const woNumber = "WO-" + String(woCounter).padStart(4, "0");
  const wo = {
    id: uid("wo"), woNumber, machineId: decision.machineId, assignedTech: chosenTechnician || decision.suggestedTechnician || "Unassigned",
    priority: decision.risk, dueDate: new Date().toISOString(), requiredParts: decision.requiredParts || "", estimatedHours: null,
    status: chosenTechnician || decision.suggestedTechnician ? "Assigned" : "Pending", decisionId: decision.id, technicianNotes: "",
    startedAt: null, completedAt: null, actualCost: null, recommendedTimeWindow: decision.recommendedTimeWindow || "",
    failureMode: "", rootCause: "", correctiveAction: "", preventiveAction: "", createdAt: new Date().toISOString(),
  };
  return { workOrders: [wo, ...d.workOrders], woCounter, workOrderId: wo.id, duplicatePrevented: false, woNumber };
}

function technicianPerformance(techName, data) {
  const jobs = data.workOrders.filter((w) => w.assignedTech === techName && w.status === "Completed" && w.startedAt && w.completedAt);
  const hours = jobs.map((w) => (new Date(w.completedAt) - new Date(w.startedAt)) / 3600000);
  return { completedJobs: jobs.length, avgHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : 0 };
}

function machineReliabilityStats(machineId, data) {
  const alertDates = data.alerts.filter((a) => a.machineId === machineId).map((a) => new Date(a.date).getTime()).sort((a, b) => a - b);
  let mtbf = null;
  if (alertDates.length > 1) {
    const gaps = []; for (let i = 1; i < alertDates.length; i++) gaps.push((alertDates[i] - alertDates[i - 1]) / 86400000);
    mtbf = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  }
  const repairs = data.workOrders.filter((w) => w.machineId === machineId && w.status === "Completed" && w.startedAt && w.completedAt);
  const mttrHours = repairs.length ? repairs.map((w) => (new Date(w.completedAt) - new Date(w.startedAt)) / 3600000).reduce((a, b) => a + b, 0) / repairs.length : null;
  return { mtbf, mttrHours, sampleSize: alertDates.length };
}

function emptyData() {
  return {
    machines: [], alerts: [], decisions: [], workOrders: [], parts: [], team: [],
    activity: [], aiRun: null, settings: { companyName: "", locations: [], assetTypes: [], timezone: "Africa/Lagos" },
    woCounter: 0,
  };
}

function seedData() {
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
  const isoF = (daysAhead) => new Date(now + daysAhead * 86400000).toISOString();
  const machines = [
    { id: uid("m"), name: "Boiler A", machineId: "BLR-001", location: "Bay 1", manufacturer: "Cleaver-Brooks", serialNumber: "SN-70211", assetType: "Boiler", installDate: iso(1400), criticality: "Critical", status: "At Risk", intervalDays: 30, lastMaintenance: iso(40), nextMaintenance: isoF(-10) },
    { id: uid("m"), name: "Conveyor 2", machineId: "CV-002", location: "Bay 2", manufacturer: "Siemens", serialNumber: "SN-44120", assetType: "Conveyor", installDate: iso(600), criticality: "Medium", status: "Running", intervalDays: 21, lastMaintenance: iso(10), nextMaintenance: isoF(11) },
    { id: uid("m"), name: "Compressor A", machineId: "AC-001", location: "Utility Room", manufacturer: "Atlas Copco", serialNumber: "SN-91847", assetType: "Compressor", installDate: iso(300), criticality: "High", status: "Offline", intervalDays: 45, lastMaintenance: iso(50), nextMaintenance: isoF(-5) },
    { id: uid("m"), name: "Pump B", machineId: "PMP-004", location: "Bay 3", manufacturer: "Grundfos", serialNumber: "SN-33902", assetType: "Pump", installDate: iso(900), criticality: "Medium", status: "Running", intervalDays: 60, lastMaintenance: iso(5), nextMaintenance: isoF(55) },
  ];
  const alerts = [
    { id: uid("al"), machineId: machines[0].id, type: "Overheating", severity: "Critical", date: iso(0.1), description: "Temperature rising rapidly, 18% above normal operating range.", photoNote: "", sensorNote: "Temp sensor: 94°C, rising ~2°C/hr", reporter: "J. Alvarez", resolved: false },
    { id: uid("al"), machineId: machines[2].id, type: "Trip fault", severity: "High", date: iso(0.3), description: "Compressor tripped breaker twice this shift.", photoNote: "", sensorNote: "", reporter: "M. Chen", resolved: false },
    { id: uid("al"), machineId: machines[1].id, type: "Vibration", severity: "Medium", date: iso(2), description: "Slightly elevated vibration on drive motor.", photoNote: "", sensorNote: "", reporter: "R. Novak", resolved: false },
  ];
  const decisions = [
    { id: uid("d"), machineId: machines[0].id, risk: "Critical", businessPriority: "Critical", downtimeCost: 15000, action: "Replace cooling pump today", reason: "Temperature rising rapidly with no sign of plateau; cooling pump output has degraded 30% over the last 2 weeks.", confidence: 92, predictedRUL: "1-2 days", requiredParts: "Cooling pump (BLR series)", recommendedTimeWindow: "Today", rootCauseProbability: "Likely cooling pump impeller wear given the steady output decline over 2 weeks.", safetyChecklist: ["Lock out/tag out boiler before opening panel", "Confirm system fully depressurized", "Wear heat-resistant gloves near recently active components"], approvalRequired: true, suggestedTechnician: "R. Novak", technicianReason: "skill tags match this equipment, currently free", status: "Pending", decisionReason: "", decidedBy: "", decidedAt: null, workOrderId: null },
    { id: uid("d"), machineId: machines[2].id, risk: "High", businessPriority: "High", downtimeCost: 8200, action: "Inspect and reset compressor trip circuit", reason: "Two unexplained breaker trips this shift; recurring trip faults historically precede full compressor failure.", confidence: 81, predictedRUL: "3-5 days", requiredParts: "Compressor trip relay", recommendedTimeWindow: "Within 24 hours", rootCauseProbability: "Possible failing trip relay given repeated trips with no clear electrical fault.", safetyChecklist: ["De-energize before inspecting trip circuit", "Verify zero voltage with meter before touching relay"], approvalRequired: true, suggestedTechnician: "R. Novak", technicianReason: "currently free", status: "Pending", decisionReason: "", decidedBy: "", decidedAt: null, workOrderId: null },
    { id: uid("d"), machineId: machines[1].id, risk: "Medium", businessPriority: "Medium", downtimeCost: 1500, action: "Schedule bearing inspection within 3 days", reason: "Vibration trending upward but still within tolerable range.", confidence: 68, predictedRUL: null, requiredParts: "Drive motor bearing kit", recommendedTimeWindow: "Within 3 days", rootCauseProbability: null, safetyChecklist: ["Ensure conveyor is stopped and locked out before inspection"], approvalRequired: false, suggestedTechnician: "R. Novak", technicianReason: "currently free", status: "Pending", decisionReason: "", decidedBy: "", decidedAt: null, workOrderId: null },
  ];
  const workOrders = [
    { id: uid("wo"), woNumber: "WO-0001", machineId: machines[3].id, assignedTech: "R. Novak", priority: "Low", dueDate: iso(-8), requiredParts: "Seal kit", estimatedHours: 2.5, status: "Completed", decisionId: null, technicianNotes: "Routine seal replacement, no issues found.", startedAt: iso(6.3), completedAt: iso(6), actualCost: 340, failureMode: "Seal wear", rootCause: "Normal wear at expected service interval", correctiveAction: "Replaced base plate seal kit", preventiveAction: "No change needed — within expected lifespan" },
  ];
  const parts = [
    { id: uid("p"), name: "Cooling pump (BLR series)", quantity: 1, minStock: 2, machineId: machines[0].id, supplier: "Cleaver-Brooks OEM", leadTimeDays: 5, alternativePartName: "" },
    { id: uid("p"), name: "Compressor trip relay", quantity: 0, minStock: 2, machineId: machines[2].id, supplier: "Atlas Copco Parts", leadTimeDays: 3, alternativePartName: "Generic 24V trip relay (Supplier X)" },
    { id: uid("p"), name: "Drive motor bearing kit", quantity: 4, minStock: 2, machineId: machines[1].id, supplier: "Siemens Parts", leadTimeDays: 7, alternativePartName: "" },
  ];
  const team = [
    { id: uid("u"), name: "J. Alvarez", role: "Manager", skills: "", shift: "", certifications: "", experienceYears: "" },
    { id: uid("u"), name: "R. Novak", role: "Technician", skills: "boiler, compressor, conveyor, pump", shift: "Day", certifications: "OSHA 30, Boiler Operator License", experienceYears: "6" },
    { id: uid("u"), name: "M. Chen", role: "Supervisor", skills: "", shift: "", certifications: "", experienceYears: "" },
  ];
  const activity = [
    { id: uid("a"), text: "Critical alert: Overheating on Boiler A", at: iso(0.1) },
    { id: uid("a"), text: "AI flagged Compressor A trip fault as High risk", at: iso(0.3) },
    { id: uid("a"), text: "Work order WO-0001 completed on Pump B", at: iso(6) },
  ];
  return { machines, alerts, decisions, workOrders, parts, team, activity, aiRun: null, settings: { companyName: "Demo Plant", locations: ["Bay 1", "Bay 2", "Bay 3", "Utility Room"], assetTypes: ["Boiler", "Conveyor", "Compressor", "Pump"], timezone: "Africa/Lagos" }, woCounter: 1 };
}

/* ---------------------------- small primitives ---------------------------- */

function Badge({ color, children }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px",
      borderRadius: 5, fontSize: 11.5, fontWeight: 600, letterSpacing: 0.2,
      color, background: color + "1A", border: "1px solid " + color + "40", whiteSpace: "nowrap"
    }}>{children}</span>
  );
}
function Dot({ color }) {
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 0 3px ${color}22` }} />;
}
function Card({ children, style, ...rest }) {
  return <div style={{ background: "#1B2127", border: "1px solid #2B333B", borderRadius: 10, ...style }} {...rest}>{children}</div>;
}
function Button({ children, onClick, variant = "primary", style, disabled, type = "button" }) {
  const base = { fontFamily: F_BODY, fontWeight: 600, fontSize: 13.5, padding: "9px 16px", borderRadius: 7, border: "1px solid transparent", cursor: disabled ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 7, transition: "all .15s ease", opacity: disabled ? 0.5 : 1 };
  const variants = {
    primary: { background: "#F5A623", color: "#14181C", border: "1px solid #F5A623" },
    ghost: { background: "transparent", color: "#EAEEF1", border: "1px solid #2B333B" },
    danger: { background: "#E5484D1A", color: "#E5484D", border: "1px solid #E5484D40" },
    success: { background: "#34D3991A", color: "#34D399", border: "1px solid #34D39940" },
    subtle: { background: "#232B33", color: "#EAEEF1", border: "1px solid #2B333B" },
  };
  return <button type={type} disabled={disabled} onClick={onClick} style={{ ...base, ...variants[variant], ...style }}>{children}</button>;
}
function Field({ label, children }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#8A96A3", fontWeight: 600 }}>{label}{children}</label>;
}
const inputStyle = { background: "#12161A", border: "1px solid #2B333B", borderRadius: 6, color: "#EAEEF1", padding: "9px 11px", fontSize: 13.5, fontFamily: F_BODY, outline: "none" };
function Modal({ title, onClose, children, width = 480 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#080A0C99", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#1B2127", border: "1px solid #2B333B", borderRadius: 12, width, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px #00000066" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #2B333B", position: "sticky", top: 0, background: "#1B2127" }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 16, color: "#EAEEF1" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8A96A3", cursor: "pointer", padding: 4 }}><X size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}
function EmptyState({ icon: Icon, text, action }) {
  return (
    <div style={{ padding: "40px 20px", textAlign: "center", color: "#8A96A3" }}>
      <Icon size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
      <div style={{ fontSize: 13.5, marginBottom: action ? 14 : 0 }}>{text}</div>
      {action}
    </div>
  );
}
function RoleGate({ role, allow, children }) { if (!allow.includes(role)) return null; return children; }
function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, gap: 12, flexWrap: "wrap" }}>
      <div><div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 22, marginBottom: 4 }}>{title}</div>{subtitle && <div style={{ fontSize: 13, color: "#8A96A3" }}>{subtitle}</div>}</div>
      {action}
    </div>
  );
}

/* ---------------------------------- App ------------------------------------ */

// Fallback-only "remember me" for demo mode and for when Supabase isn't
// configured yet — real accounts (below) don't need this, since Supabase
// itself keeps a real, secure session automatically.
function loadRememberedSession() {
  try {
    const raw = window.localStorage.getItem("meo:remembered-session");
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveRememberedSession(session) {
  try { window.localStorage.setItem("meo:remembered-session", JSON.stringify(session)); } catch (e) { /* noop */ }
}
function clearRememberedSession() {
  try { window.localStorage.removeItem("meo:remembered-session"); } catch (e) { /* noop */ }
}
function sessionFromSupabaseUser(user) {
  const meta = user.user_metadata || {};
  return { workspace: meta.workspace || "", name: meta.name || user.email, role: meta.role || "Manager", isDemo: false, email: user.email };
}

export default function App() {
  useFonts();
  const remembered = useState(() => loadRememberedSession())[0];
  const [entryChoice, setEntryChoice] = useState(remembered ? (remembered.isDemo ? "demo" : "connect") : null); // null | "demo" | "connect"
  const [session, setSession] = useState(remembered);
  const [checkingAuth, setCheckingAuth] = useState(isSupabaseConfigured);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [tour, setTour] = useState({ active: false, step: 0 });
  const saveTimer = useRef(null);
  const workspaceKey = session ? "meo:v2:" + session.workspace.trim().toLowerCase() : null;

  // Detect that this page load IS the result of clicking a confirmation or
  // password-reset link, before Supabase's client clears it from the URL.
  const [redirectType] = useState(() => {
    try {
      const hash = window.location.hash || "";
      if (hash.includes("type=signup") || hash.includes("type=invite")) return "confirmed";
      if (hash.includes("type=recovery")) return "recovery";
      return null;
    } catch (e) { return null; }
  });
  const [showConfirmedScreen, setShowConfirmedScreen] = useState(redirectType === "confirmed");

  // Restore a real, secure Supabase session on load (this is what makes you
  // stay signed in — not a localStorage trick). Demo sessions never touch
  // Supabase Auth at all.
  useEffect(() => {
    if (!isSupabaseConfigured) { setCheckingAuth(false); return; }
    let sub;
    (async () => {
      const existing = await auth.getSession();
      if (existing?.user) {
        setSession(sessionFromSupabaseUser(existing.user));
        if (redirectType !== "confirmed") setEntryChoice("connect");
      }
      try { window.history.replaceState(null, "", window.location.pathname); } catch (e) { /* noop */ }
      setCheckingAuth(false);
      sub = auth.onAuthStateChange((s) => {
        if (!s) { setSession((prev) => (prev?.isDemo ? prev : null)); }
      });
    })();
    return () => sub?.unsubscribe?.();
  }, []);

  function handleJoin(newSession) {
    if (newSession.isDemo || !isSupabaseConfigured) saveRememberedSession(newSession);
    setSession(newSession);
  }
  async function handleLeave() {
    clearRememberedSession();
    if (isSupabaseConfigured && session && !session.isDemo) { try { await auth.signOut(); } catch (e) { /* noop */ } }
    setSession(null);
    setEntryChoice(null);
  }

  useEffect(() => {
    if (!workspaceKey) return;
    setLoading(true);
    (async () => {
      try {
        const res = await storage.get(workspaceKey);
        if (res && res.value) {
          setData(JSON.parse(res.value));
        } else if (session?.isDemo) {
          setData(seedData());
        } else {
          setData(emptyData());
        }
      } catch (e) { setData(session?.isDemo ? seedData() : emptyData()); } finally { setLoading(false); }
    })();
  }, [workspaceKey]);

  useEffect(() => {
    if (!workspaceKey || !data) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await storage.set(workspaceKey, JSON.stringify(data)); } catch (e) { /* noop */ }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [data, workspaceKey]);

  const logActivity = useCallback((text) => {
    setData((d) => ({ ...d, activity: [{ id: uid("a"), text, at: new Date().toISOString() }, ...d.activity].slice(0, 60) }));
  }, []);

  if (checkingAuth) return <LoadingScreen />;
  if (showConfirmedScreen && session) {
    return <EmailConfirmedScreen name={session.name} onContinue={() => { setShowConfirmedScreen(false); setEntryChoice("connect"); }} />;
  }
  if (!entryChoice) return <WelcomeScreen onChoose={setEntryChoice} />;
  if (!session) {
    if (entryChoice === "connect" && isSupabaseConfigured) return <AuthScreen onJoin={handleJoin} onBack={() => setEntryChoice(null)} />;
    return <Login onJoin={handleJoin} isDemo={entryChoice === "demo"} onBack={() => setEntryChoice(null)} />;
  }
  if (loading || !data) return <LoadingScreen />;

  const notifications = computeNotifications(data);

  function startTour() { setTour({ active: true, step: 0 }); setTab(TOUR_STEPS[0].tab); }
  function tourNext() {
    const next = tour.step + 1;
    if (next >= TOUR_STEPS.length) { setTour({ active: false, step: 0 }); return; }
    setTour({ active: true, step: next });
    setTab(TOUR_STEPS[next].tab);
  }
  function tourSkip() { setTour({ active: false, step: 0 }); }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#12161A", fontFamily: F_BODY, color: "#EAEEF1" }}>
      <Sidebar tab={tab} setTab={setTab} session={session} onLeave={handleLeave} notifCount={notifications.length} pendingDecisions={data.decisions.filter((d) => d.status === "Pending").length} assistantName={data.settings?.assistantName} />
      <main style={{ flex: 1, minWidth: 0, padding: "28px 32px", maxWidth: 1220, paddingBottom: tour.active ? 140 : 32 }}>
        {session.isDemo && <DemoModeBanner onStartTour={!tour.active ? startTour : null} />}
        {tab === "dashboard" && <Dashboard data={data} session={session} setTab={setTab} setData={setData} logActivity={logActivity} />}
        {tab === "assets" && <Assets data={data} setData={setData} session={session} logActivity={logActivity} />}
        {tab === "alerts" && <Alerts data={data} setData={setData} session={session} logActivity={logActivity} />}
        {tab === "decisions" && <DecisionCenter data={data} setData={setData} session={session} logActivity={logActivity} />}
        {tab === "workorders" && <WorkOrders data={data} setData={setData} session={session} logActivity={logActivity} />}
        {tab === "technicians" && <TechnicianWorkspace data={data} setData={setData} session={session} logActivity={logActivity} />}
        {tab === "inventory" && <Inventory data={data} setData={setData} session={session} logActivity={logActivity} />}
        {tab === "reports" && <Reports data={data} />}
        {tab === "notifications" && <Notifications items={notifications} />}
        {tab === "integrations" && <IntegrationCenter data={data} />}
        {tab === "livedata" && <LiveDataMonitor data={data} />}
        {tab === "timeline" && <EventTimeline data={data} />}
        {tab === "fleet" && <FleetHealthMap data={data} setTab={setTab} />}
        {tab === "executive" && <ExecutiveDashboard data={data} session={session} />}
        {tab === "copilot" && <AiCopilot data={data} />}
        {tab === "settings" && <SettingsPage data={data} setData={setData} session={session} logActivity={logActivity} />}
      </main>
      {tour.active && <TourOverlay step={tour.step} onNext={tourNext} onSkip={tourSkip} />}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", background: "#12161A", display: "flex", alignItems: "center", justifyContent: "center", color: "#8A96A3" }}>
      <Loader2 size={22} style={{ marginRight: 10, animation: "meo-spin 1s linear infinite" }} /> Loading workspace…
      <style>{`@keyframes meo-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function EmailConfirmedScreen({ name, onContinue }) {
  useFonts();
  return (
    <div style={{ minHeight: "100vh", background: "#12161A", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F_BODY, color: "#EAEEF1", padding: 20 }}>
      <div style={{ width: 420, maxWidth: "100%", textAlign: "center" }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#34D3991A", border: "2px solid #34D39960", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <CheckCircle2 size={30} color="#34D399" />
        </div>
        <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 22, marginBottom: 8 }}>Email confirmed</div>
        <div style={{ fontSize: 13.5, color: "#8A96A3", marginBottom: 24, lineHeight: 1.6 }}>
          You're all set{name ? `, ${name.split(" ")[0]}` : ""} — your account is verified and you're signed in. Your workspace and everything in it is ready whenever you are.
        </div>
        <Button onClick={onContinue} style={{ justifyContent: "center", width: "100%" }}>
          Continue to MEO <ChevronRight size={15} />
        </Button>
      </div>
    </div>
  );
}

function WelcomeScreen({ onChoose }) {
  useFonts();
  return (
    <div style={{ minHeight: "100vh", background: "#12161A", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F_BODY, color: "#EAEEF1", padding: 20 }}>
      <div style={{ width: 520, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24, justifyContent: "center" }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "#F5A623", display: "flex", alignItems: "center", justifyContent: "center" }}><Gauge size={19} color="#14181C" /></div>
          <div><div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 18 }}>MEO</div><div style={{ fontSize: 11, color: "#8A96A3", fontFamily: F_MONO, letterSpacing: 0.4 }}>MAINTENANCE EXECUTION OS</div></div>
        </div>
        <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 24, textAlign: "center", marginBottom: 10 }}>Welcome to MEO</div>
        <div style={{ fontSize: 13, color: "#8A96A3", textAlign: "center", marginBottom: 28, lineHeight: 1.5 }}>Turn maintenance insights into fast, coordinated action before downtime happens.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card style={{ padding: 22, cursor: "pointer" }} onClick={() => onChoose("demo")}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 9, background: "#F5A6231A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Sparkles size={19} color="#F5A623" /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15.5 }}>🚀 Explore Interactive Demo</div>
                <div style={{ fontSize: 12, color: "#8A96A3", marginTop: 2 }}>Preloaded sample machines, alerts, and decisions — see MEO in action instantly.</div>
              </div>
              <ChevronRight size={16} color="#5B6672" />
            </div>
          </Card>
          <Card style={{ padding: 22, cursor: "pointer" }} onClick={() => onChoose("connect")}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 9, background: "#4C9FE51A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Building2 size={19} color="#4C9FE5" /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15.5 }}>🏭 Connect Your Plant</div>
                <div style={{ fontSize: 12, color: "#8A96A3", marginTop: 2 }}>Start with a clean workspace and register your real machines and team.</div>
              </div>
              <ChevronRight size={16} color="#5B6672" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DemoModeBanner({ onStartTour }) {
  return (
    <div style={{ background: "#F5A6231A", border: "1px solid #F5A62340", borderRadius: 8, padding: "9px 14px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: "#F5A623", fontWeight: 600, flexWrap: "wrap" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={14} /> Demo Mode — everything here is sample data, not live production data.</span>
      {onStartTour && <button onClick={onStartTour} style={{ background: "#F5A623", color: "#14181C", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>▶ Take the 2-minute tour</button>}
    </div>
  );
}

const TOUR_STEPS = [
  { tab: "dashboard", title: "Step 1 — Your morning briefing", text: "This is what a manager sees first: the AI assistant already looked at everything and told you what needs attention — no clicking around required." },
  { tab: "decisions", title: "Step 2 — The full picture", text: "Risk, cost if you wait, why it matters, and whether a technician and part are ready right now — everything needed to make the call, in one place." },
  { tab: "decisions", title: "Step 3 — Make the call", text: "Try tapping Approve on the top recommendation. That single tap is about to do real work for you." },
  { tab: "workorders", title: "Step 4 — It's already assigned", text: "That approval just created a real work order automatically — no extra typing, no second system to update." },
  { tab: "technicians", title: "Step 5 — What the technician sees", text: "Clear instructions, a Start Work button, a Complete Work button. No guessing what to do." },
  { tab: "dashboard", title: "That's the whole story", text: "Something needs attention → MEO tells you why → you approve it → it becomes a real job. Everything else in MEO supports this one loop." },
];

function TourOverlay({ step, onNext, onSkip }) {
  const isLast = step === TOUR_STEPS.length - 1;
  const s = TOUR_STEPS[step];
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 200, display: "flex", justifyContent: "center", padding: 16 }}>
      <div style={{ width: 480, maxWidth: "100%", background: "#1B2127", border: "1px solid #F5A62360", borderRadius: 12, padding: 18, boxShadow: "0 10px 40px #000000AA" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 10 }}>
          <div style={{ display: "flex", gap: 5 }}>
            {TOUR_STEPS.map((_, i) => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === step ? "#F5A623" : "#2B333B" }} />)}
          </div>
          <button onClick={onSkip} style={{ background: "none", border: "none", color: "#8A96A3", fontSize: 11.5, cursor: "pointer" }}>Skip tour</button>
        </div>
        <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{s.title}</div>
        <div style={{ fontSize: 13, color: "#C7CED5", marginBottom: 14, lineHeight: 1.5 }}>{s.text}</div>
        <Button onClick={onNext} style={{ justifyContent: "center", width: "100%" }}>
          {isLast ? "Finish" : "Next"} {!isLast && <ChevronRight size={15} />}
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------- Login ---------------------------------- */

function WorkflowDiagram() {
  const steps = ["Alert", "Decision", "Approval", "Work Order", "Assignment", "Execution", "Completed"];
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, rowGap: 10 }}>
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <span style={{ fontSize: 11.5, fontWeight: 600, padding: "6px 10px", borderRadius: 20, background: "#1B2127", border: "1px solid #2B333B", color: "#C7CED5", whiteSpace: "nowrap" }}>{s}</span>
          {i < steps.length - 1 && <ArrowRight size={12} color="#5B6672" style={{ flexShrink: 0 }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function Login({ onJoin, isDemo, onBack }) {
  useFonts();
  const [workspace, setWorkspace] = useState(isDemo ? "demo-" + Math.random().toString(36).slice(2, 8) : "");
  const [name, setName] = useState(isDemo ? "Demo User" : "");
  const [role, setRole] = useState("Manager");
  return (
    <div style={{ minHeight: "100vh", background: "#12161A", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F_BODY, color: "#EAEEF1", padding: 20 }}>
      <div style={{ width: 460, maxWidth: "100%" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#8A96A3", fontSize: 12, cursor: "pointer", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>← Back</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "#F5A623", display: "flex", alignItems: "center", justifyContent: "center" }}><Gauge size={19} color="#14181C" /></div>
          <div><div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 18 }}>MEO</div><div style={{ fontSize: 11, color: "#8A96A3", fontFamily: F_MONO, letterSpacing: 0.4 }}>MAINTENANCE EXECUTION OS</div></div>
        </div>

        {!isDemo && (
          <>
            <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 21, lineHeight: 1.35, marginBottom: 10 }}>Turn maintenance insights into fast, coordinated action before downtime happens.</div>
            <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 18, lineHeight: 1.5 }}>MEO helps maintenance teams prioritize, decide, and execute the right maintenance actions — the coordination layer between what your systems detect (predictive maintenance platforms, sensors, and more — too many to list individually) and what your team actually does about it.</div>
            <Card style={{ padding: 16, marginBottom: 18 }}>
              <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 10 }}>How it works</div>
              <WorkflowDiagram />
            </Card>
          </>
        )}

        {isDemo && (
          <div style={{ fontSize: 13, color: "#8A96A3", marginBottom: 18, lineHeight: 1.5 }}>You're entering demo mode — a workspace preloaded with sample machines, alerts, and decisions so you can click around freely. Nothing here is real production data.</div>
        )}

        <Card style={{ padding: 24 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 17, marginBottom: 4 }}>{isDemo ? "Enter the demo" : "Sign in to your workspace"}</div>
          <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 20 }}>{isDemo ? "We've generated a private demo workspace for you." : "Enter your company's workspace name to join or create it."}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Company workspace"><input style={inputStyle} placeholder="e.g. northgate-plant-2" value={workspace} onChange={(e) => setWorkspace(e.target.value)} disabled={isDemo} /></Field>
            <Field label="Your name"><input style={inputStyle} placeholder="e.g. J. Alvarez" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Your role">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ROLES.map((r) => (
                  <button key={r} onClick={() => setRole(r)} style={{ flex: "1 1 40%", padding: "8px 6px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, background: role === r ? "#F5A6231A" : "#12161A", color: role === r ? "#F5A623" : "#8A96A3", border: "1px solid " + (role === r ? "#F5A62360" : "#2B333B") }}>{r}</button>
                ))}
              </div>
            </Field>
            <Button disabled={!workspace.trim() || !name.trim()} onClick={() => onJoin({ workspace: workspace.trim(), name: name.trim(), role, isDemo: !!isDemo })} style={{ justifyContent: "center", marginTop: 6 }}>
              {isDemo ? "Enter demo" : "Enter workspace"} <ChevronRight size={15} />
            </Button>
          </div>
        </Card>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#5B6672", marginTop: 14 }}>Prototype auth — data is shared per workspace name, not password-protected.</div>
      </div>
    </div>

  );
}

function AuthScreen({ onJoin, onBack }) {
  useFonts();
  const [mode, setMode] = useState("signup"); // "signup" | "signin"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("Manager");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function handleSignUp() {
    setError(""); setInfo("");
    if (!workspace.trim() || !name.trim() || !email.trim()) { setError("Fill in every field."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords don't match."); return; }
    setLoading(true);
    const workspaceKey = "meo:v2:" + workspace.trim().toLowerCase();
    const existingMembers = await getWorkspaceMembers(workspaceKey);
    const isNewWorkspace = existingMembers.length === 0;
    if (!isNewWorkspace) {
      const invited = existingMembers.some((m) => m.email.toLowerCase() === email.trim().toLowerCase());
      if (!invited) {
        setLoading(false);
        setError("This workspace already has a team — you need to be invited first. Ask your manager to add your email in Settings → Team, then try again.");
        return;
      }
    }
    const { data, error: err } = await auth.signUp(email.trim(), password, { workspace: workspace.trim(), name: name.trim(), role });
    setLoading(false);
    if (err) { setError(err.message); return; }
    await addWorkspaceMember(workspaceKey, email.trim(), role, isNewWorkspace ? "self" : "invited", isNewWorkspace);
    if (data.session) {
      onJoin({ workspace: workspace.trim(), name: name.trim(), role, isDemo: false, email: email.trim() });
    } else {
      setInfo("Account created — check your email to confirm it, then sign in below.");
      setMode("signin");
    }
  }

  async function handleSignIn() {
    setError(""); setInfo("");
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setLoading(true);
    const { data, error: err } = await auth.signIn(email.trim(), password);
    setLoading(false);
    if (err) { setError(err.message); return; }
    const meta = data.user?.user_metadata || {};
    onJoin({ workspace: meta.workspace || "", name: meta.name || email.trim(), role: meta.role || "Manager", isDemo: false, email: email.trim() });
  }

  async function handleForgotPassword() {
    setError(""); setInfo("");
    if (!email.trim()) { setError("Enter your email above first, then tap this again."); return; }
    setLoading(true);
    const { error: err } = await auth.resetPasswordForEmail(email.trim());
    setLoading(false);
    if (err) { setError(err.message); return; }
    setInfo("If that email has an account, a reset link is on its way.");
  }

  return (
    <div style={{ minHeight: "100vh", background: "#12161A", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F_BODY, color: "#EAEEF1", padding: 20 }}>
      <div style={{ width: 440, maxWidth: "100%" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#8A96A3", fontSize: 12, cursor: "pointer", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>← Back</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "#F5A623", display: "flex", alignItems: "center", justifyContent: "center" }}><Gauge size={19} color="#14181C" /></div>
          <div><div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 18 }}>MEO</div><div style={{ fontSize: 11, color: "#8A96A3", fontFamily: F_MONO, letterSpacing: 0.4 }}>MAINTENANCE EXECUTION OS</div></div>
        </div>

        <Card style={{ padding: 24 }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 18, background: "#12161A", borderRadius: 8, padding: 3 }}>
            <button onClick={() => { setMode("signup"); setError(""); setInfo(""); }} style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: mode === "signup" ? "#232B33" : "transparent", color: mode === "signup" ? "#EAEEF1" : "#8A96A3" }}>Sign Up</button>
            <button onClick={() => { setMode("signin"); setError(""); setInfo(""); }} style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: mode === "signin" ? "#232B33" : "transparent", color: mode === "signin" ? "#EAEEF1" : "#8A96A3" }}>Sign In</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Email"><input type="email" style={inputStyle} placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password"><input type="password" style={inputStyle} placeholder={mode === "signup" ? "At least 6 characters" : "Your password"} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>

            {mode === "signup" && (
              <>
                <Field label="Confirm password"><input type="password" style={inputStyle} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></Field>
                <Field label="Company workspace"><input style={inputStyle} placeholder="e.g. northgate-plant-2" value={workspace} onChange={(e) => setWorkspace(e.target.value)} /></Field>
                <Field label="Your name"><input style={inputStyle} placeholder="e.g. J. Alvarez" value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Your role">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {ROLES.map((r) => (
                      <button key={r} onClick={() => setRole(r)} style={{ flex: "1 1 40%", padding: "8px 6px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, background: role === r ? "#F5A6231A" : "#12161A", color: role === r ? "#F5A623" : "#8A96A3", border: "1px solid " + (role === r ? "#F5A62360" : "#2B333B") }}>{r}</button>
                    ))}
                  </div>
                </Field>
              </>
            )}

            {error && <div style={{ fontSize: 12.5, color: "#E5484D" }}>{error}</div>}
            {info && <div style={{ fontSize: 12.5, color: "#34D399" }}>{info}</div>}

            <Button disabled={loading} onClick={mode === "signup" ? handleSignUp : handleSignIn} style={{ justifyContent: "center", marginTop: 4 }}>
              {loading ? <Loader2 size={15} style={{ animation: "meo-spin 1s linear infinite" }} /> : <ChevronRight size={15} />} {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
            <style>{`@keyframes meo-spin{to{transform:rotate(360deg)}}`}</style>

            {mode === "signin" && (
              <button onClick={handleForgotPassword} style={{ background: "none", border: "none", color: "#8A96A3", fontSize: 12, cursor: "pointer", textAlign: "center" }}>Forgot password?</button>
            )}
          </div>
        </Card>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#5B6672", marginTop: 14 }}>Real accounts, real passwords — handled securely by Supabase. Your team joins the same workspace by using the same workspace name at sign up.</div>
      </div>
    </div>
  );
}

/* -------------------------------- Sidebar ---------------------------------- */

function Sidebar({ tab, setTab, session, onLeave, notifCount, pendingDecisions, assistantName }) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: Gauge },
    { id: "assets", label: "Assets", icon: Factory },
    { id: "alerts", label: "Alerts", icon: AlertTriangle },
    { id: "decisions", label: "Decision Center", icon: Sparkles, hot: true, badge: pendingDecisions },
    { id: "workorders", label: "Work Orders", icon: ClipboardList },
    { id: "technicians", label: "Technicians", icon: Hammer },
    { id: "inventory", label: "Inventory", icon: Package },
    { id: "fleet", label: "Fleet Health Map", icon: Map },
    { id: "livedata", label: "Live Data Monitor", icon: Radio },
    { id: "timeline", label: "Event Timeline", icon: GitBranch },
    { id: "copilot", label: assistantName ? `Ask ${assistantName}` : "AI Copilot", icon: MessageCircle },
    { id: "integrations", label: "Integration Center", icon: Plug },
    { id: "reports", label: "Reports", icon: BarChart3 },
    { id: "executive", label: "Executive Dashboard", icon: LineChart },
    { id: "notifications", label: "Notifications", icon: Bell, badge: notifCount },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];
  return (
    <aside style={{ width: 236, flexShrink: 0, background: "#161B20", borderRight: "1px solid #2B333B", padding: "20px 14px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px", marginBottom: 22 }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: "#F5A623", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Gauge size={16} color="#14181C" /></div>
        <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 15.5 }}>MEO</div>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, overflowY: "auto" }}>
        {items.map((it) => {
          const active = tab === it.id;
          const Icon = it.icon;
          return (
            <button key={it.id} onClick={() => setTab(it.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 7, background: active ? "#232B33" : "transparent", border: "none", cursor: "pointer", color: active ? "#EAEEF1" : "#8A96A3", fontSize: 13.5, fontWeight: 500, textAlign: "left", borderLeft: active ? "2px solid #F5A623" : "2px solid transparent" }}>
              <Icon size={16} color={it.hot && !active ? "#F5A623" : undefined} />
              <span style={{ flex: 1 }}>{it.label}</span>
              {!!it.badge && <span style={{ background: it.id === "decisions" ? "#F5A623" : "#E5484D", color: it.id === "decisions" ? "#14181C" : "#fff", fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 10 }}>{it.badge}</span>}
            </button>
          );
        })}
      </nav>
      <div style={{ borderTop: "1px solid #2B333B", paddingTop: 12, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px", marginBottom: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#232B33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#F5A623" }}>{session.name.slice(0, 1).toUpperCase()}</div>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.name}</div><div style={{ fontSize: 10.5, color: "#8A96A3" }}>{session.role} · {session.workspace}</div></div>
        </div>
        <button onClick={onLeave} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", color: "#8A96A3", fontSize: 12.5, cursor: "pointer", padding: "6px 8px" }}><LogOut size={14} /> Leave workspace</button>
      </div>
    </aside>
  );
}

/* -------------------------------- Notifications core ---------------------------------- */

function computeNotifications(data) {
  const items = [];
  data.alerts.filter((a) => !a.resolved && (a.severity === "High" || a.severity === "Critical") && (Date.now() - new Date(a.date)) < 86400000 * 3).forEach((a) => {
    const m = data.machines.find((m) => m.id === a.machineId);
    items.push({ id: a.id, kind: "alert", severity: a.severity, text: `${a.type} on ${m ? m.name : "a machine"} — ${a.severity}`, at: a.date });
  });
  data.workOrders.filter((w) => w.status === "Assigned" || w.status === "Approved").forEach((w) => {
    const m = data.machines.find((m) => m.id === w.machineId);
    items.push({ id: w.id + "-a", kind: "assigned", severity: w.priority, text: `Work order ${w.woNumber} assigned: ${m ? m.name : ""}`, at: w.dueDate });
  });
  data.decisions.filter((d) => d.status === "Pending").forEach((d) => {
    const m = data.machines.find((m) => m.id === d.machineId);
    items.push({ id: d.id + "-p", kind: "approval", severity: d.risk, text: `Approval needed: ${d.action} (${m ? m.name : ""})`, at: data.aiRun?.generatedAt || new Date().toISOString() });
  });
  data.machines.filter((m) => m.nextMaintenance && daysUntil(m.nextMaintenance) < 0).forEach((m) => {
    items.push({ id: m.id + "-om", kind: "overdue", severity: "High", text: `Maintenance overdue: ${m.name}`, at: m.nextMaintenance });
  });
  data.parts.filter((p) => p.quantity <= p.minStock).forEach((p) => {
    items.push({ id: p.id + "-low", kind: "parts", severity: "Medium", text: `Parts running low: ${p.name} (${p.quantity} left)`, at: new Date().toISOString() });
  });
  return items.sort((a, b) => new Date(b.at) - new Date(a.at));
}

/* -------------------------------- Dashboard --------------------------------- */

function greeting(timezone) {
  let h;
  try {
    h = timezone ? Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(new Date())) : new Date().getHours();
  } catch (e) {
    h = new Date().getHours();
  }
  if (h < 12) return "morning"; if (h < 17) return "afternoon"; return "evening";
}

const TIMEZONES = [
  { label: "Nigeria (Lagos)", value: "Africa/Lagos" },
  { label: "UK (London)", value: "Europe/London" },
  { label: "USA — Eastern", value: "America/New_York" },
  { label: "USA — Central", value: "America/Chicago" },
  { label: "USA — Pacific", value: "America/Los_Angeles" },
  { label: "South Africa (Johannesburg)", value: "Africa/Johannesburg" },
  { label: "Kenya (Nairobi)", value: "Africa/Nairobi" },
  { label: "Ghana (Accra)", value: "Africa/Accra" },
  { label: "UAE (Dubai)", value: "Asia/Dubai" },
  { label: "India (Delhi/Mumbai)", value: "Asia/Kolkata" },
  { label: "Germany (Berlin)", value: "Europe/Berlin" },
  { label: "China (Shanghai)", value: "Asia/Shanghai" },
  { label: "Australia (Sydney)", value: "Australia/Sydney" },
];

function DashboardHeroDecision({ decision, machine, data, session, setData, logActivity, setTab }) {
  const [decideModal, setDecideModal] = useState(null);
  const color = RISK_COLOR[decision.risk] || "#8A96A3";
  const matches = machine ? computeTechnicianMatch(machine, data) : [];
  const techReady = matches.length > 0;
  const neededParts = (decision.requiredParts || "").split(",").map((s) => s.trim()).filter(Boolean);
  const partsReady = neededParts.length === 0 || neededParts.every((pn) => data.parts.some((p) => p.machineId === decision.machineId && p.name.toLowerCase().includes(pn.toLowerCase()) && p.quantity > 0));
  const altPart = !partsReady ? data.parts.find((p) => p.machineId === decision.machineId && p.alternativePartName) : null;

  function confirmDecide(reasonText, chosenTechnician) {
    const action = decideModal.action;
    let dupInfo = null;
    setData((d) => {
      let workOrders = d.workOrders;
      let woCounter = d.woCounter || 0;
      let workOrderId = null;
      if (action === "Approved") {
        const result = createWorkOrderForDecision(d, decision, chosenTechnician);
        workOrders = result.workOrders; woCounter = result.woCounter; workOrderId = result.workOrderId;
        if (result.duplicatePrevented) dupInfo = result.woNumber;
      }
      const decisions = d.decisions.map((dec) => dec.id === decision.id ? { ...dec, status: action, decisionReason: reasonText, decidedBy: session.name, decidedAt: new Date().toISOString(), workOrderId } : dec);
      return { ...d, decisions, workOrders, woCounter };
    });
    logActivity(dupInfo ? `${session.name} approved ${decision.action} for ${machine?.name} — linked to existing ${dupInfo} instead of creating a duplicate` : `${session.name} ${action.toLowerCase()} recommendation for ${machine?.name}: ${decision.action}`);
    setDecideModal(null);
  }

  return (
    <Card style={{ padding: 22, borderLeft: `4px solid ${color}`, marginBottom: 22 }}>
      <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 10 }}>What needs your attention right now</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 19 }}>{machine?.name || "Unknown machine"}</div>
        <Badge color={color}>{decision.risk} risk</Badge>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", marginBottom: 14 }}>
        <div><div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Expected production loss if we wait</div><div style={{ fontFamily: F_MONO, fontSize: 19, fontWeight: 700, color: "#E5484D" }}>{fmtMoney(decision.downtimeCost)}</div></div>
        {decision.recommendedTimeWindow && <div><div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Time window</div><div style={{ fontSize: 15, fontWeight: 600 }}>{decision.recommendedTimeWindow}</div></div>}
      </div>
      <div style={{ marginBottom: 10 }}><div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Why</div><div style={{ fontSize: 13, color: "#C7CED5" }}>{decision.reason}</div></div>
      <div style={{ marginBottom: 16 }}><div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Recommended action</div><div style={{ fontSize: 15, fontWeight: 600 }}>{decision.action}</div></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18, background: "#12161A", borderRadius: 8, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>{techReady ? <CheckCircle2 size={13} color="#34D399" /> : <AlertTriangle size={13} color="#F5A623" />}{techReady ? `Technician available${matches[0] ? ` — ${matches[0].name}` : ""}` : "No technician available"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>{partsReady ? <CheckCircle2 size={13} color="#34D399" /> : <AlertTriangle size={13} color="#E5484D" />}{neededParts.length === 0 ? "No specific parts required" : partsReady ? `Spare part in stock: ${neededParts.join(", ")}` : `Spare part missing: ${neededParts.join(", ")}${altPart ? ` — alternative available: ${altPart.alternativePartName}` : ""}`}</div>
      </div>
      <RoleGate role={session.role} allow={["Manager", "Supervisor", "Administrator"]}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="success" onClick={() => setDecideModal({ action: "Approved" })}><CheckCheck size={14} /> Approve Work Order</Button>
          <Button variant="ghost" onClick={() => setDecideModal({ action: "Delayed" })}><PauseCircle size={14} /> Delay</Button>
          <Button variant="danger" onClick={() => setDecideModal({ action: "Rejected" })}><XCircle size={14} /> Reject</Button>
          <button onClick={() => setTab("decisions")} style={{ background: "none", border: "none", color: "#8A96A3", fontSize: 12, cursor: "pointer", marginLeft: "auto" }}>See all priorities →</button>
        </div>
      </RoleGate>
      {decideModal && <DecideModal decision={decision} action={decideModal.action} machine={machine} data={data} onClose={() => setDecideModal(null)} onConfirm={confirmDecide} />}
    </Card>
  );
}

function ConnectPlantChecklist({ data, setTab }) {
  const steps = [
    { label: "Create organization", done: true, note: "You're in — this workspace is your organization." },
    { label: "Register assets", done: data.machines.length > 0, action: () => setTab("assets"), actionLabel: "Register machines" },
    { label: "Import CMMS", done: false, comingSoon: true },
    { label: "Connect ERP", done: false, comingSoon: true },
    { label: "Connect PLC / SCADA", done: false, comingSoon: true },
    { label: "Connect IoT", done: false, comingSoon: true },
    { label: "Invite technicians", done: data.team.length > 0, action: () => setTab("settings"), actionLabel: "Add team" },
    { label: "Start receiving live data", done: data.alerts.some((a) => a.sensorNote), action: () => setTab("livedata"), actionLabel: "View Live Data Monitor" },
  ];
  return (
    <Card style={{ padding: 20, marginBottom: 22 }}>
      <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Connect Your Plant</div>
      <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 16 }}>A quick checklist to get MEO running on your real operation.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", background: "#12161A", borderRadius: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              {s.done ? <CheckCircle2 size={15} color="#34D399" /> : <div style={{ width: 15, height: 15, borderRadius: "50%", border: "1.5px solid #5B6672", flexShrink: 0 }} />}
              <span style={{ fontSize: 13, color: s.done ? "#EAEEF1" : "#C7CED5" }}>{s.label}</span>
              {s.comingSoon && <Badge color="#8A96A3">Coming soon</Badge>}
            </div>
            {s.action && !s.done && <button onClick={s.action} style={{ background: "none", border: "none", color: "#F5A623", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>{s.actionLabel} →</button>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AssistantBriefing({ data, session, setData, logActivity }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [localName, setLocalName] = useState("");
  const assistantName = data.settings?.assistantName;
  const automatic = !!data.settings?.automaticBriefings;
  const briefing = data.settings?.assistantBriefing;
  const stale = !briefing || (Date.now() - new Date(briefing.generatedAt).getTime()) > 4 * 3600000;
  const triedAuto = useRef(false);

  async function generateBriefing() {
    setRunning(true); setError("");
    try {
      const prompt = buildBriefingPrompt(data, session);
      const res = await fetch("/api/generate-priorities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      const text = (json.text || "").trim();
      setData((d) => ({ ...d, settings: { ...d.settings, assistantBriefing: { text, generatedAt: new Date().toISOString() } } }));
      logActivity(`${data.settings?.assistantName || "Assistant"} gave a briefing`);
    } catch (e) {
      setError(`Couldn't get a briefing: ${e.message || "unknown error"}`);
    } finally { setRunning(false); }
  }

  useEffect(() => {
    if (triedAuto.current) return;
    if (automatic && assistantName && data.machines.length > 0 && stale && !running) {
      triedAuto.current = true;
      generateBriefing();
    }
  }, [automatic, assistantName, stale]);

  function saveAssistantName() {
    if (!localName.trim()) return;
    setData((d) => ({ ...d, settings: { ...d.settings, assistantName: localName.trim() } }));
  }

  if (!assistantName) {
    return (
      <Card style={{ padding: 20, marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15 }}><MessageCircle size={16} color="#F5A623" /> Name your AI Assistant</div>
        <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 12 }}>Give it a name and it'll greet you here every time you log in, summarizing what actually needs attention — no clicking around required.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...inputStyle, flex: 1 }} value={localName} onChange={(e) => setLocalName(e.target.value)} placeholder="e.g. James" />
          <Button onClick={saveAssistantName} disabled={!localName.trim()}>Save name</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 20, marginBottom: 22, background: "linear-gradient(180deg, #1B2127 0%, #191F25 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14 }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#F5A6231A", display: "flex", alignItems: "center", justifyContent: "center" }}><Sparkles size={13} color="#F5A623" /></div>
          {assistantName}
        </div>
        <button onClick={generateBriefing} disabled={running} style={{ background: "none", border: "none", color: "#8A96A3", fontSize: 11.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
          {running ? <Loader2 size={12} style={{ animation: "meo-spin 1s linear infinite" }} /> : <RefreshCw size={12} />} {briefing ? "Refresh" : "Get briefing"}
        </button>
      </div>
      <style>{`@keyframes meo-spin{to{transform:rotate(360deg)}}`}</style>
      {error && <div style={{ fontSize: 12.5, color: "#E5484D" }}>{error}</div>}
      {running && !briefing && <div style={{ fontSize: 13, color: "#8A96A3", display: "flex", alignItems: "center", gap: 8 }}><Loader2 size={14} style={{ animation: "meo-spin 1s linear infinite" }} /> {assistantName} is looking things over…</div>}
      {briefing && <div style={{ fontSize: 13.5, color: "#EAEEF1", lineHeight: 1.6 }}>{briefing.text}</div>}
      {briefing && <div style={{ fontSize: 10.5, color: "#5B6672", marginTop: 8 }}>{relTime(briefing.generatedAt)}</div>}
      {!briefing && !running && !error && <div style={{ fontSize: 13, color: "#8A96A3" }}>Tap "Get briefing" whenever you want {assistantName} to summarize what needs attention.</div>}
    </Card>
  );
}

function Dashboard({ data, session, setTab, setData, logActivity }) {
  const running = data.machines.filter((m) => m.status === "Running").length;
  const atRisk = data.machines.filter((m) => m.status === "At Risk").length;
  const openWO = data.workOrders.filter((w) => w.status !== "Completed" && w.status !== "Closed").length;
  const overdueWO = data.workOrders.filter((w) => isOverdue(w.dueDate, w.status)).length;
  const completedToday = data.workOrders.filter((w) => w.completedAt && new Date(w.completedAt).toDateString() === new Date().toDateString()).length;
  const criticalAlerts = data.alerts.filter((a) => !a.resolved && a.severity === "Critical").length;

  const pending = data.decisions.filter((d) => d.status === "Pending").sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || b.downtimeCost - a.downtimeCost);
  const topDecision = pending[0];
  const topMachine = topDecision ? data.machines.find((m) => m.id === topDecision.machineId) : null;
  const others = pending.slice(1, 4);

  const stats = [
    { label: "Machines Running", value: running, total: data.machines.length, color: "#34D399", icon: Factory },
    { label: "Machines at Risk", value: atRisk, color: "#F5A623", icon: AlertTriangle },
    { label: "Open Work Orders", value: openWO, color: "#4C9FE5", icon: ClipboardList },
    { label: "Overdue Tasks", value: overdueWO, color: "#E5484D", icon: Clock },
    { label: "Completed Today", value: completedToday, color: "#34D399", icon: CheckCircle2 },
    { label: "Critical Alerts", value: criticalAlerts, color: "#E5484D", icon: ShieldAlert },
  ];

  return (
    <div>
      <PageHeader title={`Good ${greeting(data.settings?.timezone)}, ${session.name.split(" ")[0]}`} subtitle="What needs a decision, why it matters, and what happens if you wait." />

      {!session.isDemo && data.machines.length === 0 && <ConnectPlantChecklist data={data} setTab={setTab} />}
      <AssistantBriefing data={data} session={session} setData={setData} logActivity={logActivity} />

      {topDecision ? (
        <DashboardHeroDecision decision={topDecision} machine={topMachine} data={data} session={session} setData={setData} logActivity={logActivity} setTab={setTab} />
      ) : (
        <Card style={{ padding: 28, marginBottom: 22, textAlign: "center" }}>
          <CheckCircle2 size={24} color="#34D399" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Nothing needs a decision right now</div>
          <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 14 }}>Head to the Decision Center to analyze current conditions across your registered machines.</div>
          <Button variant="ghost" onClick={() => setTab("decisions")} style={{ margin: "0 auto" }}>Open Decision Center <ChevronRight size={14} /></Button>
        </Card>
      )}

      {others.length > 0 && (
        <Card style={{ padding: 18, marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "#8A96A3", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Next up</div>
            <button onClick={() => setTab("decisions")} style={{ background: "none", border: "none", color: "#F5A623", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>See all <ChevronRight size={13} /></button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {others.map((d) => {
              const m = data.machines.find((m) => m.id === d.machineId);
              return (
                <div key={d.id} style={{ display: "flex", gap: 12, padding: "10px 12px", background: "#12161A", borderRadius: 8, borderLeft: `3px solid ${RISK_COLOR[d.risk]}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}><Badge color={RISK_COLOR[d.risk]}>{d.risk}</Badge><span style={{ fontWeight: 600, fontSize: 13 }}>{d.action}</span></div>
                    <div style={{ fontSize: 11.5, color: "#8A96A3" }}>{m?.name} · Expected loss {fmtMoney(d.downtimeCost)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 22 }}>
        {stats.map((s) => (
          <Card key={s.label} style={{ padding: "13px 15px" }}>
            <s.icon size={14} color={s.color} style={{ marginBottom: 6 }} />
            <div style={{ fontFamily: F_MONO, fontSize: 19, fontWeight: 600 }}>{s.value}{s.total !== undefined ? <span style={{ fontSize: 12, color: "#5B6672" }}> /{s.total}</span> : null}</div>
            <div style={{ fontSize: 11, color: "#8A96A3", marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: 20 }}>
        <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}><Activity size={16} color="#4C9FE5" /> Recent Activity</div>
        {data.activity.length === 0 ? <EmptyState icon={Activity} text="Nothing has happened yet." /> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.activity.slice(0, 8).map((a) => (
              <div key={a.id} style={{ display: "flex", gap: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4C9FE5", marginTop: 6, flexShrink: 0 }} />
                <div><div style={{ fontSize: 12.5 }}>{a.text}</div><div style={{ fontSize: 11, color: "#5B6672", fontFamily: F_MONO }}>{relTime(a.at)}</div></div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* --------------------------------- Assets ----------------------------------- */

function Assets({ data, setData, session, logActivity }) {
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const canEdit = session.role === "Manager" || session.role === "Supervisor" || session.role === "Administrator";

  function save(machine) {
    setData((d) => {
      const exists = d.machines.some((m) => m.id === machine.id);
      const machines = exists ? d.machines.map((m) => (m.id === machine.id ? machine : m)) : [...d.machines, machine];
      return { ...d, machines };
    });
    logActivity(`${modal && modal.id ? "Updated" : "Registered"} machine ${machine.name} (${machine.machineId})`);
    setModal(null);
  }

  if (selected) {
    const m = data.machines.find((m) => m.id === selected);
    if (!m) { setSelected(null); return null; }
    const machineAlerts = data.alerts.filter((a) => a.machineId === m.id).sort((a, b) => new Date(b.date) - new Date(a.date));
    const machineWOs = data.workOrders.filter((w) => w.machineId === m.id).sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate));
    const reliability = machineReliabilityStats(m.id, data);
    return (
      <div>
        <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#8A96A3", fontSize: 12.5, cursor: "pointer", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>← Back to assets</button>
        <PageHeader title={m.name} subtitle={m.machineId} action={<RoleGate role={session.role} allow={["Manager", "Supervisor", "Administrator"]}><Button variant="ghost" onClick={() => setModal(m)}>Edit machine</Button></RoleGate>} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <Card style={{ padding: 20 }}>
            <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Details</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              <Row label="Status"><Badge color={STATUS_COLOR[m.status]}><Dot color={STATUS_COLOR[m.status]} />{m.status}</Badge></Row>
              <Row label="Criticality"><Badge color={RISK_COLOR[m.criticality] || "#8A96A3"}>{m.criticality}</Badge></Row>
              {m.assetType && <Row label="Asset type">{m.assetType}</Row>}
              {m.serialNumber && <Row label="Serial number">{m.serialNumber}</Row>}
              <Row label="Location">{m.location}</Row>
              <Row label="Manufacturer">{m.manufacturer}</Row>
              <Row label="Installed">{fmtDate(m.installDate)}</Row>
              <Row label="Maintenance interval">Every {m.intervalDays} days</Row>
              <Row label="Last maintenance">{fmtDate(m.lastMaintenance)}</Row>
              <Row label="Next maintenance">{fmtDate(m.nextMaintenance)}{daysUntil(m.nextMaintenance) < 0 && <span style={{ color: "#E5484D", marginLeft: 8, fontSize: 11.5 }}>overdue</span>}</Row>
              <Row label="MTBF">{reliability.mtbf != null ? `${reliability.mtbf.toFixed(0)} days` : "Not enough alert history yet"}</Row>
              <Row label="MTTR">{reliability.mttrHours != null ? `${reliability.mttrHours.toFixed(1)} hours` : "Not enough repair history yet"}</Row>
            </div>
          </Card>
          <Card style={{ padding: 20 }}>
            <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Recent alerts</div>
            {machineAlerts.length === 0 ? <div style={{ fontSize: 12.5, color: "#5B6672" }}>No alerts logged.</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {machineAlerts.slice(0, 5).map((a) => <div key={a.id} style={{ fontSize: 12.5 }}><Badge color={RISK_COLOR[a.severity]}>{a.severity}</Badge> <span style={{ marginLeft: 6 }}>{a.type}</span> <span style={{ color: "#5B6672" }}> · {relTime(a.date)}</span></div>)}
              </div>
            )}
          </Card>
        </div>
        <Card style={{ padding: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Work order history</div>
          {machineWOs.length === 0 ? <div style={{ fontSize: 12.5, color: "#5B6672" }}>No work orders yet.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {machineWOs.map((w) => (
                <div key={w.id} style={{ padding: "8px 0", borderBottom: "1px solid #2B333B" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}><span>{w.woNumber} · {w.assignedTech}</span><Badge color={WO_STATUS_COLOR[w.status]}>{w.status}</Badge></div>
                  {w.rootCause && <div style={{ fontSize: 11.5, color: "#8A96A3", marginTop: 3 }}>Root cause: {w.rootCause}{w.correctiveAction ? ` · Fix: ${w.correctiveAction}` : ""}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
        {modal && <MachineModal machine={modal} machines={data.machines} onClose={() => setModal(null)} onSave={save} />}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Assets" subtitle="Every machine your team is responsible for." action={<RoleGate role={session.role} allow={["Manager", "Supervisor", "Administrator"]}><Button onClick={() => setModal({})}><Plus size={15} /> Register machine</Button></RoleGate>} />
      {data.machines.length === 0 ? (
        <Card style={{ padding: 32, textAlign: "center" }}>
          <Factory size={28} style={{ opacity: 0.4, marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No machines registered yet</div>
          <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 18, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>Register your real machines — the Decision Center only ever reasons about what's actually here, nothing invented.</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <RoleGate role={session.role} allow={["Manager", "Supervisor", "Administrator"]}>
              <Button onClick={() => setModal({})}><Plus size={15} /> Register your first machine</Button>
              <Button variant="ghost" onClick={() => { const s = seedData(); setData((d) => ({ ...d, ...s })); logActivity("Loaded sample data for demo purposes"); }}>Load sample data instead</Button>
            </RoleGate>
          </div>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
          {data.machines.map((m) => {
            const openAlerts = data.alerts.filter((a) => a.machineId === m.id && !a.resolved).length;
            return (
              <Card key={m.id} style={{ padding: 18, cursor: "pointer" }} onClick={() => setSelected(m.id)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div><div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15.5 }}>{m.name}</div><div style={{ fontFamily: F_MONO, fontSize: 11.5, color: "#8A96A3", marginTop: 2 }}>{m.machineId}</div></div>
                  <Badge color={STATUS_COLOR[m.status]}><Dot color={STATUS_COLOR[m.status]} />{m.status}</Badge>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12, color: "#8A96A3" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}><MapPin size={12} /> {m.location}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Factory size={12} /> {m.manufacturer}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Calendar size={12} /> Next due {fmtDate(m.nextMaintenance)}</span>
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <Badge color={RISK_COLOR[m.criticality] || "#8A96A3"}>{m.criticality} criticality</Badge>
                  {openAlerts > 0 && <Badge color="#E5484D">{openAlerts} open alert{openAlerts > 1 ? "s" : ""}</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {modal !== null && <MachineModal machine={modal} machines={data.machines} onClose={() => setModal(null)} onSave={save} />}
    </div>
  );
}

function Row({ label, children }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#8A96A3" }}>{label}</span><span style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>{children}</span></div>;
}

function MachineModal({ machine, machines = [], onClose, onSave }) {
  const [form, setForm] = useState({
    id: machine.id || uid("m"), name: machine.name || "", machineId: machine.machineId || "",
    location: machine.location || "", manufacturer: machine.manufacturer || "", serialNumber: machine.serialNumber || "", assetType: machine.assetType || "",
    installDate: machine.installDate ? machine.installDate.slice(0, 10) : "", intervalDays: machine.intervalDays || 30,
    status: machine.status || "Running", criticality: machine.criticality || "Medium",
    lastMaintenance: machine.lastMaintenance ? machine.lastMaintenance.slice(0, 10) : "",
    nextMaintenance: machine.nextMaintenance ? machine.nextMaintenance.slice(0, 10) : "",
  });
  const [touched, setTouched] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const nameError = validateMachineName(form.name);
  const idError = validateMachineId(form.machineId, machines, form.id);
  const hasErrors = !!nameError || !!idError;
  return (
    <Modal title={machine.id ? "Edit machine" : "Register machine"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Machine name">
          <input style={inputStyle} value={form.name} onChange={set("name")} onBlur={() => setTouched((t) => ({ ...t, name: true }))} placeholder="Boiler A" />
          {touched.name && nameError && <div style={{ color: "#E5484D", fontSize: 11.5, marginTop: 4 }}>{nameError}</div>}
        </Field>
        <Field label="Machine ID">
          <input style={{ ...inputStyle, fontFamily: F_MONO }} value={form.machineId} onChange={set("machineId")} onBlur={() => setTouched((t) => ({ ...t, machineId: true }))} placeholder="BLR-001" />
          {touched.machineId && idError && <div style={{ color: "#E5484D", fontSize: 11.5, marginTop: 4 }}>{idError}</div>}
          {!idError && form.machineId && touched.machineId && <div style={{ color: "#34D399", fontSize: 11.5, marginTop: 4 }}>Looks like a valid machine ID.</div>}
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Serial number (optional)"><input style={inputStyle} value={form.serialNumber} onChange={set("serialNumber")} placeholder="SN-88231" /></Field>
          <Field label="Asset type (optional)"><input style={inputStyle} value={form.assetType} onChange={set("assetType")} placeholder="Boiler" /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Location"><input style={inputStyle} value={form.location} onChange={set("location")} placeholder="Bay 1" /></Field>
          <Field label="Manufacturer"><input style={inputStyle} value={form.manufacturer} onChange={set("manufacturer")} placeholder="Cleaver-Brooks" /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Installation date"><input type="date" style={inputStyle} value={form.installDate} onChange={set("installDate")} /></Field>
          <Field label="Maintenance interval (days)"><input type="number" style={inputStyle} value={form.intervalDays} onChange={set("intervalDays")} /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Last maintenance"><input type="date" style={inputStyle} value={form.lastMaintenance} onChange={set("lastMaintenance")} /></Field>
          <Field label="Next maintenance"><input type="date" style={inputStyle} value={form.nextMaintenance} onChange={set("nextMaintenance")} /></Field>
        </div>
        <Field label="Criticality">
          <div style={{ display: "flex", gap: 8 }}>{RISK_LEVELS.map((s) => <button key={s} onClick={() => setForm((f) => ({ ...f, criticality: s }))} style={{ flex: 1, padding: "8px 4px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, background: form.criticality === s ? RISK_COLOR[s] + "1A" : "#12161A", color: form.criticality === s ? RISK_COLOR[s] : "#8A96A3", border: "1px solid " + (form.criticality === s ? RISK_COLOR[s] + "60" : "#2B333B") }}>{s}</button>)}</div>
        </Field>
        <Field label="Status">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{MACHINE_STATUSES.map((s) => <button key={s} onClick={() => setForm((f) => ({ ...f, status: s }))} style={{ flex: "1 1 40%", padding: "8px 4px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, background: form.status === s ? STATUS_COLOR[s] + "1A" : "#12161A", color: form.status === s ? STATUS_COLOR[s] : "#8A96A3", border: "1px solid " + (form.status === s ? STATUS_COLOR[s] + "60" : "#2B333B") }}>{s}</button>)}</div>
          <div style={{ fontSize: 10.5, color: "#5B6672", marginTop: 5 }}>Set this based on what you currently observe. MEO can't detect it automatically yet — that needs a real sensor physically connected to this machine (see Integration Center).</div>
        </Field>
        <Button style={{ justifyContent: "center", marginTop: 6 }} disabled={hasErrors}
          onClick={() => {
            if (hasErrors) { setTouched({ name: true, machineId: true }); return; }
            onSave({ ...form, installDate: form.installDate ? new Date(form.installDate).toISOString() : new Date().toISOString(), intervalDays: Number(form.intervalDays) || 30, lastMaintenance: form.lastMaintenance ? new Date(form.lastMaintenance).toISOString() : null, nextMaintenance: form.nextMaintenance ? new Date(form.nextMaintenance).toISOString() : null });
          }}>
          Save machine
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------------- Alerts ------------------------------------ */

function Alerts({ data, setData, session, logActivity }) {
  const [modal, setModal] = useState(false);
  const sorted = data.alerts.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  function addAlert(alert) {
    setData((d) => ({ ...d, alerts: [alert, ...d.alerts] }));
    const m = data.machines.find((m) => m.id === alert.machineId);
    logActivity(`${alert.severity} alert on ${m ? m.name : "a machine"}: ${alert.type}`);
    setModal(false);
  }
  function toggleResolved(alert) { setData((d) => ({ ...d, alerts: d.alerts.map((a) => (a.id === alert.id ? { ...a, resolved: !a.resolved } : a)) })); }

  return (
    <div>
      <PageHeader title="Alerts" subtitle="What's showing up on the floor right now." action={<Button onClick={() => setModal(true)}><Plus size={15} /> Report alert</Button>} />
      {data.machines.length === 0 && <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 14 }}>Register a machine in Assets first.</div>}
      {sorted.length === 0 ? <EmptyState icon={AlertTriangle} text="No alerts reported." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((a) => {
            const m = data.machines.find((m) => m.id === a.machineId);
            return (
              <Card key={a.id} style={{ padding: 16, opacity: a.resolved ? 0.55 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <Badge color={RISK_COLOR[a.severity]}>{a.severity}</Badge>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{a.type}</span>
                      <span style={{ fontSize: 12, color: "#8A96A3" }}>· {m ? m.name : "Unknown machine"}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#C7CED5", marginBottom: 8 }}>{a.description}</div>
                    <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "#8A96A3", flexWrap: "wrap" }}>
                      <span>Reported by {a.reporter}</span><span>{fmtDateTime(a.date)}</span>
                      {a.photoNote && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Camera size={12} /> {a.photoNote}</span>}
                      {a.sensorNote && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Activity size={12} /> {a.sensorNote}</span>}
                    </div>
                  </div>
                  <button onClick={() => toggleResolved(a)} style={{ background: "none", border: "1px solid #2B333B", borderRadius: 6, padding: "6px 10px", color: a.resolved ? "#34D399" : "#8A96A3", fontSize: 11.5, cursor: "pointer", height: "fit-content", whiteSpace: "nowrap" }}>{a.resolved ? "Resolved" : "Mark resolved"}</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {modal && <AlertModal machines={data.machines} session={session} onClose={() => setModal(false)} onSave={addAlert} />}
    </div>
  );
}

function AlertModal({ machines, session, onClose, onSave }) {
  const [form, setForm] = useState({ machineId: machines[0]?.id || "", type: "", description: "", severity: "Medium", photoNote: "", sensorNote: "" });
  return (
    <Modal title="Report an alert" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Machine"><select style={inputStyle} value={form.machineId} onChange={(e) => setForm((f) => ({ ...f, machineId: e.target.value }))}>{machines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.machineId})</option>)}</select></Field>
        <Field label="Alert type"><input style={inputStyle} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} placeholder="Overheating, vibration, leak…" /></Field>
        <Field label="Description"><textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Describe what you're seeing…" /></Field>
        <Field label="Severity"><div style={{ display: "flex", gap: 8 }}>{RISK_LEVELS.map((s) => <button key={s} onClick={() => setForm((f) => ({ ...f, severity: s }))} style={{ flex: 1, padding: "8px 4px", borderRadius: 6, cursor: "pointer", fontSize: 12, background: form.severity === s ? RISK_COLOR[s] + "1A" : "#12161A", color: form.severity === s ? RISK_COLOR[s] : "#8A96A3", border: "1px solid " + (form.severity === s ? RISK_COLOR[s] + "60" : "#2B333B") }}>{s}</button>)}</div></Field>
        <Field label="Photo note (optional)"><input style={inputStyle} value={form.photoNote} onChange={(e) => setForm((f) => ({ ...f, photoNote: e.target.value }))} placeholder="Describe attached photo" /></Field>
        <Field label="Sensor data (optional, future-ready)"><input style={inputStyle} value={form.sensorNote} onChange={(e) => setForm((f) => ({ ...f, sensorNote: e.target.value }))} placeholder="e.g. Temp 94°C, rising" /></Field>
        <Button disabled={!form.machineId || !form.type.trim() || !form.description.trim()} style={{ justifyContent: "center", marginTop: 6 }} onClick={() => onSave({ id: uid("al"), ...form, date: new Date().toISOString(), reporter: session.name, resolved: false })}>Submit alert</Button>
      </div>
    </Modal>
  );
}

/* ---------------------------- Decision Center (flagship) ----------------------------- */

function buildAiPrompt(data) {
  const machines = data.machines.map((m) => {
    const allAlerts = data.alerts.filter((a) => a.machineId === m.id);
    const openAlerts = allAlerts.filter((a) => !a.resolved);
    const completedWOs = data.workOrders.filter((w) => w.machineId === m.id && (w.status === "Completed" || w.status === "Closed")).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    const alertsLast30Days = allAlerts.filter((a) => (Date.now() - new Date(a.date)) < 86400000 * 30).length;
    const daysSinceInstall = Math.round((Date.now() - new Date(m.installDate)) / 86400000);
    const daysSinceLastRepair = completedWOs[0]?.completedAt ? Math.round((Date.now() - new Date(completedWOs[0].completedAt)) / 86400000) : null;
    const overdueMaintenance = m.nextMaintenance ? daysUntil(m.nextMaintenance) : null;
    const relatedParts = data.parts.filter((p) => p.machineId === m.id).map((p) => ({ name: p.name, quantity: p.quantity, minStock: p.minStock, supplier: p.supplier }));
    return {
      name: m.name, machineId: m.machineId, status: m.status, criticality: m.criticality, location: m.location,
      maintenanceIntervalDays: m.intervalDays, daysSinceInstall, daysUntilNextMaintenance: overdueMaintenance,
      history: { totalAlertsAllTime: allAlerts.length, alertsLast30Days, completedRepairsAllTime: completedWOs.length, daysSinceLastRepair },
      openAlerts: openAlerts.map((a) => ({ type: a.type, severity: a.severity, description: a.description, sensorNote: a.sensorNote || null, date: a.date })),
      lastRepair: completedWOs[0] ? { title: completedWOs[0].requiredParts, completedAt: completedWOs[0].completedAt, notes: completedWOs[0].technicianNotes || null } : null,
      knownSpareParts: relatedParts,
    };
  });

  return `You are the Decision Engine inside MEO, the execution layer between predictive maintenance/CMMS/IoT systems and the maintenance team. Your ONLY job: given everything happening today, tell the manager what needs attention right now, why it matters, what happens if they wait, and what to do next — using ONLY the real registered machines, alerts, repair history, and spare-parts data given below. Never invent a machine, part, technician, or event that is not in this data.

If a machine has little or no logged history (few or no alerts, no completed repairs), do not guess specifics — produce a recommendation with a clearly lower confidence score, set predictedRUL to null, and say plainly in the reason that there isn't much history yet, rather than inventing a detailed diagnosis. Weight rising trends (alertsLast30Days, days past due on maintenance, repeated alert types) more heavily than a single event. Only set requiredParts using names that appear in knownSpareParts for that machine — if nothing relevant is listed, leave it as an empty string rather than inventing a part name.

DATA (the complete, real set of machines — do not reference anything outside this list):
${JSON.stringify({ machines }, null, 2)}

Respond with ONLY a raw JSON array (no markdown fences, no prose) of 3-8 objects, one per machine that genuinely needs attention (skip machines with no real signal), in this exact shape:
[{"machineId": "<the machine's machineId field, exactly as given>", "risk": "<Low, Medium, High, or Critical>", "businessPriority": "<Low, Medium, High, or Critical — how urgent this is for the business, may differ slightly from risk if criticality/status matters more>", "downtimeCost": <integer USD estimate of cost if this is ignored, based on criticality and status — reasonable order-of-magnitude, not precise>, "action": "<short imperative action, e.g. 'Replace cooling pump today'>", "reason": "<1-2 sentences citing the specific real evidence — trend, sensor note, days overdue, etc>", "confidence": <integer 0-100, lower when history is sparse>, "predictedRUL": "<short phrase estimating remaining useful life before failure if the data supports it, e.g. '2-3 days', or null if there isn't enough history to estimate>", "requiredParts": "<comma-separated part name(s) from this machine's knownSpareParts if relevant, else empty string>", "recommendedTimeWindow": "<short phrase, e.g. 'Today', 'Within 24 hours', 'Within 3 days', based on urgency>", "rootCauseProbability": "<short phrase naming the most likely root cause based on the evidence given, e.g. 'Likely bearing wear given rising vibration trend', or null if there isn't enough evidence to suggest one>", "safetyChecklist": ["<short safety check items relevant to this specific action, e.g. 'Lock out/tag out before opening panel', 2-4 items, grounded in the actual action and machine type — not generic filler>"], "approvalRequired": <true unless risk is Low and downtimeCost is small, in which case this can be false for routine low-stakes items>}]

Order by descending urgency (Critical/High risk and highest downtimeCost first).`;
}

function DecisionCenter({ data, setData, session, logActivity }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [decideModal, setDecideModal] = useState(null); // { decision, action: 'Approved'|'Delayed'|'Rejected' }
  const [simModal, setSimModal] = useState(null); // decision being simulated
  const [rcModal, setRcModal] = useState(null); // decision being root-cause-explored
  const canDecide = session.role === "Manager" || session.role === "Supervisor" || session.role === "Administrator";

  async function generate() {
    setRunning(true); setError("");
    try {
      const prompt = buildAiPrompt(data);
      const res = await fetch("/api/generate-priorities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      const text = (json.text || "").trim();
      const clean = text.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
      const recs = JSON.parse(clean);
      const newDecisions = recs.map((r) => {
        const m = data.machines.find((m) => m.machineId === r.machineId);
        if (!m) return null;
        const matches = computeTechnicianMatch(m, data);
        return {
          id: uid("d"), machineId: m.id, risk: r.risk, businessPriority: r.businessPriority || r.risk,
          downtimeCost: r.downtimeCost, action: r.action, reason: r.reason, confidence: r.confidence,
          predictedRUL: r.predictedRUL || null, requiredParts: r.requiredParts || "", recommendedTimeWindow: r.recommendedTimeWindow || "",
          rootCauseProbability: r.rootCauseProbability || null, safetyChecklist: Array.isArray(r.safetyChecklist) ? r.safetyChecklist : [],
          approvalRequired: r.approvalRequired !== false,
          suggestedTechnician: matches[0]?.name || null, technicianReason: matches[0]?.reason || "",
          status: "Pending", decisionReason: "", decidedBy: "", decidedAt: null, workOrderId: null, generatedAt: new Date().toISOString(),
        };
      }).filter(Boolean);
      setData((d) => ({ ...d, aiRun: { generatedAt: new Date().toISOString() }, decisions: [...newDecisions, ...d.decisions.filter((old) => old.status !== "Pending")] }));
      logActivity(`Decision Center generated ${newDecisions.length} recommendations`);
    } catch (e) {
      setError(`Couldn't generate recommendations: ${e.message || "unknown error"}. If this mentions ANTHROPIC_API_KEY, it means the key isn't set in Vercel yet — see Settings help or check Vercel → Environment Variables.`);
    } finally { setRunning(false); }
  }

  function openDecide(decision, action) { setDecideModal({ decision, action }); }

  function confirmDecide(reasonText, chosenTechnician) {
    const { decision, action } = decideModal;
    let dupInfo = null;
    setData((d) => {
      let workOrders = d.workOrders;
      let woCounter = d.woCounter || 0;
      let workOrderId = null;
      if (action === "Approved") {
        const result = createWorkOrderForDecision(d, decision, chosenTechnician);
        workOrders = result.workOrders; woCounter = result.woCounter; workOrderId = result.workOrderId;
        if (result.duplicatePrevented) dupInfo = result.woNumber;
      }
      const decisions = d.decisions.map((dec) => dec.id === decision.id ? { ...dec, status: action, decisionReason: reasonText, decidedBy: session.name, decidedAt: new Date().toISOString(), workOrderId } : dec);
      return { ...d, decisions, workOrders, woCounter };
    });
    const m = data.machines.find((m) => m.id === decision.machineId);
    logActivity(dupInfo ? `${session.name} approved ${decision.action} for ${m?.name} — linked to existing ${dupInfo} instead of creating a duplicate` : `${session.name} ${action.toLowerCase()} recommendation for ${m?.name}: ${decision.action}`);
    setDecideModal(null);
  }

  const pending = data.decisions.filter((d) => d.status === "Pending").sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || b.downtimeCost - a.downtimeCost);
  const decided = data.decisions.filter((d) => d.status !== "Pending").sort((a, b) => new Date(b.decidedAt) - new Date(a.decidedAt)).slice(0, 8);

  return (
    <div>
      <PageHeader title="Decision Center" subtitle="Given everything happening today — what's the best action to take right now?" action={
        <Button onClick={generate} disabled={running}>{running ? <Loader2 size={15} style={{ animation: "meo-spin 1s linear infinite" }} /> : <RefreshCw size={15} />} {running ? "Analyzing…" : "Analyze current conditions"}</Button>
      } />
      <style>{`@keyframes meo-spin{to{transform:rotate(360deg)}}`}</style>
      {error && <div style={{ marginBottom: 14, color: "#E5484D", fontSize: 13 }}>{error}</div>}
      {data.machines.length === 0 && <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 14 }}>Register machines in Assets first — the Decision Center only reasons about what's actually registered.</div>}

      {pending.length === 0 ? (
        <Card style={{ padding: 40 }}><EmptyState icon={Sparkles} text="No pending decisions. Click 'Analyze current conditions' to have MEO read your machines, alerts, and history, and tell you what needs a call right now." /></Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
          {pending.map((d, idx) => {
            const m = data.machines.find((m) => m.id === d.machineId);
            const color = RISK_COLOR[d.risk] || "#8A96A3";
            const matches = m ? computeTechnicianMatch(m, data) : [];
            const techReady = matches.length > 0;
            const neededParts = (d.requiredParts || "").split(",").map((s) => s.trim()).filter(Boolean);
            const partsReady = neededParts.length === 0 || neededParts.every((pn) => data.parts.some((p) => p.machineId === d.machineId && p.name.toLowerCase().includes(pn.toLowerCase()) && p.quantity > 0));
            const altPart = !partsReady ? data.parts.find((p) => p.machineId === d.machineId && p.alternativePartName) : null;
            return (
              <Card key={d.id} style={{ padding: 22, borderLeft: `4px solid ${color}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#5B6672", fontFamily: F_MONO, marginBottom: 4 }}>PRIORITY {idx + 1} OF {pending.length}</div>
                    <div style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 18 }}>{m?.name || "Unknown machine"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}><Badge color={color}>{d.risk} risk</Badge>{d.businessPriority && d.businessPriority !== d.risk && <Badge color={RISK_COLOR[d.businessPriority] || "#8A96A3"}>{d.businessPriority} priority</Badge>}{d.approvalRequired === false && <Badge color="#8A96A3">Routine — approval optional</Badge>}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", marginBottom: 14 }}>
                  <div><div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Estimated downtime cost</div><div style={{ fontFamily: F_MONO, fontSize: 17, fontWeight: 600, color: "#E5484D" }}>{fmtMoney(d.downtimeCost)}</div></div>
                  <div><div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Confidence</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 90, height: 6, background: "#2B333B", borderRadius: 3, overflow: "hidden", display: "inline-block" }}><span style={{ display: "block", height: "100%", width: `${d.confidence}%`, background: color }} /></span>
                      <span style={{ fontFamily: F_MONO, fontSize: 13 }}>{d.confidence}%</span>
                    </div>
                  </div>
                  {d.predictedRUL && <div><div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Predicted remaining useful life</div><div style={{ fontSize: 13, fontWeight: 600 }}>{d.predictedRUL}</div></div>}
                  {d.recommendedTimeWindow && <div><div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Recommended time window</div><div style={{ fontSize: 13, fontWeight: 600 }}>{d.recommendedTimeWindow}</div></div>}
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Recommended action</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{d.action}</div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Reason</div>
                  <div style={{ fontSize: 13, color: "#C7CED5" }}>{d.reason}</div>
                </div>
                {d.rootCauseProbability && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Likely root cause</div>
                    <div style={{ fontSize: 13, color: "#C7CED5" }}>{d.rootCauseProbability}</div>
                  </div>
                )}
                {d.safetyChecklist && d.safetyChecklist.length > 0 && (
                  <div style={{ marginBottom: 16, background: "#F5A6230D", border: "1px solid #F5A62330", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 10.5, color: "#F5A623", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6, fontWeight: 700 }}>Safety checklist</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {d.safetyChecklist.map((item, i) => <div key={i} style={{ fontSize: 12.5, color: "#C7CED5", display: "flex", gap: 6 }}><span>⚠</span>{item}</div>)}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18, background: "#12161A", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>Ready to execute?</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>{techReady ? <CheckCircle2 size={13} color="#34D399" /> : <AlertTriangle size={13} color="#F5A623" />}{techReady ? `Technician available${matches[0] ? ` — ${matches[0].name} suggested` : ""}` : "No technician available in team roster"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>{partsReady ? <CheckCircle2 size={13} color="#34D399" /> : <AlertTriangle size={13} color="#E5484D" />}{neededParts.length === 0 ? "No specific parts required" : partsReady ? `Spare part in stock: ${neededParts.join(", ")}` : `Spare part missing: ${neededParts.join(", ")}${altPart ? ` — alternative available: ${altPart.alternativePartName}` : ""}`}</div>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button onClick={() => setSimModal(d)} style={{ fontSize: 11.5, padding: "6px 10px", borderRadius: 6, background: "#12161A", border: "1px solid #2B333B", color: "#8A96A3", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><LineChart size={12} /> Simulate: what if we delay?</button>
                  <button onClick={() => setRcModal(d)} style={{ fontSize: 11.5, padding: "6px 10px", borderRadius: 6, background: "#12161A", border: "1px solid #2B333B", color: "#8A96A3", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><Search size={12} /> Explore root cause</button>
                </div>
                <RoleGate role={session.role} allow={["Manager", "Supervisor", "Administrator"]}>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Button variant="success" onClick={() => openDecide(d, "Approved")}><CheckCheck size={14} /> Approve</Button>
                    <Button variant="ghost" onClick={() => openDecide(d, "Delayed")}><PauseCircle size={14} /> Delay</Button>
                    <Button variant="danger" onClick={() => openDecide(d, "Rejected")}><XCircle size={14} /> Reject</Button>
                  </div>
                </RoleGate>
              </Card>
            );
          })}
        </div>
      )}

      {decided.length > 0 && (
        <Card style={{ padding: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Recent decisions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {decided.map((d) => {
              const m = data.machines.find((m) => m.id === d.machineId);
              return (
                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, padding: "8px 0", borderBottom: "1px solid #2B333B", flexWrap: "wrap" }}>
                  <div><Badge color={DECISION_STATUS_COLOR[d.status]}>{d.status}</Badge> <span style={{ marginLeft: 8 }}>{d.action} — {m?.name}</span></div>
                  <div style={{ color: "#5B6672" }}>{d.decidedBy}, {relTime(d.decidedAt)}{d.decisionReason ? `: "${d.decisionReason}"` : ""}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {decideModal && <DecideModal decision={decideModal.decision} action={decideModal.action} machine={data.machines.find((m) => m.id === decideModal.decision.machineId)} data={data} onClose={() => setDecideModal(null)} onConfirm={confirmDecide} />}
      {simModal && <DecisionSimulatorModal decision={simModal} machine={data.machines.find((m) => m.id === simModal.machineId)} onClose={() => setSimModal(null)} />}
      {rcModal && <RootCauseModal decision={rcModal} machine={data.machines.find((m) => m.id === rcModal.machineId)} data={data} onClose={() => setRcModal(null)} />}
    </div>
  );
}

function DecisionSimulatorModal({ decision, machine, onClose }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const prompt = `You are MEO's Decision Simulator. Given this real pending maintenance decision, project what happens if the manager delays acting on it instead of approving it now. Use only the evidence given — do not invent new facts.

DECISION: ${JSON.stringify({ machine: machine?.name, risk: decision.risk, downtimeCost: decision.downtimeCost, confidence: decision.confidence, reason: decision.reason, action: decision.action })}

Respond with ONLY a raw JSON object (no markdown fences, no prose) in this shape:
{"downtimeRiskIncreasePercent": <integer, how much more likely/severe downtime risk becomes if delayed>, "expectedProductionLoss": <integer USD estimate if delayed>, "failureChancePercent": <integer 0-100, estimated chance of failure before the recommended window closes if delayed>, "recommendation": "<short phrase, e.g. 'Do not delay' or 'Delay is acceptable for 24 hours'>", "reasoning": "<1-2 sentences grounded in the decision data given>"}`;
        const res = await fetch("/api/generate-priorities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Request failed");
        const clean = (json.text || "").trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
        setResult(JSON.parse(clean));
      } catch (e) {
        setError("Couldn't run the simulation right now.");
      } finally { setLoading(false); }
    })();
  }, []);

  return (
    <Modal title="What if we delay this repair?" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 16 }}>{decision.action} — <b style={{ color: "#EAEEF1" }}>{machine?.name}</b></div>
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A96A3", fontSize: 13 }}><Loader2 size={15} style={{ animation: "meo-spin 1s linear infinite" }} /> Simulating…</div>
      ) : error ? (
        <div style={{ color: "#E5484D", fontSize: 13 }}>{error}</div>
      ) : result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ background: "#12161A", borderRadius: 8, padding: 12 }}><div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", marginBottom: 4 }}>Downtime risk</div><div style={{ fontSize: 18, fontWeight: 700, color: "#E5484D" }}>+{result.downtimeRiskIncreasePercent}%</div></div>
            <div style={{ background: "#12161A", borderRadius: 8, padding: 12 }}><div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", marginBottom: 4 }}>Chance of failure</div><div style={{ fontSize: 18, fontWeight: 700, color: "#F5A623" }}>{result.failureChancePercent}%</div></div>
          </div>
          <div style={{ background: "#12161A", borderRadius: 8, padding: 12 }}><div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", marginBottom: 4 }}>Expected production loss</div><div style={{ fontSize: 20, fontWeight: 700, color: "#E5484D" }}>{fmtMoney(result.expectedProductionLoss)}</div></div>
          <div style={{ background: "#F5A6231A", border: "1px solid #F5A62340", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10.5, color: "#F5A623", textTransform: "uppercase", marginBottom: 4, fontWeight: 700 }}>Recommended</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{result.recommendation}</div>
            <div style={{ fontSize: 12, color: "#C7CED5" }}>{result.reasoning}</div>
          </div>
          <div style={{ fontSize: 10.5, color: "#5B6672" }}>This is an AI-generated projection based on the decision's own data — not a guarantee.</div>
        </div>
      ) : null}
    </Modal>
  );
}

function RootCauseModal({ decision, machine, data, onClose }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const history = data.alerts.filter((a) => a.machineId === decision.machineId).map((a) => ({ type: a.type, severity: a.severity, description: a.description, sensorNote: a.sensorNote || null, date: a.date }));
        const pastRepairs = data.workOrders.filter((w) => w.machineId === decision.machineId && w.status === "Completed").map((w) => ({ failureMode: w.failureMode, rootCause: w.rootCause, completedAt: w.completedAt }));
        const prompt = `You are MEO's Root Cause Explorer. Based ONLY on the real alert history and past repair records below for this one machine, estimate the most likely root causes for the current issue. If there is very little history, say so plainly and give at most 1-2 tentative causes with low confidence rather than inventing a detailed breakdown.

CURRENT ISSUE: ${decision.action} — ${decision.reason}
ALERT HISTORY: ${JSON.stringify(history)}
PAST REPAIRS: ${JSON.stringify(pastRepairs)}

Respond with ONLY a raw JSON object (no markdown fences, no prose) in this shape:
{"causes": [{"cause": "<short name>", "likelihoodPercent": <integer, all causes should sum to roughly 100>}], "recommendedInspections": ["<short inspection item>"], "confidenceNote": "<1 sentence on how much real evidence supports this>"}`;
        const res = await fetch("/api/generate-priorities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Request failed");
        const clean = (json.text || "").trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
        setResult(JSON.parse(clean));
      } catch (e) {
        setError("Couldn't run root cause analysis right now.");
      } finally { setLoading(false); }
    })();
  }, []);

  return (
    <Modal title="Root cause explorer" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 16 }}>{decision.action} — <b style={{ color: "#EAEEF1" }}>{machine?.name}</b></div>
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A96A3", fontSize: 13 }}><Loader2 size={15} style={{ animation: "meo-spin 1s linear infinite" }} /> Analyzing…</div>
      ) : error ? (
        <div style={{ color: "#E5484D", fontSize: 13 }}>{error}</div>
      ) : result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}>Most likely causes</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(result.causes || []).map((c, i) => (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}><span>{c.cause}</span><span style={{ fontFamily: F_MONO, color: "#F5A623" }}>{c.likelihoodPercent}%</span></div>
                  <div style={{ height: 5, background: "#2B333B", borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${c.likelihoodPercent}%`, height: "100%", background: "#F5A623" }} /></div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}>Recommended inspections</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {(result.recommendedInspections || []).map((item, i) => <div key={i} style={{ fontSize: 12.5, display: "flex", gap: 6 }}><CheckCircle2 size={13} color="#34D399" style={{ flexShrink: 0, marginTop: 1 }} />{item}</div>)}
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: "#5B6672", background: "#12161A", borderRadius: 8, padding: 10 }}>{result.confidenceNote} — AI estimate, not a certified diagnosis.</div>
        </div>
      ) : null}
    </Modal>
  );
}

function DecideModal({ decision, action, machine, data, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const matches = action === "Approved" && machine ? computeTechnicianMatch(machine, data) : [];
  const [tech, setTech] = useState(decision.suggestedTechnician || matches[0]?.name || "");
  const labels = { Approved: "Approve this recommendation", Delayed: "Delay this recommendation", Rejected: "Reject this recommendation" };
  const colors = { Approved: "#34D399", Delayed: "#4C9FE5", Rejected: "#E5484D" };
  return (
    <Modal title={labels[action]} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, color: "#C7CED5" }}>{decision.action} — <b>{machine?.name}</b></div>
        {action === "Approved" && (
          <>
            <div style={{ fontSize: 12.5, color: "#8A96A3" }}>This creates a new work order automatically.</div>
            <Field label="Assign technician">
              {matches.length === 0 ? (
                <div style={{ fontSize: 12, color: "#8A96A3" }}>No technicians in your team roster yet — this work order will be created unassigned. Add technicians in Settings.</div>
              ) : (
                <>
                  <select style={inputStyle} value={tech} onChange={(e) => setTech(e.target.value)}>
                    {matches.map((m) => <option key={m.name} value={m.name}>{m.name}{m.name === matches[0].name ? " (suggested)" : ""}</option>)}
                  </select>
                  <div style={{ fontSize: 11.5, color: "#8A96A3", marginTop: 4 }}>{matches.find((m) => m.name === tech)?.reason}</div>
                </>
              )}
            </Field>
            {decision.requiredParts && <div style={{ fontSize: 12, color: "#8A96A3" }}>Parts needed: <b style={{ color: "#EAEEF1" }}>{decision.requiredParts}</b></div>}
          </>
        )}
        <Field label={`Reason for ${action.toLowerCase()} decision (recorded for accountability)`}>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Confirmed with floor lead, scheduling technician now." />
        </Field>
        <Button style={{ justifyContent: "center", background: colors[action], border: `1px solid ${colors[action]}`, color: "#0C0F12" }} disabled={!reason.trim()} onClick={() => onConfirm(reason.trim(), tech)}>Confirm {action.toLowerCase()}</Button>
      </div>
    </Modal>
  );
}

/* ----------------------------------- Work Orders -------------------------------------- */

function WorkOrders({ data, setData, session, logActivity }) {
  const [modal, setModal] = useState(null);
  const canManage = session.role === "Manager" || session.role === "Supervisor" || session.role === "Administrator";

  function update(wo, patch) {
    setData((d) => ({ ...d, workOrders: d.workOrders.map((w) => w.id === wo.id ? { ...w, ...patch } : w) }));
    logActivity(`Work order ${wo.woNumber} updated: ${Object.keys(patch)[0]}`);
  }
  function assign(wo, tech) { update(wo, { assignedTech: tech, status: wo.status === "Pending" || wo.status === "Approved" ? "Assigned" : wo.status }); setModal(null); }

  const sorted = data.workOrders.slice().sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate));

  return (
    <div>
      <PageHeader title="Work Orders" subtitle="Approved decisions become work orders here." />
      {sorted.length === 0 ? <EmptyState icon={ClipboardList} text="No work orders yet. Approve a recommendation in the Decision Center to create one." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((w) => {
            const m = data.machines.find((m) => m.id === w.machineId);
            const overdue = isOverdue(w.dueDate, w.status);
            return (
              <Card key={w.id} style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: F_MONO, fontSize: 12, color: "#8A96A3" }}>{w.woNumber}</span>
                      <Badge color={WO_STATUS_COLOR[w.status]}>{w.status}</Badge>
                      <Badge color={RISK_COLOR[w.priority] || "#8A96A3"}>{w.priority}</Badge>
                      {overdue && <Badge color="#E5484D">Overdue</Badge>}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>{m?.name || "Unknown machine"}</div>
                    <div style={{ fontSize: 11.5, color: "#8A96A3" }}>Assigned: {w.assignedTech} · Due {fmtDate(w.dueDate)} {w.requiredParts && `· Parts: ${w.requiredParts}`} {w.estimatedHours && `· Est. ${w.estimatedHours}h`}</div>
                  </div>
                  <RoleGate role={session.role} allow={["Manager", "Supervisor", "Administrator"]}>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <button onClick={() => setModal(w)} style={{ fontSize: 11.5, padding: "6px 10px", borderRadius: 5, background: "#12161A", border: "1px solid #2B333B", color: "#8A96A3", cursor: "pointer" }}>Assign / edit</button>
                      <select value={w.status} onChange={(e) => update(w, { status: e.target.value })} style={{ ...inputStyle, padding: "6px 8px", fontSize: 11.5 }}>
                        {WO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </RoleGate>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {modal && <WOModal wo={modal} onClose={() => setModal(null)} onSave={assign} />}
    </div>
  );
}

function WOModal({ wo, onClose, onSave }) {
  const [tech, setTech] = useState(wo.assignedTech === "Unassigned" ? "" : wo.assignedTech);
  const [parts, setParts] = useState(wo.requiredParts || "");
  const [hours, setHours] = useState(wo.estimatedHours || "");
  const [dueDate, setDueDate] = useState(wo.dueDate ? wo.dueDate.slice(0, 10) : "");
  return (
    <Modal title={`Edit ${wo.woNumber}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Assign to technician"><input style={inputStyle} value={tech} onChange={(e) => setTech(e.target.value)} placeholder="R. Novak" /></Field>
        <Field label="Required parts"><input style={inputStyle} value={parts} onChange={(e) => setParts(e.target.value)} placeholder="Bearing kit" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Estimated hours"><input type="number" style={inputStyle} value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
          <Field label="Due date"><input type="date" style={inputStyle} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        </div>
        <Button style={{ justifyContent: "center", marginTop: 6 }} disabled={!tech.trim()} onClick={() => onSave({ ...wo, requiredParts: parts, estimatedHours: hours ? Number(hours) : null, dueDate: dueDate ? new Date(dueDate).toISOString() : wo.dueDate }, tech.trim())}>Save</Button>
      </div>
    </Modal>
  );
}

/* ---------------------------- Technician Workspace ----------------------------- */

function TechnicianWorkspace({ data, setData, session, logActivity }) {
  const [techFilter, setTechFilter] = useState(session.role === "Technician" ? session.name : "All");
  const techNames = Array.from(new Set(data.workOrders.map((w) => w.assignedTech).filter((t) => t && t !== "Unassigned")));
  const jobs = data.workOrders.filter((w) => w.status !== "Completed" && w.status !== "Closed" && (techFilter === "All" || w.assignedTech === techFilter)).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  function startWork(wo) { setData((d) => ({ ...d, workOrders: d.workOrders.map((w) => w.id === wo.id ? { ...w, status: "In Progress", startedAt: new Date().toISOString() } : w) })); logActivity(`${wo.woNumber} started`); }
  function completeWork(wo, fields) {
    setData((d) => ({ ...d, workOrders: d.workOrders.map((w) => w.id === wo.id ? { ...w, status: "Completed", completedAt: new Date().toISOString(), ...fields } : w) }));
    logActivity(`${wo.woNumber} completed`);
  }

  const [completeModal, setCompleteModal] = useState(null);

  return (
    <div>
      <PageHeader title="Technicians" subtitle="Today's jobs — instructions, notes, and evidence in one place." action={
        <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} style={{ ...inputStyle, width: 180 }}>
          <option value="All">All technicians</option>
          {techNames.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      } />
      {jobs.length === 0 ? <EmptyState icon={Hammer} text="No open jobs for this view." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {jobs.map((w) => {
            const m = data.machines.find((m) => m.id === w.machineId);
            const decision = data.decisions.find((d) => d.id === w.decisionId);
            return (
              <Card key={w.id} style={{ padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}><span style={{ fontFamily: F_MONO, fontSize: 12, color: "#8A96A3" }}>{w.woNumber}</span><Badge color={WO_STATUS_COLOR[w.status]}>{w.status}</Badge><Badge color={RISK_COLOR[w.priority] || "#8A96A3"}>{w.priority}</Badge></div>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{m?.name}</div>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#8A96A3" }}>Due {fmtDate(w.dueDate)}</div>
                </div>
                {decision && <div style={{ fontSize: 12.5, color: "#C7CED5", marginBottom: 10, background: "#12161A", padding: 10, borderRadius: 6 }}><b>Instructions:</b> {decision.action}. {decision.reason}</div>}
                {w.requiredParts && <div style={{ fontSize: 12, color: "#8A96A3", marginBottom: 10 }}>Parts needed: {w.requiredParts}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  {w.status !== "In Progress" && <Button variant="ghost" onClick={() => startWork(w)}>Start Work</Button>}
                  {w.status === "In Progress" && <Button variant="success" onClick={() => setCompleteModal(w)}><CheckCircle2 size={14} /> Complete Work</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {completeModal && <CompleteWorkModal wo={completeModal} onClose={() => setCompleteModal(null)} onSave={(fields) => { completeWork(completeModal, fields); setCompleteModal(null); }} />}
    </div>
  );
}

function CompleteWorkModal({ wo, onClose, onSave }) {
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState("");
  const [failureMode, setFailureMode] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [preventiveAction, setPreventiveAction] = useState("");
  return (
    <Modal title={`Complete ${wo.woNumber}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Technician notes"><textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was done, what was found…" /></Field>
        <div style={{ borderTop: "1px solid #2B333B", paddingTop: 12, marginTop: 2 }}>
          <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700, marginBottom: 10 }}>Root cause analysis</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="Failure mode (optional)"><input style={inputStyle} value={failureMode} onChange={(e) => setFailureMode(e.target.value)} placeholder="e.g. Bearing seizure" /></Field>
            <Field label="Root cause (optional)"><input style={inputStyle} value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="e.g. Lubrication schedule too infrequent" /></Field>
            <Field label="Corrective action (optional)"><input style={inputStyle} value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} placeholder="e.g. Replaced bearing and shaft seal" /></Field>
            <Field label="Preventive action (optional)"><input style={inputStyle} value={preventiveAction} onChange={(e) => setPreventiveAction(e.target.value)} placeholder="e.g. Shortened lubrication interval to 2 weeks" /></Field>
          </div>
        </div>
        <Field label="Photo / evidence note (optional)"><input style={inputStyle} placeholder="Describe uploaded evidence (file upload not wired in this prototype)" /></Field>
        <Field label="Actual cost (optional)"><input type="number" style={inputStyle} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="340" /></Field>
        <Button style={{ justifyContent: "center", marginTop: 6 }} disabled={!notes.trim()} onClick={() => onSave({ technicianNotes: notes.trim(), actualCost: cost ? Number(cost) : null, failureMode: failureMode.trim(), rootCause: rootCause.trim(), correctiveAction: correctiveAction.trim(), preventiveAction: preventiveAction.trim() })}>Mark Completed</Button>
      </div>
    </Modal>
  );
}

/* ------------------------------- Inventory ---------------------------------- */

function Inventory({ data, setData, session, logActivity }) {
  const [modal, setModal] = useState(null);
  const canEdit = session.role === "Manager" || session.role === "Supervisor" || session.role === "Administrator";
  function save(part) {
    setData((d) => { const exists = d.parts.some((p) => p.id === part.id); return { ...d, parts: exists ? d.parts.map((p) => p.id === part.id ? part : p) : [...d.parts, part] }; });
    logActivity(`Inventory updated: ${part.name}`); setModal(null);
  }
  return (
    <div>
      <PageHeader title="Inventory" subtitle="Spare parts — what you have, what's missing." action={<RoleGate role={session.role} allow={["Manager", "Supervisor", "Administrator"]}><Button onClick={() => setModal({})}><Plus size={15} /> Add part</Button></RoleGate>} />
      {data.parts.length === 0 ? <EmptyState icon={Package} text="No parts tracked yet." /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
          {data.parts.map((p) => {
            const m = data.machines.find((m) => m.id === p.machineId);
            const low = p.quantity <= p.minStock;
            return (
              <Card key={p.id} style={{ padding: 16, cursor: canEdit ? "pointer" : "default" }} onClick={() => canEdit && setModal(p)}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                  {low && <Badge color="#E5484D"><AlertTriangle size={11} /> Spare Part Missing</Badge>}
                </div>
                <div style={{ fontSize: 12, color: "#8A96A3", marginBottom: 4 }}>Used on: {m?.name || "—"}</div>
                <div style={{ fontSize: 12, color: "#8A96A3", marginBottom: 4 }}>Supplier: {p.supplier}{p.leadTimeDays ? ` · ${p.leadTimeDays}d lead time` : ""}</div>
                <div style={{ fontSize: 13, fontFamily: F_MONO, color: low ? "#E5484D" : "#34D399" }}>{p.quantity} in stock <span style={{ color: "#5B6672" }}>(min {p.minStock})</span></div>
                {low && p.alternativePartName && <div style={{ fontSize: 11.5, color: "#4C9FE5", marginTop: 6 }}>Alternative available: {p.alternativePartName}</div>}
              </Card>
            );
          })}
        </div>
      )}
      {modal !== null && <PartModal part={modal} machines={data.machines} onClose={() => setModal(null)} onSave={save} />}
    </div>
  );
}

function PartModal({ part, machines, onClose, onSave }) {
  const [form, setForm] = useState({ id: part.id || uid("p"), name: part.name || "", quantity: part.quantity ?? 0, minStock: part.minStock ?? 1, machineId: part.machineId || machines[0]?.id || "", supplier: part.supplier || "", leadTimeDays: part.leadTimeDays || "", alternativePartName: part.alternativePartName || "" });
  return (
    <Modal title={part.id ? "Edit part" : "Add part"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Part name"><input style={inputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Cooling pump" /></Field>
        <Field label="Used on machine"><select style={inputStyle} value={form.machineId} onChange={(e) => setForm((f) => ({ ...f, machineId: e.target.value }))}>{machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Quantity in stock"><input type="number" style={inputStyle} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} /></Field>
          <Field label="Minimum stock"><input type="number" style={inputStyle} value={form.minStock} onChange={(e) => setForm((f) => ({ ...f, minStock: e.target.value }))} /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Supplier"><input style={inputStyle} value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} placeholder="Atlas Copco Parts" /></Field>
          <Field label="Lead time (days, optional)"><input type="number" style={inputStyle} value={form.leadTimeDays} onChange={(e) => setForm((f) => ({ ...f, leadTimeDays: e.target.value }))} placeholder="5" /></Field>
        </div>
        <Field label="Alternative part (optional)"><input style={inputStyle} value={form.alternativePartName} onChange={(e) => setForm((f) => ({ ...f, alternativePartName: e.target.value }))} placeholder="e.g. Generic equivalent from Supplier X" /></Field>
        <Button style={{ justifyContent: "center", marginTop: 6 }} disabled={!form.name.trim()} onClick={() => onSave({ ...form, quantity: Number(form.quantity) || 0, minStock: Number(form.minStock) || 1, leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : null })}>Save part</Button>
      </div>
    </Modal>
  );
}

/* ------------------------------- Notifications ---------------------------------- */

function Notifications({ items }) {
  const kindIcon = { alert: AlertTriangle, assigned: ClipboardList, approval: Sparkles, overdue: Clock, parts: Package };
  return (
    <div>
      <PageHeader title="Notifications" subtitle="Alerts, assignments, approvals needed, overdue maintenance, low parts." />
      {items.length === 0 ? <EmptyState icon={Bell} text="You're all caught up." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((n) => {
            const Icon = kindIcon[n.kind] || Bell;
            const color = RISK_COLOR[n.severity] || "#8A96A3";
            return (
              <Card key={n.id} style={{ padding: 14, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ width: 30, height: 30, borderRadius: 7, background: color + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={15} color={color} /></div>
                <div><div style={{ fontSize: 13 }}>{n.text}</div><div style={{ fontSize: 11, color: "#5B6672", fontFamily: F_MONO, marginTop: 2 }}>{relTime(n.at)}</div></div>
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
  const completedWOs = data.workOrders.filter((w) => w.status === "Completed" || w.status === "Closed");
  const completedThisMonth = completedWOs.filter((w) => w.completedAt && new Date(w.completedAt) >= startOfMonth);
  const delayedJobs = data.workOrders.filter((w) => w.completedAt && w.dueDate && new Date(w.completedAt) > new Date(w.dueDate)).length;

  const mttrList = completedWOs.filter((w) => w.startedAt && w.completedAt).map((w) => (new Date(w.completedAt) - new Date(w.startedAt)) / 3600000);
  const mttr = mttrList.length ? mttrList.reduce((a, b) => a + b, 0) / mttrList.length : null;

  const mtbfByMachine = {};
  data.machines.forEach((m) => {
    const alertDates = data.alerts.filter((a) => a.machineId === m.id).map((a) => new Date(a.date).getTime()).sort((a, b) => a - b);
    if (alertDates.length > 1) {
      const gaps = []; for (let i = 1; i < alertDates.length; i++) gaps.push((alertDates[i] - alertDates[i - 1]) / 86400000);
      mtbfByMachine[m.id] = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    }
  });
  const mtbfValues = Object.values(mtbfByMachine);
  const mtbf = mtbfValues.length ? mtbfValues.reduce((a, b) => a + b, 0) / mtbfValues.length : null;

  const downtimeThisMonth = completedThisMonth.reduce((sum, w) => sum + (w.startedAt && w.completedAt ? (new Date(w.completedAt) - new Date(w.startedAt)) / 3600000 : 0), 0);
  const maintenanceCost = completedThisMonth.reduce((sum, w) => sum + (w.actualCost || 0), 0);

  const problemCounts = {};
  data.alerts.forEach((a) => { problemCounts[a.machineId] = (problemCounts[a.machineId] || 0) + 1; });
  const problemData = Object.entries(problemCounts).map(([machineId, count]) => ({ name: data.machines.find((m) => m.id === machineId)?.name || "Unknown", count })).sort((a, b) => b.count - a.count).slice(0, 5);

  const techPerf = data.team.filter((t) => t.role === "Technician").map((t) => ({ name: t.name, ...technicianPerformance(t.name, data) })).filter((t) => t.completedJobs > 0).sort((a, b) => b.completedJobs - a.completedJobs);

  const failureModeCounts = {};
  completedWOs.forEach((w) => { if (w.failureMode) failureModeCounts[w.failureMode] = (failureModeCounts[w.failureMode] || 0) + 1; });
  const recurringFailures = Object.entries(failureModeCounts).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const stats = [
    { label: "Downtime this month", value: `${downtimeThisMonth.toFixed(1)}h`, icon: Clock, color: "#E5484D" },
    { label: "MTTR (avg repair time)", value: mttr != null ? `${mttr.toFixed(1)}h` : "—", icon: Wrench, color: "#4C9FE5" },
    { label: "MTBF (avg days between failures)", value: mtbf != null ? `${mtbf.toFixed(0)}d` : "—", icon: TrendingUp, color: "#34D399" },
    { label: "Completed jobs", value: completedThisMonth.length, icon: CheckCircle2, color: "#34D399" },
    { label: "Delayed jobs", value: delayedJobs, icon: PauseCircle, color: "#F5A623" },
    { label: "Maintenance cost (this month)", value: fmtMoney(maintenanceCost), icon: FileText, color: "#A78BFA" },
  ];

  return (
    <div>
      <PageHeader title="Reports" subtitle="The roll-ups a manager actually wants to see." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
        {stats.map((s) => (
          <Card key={s.label} style={{ padding: "16px 18px" }}>
            <s.icon size={16} color={s.color} style={{ marginBottom: 10 }} />
            <div style={{ fontFamily: F_MONO, fontSize: 20, fontWeight: 600 }}>{s.value}</div>
            <div style={{ fontSize: 11.5, color: "#8A96A3", marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>
      <Card style={{ padding: 20 }}>
        <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Most problematic machines</div>
        {problemData.length === 0 ? <EmptyState icon={BarChart3} text="No alert data yet." /> : (
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={problemData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2B333B" horizontal={false} />
                <XAxis type="number" stroke="#8A96A3" fontSize={11} allowDecimals={false} />
                <YAxis type="category" dataKey="name" stroke="#8A96A3" fontSize={11.5} width={130} />
                <Tooltip contentStyle={{ background: "#1B2127", border: "1px solid #2B333B", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#EAEEF1" }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>{problemData.map((_, i) => <Cell key={i} fill="#F5A623" opacity={1 - i * 0.12} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <Card style={{ padding: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Technician performance</div>
          {techPerf.length === 0 ? <EmptyState icon={Hammer} text="No completed jobs with timing data yet." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {techPerf.map((t) => (
                <div key={t.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid #2B333B" }}>
                  <span>{t.name}</span>
                  <span style={{ color: "#8A96A3" }}>{t.completedJobs} jobs · avg {t.avgHours.toFixed(1)}h</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card style={{ padding: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Recurring failure modes</div>
          {recurringFailures.length === 0 ? <EmptyState icon={FileText} text="No root-cause data logged yet — technicians can add it when completing a job." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recurringFailures.map(([mode, count]) => (
                <div key={mode} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid #2B333B" }}>
                  <span>{mode}</span>
                  <Badge color={count > 1 ? "#F5A623" : "#8A96A3"}>{count}x</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------- Integration Center ----------------------------- */

function IntegrationCenter({ data }) {
  const [refreshedAt, setRefreshedAt] = useState(null);
  const external = [
    { name: "SAP PM", category: "Enterprise software" },
    { name: "IBM Maximo", category: "Enterprise software" },
    { name: "Oracle ERP", category: "Enterprise software" },
    { name: "MaintainX / UpKeep / Fiix", category: "CMMS" },
    { name: "Augury / Tractian / Senseye", category: "Predictive maintenance" },
    { name: "Azure IoT Hub / AWS IoT Core", category: "Cloud IoT" },
    { name: "MQTT Broker", category: "Industrial protocol" },
    { name: "SCADA / PLC (OPC UA, Modbus)", category: "Industrial protocol" },
  ];
  const internal = [
    { name: "MEO Decision Engine (Claude)", status: "Active", lastSync: data.aiRun?.generatedAt || null, assets: data.machines.length, errors: "None" },
    { name: "Webhook Gate", status: data.settings?.webhookApiKey ? "Active" : "Not set up", lastSync: null, assets: data.machines.length, errors: "None", note: data.settings?.webhookApiKey ? "Ready to receive real data — set up in Settings" : "Generate a key in Settings to activate" },
  ];
  return (
    <div>
      <PageHeader title="Integration Center" subtitle="MEO's control room — every system it's built to connect to, and its real current status." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 20 }}>
        {internal.map((it) => (
          <Card key={it.name} style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{it.name}</div>
              <Badge color={it.status === "Active" ? "#34D399" : "#8A96A3"}><Dot color={it.status === "Active" ? "#34D399" : "#5B6672"} />{it.status}</Badge>
            </div>
            <div style={{ fontSize: 11.5, color: "#8A96A3", display: "flex", flexDirection: "column", gap: 2 }}>
              <span>Last sync: {it.lastSync ? relTime(it.lastSync) : "never"}</span>
              <span>Assets covered: {it.assets}</span>
              <span>Errors: {it.errors}</span>
              {it.note && <span style={{ color: "#F5A623", marginTop: 2 }}>{it.note}</span>}
            </div>
          </Card>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "#8A96A3", marginBottom: 12 }}>
        Everything below is real — genuinely not connected yet. This isn't decoration; it's an honest status board. Connecting any of these requires an API/credentials relationship with that vendor, which comes after the MVP stage.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {external.map((it) => (
          <Card key={it.name} style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 8 }}>
              <div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{it.name}</div><div style={{ fontSize: 10.5, color: "#5B6672" }}>{it.category}</div></div>
              <Badge color="#8A96A3"><Dot color="#5B6672" />Not connected</Badge>
            </div>
            <div style={{ fontSize: 11.5, color: "#5B6672", display: "flex", flexDirection: "column", gap: 2, marginBottom: 10 }}>
              <span>Last sync: —</span><span>Assets covered: 0</span><span>Errors: —</span>
            </div>
            <button onClick={() => setRefreshedAt(it.name)} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 5, background: "#12161A", border: "1px solid #2B333B", color: "#8A96A3", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              <RefreshCw size={11} /> Refresh
            </button>
            {refreshedAt === it.name && <div style={{ fontSize: 10.5, color: "#5B6672", marginTop: 6 }}>Checked — still no connection configured.</div>}
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------- Live Data Monitor ----------------------------- */

function LiveDataMonitor({ data }) {
  const readings = data.alerts.filter((a) => a.sensorNote).sort((a, b) => new Date(b.date) - new Date(a.date));
  return (
    <div>
      <PageHeader title="Live Data Monitor" subtitle="Sensor readings logged with alerts — manually entered for now, structured to accept a real live feed later." />
      {readings.length === 0 ? (
        <Card style={{ padding: 32, textAlign: "center" }}>
          <Radio size={26} style={{ opacity: 0.4, marginBottom: 10 }} />
          <div style={{ fontSize: 13.5, color: "#8A96A3", maxWidth: 420, margin: "0 auto" }}>No sensor readings logged yet. When reporting an alert in the Alerts tab, fill in the optional "Sensor data" field — those readings will show up here. Once a real IoT feed is connected, this page updates automatically instead.</div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {readings.map((a) => {
            const m = data.machines.find((m) => m.id === a.machineId);
            return (
              <Card key={a.id} style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: "#4C9FE51A", display: "flex", alignItems: "center", justifyContent: "center" }}><Radio size={16} color="#4C9FE5" /></div>
                  <div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{m?.name || "Unknown machine"}</div><div style={{ fontSize: 12.5, color: "#C7CED5", fontFamily: F_MONO }}>{a.sensorNote}</div></div>
                </div>
                <div style={{ fontSize: 11, color: "#5B6672", fontFamily: F_MONO }}>logged {relTime(a.date)}</div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Event Timeline ----------------------------- */

function EventTimeline({ data }) {
  const events = [];
  data.alerts.forEach((a) => { const m = data.machines.find((m) => m.id === a.machineId); events.push({ at: a.date, color: RISK_COLOR[a.severity] || "#8A96A3", text: `${a.type} reported on ${m?.name || "a machine"} — ${a.severity}` }); });
  data.decisions.forEach((d) => {
    const m = data.machines.find((m) => m.id === d.machineId);
    if (d.generatedAt) events.push({ at: d.generatedAt, color: "#F5A623", text: `Decision generated: ${d.action} (${m?.name || ""})` });
    if (d.decidedAt) events.push({ at: d.decidedAt, color: DECISION_STATUS_COLOR[d.status] || "#8A96A3", text: `${d.decidedBy} ${d.status.toLowerCase()}: ${d.action}` });
  });
  data.workOrders.forEach((w) => {
    const m = data.machines.find((m) => m.id === w.machineId);
    if (w.createdAt) events.push({ at: w.createdAt, color: "#4C9FE5", text: `${w.woNumber} created for ${m?.name || ""}` });
    if (w.startedAt) events.push({ at: w.startedAt, color: "#F5A623", text: `${w.woNumber} started by ${w.assignedTech}` });
    if (w.completedAt) events.push({ at: w.completedAt, color: "#34D399", text: `${w.woNumber} completed` });
  });
  events.sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div>
      <PageHeader title="Event Timeline" subtitle="Every alert, decision, approval, and repair — in order, for full auditability." />
      {events.length === 0 ? <EmptyState icon={GitBranch} text="Nothing has happened yet." /> : (
        <Card style={{ padding: 20 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {events.slice(0, 60).map((e, idx) => (
              <div key={idx} style={{ display: "flex", gap: 14, paddingBottom: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: 9, height: 9, borderRadius: "50%", background: e.color, flexShrink: 0, marginTop: 4 }} />
                  {idx < events.length - 1 && idx < 59 && <div style={{ width: 1, flex: 1, background: "#2B333B", marginTop: 4 }} />}
                </div>
                <div style={{ paddingBottom: 2 }}>
                  <div style={{ fontSize: 11, color: "#5B6672", fontFamily: F_MONO, marginBottom: 2 }}>{fmtDateTime(e.at)}</div>
                  <div style={{ fontSize: 13 }}>{e.text}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------------------------- Fleet Health Map ----------------------------- */

function FleetHealthMap({ data, setTab }) {
  const [expanded, setExpanded] = useState(null);
  const byLocation = {};
  data.machines.forEach((m) => {
    const loc = m.location || "Unspecified";
    if (!byLocation[loc]) byLocation[loc] = [];
    byLocation[loc].push(m);
  });
  return (
    <div>
      <PageHeader title="Fleet Health Map" subtitle="Every registered machine, grouped by location." />
      {Object.keys(byLocation).length === 0 ? <EmptyState icon={Map} text="No machines registered yet." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Object.entries(byLocation).map(([loc, machines]) => {
            const healthy = machines.filter((m) => m.status === "Running").length;
            const warning = machines.filter((m) => m.status === "At Risk" || m.status === "Maintenance").length;
            const critical = machines.filter((m) => m.status === "Offline").length;
            const isOpen = expanded === loc;
            return (
              <Card key={loc} style={{ padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : loc)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 15 }}><MapPin size={15} color="#8A96A3" />{loc}</div>
                  <div style={{ display: "flex", gap: 12, fontSize: 12.5 }}>
                    <span style={{ color: "#34D399" }}>🟢 {healthy} Healthy</span>
                    <span style={{ color: "#F5A623" }}>🟡 {warning} Warning</span>
                    <span style={{ color: "#E5484D" }}>🔴 {critical} Offline</span>
                    <ChevronDown size={14} color="#5B6672" style={{ transform: isOpen ? "rotate(180deg)" : "none" }} />
                  </div>
                </div>
                {isOpen && (
                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #2B333B", paddingTop: 12 }}>
                    {machines.map((m) => (
                      <div key={m.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                        <span>{m.name} <span style={{ color: "#5B6672", fontFamily: F_MONO }}>{m.machineId}</span></span>
                        <Badge color={STATUS_COLOR[m.status]}><Dot color={STATUS_COLOR[m.status]} />{m.status}</Badge>
                      </div>
                    ))}
                    <button onClick={() => setTab("assets")} style={{ background: "none", border: "none", color: "#F5A623", fontSize: 11.5, cursor: "pointer", textAlign: "left", marginTop: 4 }}>Open in Assets →</button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Executive Dashboard ----------------------------- */

function ExecutiveDashboard({ data, session }) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const completedThisMonth = data.workOrders.filter((w) => (w.status === "Completed" || w.status === "Closed") && w.completedAt && new Date(w.completedAt) >= startOfMonth);
  const downtimeThisMonth = completedThisMonth.reduce((sum, w) => sum + (w.startedAt && w.completedAt ? (new Date(w.completedAt) - new Date(w.startedAt)) / 3600000 : 0), 0);
  const maintenanceCost = completedThisMonth.reduce((sum, w) => sum + (w.actualCost || 0), 0);
  const approvedDecisions = data.decisions.filter((d) => d.status === "Approved");
  const estimatedLossAvoided = approvedDecisions.reduce((sum, d) => sum + (d.downtimeCost || 0), 0);
  const technicians = data.team.filter((t) => t.role === "Technician");
  const avgJobsPerTech = technicians.length ? technicians.reduce((sum, t) => sum + technicianPerformance(t.name, data).completedJobs, 0) / technicians.length : 0;
  const lowStockParts = data.parts.filter((p) => p.quantity <= p.minStock).length;
  const mtbfValues = data.machines.map((m) => machineReliabilityStats(m.id, data).mtbf).filter((v) => v != null);
  const avgMtbf = mtbfValues.length ? mtbfValues.reduce((a, b) => a + b, 0) / mtbfValues.length : null;
  const mttrValues = data.machines.map((m) => machineReliabilityStats(m.id, data).mttrHours).filter((v) => v != null);
  const avgMttr = mttrValues.length ? mttrValues.reduce((a, b) => a + b, 0) / mttrValues.length : null;

  const stats = [
    { label: "Downtime cost this month", value: fmtMoney(maintenanceCost), icon: Clock, color: "#E5484D" },
    { label: "MTBF (fleet average)", value: avgMtbf != null ? `${avgMtbf.toFixed(0)}d` : "Not enough data yet", icon: TrendingUp, color: "#34D399" },
    { label: "MTTR (fleet average)", value: avgMttr != null ? `${avgMttr.toFixed(1)}h` : "Not enough data yet", icon: Wrench, color: "#4C9FE5" },
    { label: "Maintenance cost this month", value: fmtMoney(maintenanceCost), icon: FileText, color: "#A78BFA" },
    { label: "AI recommendations approved", value: approvedDecisions.length, icon: CheckCheck, color: "#34D399" },
    { label: "Est. production loss avoided", value: fmtMoney(estimatedLossAvoided), icon: ShieldAlert, color: "#F5A623" },
    { label: "Avg jobs per technician", value: avgJobsPerTech.toFixed(1), icon: Hammer, color: "#4C9FE5" },
    { label: "Parts needing attention", value: lowStockParts, icon: Package, color: lowStockParts > 0 ? "#E5484D" : "#34D399" },
  ];

  return (
    <div>
      <PageHeader title="Executive Dashboard" subtitle="The numbers a plant manager or executive checks every morning." />
      <div style={{ fontSize: 11.5, color: "#5B6672", marginBottom: 16 }}>"Est. production loss avoided" is the sum of estimated downtime costs on recommendations that were approved — an estimate based on the Decision Center's own projections, not a verified measurement. MTBF/MTTR trend lines will appear once more history accumulates over time.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {stats.map((s) => (
          <Card key={s.label} style={{ padding: "15px 16px" }}>
            <s.icon size={15} color={s.color} style={{ marginBottom: 8 }} />
            <div style={{ fontFamily: F_MONO, fontSize: 17, fontWeight: 600 }}>{s.value}</div>
            <div style={{ fontSize: 10.5, color: "#8A96A3", marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------- AI Copilot ----------------------------- */

function buildDataSnapshot(data) {
  return {
    machines: data.machines.map((m) => ({ name: m.name, machineId: m.machineId, status: m.status, criticality: m.criticality, location: m.location, nextMaintenance: m.nextMaintenance })),
    openAlerts: data.alerts.filter((a) => !a.resolved).map((a) => ({ machine: data.machines.find((m) => m.id === a.machineId)?.name, type: a.type, severity: a.severity, date: a.date })),
    pendingDecisions: data.decisions.filter((d) => d.status === "Pending").map((d) => ({ machine: data.machines.find((m) => m.id === d.machineId)?.name, action: d.action, risk: d.risk, downtimeCost: d.downtimeCost, recommendedTimeWindow: d.recommendedTimeWindow })),
    openWorkOrders: data.workOrders.filter((w) => w.status !== "Completed" && w.status !== "Closed").map((w) => ({ woNumber: w.woNumber, machine: data.machines.find((m) => m.id === w.machineId)?.name, assignedTech: w.assignedTech, dueDate: w.dueDate, status: w.status })),
    overdueWorkOrders: data.workOrders.filter((w) => isOverdue(w.dueDate, w.status)).map((w) => w.woNumber),
    lowStockParts: data.parts.filter((p) => p.quantity <= p.minStock).map((p) => p.name),
    team: data.team.map((t) => ({ name: t.name, role: t.role })),
  };
}

function buildCopilotPrompt(data, question, assistantName) {
  const snapshot = buildDataSnapshot(data);
  return `You are ${assistantName || "MEO's AI Copilot"}, answering a maintenance manager's question using ONLY the real data below. Never invent a machine, technician, or event not present here. If the data doesn't contain the answer, say so plainly instead of guessing.

DATA:
${JSON.stringify(snapshot, null, 2)}

QUESTION: ${question}

Answer in 2-4 concise sentences, plain text, no markdown formatting, grounded only in the data above.`;
}

function buildBriefingPrompt(data, session) {
  const snapshot = buildDataSnapshot(data);
  const assistantName = data.settings?.assistantName || "your assistant";
  const firstName = session.name.split(" ")[0];
  return `You are ${assistantName}, a maintenance manager's personal AI assistant inside MEO. Write a short spoken-style morning briefing addressed to ${firstName}, using ONLY the real data below. Never invent a machine, alert, or number not present here.

Structure: a warm one-line greeting using their name, then 2-4 sentences covering what genuinely needs attention (pending decisions, overdue work, low stock parts, critical alerts) with real specifics (machine names, numbers) — or, if there's truly nothing notable, say so warmly and briefly instead of inventing a concern. End with one clear next step if there is one.

DATA:
${JSON.stringify(snapshot, null, 2)}

Respond with ONLY the briefing text, plain sentences, no markdown, no headers, no bullet points — like something a helpful colleague would actually say out loud.`;
}

function AiCopilot({ data }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const assistantName = data.settings?.assistantName || "AI Copilot";
  const suggestions = ["Which machines need maintenance today?", "Show me all overdue work orders.", "What's our biggest risk right now?"];

  async function ask(q) {
    const question = (q || input).trim();
    if (!question || asking) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    setAsking(true);
    try {
      const prompt = buildCopilotPrompt(data, question, assistantName);
      const res = await fetch("/api/generate-priorities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      setMessages((m) => [...m, { role: "assistant", text: (json.text || "").trim() }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: `Couldn't get an answer: ${e.message || "unknown error"}` }]);
    } finally { setAsking(false); }
  }

  return (
    <div>
      <PageHeader title={`Ask ${assistantName}`} subtitle="Ask about your real data instead of digging through pages." />
      <Card style={{ padding: 20, minHeight: 360, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
          {messages.length === 0 && (
            <div>
              <div style={{ fontSize: 12.5, color: "#8A96A3", marginBottom: 10 }}>Try asking:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {suggestions.map((s) => (
                  <button key={s} onClick={() => ask(s)} style={{ textAlign: "left", background: "#12161A", border: "1px solid #2B333B", borderRadius: 7, padding: "9px 12px", color: "#C7CED5", fontSize: 12.5, cursor: "pointer" }}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: m.role === "user" ? "#232B33" : "#F5A6231A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {m.role === "user" ? <span style={{ fontSize: 11 }}>You</span> : <Sparkles size={13} color="#F5A623" />}
              </div>
              <div style={{ background: m.role === "user" ? "#232B33" : "#12161A", borderRadius: 10, padding: "10px 13px", fontSize: 13, maxWidth: "80%", color: "#EAEEF1" }}>{m.text}</div>
            </div>
          ))}
          {asking && <div style={{ fontSize: 12, color: "#8A96A3", display: "flex", alignItems: "center", gap: 6 }}><Loader2 size={13} style={{ animation: "meo-spin 1s linear infinite" }} /> Thinking…</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...inputStyle, flex: 1 }} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask about your machines, alerts, or work orders…" />
          <Button onClick={() => ask()} disabled={asking || !input.trim()}><Send size={14} /></Button>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------------- Settings ------------------------------------- */

function SettingsPage({ data, setData, session, logActivity }) {
  const [companyName, setCompanyName] = useState(data.settings?.companyName || "");
  const [timezone, setTimezone] = useState(data.settings?.timezone || "Africa/Lagos");
  const [companySaved, setCompanySaved] = useState(false);
  const [assistantName, setAssistantName] = useState(data.settings?.assistantName || "");
  const [automaticBriefings, setAutomaticBriefings] = useState(!!data.settings?.automaticBriefings);
  const [assistantSaved, setAssistantSaved] = useState(false);
  const [newLocation, setNewLocation] = useState("");
  const [newAssetType, setNewAssetType] = useState("");
  const [newMember, setNewMember] = useState({ name: "", role: "Technician", skills: "", shift: "Day", certifications: "", experienceYears: "" });
  const [confirmReset, setConfirmReset] = useState(false);
  const [members, setMembers] = useState([]);
  const [newInviteEmail, setNewInviteEmail] = useState("");
  const [newInviteRole, setNewInviteRole] = useState("Technician");
  const [inviteError, setInviteError] = useState("");
  const [webhookKeyCopied, setWebhookKeyCopied] = useState(false);
  const canEdit = session.role === "Manager" || session.role === "Supervisor" || session.role === "Administrator";
  const workspaceKey = "meo:v2:" + (session.workspace || "").trim().toLowerCase();
  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/ingest` : "/api/ingest";

  function generateWebhookKey() {
    const key = "meo_" + Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");
    setData((d) => ({ ...d, settings: { ...d.settings, webhookApiKey: key } }));
    logActivity("Generated a new webhook API key");
  }

  useEffect(() => {
    if (!isSupabaseConfigured || session.isDemo) return;
    (async () => {
      const list = await getWorkspaceMembers(workspaceKey);
      // Self-healing: if this signed-in account predates the invite system,
      // register them now so the workspace's member list stays accurate.
      if (session.email && !list.some((m) => m.email.toLowerCase() === session.email.toLowerCase())) {
        await addWorkspaceMember(workspaceKey, session.email, session.role, "self", list.length === 0);
        setMembers(await getWorkspaceMembers(workspaceKey));
      } else {
        setMembers(list);
      }
    })();
  }, [workspaceKey]);

  async function inviteTeammate() {
    setInviteError("");
    if (!newInviteEmail.trim()) return;
    const ok = await addWorkspaceMember(workspaceKey, newInviteEmail.trim(), newInviteRole, session.email || session.name, false);
    if (!ok) { setInviteError("Couldn't save the invite — try again."); return; }
    setMembers(await getWorkspaceMembers(workspaceKey));
    logActivity(`Invited ${newInviteEmail.trim()} to the workspace`);
    setNewInviteEmail("");
  }
  async function revokeInvite(email) {
    await removeWorkspaceMember(workspaceKey, email);
    setMembers(await getWorkspaceMembers(workspaceKey));
  }

  function resetWorkspace() {
    setData(() => ({ machines: [], alerts: [], decisions: [], workOrders: [], parts: [], team: [], activity: [], aiRun: null, settings: { companyName: "", locations: [], assetTypes: [], timezone: "Africa/Lagos" }, woCounter: 0 }));
    setConfirmReset(false);
  }

  function saveCompany() {
    setData((d) => ({ ...d, settings: { ...d.settings, companyName, timezone } }));
    logActivity("Updated company settings");
    setCompanySaved(true);
    setTimeout(() => setCompanySaved(false), 2500);
  }
  function saveAssistantSettings() {
    setData((d) => ({ ...d, settings: { ...d.settings, assistantName: assistantName.trim(), automaticBriefings } }));
    logActivity(`Updated AI Assistant settings`);
    setAssistantSaved(true);
    setTimeout(() => setAssistantSaved(false), 2500);
  }
  function addLocation() { if (!newLocation.trim()) return; setData((d) => ({ ...d, settings: { ...d.settings, locations: [...(d.settings.locations || []), newLocation.trim()] } })); setNewLocation(""); }
  function addAssetType() { if (!newAssetType.trim()) return; setData((d) => ({ ...d, settings: { ...d.settings, assetTypes: [...(d.settings.assetTypes || []), newAssetType.trim()] } })); setNewAssetType(""); }
  function addMember() { if (!newMember.name.trim()) return; setData((d) => ({ ...d, team: [...d.team, { id: uid("u"), ...newMember }] })); setNewMember({ name: "", role: "Technician", skills: "", shift: "Day", certifications: "", experienceYears: "" }); logActivity(`Added team member ${newMember.name} (${newMember.role})`); }
  function removeMember(id) { setData((d) => ({ ...d, team: d.team.filter((t) => t.id !== id) })); }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Company, team, locations, asset types, and notifications." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card style={{ padding: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Company</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input style={inputStyle} value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" disabled={!canEdit} />
            <Field label="Workspace timezone (used for greetings and dates)">
              <select style={inputStyle} value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!canEdit}>
                {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
              </select>
            </Field>
            {canEdit && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Button variant="ghost" onClick={saveCompany}>Save</Button>
                {companySaved && <span style={{ fontSize: 12, color: "#34D399", display: "flex", alignItems: "center", gap: 5 }}><CheckCircle2 size={13} /> Saved</span>}
              </div>
            )}
          </div>
        </Card>

        <Card style={{ padding: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Team ({data.team.length})</div>
          <div style={{ fontSize: 11.5, color: "#8A96A3", marginBottom: 10 }}>Skills, certifications, and shift are used by the Decision Center to suggest the right technician for each job. Performance is computed automatically from completed work orders — nothing to fill in.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12, maxHeight: 220, overflowY: "auto" }}>
            {data.team.map((u) => {
              const perf = u.role === "Technician" ? technicianPerformance(u.name, data) : null;
              return (
                <div key={u.id} style={{ fontSize: 12.5, padding: "8px 0", borderBottom: "1px solid #2B333B" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{u.name} <span style={{ color: "#8A96A3" }}>· {u.role}{u.shift ? ` · ${u.shift} shift` : ""}{u.experienceYears ? ` · ${u.experienceYears}y exp` : ""}</span></span>
                    {canEdit && <button onClick={() => removeMember(u.id)} style={{ background: "none", border: "none", color: "#E5484D", cursor: "pointer", fontSize: 11.5 }}>Remove</button>}
                  </div>
                  {(u.skills || u.certifications) && <div style={{ fontSize: 11, color: "#5B6672", marginTop: 2 }}>{u.skills && `Skills: ${u.skills}`}{u.skills && u.certifications ? " · " : ""}{u.certifications && `Certs: ${u.certifications}`}</div>}
                  {perf && perf.completedJobs > 0 && <div style={{ fontSize: 11, color: "#34D399", marginTop: 2 }}>{perf.completedJobs} jobs completed · avg {perf.avgHours.toFixed(1)}h repair time</div>}
                </div>
              );
            })}
            {data.team.length === 0 && <div style={{ fontSize: 12, color: "#5B6672" }}>No team members added yet.</div>}
          </div>
          {canEdit && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input style={{ ...inputStyle, flex: 1 }} value={newMember.name} onChange={(e) => setNewMember((m) => ({ ...m, name: e.target.value }))} placeholder="Name" />
                <select style={inputStyle} value={newMember.role} onChange={(e) => setNewMember((m) => ({ ...m, role: e.target.value }))}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
              </div>
              {newMember.role === "Technician" && (
                <>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input style={{ ...inputStyle, flex: 1 }} value={newMember.skills} onChange={(e) => setNewMember((m) => ({ ...m, skills: e.target.value }))} placeholder="Skills, comma separated (e.g. boiler, compressor)" />
                    <select style={inputStyle} value={newMember.shift} onChange={(e) => setNewMember((m) => ({ ...m, shift: e.target.value }))}>
                      <option value="Day">Day shift</option><option value="Night">Night shift</option><option value="Swing">Swing shift</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input style={{ ...inputStyle, flex: 1 }} value={newMember.certifications} onChange={(e) => setNewMember((m) => ({ ...m, certifications: e.target.value }))} placeholder="Certifications, comma separated (optional)" />
                    <input type="number" style={{ ...inputStyle, width: 100 }} value={newMember.experienceYears} onChange={(e) => setNewMember((m) => ({ ...m, experienceYears: e.target.value }))} placeholder="Years exp" />
                  </div>
                </>
              )}
              <Button variant="ghost" onClick={addMember} style={{ justifyContent: "center" }}><Plus size={14} /> Add team member</Button>
            </div>
          )}
        </Card>

        {isSupabaseConfigured && !session.isDemo && (
          <Card style={{ padding: 20, gridColumn: "1 / -1" }}>
            <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Invite teammates (login access)</div>
            <div style={{ fontSize: 12, color: "#8A96A3", marginBottom: 12 }}>This workspace is invite-only — add an email here before that person can sign up and join. This is separate from the technician roster above.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {members.map((m) => (
                <div key={m.email} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid #2B333B" }}>
                  <span>{m.email} <span style={{ color: "#8A96A3" }}>· {m.role}</span> {m.is_owner && <Badge color="#F5A623">Owner</Badge>}</span>
                  {canEdit && !m.is_owner && <button onClick={() => revokeInvite(m.email)} style={{ background: "none", border: "none", color: "#E5484D", cursor: "pointer", fontSize: 11.5 }}>Remove</button>}
                </div>
              ))}
              {members.length === 0 && <div style={{ fontSize: 12, color: "#5B6672" }}>No one registered yet.</div>}
            </div>
            {canEdit && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input style={{ ...inputStyle, flex: 1 }} value={newInviteEmail} onChange={(e) => setNewInviteEmail(e.target.value)} placeholder="teammate@company.com" />
                  <select style={inputStyle} value={newInviteRole} onChange={(e) => setNewInviteRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
                  <Button variant="ghost" onClick={inviteTeammate}><Plus size={14} /></Button>
                </div>
                {inviteError && <div style={{ fontSize: 12, color: "#E5484D" }}>{inviteError}</div>}
                <div style={{ fontSize: 11, color: "#5B6672" }}>They'll be able to sign up at your MEO link using this exact email — tell them the workspace name too.</div>
              </div>
            )}
          </Card>
        )}

        <Card style={{ padding: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Locations</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>{(data.settings.locations || []).map((l, i) => <Badge key={i} color="#8A96A3">{l}</Badge>)}</div>
          {canEdit && <div style={{ display: "flex", gap: 6 }}><input style={{ ...inputStyle, flex: 1 }} value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="Bay 4" /><Button variant="ghost" onClick={addLocation}><Plus size={14} /></Button></div>}
        </Card>

        <Card style={{ padding: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Asset types</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>{(data.settings.assetTypes || []).map((t, i) => <Badge key={i} color="#8A96A3">{t}</Badge>)}</div>
          {canEdit && <div style={{ display: "flex", gap: 6 }}><input style={{ ...inputStyle, flex: 1 }} value={newAssetType} onChange={(e) => setNewAssetType(e.target.value)} placeholder="Boiler" /><Button variant="ghost" onClick={addAssetType}><Plus size={14} /></Button></div>}
        </Card>

        <Card style={{ padding: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 8 }}>AI Assistant</div>
          <div style={{ fontSize: 12, color: "#8A96A3", marginBottom: 12 }}>Name your assistant and choose how it behaves when someone logs in.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="Assistant name">
              <input style={inputStyle} value={assistantName} onChange={(e) => setAssistantName(e.target.value)} placeholder="e.g. James" disabled={!canEdit} />
            </Field>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#12161A", borderRadius: 7, padding: "10px 12px" }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>Automatic briefings</div>
                <div style={{ fontSize: 11, color: "#8A96A3" }}>When on, {assistantName || "your assistant"} greets you with a summary automatically on login (uses a small AI request each time).</div>
              </div>
              <button onClick={() => canEdit && setAutomaticBriefings((v) => !v)} style={{ width: 40, height: 22, borderRadius: 12, border: "none", background: automaticBriefings ? "#34D399" : "#2B333B", position: "relative", cursor: canEdit ? "pointer" : "default", flexShrink: 0 }}>
                <span style={{ position: "absolute", top: 2, left: automaticBriefings ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s ease" }} />
              </button>
            </div>
            {canEdit && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Button variant="ghost" onClick={saveAssistantSettings}>Save</Button>
                {assistantSaved && <span style={{ fontSize: 12, color: "#34D399", display: "flex", alignItems: "center", gap: 5 }}><CheckCircle2 size={13} /> Saved</span>}
              </div>
            )}
          </div>
        </Card>

        <Card style={{ padding: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Notification preferences</div>
          <div style={{ fontSize: 12, color: "#8A96A3" }}>All notification types (alerts, approvals, overdue maintenance, low parts) are on by default in this prototype.</div>
        </Card>

        <Card style={{ padding: 20, gridColumn: "1 / -1" }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Connected systems</div>
          <div style={{ fontSize: 12, color: "#8A96A3", marginBottom: 14 }}>MEO is built to sit on top of the systems you already run — not replace them. None of these are live yet; everything below is entered manually for now. The data model is already shaped to accept a real feed the moment a connection exists.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px 20px" }}>
            {[
              ["Industrial protocols", "OPC UA, Modbus TCP, MQTT, EtherNet/IP"],
              ["Enterprise software", "SAP PM, IBM Maximo, Oracle Maintenance"],
              ["CMMS", "MaintainX, UpKeep, Fiix, Limble"],
              ["Predictive maintenance", "Augury, Tractian, Senseye"],
              ["Cloud IoT platforms", "Azure IoT Hub, AWS IoT Core"],
            ].map(([label, examples]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#12161A", borderRadius: 6 }}>
                <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</div><div style={{ fontSize: 10.5, color: "#5B6672" }}>{examples}</div></div>
                <Badge color="#8A96A3">Not connected</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card style={{ padding: 20, gridColumn: "1 / -1" }}>
          <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Connect an external system (webhook)</div>
          <div style={{ fontSize: 12, color: "#8A96A3", marginBottom: 14 }}>This is a real, working connection point — any predictive maintenance platform, IoT gateway, or automation tool (like Zapier) that can send data to a web address can push real alerts straight into this workspace.</div>

          {!data.settings?.webhookApiKey ? (
            <RoleGate role={session.role} allow={["Manager", "Supervisor", "Administrator"]}>
              <Button variant="ghost" onClick={generateWebhookKey}>Generate webhook API key</Button>
            </RoleGate>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", marginBottom: 4 }}>Webhook URL</div>
                <div style={{ fontFamily: F_MONO, fontSize: 12, background: "#12161A", padding: "8px 10px", borderRadius: 6, wordBreak: "break-all" }}>{webhookUrl}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", marginBottom: 4 }}>API key</div>
                <div style={{ fontFamily: F_MONO, fontSize: 12, background: "#12161A", padding: "8px 10px", borderRadius: 6, wordBreak: "break-all" }}>{data.settings.webhookApiKey}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: "#8A96A3", textTransform: "uppercase", marginBottom: 4 }}>Example — what the external system should send (POST, JSON body)</div>
                <pre style={{ fontFamily: F_MONO, fontSize: 11, background: "#12161A", padding: 10, borderRadius: 6, overflowX: "auto", margin: 0 }}>{`{
  "workspace": "${session.workspace}",
  "apiKey": "${data.settings.webhookApiKey}",
  "machineId": "BLR-001",
  "type": "Overheating",
  "severity": "High",
  "description": "Temperature 12% above normal",
  "sensorNote": "94°C, rising"
}`}</pre>
              </div>
              <div style={{ fontSize: 11, color: "#5B6672" }}>"machineId" must exactly match a machine already registered in Assets. Give this URL, key, and format to whoever manages your predictive maintenance system or IoT gateway.</div>
              {canEdit && <RoleGate role={session.role} allow={["Manager", "Supervisor", "Administrator"]}><Button variant="danger" onClick={generateWebhookKey}>Regenerate key (invalidates the old one)</Button></RoleGate>}
            </div>
          )}
        </Card>

        <RoleGate role={session.role} allow={["Manager", "Supervisor", "Administrator"]}>
          <Card style={{ padding: 20, border: "1px solid #E5484D40" }}>
            <div style={{ fontFamily: F_DISPLAY, fontWeight: 600, fontSize: 14, marginBottom: 8, color: "#E5484D" }}>Danger zone</div>
            <div style={{ fontSize: 12, color: "#8A96A3", marginBottom: 12 }}>Permanently erases every machine, alert, decision, work order, part, and team member in this workspace — including any sample/demo data. This cannot be undone.</div>
            {!confirmReset ? (
              <Button variant="danger" onClick={() => setConfirmReset(true)}>Reset workspace data</Button>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "#E5484D", fontWeight: 600 }}>Are you sure? This can't be undone.</span>
                <Button variant="danger" onClick={resetWorkspace}>Yes, erase everything</Button>
                <Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
              </div>
            )}
          </Card>
        </RoleGate>
      </div>
    </div>
  );
}
