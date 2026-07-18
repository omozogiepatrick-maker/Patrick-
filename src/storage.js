// Real, shared, multi-device storage backed by Supabase (Postgres).
// Keeps the exact same get/set/delete/list interface the rest of the app
// already uses — so nothing in App.jsx needs to change for this upgrade.
//
// Data model: one row per workspace, storing the whole workspace's data as
// a single JSON blob (same shape as before, just no longer stuck in one
// browser). This keeps the upgrade simple and safe rather than rewriting
// the whole app into a fully relational database on day one.
//
// SAFETY NET: if the Supabase environment variables haven't been set yet,
// this automatically falls back to localStorage (the old behavior) instead
// of crashing the app. Once you add the env vars and redeploy, it switches
// to real shared storage automatically — see README.md "Supabase setup".

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE = "meo_workspaces";

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const localFallback = {
  async get(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return null;
      return { key, value: raw };
    } catch (e) { return null; }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return { key, value };
    } catch (e) { return null; }
  },
  async delete(key) {
    try {
      window.localStorage.removeItem(key);
      return { key, deleted: true };
    } catch (e) { return null; }
  },
  async list(prefix) {
    try {
      const keys = Object.keys(window.localStorage).filter((k) => !prefix || k.startsWith(prefix));
      return { keys };
    } catch (e) { return null; }
  },
};

const supabaseStorage = {
  async get(key) {
    try {
      const { data, error } = await supabase.from(TABLE).select("value").eq("key", key).maybeSingle();
      if (error || !data) return null;
      return { key, value: data.value };
    } catch (e) { return null; }
  },

  async set(key, value) {
    try {
      const { error } = await supabase.from(TABLE).upsert({ key, value, updated_at: new Date().toISOString() });
      if (error) return null;
      return { key, value };
    } catch (e) { return null; }
  },

  async delete(key) {
    try {
      const { error } = await supabase.from(TABLE).delete().eq("key", key);
      if (error) return null;
      return { key, deleted: true };
    } catch (e) { return null; }
  },

  async list(prefix) {
    try {
      let query = supabase.from(TABLE).select("key");
      if (prefix) query = query.like("key", `${prefix}%`);
      const { data, error } = await query;
      if (error) return null;
      return { keys: (data || []).map((r) => r.key) };
    } catch (e) { return null; }
  },
};

if (!supabase) {
  console.warn(
    "[MEO] Supabase isn't configured yet (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). " +
    "Falling back to localStorage — data will NOT be shared across devices until Supabase is set up. See README.md."
  );
}

export const storage = supabase ? supabaseStorage : localFallback;

// Diagnostic tool, surfaced in Settings, so real errors show up on screen
// instead of being silently swallowed — useful since most testing here
// happens on a phone with no access to the browser console.
export async function testStorageConnection() {
  if (!supabase) {
    return {
      ok: false,
      usingSupabase: false,
      message: "Supabase is not configured. VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing, empty, or wasn't present when this site was last built. Currently running on localStorage (not shared across devices).",
    };
  }
  try {
    const testKey = "meo:diagnostic:" + Date.now();
    const writeRes = await supabase.from(TABLE).upsert({ key: testKey, value: "diagnostic-test", updated_at: new Date().toISOString() });
    if (writeRes.error) {
      return { ok: false, usingSupabase: true, message: "WRITE FAILED — " + writeRes.error.message + (writeRes.error.code ? ` (code: ${writeRes.error.code})` : "") };
    }
    const readRes = await supabase.from(TABLE).select("value").eq("key", testKey).maybeSingle();
    if (readRes.error) {
      return { ok: false, usingSupabase: true, message: "READ FAILED — " + readRes.error.message + (readRes.error.code ? ` (code: ${readRes.error.code})` : "") };
    }
    if (!readRes.data) {
      return { ok: false, usingSupabase: true, message: "Wrote successfully but couldn't read it back. This usually means a Row Level Security policy is blocking reads — check the 4 policies on meo_workspaces in Supabase." };
    }
    await supabase.from(TABLE).delete().eq("key", testKey);
    return { ok: true, usingSupabase: true, message: "Success — wrote and read back a real row. Supabase is genuinely connected and working." };
  } catch (e) {
    return { ok: false, usingSupabase: true, message: "UNEXPECTED ERROR — " + (e?.message || String(e)) };
  }
}

export const isSupabaseConfigured = !!supabase;

// Real authentication, backed by Supabase Auth. Passwords are hashed and
// verified by Supabase — this app never sees or stores a plain password.
// When Supabase isn't configured, `auth` is null and App.jsx falls back to
// the old prototype-style entry (no password) so the app stays usable.
export const auth = supabase ? {
  async signUp(email, password, metadata) {
    return await supabase.auth.signUp({ email, password, options: { data: metadata } });
  },
  async signIn(email, password) {
    return await supabase.auth.signInWithPassword({ email, password });
  },
  async signOut() {
    return await supabase.auth.signOut();
  },
  async getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },
  onAuthStateChange(callback) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
    return data.subscription;
  },
  async resetPasswordForEmail(email) {
    return await supabase.auth.resetPasswordForEmail(email);
  },
} : null;
