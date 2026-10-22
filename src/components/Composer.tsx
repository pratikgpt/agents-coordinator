"use client";

import { useState } from "react";
import { FileText, Play, RotateCcw } from "lucide-react";
import type { Faults } from "@/lib/orchestrator";
import { SAMPLE_RULES, SAMPLE_TRANSCRIPT } from "@/lib/sample";
import { Button, Card, SimulatedTag } from "./ui";

export const SAMPLE_RULES_TEXT = JSON.stringify(SAMPLE_RULES, null, 2);

const SCENARIOS: { key: string; title: string; text: string; faults: Faults; simulated?: boolean }[] = [
  { key: "standard", title: "Standard run", text: "All three agents run normally.", faults: {} },
  {
    key: "violation",
    title: "Rule violation",
    text: "Planning's first draft ignores rule R2. Review should catch it and send corrections back.",
    faults: { rule_violation: true },
    simulated: true,
  },
  {
    key: "failure",
    title: "Model failure",
    text: "The first Planning call fails. Retrying reruns Planning only; Intake is not repeated.",
    faults: { fail_planning: true },
    simulated: true,
  },
];

function parseRules(text: string): { ok: true; people: number; rules: number; date: string } | { ok: false } {
  try {
    const r = JSON.parse(text);
    return { ok: true, people: r.roster?.length ?? 0, rules: r.rules?.length ?? 0, date: r.meeting_date ?? "?" };
  } catch {
    return { ok: false };
  }
}

export function Composer({
  transcript,
  rulesText,
  onTranscript,
  onRules,
  onStart,
  busy,
}: {
  transcript: string;
  rulesText: string;
  onTranscript: (t: string) => void;
  onRules: (t: string) => void;
  onStart: (faults: Faults) => void;
  busy: boolean;
}) {
  const [scenario, setScenario] = useState("standard");
  const [editing, setEditing] = useState(false);
  const isSample = transcript === SAMPLE_TRANSCRIPT && rulesText === SAMPLE_RULES_TEXT;
  const rules = parseRules(rulesText);
  const title = transcript.split("\n").find((l) => l.trim())?.trim() ?? "Empty transcript";
  const chosen = SCENARIOS.find((s) => s.key === scenario)!;

  return (
    <Card className="p-5 sm:p-6">
      <h1 className="text-lg font-semibold text-slate-900">New run</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        Intake extracts facts from a meeting transcript, Planning turns them into tasks under the company rules, and Review checks the plan and sends
        corrections back until it passes.
      </p>

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-slate-900">Scenario</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {SCENARIOS.map((s) => (
            <label
              key={s.key}
              className={`cursor-pointer rounded-xl border p-3.5 transition has-focus-visible:outline-2 has-focus-visible:outline-teal-700 ${scenario === s.key ? "border-teal-700 bg-teal-50/50 ring-1 ring-teal-700" : "border-slate-200 hover:border-slate-300"}`}
            >
              <input type="radio" name="scenario" value={s.key} checked={scenario === s.key} onChange={() => setScenario(s.key)} className="sr-only" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-900">{s.title}</span>
                {s.simulated && <SimulatedTag />}
              </div>
              <p className="mt-1 text-[13px] text-slate-600">{s.text}</p>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Input</h2>
          <div className="flex gap-1">
            {!isSample && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onTranscript(SAMPLE_TRANSCRIPT);
                  onRules(SAMPLE_RULES_TEXT);
                }}
              >
                <RotateCcw className="size-3.5" /> Restore sample
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
              {editing ? "Done" : "Edit"}
            </Button>
          </div>
        </div>
        {editing ? (
          <div className="mt-2 grid gap-4 lg:grid-cols-2">
            <label className="block text-[13px] font-medium text-slate-700">
              Meeting transcript
              <textarea
                value={transcript}
                onChange={(e) => onTranscript(e.target.value)}
                rows={16}
                className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs leading-relaxed focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
            </label>
            <label className="block text-[13px] font-medium text-slate-700">
              Company rules (JSON: roster, calendar, rules)
              <textarea
                value={rulesText}
                onChange={(e) => onRules(e.target.value)}
                rows={16}
                className={`mt-1.5 w-full rounded-lg border p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 ${rules.ok ? "border-slate-300 focus:border-teal-600 focus:ring-teal-600/20" : "border-rose-400 focus:ring-rose-500/20"}`}
              />
              {!rules.ok && <span className="mt-1 block text-xs font-normal text-rose-700">Not valid JSON</span>}
            </label>
          </div>
        ) : (
          <div className="mt-2 flex items-start gap-3 rounded-lg bg-slate-50 p-3">
            <FileText className="mt-0.5 size-4 shrink-0 text-slate-500" />
            <div className="min-w-0 text-sm">
              <div className="truncate font-medium text-slate-900">
                {isSample ? "Sample: " : ""}
                {title}
              </div>
              <div className="text-[13px] text-slate-600">
                {transcript.split("\n").length} transcript lines
                {rules.ok ? ` · ${rules.people} people · ${rules.rules} rules · meeting ${rules.date}` : " · rules are not valid JSON"}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <p className="text-xs text-slate-600">Usually 1–2 minutes and about $0.10–0.20 in model usage.</p>
        <Button variant="primary" disabled={busy || !rules.ok} onClick={() => onStart(chosen.faults)}>
          <Play className="size-4" /> {busy ? "Starting…" : "Start run"}
        </Button>
      </div>
    </Card>
  );
}
