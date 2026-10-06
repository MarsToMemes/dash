"use client";

import clsx from "clsx";
import {
  BarChart3,
  Code2,
  Eye,
  FileText,
  Handshake,
  Hourglass,
  MapPin,
  Palette,
  PenLine,
  PenTool,
  Phone,
  Search,
  Sparkles,
  Target,
  User,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { AGENTS } from "@/lib/agents";
import type { AgentRole, ExecutionMode, HumanKind, ProjectHealth, Task } from "@/lib/types";

// ---------------------------------------------------------------------------
// Motion language

export const spring = { type: "spring", stiffness: 420, damping: 36, mass: 0.8 } as const;
export const softSpring = { type: "spring", stiffness: 240, damping: 30 } as const;
export const easeOut = [0.22, 1, 0.36, 1] as const;

/** Staggered entrance: ~80ms per step, all done in < 1s. */
export const enter = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, transition: { delay: 0.06 + i * 0.08, duration: 0.5, ease: easeOut } }),
};

// ---------------------------------------------------------------------------
// Semantic visuals

export const AGENT_ICON: Record<AgentRole, LucideIcon> = {
  research: Search,
  coding: Code2,
  design: PenTool,
  content: FileText,
  operations: Workflow,
  analyst: BarChart3,
};

export const KIND_ICON: Record<HumanKind, LucideIcon> = {
  call: Phone,
  meeting: Users,
  onsite: MapPin,
  decision: Target,
  creative: Palette,
  relationship: Handshake,
  signature: PenLine,
  review: Eye,
  generic: User,
};

export function humanIcon(t: Task): LucideIcon {
  if (t.humanKind === "decision" && t.agent === "design") return Palette;
  return KIND_ICON[t.humanKind ?? "generic"];
}

export const MODE_META: Record<ExecutionMode, { label: string; icon: LucideIcon; tone: string; dot: string }> = {
  YOU: { label: "YOU", icon: User, tone: "text-human bg-human-soft", dot: "bg-human" },
  AI: { label: "AI", icon: Sparkles, tone: "text-ai bg-ai-soft", dot: "bg-ai" },
  AI_YOU: { label: "AI + YOU", icon: Handshake, tone: "text-ink bg-card-2", dot: "bg-linear-to-r from-ai to-human" },
  WAITING: { label: "WAITING", icon: Hourglass, tone: "text-ink-2 bg-card-2", dot: "bg-idle" },
};

export const HEALTH_META: Record<ProjectHealth, { label: string; color: string }> = {
  on_track: { label: "On track", color: "var(--ok)" },
  at_risk: { label: "At risk", color: "var(--warn)" },
  attention: { label: "Needs attention", color: "var(--bad)" },
  idle: { label: "Idle", color: "var(--idle)" },
};

// Tag colours echo the reference: pink/violet, teal, coral, green — muted.
const TAG_TONES = [
  "text-[#e58ad9] bg-[#e58ad9]/12",
  "text-[#4fc3c9] bg-[#4fc3c9]/12",
  "text-[#ff8a7a] bg-[#ff8a7a]/12",
  "text-[#7fd48a] bg-[#7fd48a]/12",
  "text-[#9fa8ff] bg-[#9fa8ff]/12",
];
export function tagTone(tag: string): string {
  let h = 0;
  for (const c of tag) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return TAG_TONES[h % TAG_TONES.length];
}

// ---------------------------------------------------------------------------
// Primitives

export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  const text = typeof children === "string" ? children : "";
  return (
    <span className={clsx("inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium", text ? tagTone(text) : "bg-card-2 text-ink-2", className)}>
      {children}
    </span>
  );
}

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase", className)}>
      {children}
    </span>
  );
}

export function ModeBadge({ mode, only = false }: { mode: ExecutionMode; only?: boolean }) {
  const m = MODE_META[mode];
  const Icon = m.icon;
  return (
    <Chip className={m.tone}>
      <Icon size={12} strokeWidth={2.4} />
      {only && mode === "YOU" ? "Only you" : m.label}
    </Chip>
  );
}

