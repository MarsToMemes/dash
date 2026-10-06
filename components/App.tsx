"use client";

import clsx from "clsx";
import { BarChart3, CalendarDays, Command, Compass, Cpu, FolderKanban, House, Moon, Plus, Search, Sun } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from "motion/react";
import { useEffect } from "react";
import { AddTask } from "./overlays/AddTask";
import { CommandPalette } from "./overlays/CommandPalette";
import { DelegationPrompt } from "./overlays/DelegationPrompt";
import { FocusMode } from "./overlays/FocusMode";
import { TaskDrawer } from "./overlays/TaskDrawer";
import { useWorkspace, WorkspaceProvider, type View } from "./store";
import { Button, easeOut, Kbd, spring, Toggle } from "./ui";
import { Home } from "./views/Home";
import { Insights } from "./views/Insights";
import { Projects } from "./views/Projects";
import { Queue } from "./views/Queue";
import { Strategy } from "./views/Strategy";
import { Today } from "./views/Today";

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <WorkspaceProvider>
        <Shell />
      </WorkspaceProvider>
    </MotionConfig>
  );
}

const NAV: { id: View; label: string; icon: typeof House }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "strategy", label: "Strategy", icon: Compass },
  { id: "queue", label: "AI Queue", icon: Cpu },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "insights", label: "Insights", icon: BarChart3 },
];

function Shell() {
  const { state, view, setView, paletteOpen, setPaletteOpen, focusId, setAddOpen, error } = useWorkspace();
  const receded = paletteOpen || focusId !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
      const typing = e.target instanceof HTMLElement && (e.target.closest("input,textarea,[contenteditable]") !== null);
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "n" && !paletteOpen) {
        e.preventDefault();
        setAddOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen, setAddOpen]);

  return (
    <div className="min-h-dvh p-0 lg:p-3">
      <motion.div
        animate={{ scale: receded ? 0.985 : 1, opacity: receded ? 0.55 : 1 }}
        transition={{ duration: 0.4, ease: easeOut }}
        className="relative mx-auto flex min-h-[calc(100dvh-1.5rem)] max-w-[1680px] overflow-clip bg-app backdrop-blur-xl lg:rounded-[30px] lg:border lg:border-line"
      >
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="relative min-w-0 flex-1 px-4 pb-24 sm:px-6 lg:px-8 lg:pb-10">
            {!state ? (
              <Boot error={error} />
            ) : (
              <LayoutGroup>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={view}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.28, ease: easeOut }}
                  >
                    {view === "home" && <Home />}
                    {view === "today" && <Today />}
                    {view === "strategy" && <Strategy />}
                    {view === "queue" && <Queue />}
                    {view === "projects" && <Projects />}
                    {view === "insights" && <Insights />}
                  </motion.div>
                </AnimatePresence>
              </LayoutGroup>
            )}
          </main>
        </div>
        <MobileNav view={view} setView={setView} />
      </motion.div>
      {state && (
        <>
          <TaskDrawer />
          <AddTask />
          <CommandPalette />
          <FocusMode />
          <DelegationPrompt />
        </>
      )}
      {error && state && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-bad px-4 py-2 text-[12.5px] font-semibold text-white shadow-lg">
          {error} — retrying
        </div>
      )}
    </div>
  );
}

function Boot({ error }: { error: string | null }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-1.5 w-40 overflow-hidden rounded-full bg-card-2">
          <div className="relative h-full w-full">
            <div className="activity-light" />
          </div>
        </div>
        <div className="shimmer-text text-[13px] font-medium">{error ? `Can’t reach the workspace (${error})` : "Waking up your workspace…"}</div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-ink text-app">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="11" cy="11" r="7.2" stroke="currentColor" strokeWidth="3" />
        <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function Sidebar() {
  const { view, setView, theme, toggleTheme, state } = useWorkspace();
  const waitingForYou = state?.jobs.filter((j) => j.status === "WAITING_FOR_APPROVAL").length ?? 0;
  return (
    <aside className="sticky top-0 hidden h-dvh w-[84px] shrink-0 flex-col items-center border-r border-line py-6 md:flex lg:h-[calc(100dvh-1.5rem)]">
      <Logo />
      <nav className="mt-14 flex flex-col gap-2" aria-label="Main">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = view === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              aria-label={n.label}
              aria-current={active ? "page" : undefined}
              className={clsx("group relative grid h-11 w-11 place-items-center rounded-2xl transition-colors", active ? "text-ink" : "text-ink-3 hover:text-ink")}
            >
              {active && <motion.span layoutId="nav-pill" transition={spring} className="absolute inset-0 rounded-2xl bg-card-2 ring-1 ring-line-2" />}
              <Icon size={19} strokeWidth={2} className="relative" />
              {n.id === "queue" && waitingForYou > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-human ring-2 ring-app" />
              )}
              <span className="pointer-events-none absolute left-14 z-10 rounded-lg bg-ink px-2 py-1 text-[11.5px] font-semibold whitespace-nowrap text-app opacity-0 transition-opacity group-hover:opacity-100">
                {n.label}
              </span>
            </button>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-1 rounded-full bg-card p-1.5 ring-1 ring-line">
        {(["dark", "light"] as const).map((t) => (
          <button
            key={t}
            onClick={() => theme !== t && toggleTheme()}
            aria-label={`${t} theme`}
            className={clsx("relative grid h-9 w-9 place-items-center rounded-full transition-colors", theme === t ? "text-white" : "text-ink-3 hover:text-ink")}
          >
            {theme === t && <motion.span layoutId="theme-pill" transition={spring} className="absolute inset-0 rounded-full bg-ai" />}
            {t === "dark" ? <Moon size={16} className="relative" /> : <Sun size={16} className="relative" />}
          </button>
        ))}
      </div>
    </aside>
  );
}

