// Vercel serverless function — the real, generic "gate" any external system
// (predictive maintenance platform, IoT gateway, automation tool like Zapier)
// can send data to. Writes straight into the workspace's real data, the same
// as if a person had reported it manually. Uses the same Supabase project
// already configured for the app — no new environment variables needed.

import { createClient } from "@supabase/supabase-js";

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

  const newAlert = {
    id: "al_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4),
    machineId: machine.id,
    type: type || "Sensor alert",
    severity: ["Low", "Medium", "High", "Critical"].includes(severity) ? severity : "Medium",
    description: description || "Received automatically from a connected system.",
    photoNote: "",
    sensorNote: sensorNote || "",
    reporter: "Connected system",
    date: new Date().toISOString(),
    resolved: false,
  };

  appData.alerts = [newAlert, ...(appData.alerts || [])];
  appData.activity = [
    { id: "a_" + Date.now().toString(36), text: `${newAlert.type} received automatically from a connected system for ${machine.name}`, at: new Date().toISOString() },
    ...(appData.activity || []),
  ].slice(0, 60);

  const { error: writeErr } = await supabase.from("meo_workspaces").upsert({ key: workspaceKey, value: JSON.stringify(appData), updated_at: new Date().toISOString() });
  if (writeErr) return res.status(500).json({ error: "Failed to save the alert: " + writeErr.message });

  return res.status(200).json({ success: true, alertId: newAlert.id, machine: machine.name });
}
