import postgres from "postgres";

const g = globalThis as unknown as { sql?: postgres.Sql; schemaReady?: Promise<void> };

export const sql =
  g.sql ??
  postgres(process.env.DATABASE_URL ?? "postgres://postgres:dev@localhost:5433/agents", {
    max: 5,
    prepare: false, // compatible with pooled connections (Neon / PgBouncer)
    onnotice: () => {},
  });
if (process.env.NODE_ENV !== "production") g.sql = sql;

const SCHEMA = `
create table if not exists sessions (
  id uuid primary key,
  created_at timestamptz not null default now()
);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  transcript text not null,
  rules jsonb not null,
  current_version int not null default 0,
  max_rounds int not null default 3,
  faults jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists runs_session_idx on runs(session_id);

-- Source facts per context version. A user correction creates a new version.
create table if not exists context_versions (
  run_id uuid not null references runs(id) on delete cascade,
  version int not null,
  reason text not null,
  facts jsonb not null,
  issues jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, version)
);

-- One row per agent step. The unique key makes execution idempotent and resumable.
create table if not exists steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  step_key text not null,
  agent text not null,
  context_version int not null,
  round int not null,
  status text not null,
  attempts int not null default 1,
  input jsonb,
  output jsonb,
  error text,
  usage jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (run_id, step_key)
);

create table if not exists messages (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  kind text not null,
  from_agent text not null,
  to_agent text not null,
  context_version int not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  level text not null,
  text text not null,
  created_at timestamptz not null default now()
);
`;

export function ensureSchema(): Promise<void> {
  g.schemaReady ??= sql.unsafe(SCHEMA).then(() => undefined);
  return g.schemaReady;
}

// postgres.js wants its own JSON type; this keeps call sites tidy.
export const json = (v: unknown) => sql.json(v as postgres.JSONValue);
