"use client";

import clsx from "clsx";
import { BarChart3, CalendarCheck, CalendarDays, Compass, Cpu, FolderKanban, House, Moon, Plus, RotateCcw, Search, Sparkles, Target, Timer, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalize } from "@/lib/classifier";
import { isOpen } from "@/lib/planner";
import { useWorkspace } from "../store";
import { Kbd, MODE_META } from "../ui";

interface Item {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  run: () => void;
  group: "Ask" | "Actions" | "Go to" | "Tasks";
}

/** ⌘K — everything recedes, the command line becomes the focus. */
export function CommandPalette() {
  const { state, paletteOpen, setPaletteOpen, setView, setAddOpen, whatShouldIDo, act, toggleTheme, setDrawerId, setArbitrageMinutes } = useWorkspace();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (paletteOpen) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    } else {
      // The input lingers during the exit animation; don't let it swallow shortcuts.
      inputRef.current?.blur();
    }
  }, [paletteOpen]);

  const items = useMemo<Item[]>(() => {
    if (!state) return [];
    const close = () => setPaletteOpen(false);
    const base: Item[] = [
      { id: "ask", group: "Ask", label: "What should I do?", hint: "Re-plan everything", icon: Sparkles, run: () => { close(); setView("home"); void whatShouldIDo(); } },
      { id: "add", group: "Actions", label: "New task", hint: "N", icon: Plus, run: () => { close(); setAddOpen(true, q.length > 3 ? q : ""); } },
      { id: "autopilot", group: "Actions", label: state.settings.autopilot ? "Turn autopilot off" : "Turn autopilot on", icon: Zap, run: () => { close(); void act({ type: "set_autopilot", on: !state.settings.autopilot }); } },
      { id: "theme", group: "Actions", label: "Toggle theme", icon: Moon, run: () => { close(); toggleTheme(); } },
      { id: "reset", group: "Actions", label: "Reset demo workspace", icon: RotateCcw, run: () => { close(); void act({ type: "reset" }).then(() => whatShouldIDo({ quick: true })); } },
      { id: "home", group: "Go to", label: "Home", icon: House, run: () => { close(); setView("home"); } },
      { id: "today", group: "Go to", label: "Today — briefing & report", icon: CalendarDays, run: () => { close(); setView("today"); } },
      { id: "queue", group: "Go to", label: "AI Queue", icon: Cpu, run: () => { close(); setView("queue"); } },
      { id: "projects", group: "Go to", label: "Projects", icon: FolderKanban, run: () => { close(); setView("projects"); } },
      { id: "insights", group: "Go to", label: "Insights", icon: BarChart3, run: () => { close(); setView("insights"); } },
      { id: "strategy", group: "Go to", label: "Strategy — arbitrage, simulation, decisions", icon: Compass, run: () => { close(); setView("strategy"); } },
      { id: "plan90", group: "Ask", label: "I have 90 minutes — what’s the optimal plan?", icon: Timer, run: () => { close(); setArbitrageMinutes(90); setView("strategy"); } },
      { id: "simulate", group: "Ask", label: "Simulate my day", icon: CalendarCheck, run: () => { close(); setView("strategy"); } },
      {
        id: "leverage",
        group: "Actions",
        label: state.settings.maxLeverage ? "Turn maximum leverage off" : "Turn maximum leverage on",
        hint: "Minimize human busywork",
        icon: Zap,
        run: () => { close(); void act({ type: "set_max_leverage", on: !state.settings.maxLeverage }); },
      },
      ...(state.settings.focus
        ? [{ id: "unfocus", group: "Actions" as const, label: "End focus", icon: Target, run: () => { close(); void act({ type: "exit_focus" }); } }]
        : state.projects
            .filter((p) => !p.parkedUntil && state.tasks.some((t) => t.projectId === p.id && isOpen(t)))
            .map((p) => ({
              id: `focus-${p.id}`,
              group: "Actions" as const,
              label: `Focus ${p.name}`,
              hint: "2 days",
              icon: Target,
              run: () => { close(); void act({ type: "focus_project", projectId: p.id, days: 2 }); },
            }))),
    ];
    // "I have 45 minutes" / "j'ai 2h" → time arbitrage.
    const time = normalize(q).match(/(\d+(?:[.,]\d+)?)\s*(h|heures?|hours?|min|minutes?|mn)\b/);
    if (time) {
      const n = Number(time[1].replace(",", "."));
      const minutes = Math.round(/^h/.test(time[2]) ? n * 60 : n);
      if (minutes >= 10 && minutes <= 720) {
        base.unshift({ id: "plan-q", group: "Ask", label: `Plan my ${minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10}h` : `${minutes} min`}`, hint: "Time arbitrage", icon: Timer, run: () => { close(); setArbitrageMinutes(minutes); setView("strategy"); } });
      }
    }
    const tasks: Item[] = state.tasks
      .filter((t) => isOpen(t) && !t.isMission)
      .map((t) => ({
        id: t.id,
        group: "Tasks" as const,
        label: t.title,
        hint: MODE_META[t.keptHuman ? "YOU" : t.mode].label,
        icon: MODE_META[t.keptHuman ? "YOU" : t.mode].icon,
        run: () => { close(); setDrawerId(t.id); },
      }));
    const nq = normalize(q);
    const all = [...base, ...tasks];
    const order = ["Ask", "Actions", "Go to", "Tasks"];
    const sorted = (list: Item[]) => list.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    if (!nq) return sorted(all.filter((i) => i.group !== "Tasks").concat(tasks.slice(0, 5)));
    const hits = all.filter((i) => i.id === "plan-q" || normalize(i.label).includes(nq));
    // Anything typed can become a task.
    if (q.trim().length > 3) {
      hits.push({ id: "create", group: "Actions", label: `Create “${q.trim()}”`, hint: "Analyze & add", icon: Plus, run: () => { close(); setAddOpen(true, q.trim()); } });
    }
    return sorted(hits);
  }, [state, q, setPaletteOpen, setView, whatShouldIDo, setAddOpen, act, toggleTheme, setDrawerId, setArbitrageMinutes]);

  useEffect(() => setSel(0), [q]);

  const groups = ["Ask", "Actions", "Go to", "Tasks"] as const;

  return (
    <AnimatePresence>
      {paletteOpen && (
        <motion.div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-md" onClick={() => setPaletteOpen(false)} />
          <motion.div
            role="dialog"
            aria-label="Command palette"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative w-full max-w-[600px] overflow-hidden rounded-[26px] bg-app shadow-[var(--shadow-lift)] ring-1 ring-line-2 backdrop-blur-2xl"
            onKeyDown={(e) => {
              if (e.key === "Escape") setPaletteOpen(false);
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
            }}
          >
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <Search size={18} className="text-ai" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ask, search, or type a new task…"
                className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-3"
              />
              <Kbd>esc</Kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {items.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-ink-3">No match.</div>}
              {groups.map((g) => {
                const inGroup = items.filter((i) => i.group === g);
                if (!inGroup.length) return null;
                return (
                  <div key={g} className="mb-1">
                    <div className="px-3 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">{g}</div>
                    {inGroup.map((it) => {
                      const i = items.indexOf(it);
                      const active = i === sel;
                      const Icon = it.icon;
                      return (
                        <button
                          key={it.id}
                          onMouseMove={() => setSel(i)}
                          onClick={it.run}
                          className={clsx("relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px]", active ? "text-ink" : "text-ink-2")}
                        >
                          {active && <motion.span layoutId="palette-sel" transition={{ type: "spring", stiffness: 500, damping: 40 }} className="absolute inset-0 rounded-xl bg-card-2" />}
                          <Icon size={16} className={clsx("relative shrink-0", it.id === "ask" ? "text-ai" : "")} />
                          <span className="relative min-w-0 flex-1 truncate">{it.label}</span>
                          {it.hint && <span className="relative text-[11.5px] text-ink-3">{it.hint}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
