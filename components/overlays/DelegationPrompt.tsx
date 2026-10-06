"use client";

import { Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useWorkspace } from "../store";
import { Button } from "../ui";

/** "You spent 35 minutes doing something I could have done in 8 minutes." */
export function DelegationPrompt() {
  const { state, act } = useWorkspace();
  const p = state?.settings.delegationPrompt;
  return (
    <AnimatePresence>
      {p && (
        <motion.div
          role="alertdialog"
          aria-label="Delegate next time?"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="fixed right-4 bottom-24 z-50 w-[min(380px,calc(100vw-2rem))] rounded-[24px] bg-app p-5 shadow-[var(--shadow-lift)] ring-1 ring-line-2 backdrop-blur-2xl md:bottom-6"
        >
          <div className="flex items-center gap-2 text-[10.5px] font-bold tracking-[0.14em] text-ai uppercase">
            <Sparkles size={13} /> Delegate next time?
          </div>
          <p className="mt-2 text-[14px] leading-relaxed">
            You spent <b>{p.spentMinutes} min</b> on “{p.title}”. I could have done it in <b>{p.aiMinutes} min</b>.
          </p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="ai" onClick={() => act({ type: "delegation_answer", yes: true })}>
              Yes, delegate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act({ type: "delegation_answer", yes: false })}>
              Keep human
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