export function AgentAvatar({ role, size = 28, active = false }: { role: AgentRole; size?: number; active?: boolean }) {
  const Icon = AGENT_ICON[role];
  return (
    <span
      title={AGENTS[role].name}
      className={clsx(
        "relative inline-grid shrink-0 place-items-center rounded-full border border-line-2 bg-card-2 text-ai",
        active && "ring-2 ring-ai/35",
      )}
      style={{ width: size, height: size }}
    >
      <Icon size={size * 0.45} strokeWidth={2.2} />
      {active && <span className="pulse-dot absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-ok ring-2 ring-card" />}
    </span>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "soft" | "human" | "ai" | "inverse";
  size?: "sm" | "md" | "lg";
};

/** Tactile button: slight press, tiny lift on hover. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "soft", size = "md", className, children, ...rest },
  ref,
) {
  const variants = {
    primary: "bg-primary text-primary-ink hover:brightness-110",
    ghost: "text-ink-2 hover:text-ink hover:bg-card-2",
    soft: "bg-card-2 text-ink hover:bg-[color-mix(in_srgb,var(--card-2)_80%,var(--text)_8%)]",
    human: "bg-human text-[#1b1406] hover:brightness-105",
    ai: "bg-ai text-white hover:brightness-110",
    inverse: "bg-hero-ink text-hero hover:brightness-95",
  };
  const sizes = { sm: "h-8 px-3 text-[12.5px] gap-1.5", md: "h-10 px-4 text-[13.5px] gap-2", lg: "h-12 px-6 text-[15px] gap-2" };
  return (
    <motion.button
      ref={ref}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97, y: 0 }}
      transition={spring}
      className={clsx(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-semibold transition-[background-color,filter,color] disabled:pointer-events-none disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ai",
        variants[variant],
        sizes[size],
        className,
      )}
      {...(rest as React.ComponentProps<typeof motion.button>)}
    >
      {children}
    </motion.button>
  );
});

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={clsx("relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300", on ? "bg-ai" : "bg-card-2 ring-1 ring-line-2")}
    >
      <motion.span
        layout
        transition={spring}
        className="absolute top-1 h-4 w-4 rounded-full bg-white shadow"
        style={{ left: on ? 24 : 4 }}
      />
    </button>
  );
}

/** Numbers animate only when they change (and on first appearance). */
export function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  className,
  duration = 1.1,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.textContent = format(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration,
      ease: easeOut,
      onUpdate: (v) => (el.textContent = format(v)),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, format, duration, reduce]);
  return <span ref={ref} className={clsx("tabular", className)}>{format(prev.current)}</span>;
}

/** Progress track; while `active`, a soft light travels along it (AI working). */
export function ProgressLine({ value, active = false, tone = "ai", className }: { value: number; active?: boolean; tone?: "ai" | "human" | "ok"; className?: string }) {
  const color = tone === "ai" ? "var(--ai)" : tone === "human" ? "var(--human)" : "var(--ok)";
  return (
    <div className={clsx("relative h-1.5 overflow-hidden rounded-full bg-card-2", className)}>
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ background: color }}
        initial={false}
        animate={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
        transition={{ duration: 0.9, ease: easeOut }}
      >
        {active && <div className="activity-light opacity-70" />}
      </motion.div>
    </div>
  );
}

export function HealthDot({ health, changedAt, now, size = 10 }: { health: ProjectHealth; changedAt: number | null; now: number; size?: number }) {
  const color = HEALTH_META[health].color;
  const recent = changedAt !== null && now - changedAt < 6000;
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {recent && <span key={changedAt} className="signal-ring absolute inset-0 rounded-full" style={{ background: color }} />}
      <motion.span
        className="absolute inset-0 rounded-full"
        initial={false}
        animate={{ backgroundColor: color }}
        transition={{ duration: 1.2, ease: easeOut }}
      />
    </span>
  );
}

/** Text that morphs (slide + fade) when it changes — used for status transitions. */
export function Morph({ value, className }: { value: string; className?: string }) {
  return (
    <span className={clsx("relative inline-flex overflow-hidden", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.32, ease: easeOut }}
          className="inline-block whitespace-nowrap"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Check mark that draws itself — the "something just got done" moment. */
export function CheckDraw({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <motion.svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} initial="hidden" animate="show">
      <motion.circle
        cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"
        variants={{ hidden: { pathLength: 0, opacity: 0 }, show: { pathLength: 1, opacity: 1, transition: { duration: 0.45, ease: easeOut } } }}
      />
      <motion.path
        d="M7.5 12.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        variants={{ hidden: { pathLength: 0 }, show: { pathLength: 1, transition: { delay: 0.3, duration: 0.35, ease: easeOut } } }}
      />
    </motion.svg>
  );
}

/** Cursor-aware depth: max ~3px of travel. Felt, not noticed. */
export function useMagnetic<T extends HTMLElement>(strength = 3) {
  const ref = useRef<T>(null);
  const reduce = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 200, damping: 20 });
  const y = useSpring(my, { stiffness: 200, damping: 20 });
  const onMouseMove = (e: React.MouseEvent) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width - 0.5) * 2 * strength);
    my.set(((e.clientY - r.top) / r.height - 0.5) * 2 * strength);
  };
  const onMouseLeave = () => {
    mx.set(0);
    my.set(0);
  };
  return { ref, style: { x, y }, onMouseMove, onMouseLeave };
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-md border border-line-2 bg-card-2 px-1 font-sans text-[10.5px] font-semibold text-ink-2">{children}</kbd>;
}

export function SectionTitle({ dot, children, right, count }: { dot?: string; children: React.ReactNode; right?: React.ReactNode; count?: number }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-ink">
        {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
        {children}
        {count !== undefined && <span className="tabular text-ink-3">{count}</span>}
      </h2>
      {right}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-dashed border-line-2 px-5 py-6 text-center"
    >
      <div className="text-[11px] font-bold tracking-[0.14em] text-ink-2 uppercase">{title}</div>
      <div className="mt-1 text-[13px] text-ink-3">{body}</div>
    </motion.div>
  );
}

/** Live "time since/until" that doesn't jitter. */
export function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(iv);
  }, [ms]);
}
