-- Organizations (tenants)
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);
alter table public.organizations disable row level security;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete set null,
  role text not null check (role in ('super_admin','sales','lead_generator','appointment_setter','general_user')),
  display_name text,
  position text,
  created_at timestamptz default now()
);
alter table public.profiles disable row level security;
create index if not exists profiles_org_id_idx on public.profiles(org_id);

-- Websites: sources per tenant
create table if not exists public.websites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  domain text,
  created_at timestamptz default now()
);
alter table public.websites disable row level security;
create index if not exists websites_org_id_idx on public.websites(org_id);

-- Leads with flexible attributes
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  website_id uuid references public.websites(id) on delete set null,
  sales_person uuid references auth.users(id) on delete set null,
  name text,
  email text,
  phone text,
  status text check (status in ('New','Contacted','Qualified','Lost','Converted','followup 1','followup 2','followup 3','Appointment confirmed','Not converted')) default 'New',
  priority text check (priority in ('Low','Medium','High')) default 'Medium',
  service_type text,
  source text,
  custom jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
alter table public.leads disable row level security;
create index if not exists leads_org_id_idx on public.leads(org_id);
create index if not exists leads_website_id_idx on public.leads(website_id);
create index if not exists leads_sales_person_idx on public.leads(sales_person);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_priority_idx on public.leads(priority);

-- Lead notes
create table if not exists public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  content text not null,
  created_at timestamptz default now()
);
alter table public.lead_notes disable row level security;
create index if not exists lead_notes_lead_id_idx on public.lead_notes(lead_id);

-- Lead activity timeline
create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  type text not null,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
alter table public.lead_activities disable row level security;
create index if not exists lead_activities_lead_id_idx on public.lead_activities(lead_id);

-- Lead documents (metadata only; files in storage)
create table if not exists public.lead_documents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  filename text not null,
  url text not null,
  created_at timestamptz default now()
);
alter table public.lead_documents disable row level security;
create index if not exists lead_documents_lead_id_idx on public.lead_documents(lead_id);

-- Appointments linked to leads
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  scheduled_at timestamptz not null,
  title text,
  notes text,
  status text check (status in ('scheduled','completed','canceled')) default 'scheduled',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
alter table public.appointments disable row level security;
create index if not exists appointments_lead_id_idx on public.appointments(lead_id);

-- Projects
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  name text not null,
  status text check (status in ('Active','On Hold','Completed')) default 'Active',
  value numeric(12,2),
  custom jsonb default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
alter table public.projects disable row level security;
create index if not exists projects_org_id_idx on public.projects(org_id);
create index if not exists projects_lead_id_idx on public.projects(lead_id);
create index if not exists projects_status_idx on public.projects(status);

-- Project documents (metadata only; files stored in external storage)
create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  filename text not null,
  url text not null,
  doc_type text check (doc_type in ('contract','boq','other')) default 'other',
  created_at timestamptz default now()
);
alter table public.project_documents disable row level security;
create index if not exists project_documents_project_id_idx on public.project_documents(project_id);

-- Quotes (sales quotations)
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  status text check (status in ('Draft','Sent','Accepted','Rejected')) default 'Draft',
  subtotal numeric(12,2),
  tax numeric(12,2),
  total numeric(12,2),
  items jsonb default '[]'::jsonb,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
alter table public.quotes disable row level security;
create index if not exists quotes_org_id_idx on public.quotes(org_id);
create index if not exists quotes_lead_id_idx on public.quotes(lead_id);
create index if not exists quotes_project_id_idx on public.quotes(project_id);
create index if not exists quotes_status_idx on public.quotes(status);

-- Tasks management
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  parent_task_id uuid references public.tasks(id) on delete set null,
  title text not null,
  description text,
  due_at timestamptz,
  status text check (status in ('open','in_progress','completed','cancelled')) default 'open',
  assignee_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.tasks disable row level security;
create index if not exists tasks_org_id_idx on public.tasks(org_id);
create index if not exists tasks_assignee_idx on public.tasks(assignee_id);
create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_due_idx on public.tasks(due_at);
create index if not exists tasks_parent_task_id_idx on public.tasks(parent_task_id);

-- Task updates (assignee responses / daily updates against tasks)
create table if not exists public.task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  state text check (state in ('completed','not_completed')) default 'not_completed',
  note text,
  created_at timestamptz default now()
);
alter table public.task_updates disable row level security;
create index if not exists task_updates_task_id_idx on public.task_updates(task_id);
create index if not exists task_updates_author_id_idx on public.task_updates(author_id);

-- Personal notes for general users
create table if not exists public.user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);
alter table public.user_notes disable row level security;
create index if not exists user_notes_user_id_idx on public.user_notes(user_id);

