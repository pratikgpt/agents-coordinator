"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronRight, CircleDashed, Clock, Loader2, Pause, X } from "lucide-react";

// Design tokens live here as Tailwind classes: one accent (teal), semantic colours for state only,
// text no lighter than slate-500 so secondary copy keeps >= 4.5:1 contrast on white.

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white ${className}`}>{children}</div>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  type = "button",
  size = "md",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  size?: "sm" | "md";
}) {
  const styles = {
    primary: "bg-teal-700 text-white hover:bg-teal-800 focus-visible:outline-teal-700",
    secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
    ghost: "text-slate-700 hover:bg-slate-100",
    danger: "text-rose-700 hover:bg-rose-50",
  }[variant];
  const sizes = size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${sizes} ${styles}`}
    >
      {children}
    </button>
  );
}

/** Collapsible raw JSON: available for inspection, never the primary way information is shown. */
export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
        <ChevronRight className={`size-3.5 transition ${open ? "rotate-90" : ""}`} />
        {label}
      </button>
      {open && (
        <pre className="mt-1.5 max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------- One status language for runs and steps ----------

type StatusDef = { label: string; text: string; bg: string; Icon: typeof Check; spin?: boolean };

export const STATUS: Record<string, StatusDef> = {
  // runs
  new: { label: "Not started", text: "text-slate-600", bg: "bg-slate-100", Icon: CircleDashed },
  ready: { label: "Paused", text: "text-slate-600", bg: "bg-slate-100", Icon: Pause },
  running: { label: "Running", text: "text-sky-700", bg: "bg-sky-50", Icon: Loader2, spin: true },
  failed: { label: "Failed", text: "text-rose-700", bg: "bg-rose-50", Icon: X },
  approved: { label: "Approved", text: "text-emerald-700", bg: "bg-emerald-50", Icon: Check },
  needs_attention: { label: "Needs attention", text: "text-amber-800", bg: "bg-amber-50", Icon: AlertTriangle },
  // steps
  succeeded: { label: "Done", text: "text-emerald-700", bg: "bg-emerald-50", Icon: Check },
  superseded: { label: "Discarded", text: "text-slate-600", bg: "bg-slate-100", Icon: X },
  waiting: { label: "Up next", text: "text-slate-600", bg: "bg-slate-100", Icon: Clock },
  idle: { label: "Waiting", text: "text-slate-500", bg: "bg-slate-50", Icon: CircleDashed },
};

export function StatusIcon({ status, className = "size-4" }: { status: string; className?: string }) {
  const s = STATUS[status] ?? STATUS.idle;
  return <s.Icon className={`${className} shrink-0 ${s.text} ${s.spin ? "animate-spin" : ""}`} aria-hidden />;
}

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.idle;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.bg} ${s.text}`}>
      <StatusIcon status={status} className="size-3.5" />
      {s.label}
    </span>
  );
}

// ---------- Where an owner or date came from ----------

export const BASIS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  transcript: { dot: "bg-emerald-500", text: "text-emerald-700", label: "stated in the meeting" },
  rule: { dot: "bg-sky-500", text: "text-sky-700", label: "required by a company rule" },
  recommendation: { dot: "bg-violet-500", text: "text-violet-700", label: "agent proposal, not agreed" },
  unresolved: { dot: "bg-amber-500", text: "text-amber-700", label: "open question" },
};

export function Basis({ basis }: { basis: string }) {
  const s = BASIS_STYLE[basis];
  return (
    <span title={s?.label} className={`inline-flex items-center gap-1 text-xs ${s?.text ?? "text-slate-500"}`}>
      <span className={`size-1.5 rounded-full ${s?.dot ?? "bg-slate-400"}`} />
      {basis}
    </span>
  );
}

/** Small uppercase label for categories (fact kind, issue kind) — text, not a pill. */
export function Kind({ children, tone = "text-slate-500" }: { children: ReactNode; tone?: string }) {
  return <span className={`text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{children}</span>;
}

/** Clearly labelled marker for anything produced by a simulated fault. */
export function SimulatedTag({ children = "Simulated" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-dashed border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
      {children}
    </span>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">{text}</div>;
}
