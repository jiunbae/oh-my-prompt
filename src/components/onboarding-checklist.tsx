"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface OnboardingChecklistProps {
  hasAnySessions: boolean;
}

const STORAGE_KEY = "omp-onboarding";
const DISMISSED_KEY = "omp-onboarding-dismissed";

interface OnboardingState {
  completedSteps: number[];
}

function getStoredState(): OnboardingState {
  if (typeof window === "undefined") return { completedSteps: [] };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : { completedSteps: [] };
  } catch {
    return { completedSteps: [] };
  }
}

function saveState(state: OnboardingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable
  }
}

function isDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    localStorage.setItem(DISMISSED_KEY, "true");
  } catch {
    // localStorage may be unavailable
  }
}

interface Step {
  id: number;
  title: string;
  description: string;
  copyText?: string;
}

const STEPS: Step[] = [
  {
    id: 1,
    title: "Install the CLI",
    description: "Install Oh My Prompt globally via npm to start capturing your prompts.",
    copyText: "npm install -g oh-my-prompt",
  },
  {
    id: 2,
    title: "Configure your token",
    description: "Run the setup wizard to connect your CLI to your account.",
    copyText: "omp setup",
  },
  {
    id: 3,
    title: "Start coding",
    description: "Use Claude Code as normal. Prompts are captured automatically via the hooks configured by the CLI.",
  },
  {
    id: 4,
    title: "Explore your dashboard",
    description: "Once prompts sync, your dashboard will light up with activity charts, quality scores, and AI insights.",
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {copied ? (
        <>
          <svg className="h-3 w-3 text-chart-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function firstIncompleteStepId(state: OnboardingState): number | null {
  const step = STEPS.find((s) => !state.completedSteps.includes(s.id));
  return step ? step.id : null;
}

export function OnboardingChecklist({ hasAnySessions }: OnboardingChecklistProps) {
  // Initialise from persisted state during render via lazy initialisers instead
  // of syncing through effects — this avoids setState-in-effect cascades. The
  // `mounted` guard below still defers the first content paint so the SSR and
  // client markup match (localStorage is client-only).
  const [state, setState] = useState<OnboardingState>(getStoredState);
  const [dismissed, setDismissed] = useState<boolean>(isDismissed);
  const [expandedStep, setExpandedStep] = useState<number | null>(() =>
    firstIncompleteStepId(getStoredState())
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // One-shot mount guard: nothing is rendered until this flips, which keeps
    // SSR/CSR output identical. Not a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const toggleStep = useCallback((stepId: number) => {
    setState((prev) => {
      const completed = prev.completedSteps.includes(stepId)
        ? prev.completedSteps.filter((id) => id !== stepId)
        : [...prev.completedSteps, stepId];
      const next = { completedSteps: completed };
      saveState(next);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((stepId: number) => {
    setExpandedStep((prev) => (prev === stepId ? null : stepId));
  }, []);

  const handleDismiss = useCallback(() => {
    dismiss();
    setDismissed(true);
  }, []);

  // Don't render if: not mounted, has sessions, or dismissed
  if (!mounted || hasAnySessions || dismissed) {
    return null;
  }

  const completedCount = state.completedSteps.length;
  const totalSteps = STEPS.length;
  const progressPct = (completedCount / totalSteps) * 100;

  return (
    <Card className="overflow-hidden">
      {/* Gradient bar at top */}
      <div
        className="h-1"
        style={{
          background: "linear-gradient(to right, var(--accent-gradient-from, var(--color-primary)), var(--accent-gradient-to, var(--color-chart-5)))",
        }}
      />
      <CardContent className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Get started with Oh My Prompt
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Complete these steps to start capturing your prompts
            </p>
          </div>
          <span className="text-xs font-medium text-muted-foreground shrink-0">
            {completedCount}/{totalSteps}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Steps */}
        <div className="space-y-1">
          {STEPS.map((step) => {
            const isCompleted = state.completedSteps.includes(step.id);
            const isExpanded = expandedStep === step.id;

            return (
              <div
                key={step.id}
                className="rounded-lg border border-border/50 overflow-hidden"
              >
                {/* Step header */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpand(step.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleExpand(step.id);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors cursor-pointer"
                >
                  {/* Checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStep(step.id);
                    }}
                    className={`shrink-0 flex items-center justify-center h-5 w-5 rounded-full border-2 transition-colors ${
                      isCompleted
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/40 hover:border-primary"
                    }`}
                  >
                    {isCompleted && (
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>

                  <span
                    className={`flex-1 text-sm font-medium ${
                      isCompleted ? "text-muted-foreground line-through" : "text-foreground"
                    }`}
                  >
                    {step.title}
                  </span>

                  {/* Chevron */}
                  <svg
                    className={`h-4 w-4 text-muted-foreground transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Step content */}
                {isExpanded && (
                  <div className="px-4 pb-4 pl-12">
                    <p className="text-sm text-muted-foreground mb-2">
                      {step.description}
                    </p>
                    {step.copyText && (
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded bg-surface px-3 py-1.5 text-xs font-mono text-foreground">
                          {step.copyText}
                        </code>
                        <CopyButton text={step.copyText} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Dismiss link */}
        <div className="text-center pt-1">
          <button
            onClick={handleDismiss}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
