"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunView } from "@/lib/orchestrator";
import { SAMPLE_RULES, SAMPLE_TRANSCRIPT } from "@/lib/sample";
import { RunPanel } from "@/components/RunPanel";
import { DemoGuide } from "@/components/DemoGuide";
import { Button, Card } from "@/components/ui";

type RunSummary = {
  id: string;
  created_at: string;
  current_version: number;
  step_count: number;
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

const SAMPLE_RULES_TEXT = JSON.stringify(SAMPLE_RULES, null, 2);

export default function Home() {
  const [sessionId, setSessionId] = useState<string>("");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [transcript, setTranscript] = useState(SAMPLE_TRANSCRIPT);
  const [rulesText, setRulesText] = useState(SAMPLE_RULES_TEXT);
  const [error, setError] = useState<string | null>(null);
  const [driving, setDriving] = useState(false);
  const [showForm, setShowForm] = useState(true);
  const stopRef = useRef(false);

  const refreshRuns = useCallback(async () => {
    const list = await api<RunSummary[]>("/api/runs");
    setRuns(list);
    return list;
  }, []);

  useEffect(() => {
    api<{ session_id: string }>("/api/session")
      .then((s) => setSessionId(s.session_id))
      .then(refreshRuns)
      .then((list) => list.length && setShowForm(false)) // returning visitor: lead with their runs, not the input form
      .catch((e) => setError(e.message));
  }, [refreshRuns]);

  const load = useCallback(async (id: string) => {
    setSelected(id);
    setView(await api<RunView>(`/api/runs/${id}`));
  }, []);

  // While a step is executing (here or in another tab) poll so agent status updates live.
  useEffect(() => {
    if (!selected || !(driving || view?.status === "running")) return;
    const t = setInterval(() => load(selected).catch(() => {}), 2500);
    return () => clearInterval(t);
  }, [selected, driving, view?.status, load]);

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const advance = async (id: string, all: boolean) => {
    stopRef.current = false;
    setDriving(true);
    try {
      for (;;) {
        const { result, view: v } = await api<{
          result: { outcome: string; error?: string };
          view: RunView;
        }>(`/api/runs/${id}/advance`, {});
        setView(v);
        refreshRuns().catch(() => {});
        if (result.outcome === "failed")
          throw new Error(result.error ?? "Step failed");
        if (result.outcome === "busy") {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (
          !all ||
          result.outcome === "done" ||
          stopRef.current ||
          v.status === "approved" ||
          v.status === "needs_attention"
        )
          break;
      }
    } finally {
      setDriving(false);
      refreshRuns().catch(() => {});
    }
  };

  const startRun = () =>
    guard(async () => {
      let rules: unknown;
      try {
        rules = JSON.parse(rulesText);
      } catch {
        throw new Error("Company rules must be valid JSON");
      }
      const { id } = await api<{ id: string }>("/api/runs", {
        transcript,
        rules,
        faults: {},
      });
      await refreshRuns();
      await load(id);
      setShowForm(false);
    });

  const reset = () =>
    guard(async () => {
      if (
        !confirm(
          "Delete all runs in this session and restore the sample input?",
        )
      )
        return;
      await api("/api/reset", {});
      setSelected(null);
      setView(null);
      setTranscript(SAMPLE_TRANSCRIPT);
      setRulesText(SAMPLE_RULES_TEXT);
      setShowForm(true);
      await refreshRuns();
    });

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">Operations Coordinator</h1>
            <p className="text-xs text-slate-500">
              Intake → Planning ⇄ Review: three LLM agents turn a transcript and
              company rules into a reviewed plan
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {sessionId && (
              <span
                className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600"
                title="Private to this browser. Open an incognito window to get a separate session."
              >
                session {sessionId.slice(0, 8)}
              </span>
            )}
            <Button variant="danger" onClick={reset}>
              Reset
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">New run</h2>
              <button
                className="text-xs text-sky-700 hover:underline"
                onClick={() => setShowForm(!showForm)}
              >
                {showForm ? "Hide input" : "Edit input"}
              </button>
            </div>
            {!showForm && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  {transcript === SAMPLE_TRANSCRIPT &&
                  rulesText === SAMPLE_RULES_TEXT
                    ? "Sample transcript and company rules"
                    : "Your edited transcript and rules"}
                </p>
                <Button variant="primary" onClick={startRun}>
                  Create run
                </Button>
              </div>
            )}
            {showForm && (
              <div className="mt-3 space-y-3">
                <label className="block text-xs font-medium text-slate-600">
                  Meeting transcript
                  <textarea
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    rows={12}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-[11px] leading-relaxed"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Company rules (JSON: roster, calendar, rules)
                  <textarea
                    value={rulesText}
                    onChange={(e) => setRulesText(e.target.value)}
                    rows={10}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-[11px] leading-relaxed"
                  />
                </label>
                <div className="flex gap-2">
                  <Button variant="primary" onClick={startRun}>
                    Create run
                  </Button>
                  <Button
                    onClick={() => {
                      setTranscript(SAMPLE_TRANSCRIPT);
                      setRulesText(SAMPLE_RULES_TEXT);
                    }}
                  >
                    Load sample
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">Runs in this session</h2>
            <ul className="mt-2 space-y-1">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => guard(() => load(r.id))}
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-sm ${selected === r.id ? "bg-slate-100 font-medium ring-1 ring-inset ring-slate-300" : "hover:bg-slate-50"}`}
                  >
                    <span className="font-mono">{r.id.slice(0, 8)}</span>
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {new Date(r.created_at).toLocaleTimeString()} · v
                      {r.current_version} · {r.step_count} steps
                    </span>
                  </button>
                </li>
              ))}
              {!runs.length && (
                <li className="text-sm text-slate-400">No runs yet.</li>
              )}
            </ul>
          </Card>

          {view && <DemoGuide />}
        </aside>

        <section
          className={`min-w-0 space-y-3 ${view ? "order-first lg:order-none" : ""}`}
        >
          {error && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <span className="whitespace-pre-wrap">{error}</span>
              <button onClick={() => setError(null)} className="text-rose-500">
                ✕
              </button>
            </div>
          )}
          {view ? (
            <RunPanel
              view={view}
              driving={driving}
              onRunNext={() => guard(() => advance(view.run.id, false))}
              onRunAll={() => guard(() => advance(view.run.id, true))}
              onStop={() => (stopRef.current = true)}
              onCorrect={async (factId, text) => {
                await guard(async () =>
                  setView(
                    await api<RunView>(`/api/runs/${view.run.id}/facts`, {
                      fact_id: factId,
                      text,
                    }),
                  ),
                );
              }}
              onFaults={(faults) => {
                setView({ ...view, run: { ...view.run, faults } }); // optimistic, so the checkbox responds instantly
                guard(async () =>
                  setView(
                    await api<RunView>(
                      `/api/runs/${view.run.id}/faults`,
                      faults,
                    ),
                  ),
                );
              }}
            />
          ) : (
            <>
              <Card className="p-8 text-center text-sm text-slate-500">
                Create a run from the sample input (or your own), then start it.
                Each agent runs as a separate model call; every handoff is
                schema-validated and stored, so a failed step can be resumed
                without redoing completed work.
              </Card>
              <DemoGuide />
            </>
          )}
        </section>
      </main>
    </div>
  );
}
