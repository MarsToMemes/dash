"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Action, WorkspaceState } from "@/lib/types";

export type View = "home" | "today" | "queue" | "projects" | "insights";

export const THINKING_STEPS = [
  "Analyzing your projects…",
  "Finding what can be delegated…",
  "Looking for blocked missions…",
  "Rebuilding today’s priorities…",
  "Preparing your next move…",
];

interface Ctx {
  state: WorkspaceState | null;
  error: string | null;
  /** Server-synchronised clock. */
  clock: () => number;
  act: (action: Action) => Promise<WorkspaceState | null>;
  view: View;
  setView: (v: View) => void;
  focusId: string | null;
  setFocusId: (id: string | null) => void;
  drawerId: string | null;
  setDrawerId: (id: string | null) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  addOpen: boolean;
  setAddOpen: (v: boolean, seed?: string) => void;
  addSeed: string;
  /** Non-null while the Chief of Staff is "thinking" (signature moment). */
  thinking: string | null;
  /** Timestamp of the last resolved analysis — drives the "one clear action" emphasis. */
  resolvedAt: number;
  whatShouldIDo: (opts?: { quick?: boolean }) => Promise<void>;
  theme: "dark" | "light";
  toggleTheme: () => void;
}

const WorkspaceCtx = createContext<Ctx | null>(null);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setViewRaw] = useState<View>("home");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addOpen, setAddOpenRaw] = useState(false);
  const [addSeed, setAddSeed] = useState("");
  const [thinking, setThinking] = useState<string | null>(null);
  const [resolvedAt, setResolvedAt] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const offset = useRef(0);
  const latest = useRef(0);
  const thinkingRef = useRef(false);
  const tz = useMemo(() => new Date().getTimezoneOffset(), []);

  const accept = useCallback((next: WorkspaceState) => {
    // Never let a slower poll overwrite a fresher action response.
    if (next.now < latest.current) return;
    latest.current = next.now;
    offset.current = next.now - Date.now();
    setState(next);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/state?tz=${tz}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      accept((await res.json()) as WorkspaceState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection lost");
    }
  }, [accept, tz]);

  const act = useCallback(
    async (action: Action) => {
      try {
        const res = await fetch(`/api/action?tz=${tz}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as WorkspaceState;
        accept(next);
        return next;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
        return null;
      }
    },
    [accept, tz],
  );

  // Poll: fast while agents work, slower when calm, paused when hidden.
  const busy = state?.jobs.some((j) => j.status === "RUNNING" || j.status === "QUEUED") ?? true;
  useEffect(() => {
    void refresh();
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, busy ? 1000 : 4000);
    return () => clearInterval(iv);
  }, [refresh, busy]);

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    if (t === "light" || t === "dark") setTheme(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("dash-theme", next);
      } catch {}
      return next;
    });
  }, []);

  const whatShouldIDo = useCallback(
    async (opts: { quick?: boolean } = {}) => {
      if (thinkingRef.current) return;
      thinkingRef.current = true;
      const pace = opts.quick ? 260 : 430;
      try {
        for (let i = 0; i < THINKING_STEPS.length; i++) {
          setThinking(THINKING_STEPS[i]);
          if (i === 3) await Promise.all([act({ type: "analyze" }), sleep(pace)]);
          else await sleep(pace);
        }
      } finally {
        setThinking(null);
        setResolvedAt(Date.now());
        thinkingRef.current = false;
      }
    },
    [act],
  );

  // The system wakes up: analyse once on open if the plan is stale.
  const autoRan = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state || autoRan.current) return;
    autoRan.current = true;
    const last = state.settings.lastAnalysisAt;
    if (!last || state.now - last > 30 * 60_000) {
      autoTimer.current = setTimeout(() => void whatShouldIDo({ quick: true }), 900);
    }
  }, [state, whatShouldIDo]);
  useEffect(() => () => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
  }, []);

  const setView = useCallback((v: View) => {
    setViewRaw(v);
    setDrawerId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const setAddOpen = useCallback((v: boolean, seed = "") => {
    setAddSeed(seed);
    setAddOpenRaw(v);
  }, []);

  const clock = useCallback(() => Date.now() + offset.current, []);

  const value: Ctx = {
    state,
    error,
    clock,
    act,
    view,
    setView,
    focusId,
    setFocusId,
    drawerId,
    setDrawerId,
    paletteOpen,
    setPaletteOpen,
    addOpen,
    setAddOpen,
    addSeed,
    thinking,
    resolvedAt,
    whatShouldIDo,
    theme,
    toggleTheme,
  };
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
}

/** Re-render on an interval with the server-synchronised time. */
export function useNow(intervalMs = 1000): number {
  const { clock } = useWorkspace();
  const [now, setNow] = useState(() => clock());
  useEffect(() => {
    const iv = setInterval(() => setNow(clock()), intervalMs);
    return () => clearInterval(iv);
  }, [clock, intervalMs]);
  return now;
}
