-- Run this in your Supabase project's SQL Editor (SQL Editor → New query →
-- paste this → Run). This is an ADDITION to your existing setup — it does
-- not touch the meo_workspaces table you already created.
--
-- This new table makes workspaces invite-only: whoever signs up first for a
-- brand-new workspace name becomes its owner automatically. After that,
-- new people can only join if their email has been added here first
-- (done from Settings → Team → Invite teammate inside the app).

create table if not exists meo_workspace_members (
  workspace_key text not null,
  email text not null,
  role text,
  is_owner boolean default false,
  invited_by text,
  created_at timestamptz default now(),
  primary key (workspace_key, email)
);

alter table meo_workspace_members enable row level security;

create policy "Allow anon read" on meo_workspace_members
  for select using (true);

create policy "Allow anon insert" on meo_workspace_members
  for insert with check (true);

create policy "Allow anon update" on meo_workspace_members
  for update using (true);

create policy "Allow anon delete" on meo_workspace_members
  for delete using (true);
