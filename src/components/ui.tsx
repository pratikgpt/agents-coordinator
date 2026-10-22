"use client";

import { useState, type ReactNode } from "react";

const TONES = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-800 ring-rose-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-slate-900 text-white hover:bg-slate-700",
    secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
    danger: "bg-white text-rose-700 ring-1 ring-inset ring-rose-300 hover:bg-rose-50",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}>
      {children}
    </button>
  );
}

export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} className="text-xs font-medium text-sky-700 hover:underline">
        {open ? "▾" : "▸"} {label}
      </button>
      {open && (
        <pre className="mt-1 max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  new: "gray",
  ready: "blue",
  running: "blue",
  succeeded: "green",
  approved: "green",
  failed: "red",
  needs_attention: "amber",
  superseded: "gray",
  idle: "gray",
  waiting: "gray",
};

// Basis is shown as a coloured dot + small label rather than a pill, so a table full of them stays quiet.
export const BASIS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  transcript: { dot: "bg-emerald-500", text: "text-emerald-700", label: "supported by the transcript" },
  rule: { dot: "bg-sky-500", text: "text-sky-700", label: "required by a company rule" },
  recommendation: { dot: "bg-violet-500", text: "text-violet-700", label: "agent proposal, not decided" },
  unresolved: { dot: "bg-amber-500", text: "text-amber-700", label: "open question" },
};

export function Basis({ basis }: { basis: string }) {
  const s = BASIS_STYLE[basis];
  return (
    <span title={s?.label} className={`inline-flex items-center gap-1 text-[11px] ${s?.text ?? "text-slate-500"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s?.dot ?? "bg-slate-400"}`} />
      {basis}
    </span>
  );
}
