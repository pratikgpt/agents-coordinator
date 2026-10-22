"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

const CASES: [string, string][] = [
  ["Complete three-agent run", "New run → Standard run → Start run."],
  ["Rule violation sent back", "New run → Rule violation. Agent exchange shows Review's corrections and Planning's revision."],
  ["Changed fact propagates", "On a finished run: Source facts → Correct F2 (release date) → Save and rerun."],
  ["Recovery after model failure", "New run → Model failure. Planning fails; Retry Planning reruns only that step."],
  ["Sessions are isolated", "Open this page in a private window: a separate session that sees none of these runs."],
];

export function DemoGuide() {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-1.5 text-left text-sm font-semibold text-slate-900">
        <ChevronRight className={`size-4 text-slate-500 transition ${open ? "rotate-90" : ""}`} />
        Demo checklist
      </button>
      {open && (
        <ol className="mt-2 space-y-2.5 pl-1">
          {CASES.map(([title, how], i) => (
            <li key={title} className="flex gap-2.5 text-[13px]">
              <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700">{i + 1}</span>
              <div>
                <div className="font-medium text-slate-900">{title}</div>
                <div className="text-slate-600">{how}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
