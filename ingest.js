// Vercel serverless function — the real, generic "gate" any external system
// (predictive maintenance platform, IoT gateway, automation tool like Zapier)
// can send data to. Writes straight into the workspace's real data, the same
// as if a person had reported it manually. Uses the same Supabase project
// already configured for the app — no new environment variables needed.
//
// When a High/Critical alert arrives, this also immediately asks Claude to
// reason about it and creates a real pending decision — completing the loop:
// sensor/predictive system → MEO reasons → decision is ready, no one had to
// click "Analyze" first. Controlled by settings.autoDecideOnWebhookAlert.

import { createClient } from "@supabase/supabase-js";

function uidServer(p) { return p + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

// Same rule-based technician matching used client-side, reimplemented here
// since serverless functions can't import from the React app bundle.
function matchTechnician(machine, appData) {
  const technicians = (appData.team || []).filter((t) => t.role === "Technician");
  if (technicians.length === 0) return null;
  const haystack = `${machine?.name || ""} ${machine?.manufacturer || ""}`.toLowerCase();
  const ranked = technicians.map((t) => {
    const activeWOs = (appData.workOrders || []).filter((w) => w.assignedTech === t.name && w.status !== "Completed" && w.status !== "Closed").length;
    const priorWOs = (appData.workOrders || []).filter((w) => w.assignedTech === t.name && w.machineId === machine?.id && (w.status === "Completed" || w.status === "Closed"));
    const skills = (t.skills || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const skillMatch = skills.some((s) => s && haystack.includes(s));
    let score = 0;
    const reasons = [];
    if (priorWOs.length > 0) { score += 40; reasons.push(`worked on this machine before (${priorWOs.length}x)`); }
    if (skillMatch) { score += 30; reasons.push("skill tags match this equipment"); }
    score += Math.max(0, 20 - activeWOs * 7);
    reasons.push(activeWOs === 0 ? "currently free" : `${activeWOs} active job${activeWOs > 1 ? "s" : ""} in progress`);
    return { name: t.name, score, reason: reasons.join(", ") };
  }).sort((a, b) => b.score - a.score);
  return ranked[0] || null;
}

async function generateDecisionForAlert(appData, machine, alert, anthropicKey) {
  const allAlerts = (appData.alerts || []).filter((a) => a.machineId === machine.id);
  const completedWOs = (appData.workOrders || []).filter((w) => w.machineId === machine.id && (w.status === "Completed" || w.status === "Closed"));
  const relatedParts = (appData.parts || []).filter((p) => p.machineId === machine.id).map((p) => ({ name: p.name, quantity: p.quantity, minStock: p.minStock }));
  const daysSinceInstall = Math.round((Date.now() - new Date(machine.installDate)) / 86400000);

  const prompt = `You are MEO's Decision Engine, reacting to a new alert that just arrived automatically from a connected predictive maintenance/sensor system. Use ONLY the real data below — never invent a machine, part, or event not present here.

TRIGGERING ALERT: ${JSON.stringify({ type: alert.type, severity: alert.severity, description: alert.description, sensorNote: alert.sensorNote })}
MACHINE: ${JSON.stringify({ name: machine.name, machineId: machine.machineId, status: machine.status, criticality: machine.criticality, intervalDays: machine.intervalDays, daysSinceInstall })}
RECENT ALERT HISTORY (this machine): ${JSON.stringify(allAlerts.slice(0, 10).map((a) => ({ type: a.type, severity: a.severity, date: a.date })))}
COMPLETED REPAIRS (this machine): ${completedWOs.length}
KNOWN SPARE PARTS (this machine): ${JSON.stringify(relatedParts)}

Respond with ONLY a raw JSON object (no markdown fences, no prose) in this exact shape:
{"risk": "Low|Medium|High|Critical", "businessPriority": "Low|Medium|High|Critical", "downtimeCost": <integer USD estimate>, "action": "<short imperative action>", "reason": "<1-2 sentences citing the real evidence above>", "confidence": <integer 0-100>, "predictedRUL": "<short phrase or null if not enough history>", "requiredParts": "<comma-separated names from KNOWN SPARE PARTS if relevant, else empty string>", "recommendedTimeWindow": "<e.g. 'Today', 'Within 24 hours'>", "rootCauseProbability": "<short phrase or null>", "safetyChecklist": ["<2-4 short real safety checks for this specific action>"], "approvalRequired": true}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || "Anthropic API error");
  const text = (json.content || []).map((c) => c.text || "").join("\n").trim();
  const clean = text.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const r = JSON.parse(clean);

  const match = matchTechnician(machine, appData);
  return {
    id: uidServer("d"), machineId: machine.id, risk: r.risk, businessPriority: r.businessPriority || r.risk,
    downtimeCost: r.downtimeCost, action: r.action, reason: r.reason, confidence: r.confidence,
    predictedRUL: r.predictedRUL || null, requiredParts: r.requiredParts || "", recommendedTimeWindow: r.recommendedTimeWindow || "",
    rootCauseProbability: r.rootCauseProbability || null, safetyChecklist: Array.isArray(r.safetyChecklist) ? r.safetyChecklist : [],
    approvalRequired: r.approvalRequired !== false, suggestedTechnician: match?.name || null, technicianReason: match?.reason || "",
    status: "Pending", decisionReason: "", decidedBy: "", decidedAt: null, workOrderId: null, generatedAt: new Date().toISOString(),
    triggeredBy: "webhook",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Send a POST request." });
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: "Supabase isn't configured on this server yet." });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { workspace, apiKey, machineId, type, severity, description, sensorNote } = req.body || {};
  if (!workspace || !machineId || !type) {
    return res.status(400).json({ error: "Missing required fields: workspace, machineId, type" });
  }

  const workspaceKey = "meo:v2:" + String(workspace).trim().toLowerCase();

  const { data: row, error: readErr } = await supabase.from("meo_workspaces").select("value").eq("key", workspaceKey).maybeSingle();
  if (readErr) return res.status(500).json({ error: "Couldn't read workspace: " + readErr.message });
  if (!row) return res.status(404).json({ error: `No workspace found named "${workspace}".` });

  let appData;
  try {
    appData = JSON.parse(row.value);
  } catch (e) {
    return res.status(500).json({ error: "Workspace data is corrupted and couldn't be read." });
  }

  const requiredKey = appData.settings?.webhookApiKey;
  if (requiredKey && requiredKey !== apiKey) {
    return res.status(401).json({ error: "Invalid API key for this workspace." });
  }

  const machine = (appData.machines || []).find((m) => m.machineId === machineId);
  if (!machine) {
    return res.status(404).json({ error: `No machine with ID "${machineId}" registered in this workspace.` });
  }

  const cleanSeverity = ["Low", "Medium", "High", "Critical"].includes(severity) ? severity : "Medium";
  const newAlert = {
    id: uidServer("al"),
    machineId: machine.id,
    type: type || "Sensor alert",
    severity: cleanSeverity,
    description: description || "Received automatically from a connected system.",
    photoNote: "",
    sensorNote: sensorNote || "",
    reporter: "Connected system",
    date: new Date().toISOString(),
    resolved: false,
  };

  appData.alerts = [newAlert, ...(appData.alerts || [])];
  appData.activity = [
    { id: uidServer("a"), text: `${newAlert.type} received automatically from a connected system for ${machine.name}`, at: new Date().toISOString() },
    ...(appData.activity || []),
  ].slice(0, 60);

  let decisionCreated = false;
  const wantsAutoDecision = appData.settings?.autoDecideOnWebhookAlert !== false;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (wantsAutoDecision && anthropicKey && (cleanSeverity === "High" || cleanSeverity === "Critical")) {
    try {
      const decision = await generateDecisionForAlert(appData, machine, newAlert, anthropicKey);
      appData.decisions = [decision, ...(appData.decisions || [])];
      appData.activity = [
        { id: uidServer("a"), text: `MEO automatically generated a decision for ${machine.name}: ${decision.action}`, at: new Date().toISOString() },
        ...appData.activity,
      ].slice(0, 60);
      decisionCreated = true;
    } catch (e) {
      // Alert is still saved even if the automatic decision step fails — never lose the incoming data.
    }
  }

  const { error: writeErr } = await supabase.from("meo_workspaces").upsert({ key: workspaceKey, value: JSON.stringify(appData), updated_at: new Date().toISOString() });
  if (writeErr) return res.status(500).json({ error: "Failed to save the alert: " + writeErr.message });

  return res.status(200).json({ success: true, alertId: newAlert.id, machine: machine.name, decisionCreated });
}