function MobileNav({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <nav className="fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-full border border-line bg-panel p-1.5 backdrop-blur-xl md:hidden" aria-label="Main">
      {NAV.map((n) => {
        const Icon = n.icon;
        const active = view === n.id;
        return (
          <button key={n.id} onClick={() => setView(n.id)} aria-label={n.label} className={clsx("relative grid h-11 w-11 place-items-center rounded-full", active ? "text-ink" : "text-ink-3")}>
            {active && <motion.span layoutId="nav-pill-m" transition={spring} className="absolute inset-0 rounded-full bg-card-2" />}
            <Icon size={19} className="relative" />
          </button>
        );
      })}
    </nav>
  );
}

function Topbar() {
  const { state, setPaletteOpen, setAddOpen, act, thinking } = useWorkspace();
  const running = state?.jobs.filter((j) => j.status === "RUNNING").length ?? 0;
  const analyzing = thinking !== null;
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-app/80 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="md:hidden">
        <Logo />
      </div>
      <button
        onClick={() => setPaletteOpen(true)}
        className="group flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full bg-card px-4 text-left ring-1 ring-line transition-shadow hover:ring-line-2 md:max-w-[460px]"
      >
        <Search size={18} className="shrink-0 text-ai" />
        <span className="truncate text-[14px] font-semibold text-ink">What should I do?</span>
        <span className="ml-auto hidden items-center gap-1 sm:flex">
          <Kbd>
            <Command size={10} />
          </Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-3">
        <AiStatus analyzing={analyzing} running={running} />
        {state && (
          <label className="hidden items-center gap-2.5 rounded-full bg-card py-1.5 pl-4 pr-1.5 ring-1 ring-line lg:flex">
            <span className="text-[11px] font-bold tracking-[0.12em] text-ink-2 uppercase">Autopilot</span>
            <Toggle on={state.settings.autopilot} onChange={(on) => act({ type: "set_autopilot", on })} label="Autopilot" />
          </label>
        )}
        <Button variant="primary" size="lg" onClick={() => setAddOpen(true)} className="!h-12 !px-5">
          <Plus size={17} strokeWidth={2.6} />
          <span className="hidden sm:inline">Add Task</span>
        </Button>
        <div className="hidden items-center gap-2.5 rounded-full bg-card py-1.5 pl-1.5 pr-4 ring-1 ring-line xl:flex">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-linear-to-br from-human to-[#e06a3b] text-[13px] font-bold text-[#1b1406]">R</span>
          <span className="text-[13.5px] text-ink-2">
            Hello, <span className="font-semibold text-ink">{state?.settings.userName ?? "Rémi"}</span>
          </span>
        </div>
      </div>
    </header>
  );
}

function AiStatus({ analyzing, running }: { analyzing: boolean; running: number }) {
  const label = analyzing ? "AI analyzing" : running > 0 ? `${running} agent${running > 1 ? "s" : ""} working` : "AI ready";
  return (
    <div className="hidden h-12 items-center gap-2.5 rounded-full bg-card px-4 ring-1 ring-line sm:flex" aria-live="polite">
      <span className="relative grid h-2.5 w-2.5 place-items-center">
        <span className={clsx("absolute inset-0 rounded-full", analyzing ? "bg-ai pulse-dot" : running ? "bg-ok pulse-dot" : "bg-ok")} />
      </span>
      <span className={clsx("text-[11px] font-bold tracking-[0.12em] uppercase", analyzing ? "shimmer-text" : "text-ink-2")}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }} className="inline-block">
            {label}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}
