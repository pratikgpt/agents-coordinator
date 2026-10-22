"use client";

import { useState } from "react";
import { Card } from "./ui";

const CASES: [string, string][] = [
  ["Complete three-agent run", "Create run with the sample input, then Start run. Intake → Planning → Review runs and the Final plan tab shows the approved plan."],
  ["Rule violation sent back", "Before starting a new run, tick “First plan draft ignores R2”. Review blocks the missing security review; Collaboration shows the corrections and Planning’s round-2 fix."],
  ["Changed fact propagates", "On a finished run open Source facts, Correct the release-date fact (e.g. to 2026-11-06) and Save & rerun, then Run to completion. Context moves to v2; Planning/Review rerun, Intake is reused."],
  ["Recovery after model failure", "Tick “Fail next Planning call”, run it: the step fails (labelled SIMULATED). Click Resume run: only Planning retries (attempt 2), Intake is not repeated."],
  ["Sessions are isolated", "Open this page in a private/incognito window. It gets a different session id and sees none of these runs; their URLs return 404 there."],
];

export function DemoGuide() {
  const [open, setOpen] = useState(true);
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">How to demo</h2>
        <button className="text-xs text-sky-700 hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <ol className="mt-2 space-y-2.5 text-xs text-slate-600">
          {CASES.map(([title, how], i) => (
            <li key={title}>
              <div className="font-medium text-slate-800">
                {i + 1}. {title}
              </div>
              {how}
            </li>
          ))}
          <li className="border-t border-slate-100 pt-2 text-slate-500">Reset (top right) deletes this session’s runs and restores the sample input. A run costs about $0.10–0.20 in model usage.</li>
        </ol>
      )}
    </Card>
  );
}