-- Task documents (metadata only; files stored in external storage)
create table if not exists public.task_documents (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  filename text not null,
  url text not null,
  created_at timestamptz default now()
);
alter table public.task_documents disable row level security;
create index if not exists task_documents_task_id_idx on public.task_documents(task_id);

create table if not exists public.task_revisions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  title text not null,
  description text,
  due_at timestamptz,
  status text check (status in ('open','in_progress','completed','cancelled')) default 'open',
  assignee_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
alter table public.task_revisions disable row level security;
create index if not exists task_revisions_task_id_idx on public.task_revisions(task_id);
create index if not exists task_revisions_assignee_idx on public.task_revisions(assignee_id);
create index if not exists task_revisions_due_idx on public.task_revisions(due_at);

create table if not exists public.task_revision_documents (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid references public.task_revisions(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  filename text not null,
  url text not null,
  created_at timestamptz default now()
);
alter table public.task_revision_documents disable row level security;
create index if not exists task_revision_documents_revision_id_idx on public.task_revision_documents(revision_id);

-- Work sessions (daily login/logout tracking)
create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  role text,
  work_date date not null,
  login_at timestamptz not null default now(),
  logout_at timestamptz,
  duration_minutes integer not null default 0,
  created_at timestamptz default now()
);
alter table public.work_sessions disable row level security;
create index if not exists work_sessions_user_date_idx on public.work_sessions(user_id, work_date);
create index if not exists work_sessions_date_idx on public.work_sessions(work_date);
create index if not exists work_sessions_org_idx on public.work_sessions(org_id);

-- Daily reports (end-of-day logs by general users)
create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  report_date date not null,
  content text not null,
  created_at timestamptz default now()
);
alter table public.daily_reports disable row level security;
create index if not exists daily_reports_user_date_idx on public.daily_reports(user_id, report_date);
create index if not exists daily_reports_date_idx on public.daily_reports(report_date);
create index if not exists daily_reports_org_idx on public.daily_reports(org_id);

create table if not exists public.daily_report_documents (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.daily_reports(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  filename text not null,
  url text not null,
  created_at timestamptz default now()
);
alter table public.daily_report_documents disable row level security;
create index if not exists daily_report_documents_report_id_idx on public.daily_report_documents(report_id);

-- Enable RLS and restrict access:
-- - Employees can only see/insert/update their own rows
-- - Super Admin can see all rows
alter table public.work_sessions enable row level security;

alter table public.daily_reports enable row level security;
alter table public.daily_report_documents enable row level security;

drop policy if exists "work_sessions_select_own_or_admin" on public.work_sessions;
create policy "work_sessions_select_own_or_admin"
on public.work_sessions
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
);

drop policy if exists "work_sessions_insert_own" on public.work_sessions;
create policy "work_sessions_insert_own"
on public.work_sessions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "work_sessions_update_own_or_admin" on public.work_sessions;
create policy "work_sessions_update_own_or_admin"
on public.work_sessions
for update
to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
)
with check (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
);

drop policy if exists "daily_reports_select_own_or_admin" on public.daily_reports;
create policy "daily_reports_select_own_or_admin"
on public.daily_reports
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
);

drop policy if exists "daily_reports_insert_own" on public.daily_reports;
create policy "daily_reports_insert_own"
on public.daily_reports
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "daily_reports_update_own_or_admin" on public.daily_reports;
create policy "daily_reports_update_own_or_admin"
on public.daily_reports
for update
to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
)
with check (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
);

drop policy if exists "daily_reports_delete_own_or_admin" on public.daily_reports;
create policy "daily_reports_delete_own_or_admin"
on public.daily_reports
for delete
to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
);

drop policy if exists "daily_report_docs_select_own_or_admin" on public.daily_report_documents;
create policy "daily_report_docs_select_own_or_admin"
on public.daily_report_documents
for select
to authenticated
using (
  exists (select 1 from public.daily_reports r where r.id = report_id and r.user_id = auth.uid())
  or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
);

drop policy if exists "daily_report_docs_insert_own" on public.daily_report_documents;
create policy "daily_report_docs_insert_own"
on public.daily_report_documents
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (select 1 from public.daily_reports r where r.id = report_id and r.user_id = auth.uid())
);

drop policy if exists "daily_report_docs_delete_own_or_admin" on public.daily_report_documents;
create policy "daily_report_docs_delete_own_or_admin"
on public.daily_report_documents
for delete
to authenticated
using (
  exists (select 1 from public.daily_reports r where r.id = report_id and r.user_id = auth.uid())
  or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
);
