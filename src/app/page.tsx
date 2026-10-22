"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Workflow, X } from "lucide-react";
import type { Faults, RunStatus, RunView } from "@/lib/orchestrator";
import { SAMPLE_TRANSCRIPT } from "@/lib/sample";
import { RunPanel } from "@/components/RunPanel";
import { Composer, SAMPLE_RULES_TEXT } from "@/components/Composer";
import { DemoGuide } from "@/components/DemoGuide";
import { Button, STATUS, StatusIcon } from "@/components/ui";

type RunSummary = { id: string; created_at: string; title: string; status: RunStatus };

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Keeps the open run in the URL so a refresh returns to it. */
function syncUrl(runId: string | null) {
  const url = runId ? `?run=${runId}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

export default function Home() {
  const [sessionId, setSessionId] = useState("");
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [composing, setComposing] = useState(false);
  const [transcript, setTranscript] = useState(SAMPLE_TRANSCRIPT);
  const [rulesText, setRulesText] = useState(SAMPLE_RULES_TEXT);
  const [error, setError] = useState<string | null>(null);
  const [driving, setDriving] = useState(false);
  const [starting, setStarting] = useState(false);
  const stopRef = useRef(false);
  const selected = composing ? null : (view?.run.id ?? null);

  const refreshRuns = useCallback(async () => {
    const list = await api<RunSummary[]>("/api/runs");
    setRuns(list);
    return list;
  }, []);

  const load = useCallback(async (id: string) => {
    const v = await api<RunView>(`/api/runs/${id}`);
    setView(v);
    setComposing(false);
    syncUrl(id);
  }, []);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    guard(async () => {
      const s = await api<{ session_id: string }>("/api/session");
      setSessionId(s.session_id);
      const list = await refreshRuns();
      const wanted = new URLSearchParams(window.location.search).get("run");
      const open = list.find((r) => r.id === wanted) ?? list[0];
      if (open) await load(open.id);
      else setComposing(true);
    });
  }, [guard, refreshRuns, load]);

  // While a step is executing (here or in another tab) poll so agent status updates live.
  useEffect(() => {
    if (!selected || !(driving || view?.status === "running")) return;
    const t = setInterval(() => load(selected).catch(() => {}), 2500);
    return () => clearInterval(t);
  }, [selected, driving, view?.status, load]);

  const advance = async (id: string, all: boolean) => {
    stopRef.current = false;
    setDriving(true);
    try {
      for (;;) {
        const { result, view: v } = await api<{ result: { outcome: string; error?: string }; view: RunView }>(`/api/runs/${id}/advance`, {});
        setView(v);
        refreshRuns().catch(() => {});
        if (result.outcome === "failed") return; // shown in the run header, with a retry button
        if (result.outcome === "busy") {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (!all || result.outcome === "done" || stopRef.current || v.status === "approved" || v.status === "needs_attention") break;
      }
    } finally {
      setDriving(false);
      refreshRuns().catch(() => {});
    }
  };

  const startRun = (faults: Faults) =>
    guard(async () => {
      setStarting(true);
      let id: string;
      try {
        ({ id } = await api<{ id: string }>("/api/runs", { transcript, rules: JSON.parse(rulesText), faults }));
        await refreshRuns();
        await load(id);
      } finally {
        setStarting(false);
      }
      await advance(id, true);
    });

  const reset = () =>
    guard(async () => {
      if (!confirm("Delete all runs in this session and restore the sample input?")) return;
      await api("/api/reset", {});
      setView(null);
      setTranscript(SAMPLE_TRANSCRIPT);
      setRulesText(SAMPLE_RULES_TEXT);
      setComposing(true);
      syncUrl(null);
      await refreshRuns();
    });

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <span className="grid size-7 place-items-center rounded-lg bg-teal-700 text-white">
            <Workflow className="size-4" />
          </span>
          <span className="font-semibold text-slate-900">Operations Coordinator</span>
          <span className="hidden text-sm text-slate-600 sm:inline">Meeting transcript → reviewed action plan</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="order-2 min-w-0 space-y-5 lg:order-1">
          <Button
            variant="primary"
            onClick={() => {
              setComposing(true);
              syncUrl(null);
            }}
          >
            <Plus className="size-4" /> New run
          </Button>

          <nav aria-label="Runs in this session">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Runs</h2>
            <ul className="mt-2 space-y-1">
              {runs?.map((r) => {
                // The open run's status is fresher than the list's (the list refreshes once per step).
                const status = r.id === selected && view ? (driving && view.status !== "failed" ? "running" : view.status) : r.status;
                return (
                <li key={r.id}>
                  <button
                    onClick={() => guard(() => load(r.id))}
                    aria-current={selected === r.id}
                    className={`w-full rounded-lg px-3 py-2 text-left transition ${selected === r.id ? "bg-white shadow-sm ring-1 ring-slate-200" : "hover:bg-white/70"}`}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <StatusIcon status={status} className="size-3.5" />
                      {STATUS[status]?.label}
                      <span className="ml-auto text-xs font-normal text-slate-600 tabular-nums">
                        {new Date(r.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate pl-5.5 text-xs text-slate-600">{r.title}</div>
                  </button>
                </li>
                );
              })}
              {runs && !runs.length && <li className="px-1 text-sm text-slate-600">No runs yet.</li>}
            </ul>
          </nav>

          <DemoGuide />

          <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <div className="flex items-center justify-between gap-2">
              <span>
                Session <span className="font-mono text-slate-900">{sessionId.slice(0, 8) || "…"}</span>
              </span>
              <Button size="sm" variant="danger" onClick={reset}>
                Reset session
              </Button>
            </div>
            <p className="mt-1">Private to this browser. Reset deletes its runs and restores the sample input.</p>
          </div>
        </aside>

        <section className="order-1 min-w-0 space-y-4 lg:order-2">
          {error && (
            <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
              <span className="whitespace-pre-wrap">{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss" className="text-rose-700">
                <X className="size-4" />
              </button>
            </div>
          )}
          {composing ? (
            <Composer transcript={transcript} rulesText={rulesText} onTranscript={setTranscript} onRules={setRulesText} onStart={startRun} busy={starting} />
          ) : view ? (
            <RunPanel
              key={view.run.id}
              view={view}
              driving={driving}
              onRun={(all) => guard(() => advance(view.run.id, all))}
              onStop={() => (stopRef.current = true)}
              onCorrect={(factId, text) =>
                guard(async () => {
                  setView(await api<RunView>(`/api/runs/${view.run.id}/facts`, { fact_id: factId, text }));
                  await advance(view.run.id, true); // "Save and rerun" reruns Planning and Review on the new context version
                })
              }
              onFaults={(faults) => {
                setView({ ...view, run: { ...view.run, faults } }); // optimistic, so the checkbox responds instantly
                guard(async () => setView(await api<RunView>(`/api/runs/${view.run.id}/faults`, faults)));
              }}
            />
          ) : (
            <div className="h-64 animate-pulse rounded-xl bg-slate-200/50" />
          )}
        </section>
      </main>
    </div>
  );
}
