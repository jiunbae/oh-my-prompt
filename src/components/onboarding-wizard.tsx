"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogTitle } from "@/components/ui/dialog";

export type OnboardingStepValue = "welcome" | "install_hook" | "create_team" | "explore" | "completed";

interface OnboardingWizardProps {
  initialStep: OnboardingStepValue;
  onComplete: () => void;
  onDismiss: () => void;
}

const STEPS: { id: OnboardingStepValue; label: string; number: number }[] = [
  { id: "welcome", label: "Welcome", number: 1 },
  { id: "install_hook", label: "Install", number: 2 },
  { id: "create_team", label: "Team", number: 3 },
  { id: "explore", label: "Explore", number: 4 },
];

const STEP_ORDER: OnboardingStepValue[] = ["welcome", "install_hook", "create_team", "explore"];
const SETUP_COMMAND = "npm install -g oh-my-prompt && omp setup";

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
      type="button"
      onClick={handleCopy}
      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors motion-reduce:transition-none"
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

function ConfettiAnimation() {
  // Generate randomized particles once, in a lazy state initializer, so
  // Math.random() is not called during render (react-hooks/purity).
  const [particles] = useState(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 0.5}s`,
      duration: `${1 + Math.random() * 1.5}s`,
      color: ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-primary"][
        Math.floor(Math.random() * 6)
      ],
    }))
  );

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className={`absolute top-0 w-2 h-2 rounded-sm ${p.color} animate-confetti-fall motion-reduce:hidden`}
          style={{
            left: p.left,
            animationDelay: p.delay,
            animationDuration: p.duration,
          }}
        />
      ))}
    </div>
  );
}

export default function OnboardingWizard({ initialStep, onComplete, onDismiss }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStepValue>(initialStep);
  const [animating, setAnimating] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [testConnectionStatus, setTestConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const completionHandledRef = useRef(false);

  const currentStepIndex = STEP_ORDER.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / STEP_ORDER.length) * 100;

  const persistStep = useCallback(async (step: OnboardingStepValue) => {
    try {
      await fetch("/api/onboarding/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step }),
      });
    } catch {
      // Silently fail — onboarding will resume from local state
    }
  }, []);

  const goToStep = useCallback(
    async (step: OnboardingStepValue) => {
      if (step === currentStep) return;
      setAnimating(true);
      setTimeout(() => {
        setCurrentStep(step);
        setAnimating(false);
      }, 200);
      await persistStep(step);
    },
    [currentStep, persistStep]
  );

  const handleNext = useCallback(async () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEP_ORDER.length) {
      await goToStep(STEP_ORDER[nextIndex]);
    }
  }, [currentStepIndex, goToStep]);

  const handleBack = useCallback(async () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      await goToStep(STEP_ORDER[prevIndex]);
    }
  }, [currentStepIndex, goToStep]);

  const finishOnboarding = useCallback(async () => {
    clearTimeout(completionTimerRef.current);
    completionHandledRef.current = false;
    setShowCelebration(true);
    try {
      await fetch("/api/onboarding/complete", { method: "POST" });
    } catch {
      // Silently fail
    }
    if (completionHandledRef.current) return;
    completionTimerRef.current = setTimeout(() => {
      if (completionHandledRef.current) return;
      completionHandledRef.current = true;
      setShowCelebration(false);
      onComplete();
    }, 2500);
  }, [onComplete]);

  const closeCelebration = useCallback(() => {
    if (completionHandledRef.current) return;
    completionHandledRef.current = true;
    clearTimeout(completionTimerRef.current);
    setShowCelebration(false);
    onComplete();
  }, [onComplete]);

  const createTeam = useCallback(async () => {
    if (!teamName.trim()) return;
    setCreatingTeam(true);
    setTeamError(null);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName.trim() }),
      });
      if (res.ok) {
        setTeamName("");
        await handleNext();
      } else {
        const data = await res.json().catch(() => ({}));
        setTeamError(data.error || "Failed to create team");
      }
    } catch {
      setTeamError("Failed to create team");
    } finally {
      setCreatingTeam(false);
    }
  }, [teamName, handleNext]);

  const testConnection = useCallback(async () => {
    setTestConnectionStatus("testing");
    setConnectionError(null);

    try {
      const healthResponse = await fetch("/api/health", { cache: "no-store" });
      const health = (await healthResponse.json().catch(() => null)) as { ok?: boolean } | null;
      if (!healthResponse.ok || health?.ok !== true) {
        throw new Error("The server is unavailable. Check your deployment and retry.");
      }

      const sessionResponse = await fetch("/api/auth/me", { cache: "no-store" });
      if (!sessionResponse.ok) {
        if (sessionResponse.status === 401) {
          throw new Error("Your login session has expired. Sign in again, then retry.");
        }
        throw new Error("Your account connection could not be verified. Please retry.");
      }

      const session = (await sessionResponse.json().catch(() => null)) as {
        user?: { id?: string; email?: string };
      } | null;
      if (!session?.user?.id || !session.user.email) {
        throw new Error("The server returned an invalid account response. Please retry.");
      }

      setTestConnectionStatus("success");
    } catch (error) {
      setTestConnectionStatus("error");
      setConnectionError(
        error instanceof Error
          ? error.message
          : "The connection could not be verified. Please retry.",
      );
    }
  }, []);

  useEffect(() => {
    return () => clearTimeout(completionTimerRef.current);
  }, []);

  if (showCelebration) {
    return (
      <Dialog
        open
        onClose={closeCelebration}
        className="relative max-w-md p-8 text-center"
      >
        <ConfettiAnimation />
        <div className="relative z-10">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-chart-2/10 text-chart-2">
            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <DialogTitle className="text-xl">You&apos;re all set!</DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Welcome to oh-my-prompt. Start capturing and analyzing your prompts.
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onDismiss} className="max-w-lg p-0">
        <DialogTitle className="sr-only">
          Onboarding: {STEPS[currentStepIndex]?.label ?? "Setup"}
        </DialogTitle>
        {/* Progress bar */}
        <div
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="h-1 bg-secondary"
        >
          <div
            className="h-full bg-gradient-to-r from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)] transition-all duration-500 motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 px-6 pt-4">
          {STEPS.map((step, i) => {
            const isActive = step.id === currentStep;
            const isPast = i < currentStepIndex;
            return (
              <div key={step.id} className="flex items-center gap-2">
                <div
                  aria-current={isActive ? "step" : undefined}
                  className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-medium transition-colors motion-reduce:transition-none ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isPast
                        ? "bg-chart-2/20 text-chart-2"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {isPast ? (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    step.number
                  )}
                </div>
                <span
                  className={`hidden text-xs font-medium sm:inline ${
                    isActive ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
                {i < STEPS.length - 1 && (
                  <div className={`w-4 h-px ${isPast ? "bg-chart-2/40" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className={`p-6 transition-opacity duration-200 motion-reduce:transition-none ${animating ? "opacity-0 motion-reduce:opacity-100" : "opacity-100"}`}>
          {/* Step 1: Welcome */}
          {currentStep === "welcome" && (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-foreground">
                Welcome to oh-my-prompt
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your prompt analytics platform. Let&apos;s get you set up in just a few steps.
              </p>
              <div className="pt-2">
                <Button onClick={handleNext} size="lg">
                  Get Started
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Install Hook */}
          {currentStep === "install_hook" && (
            <div className="space-y-4">
              <div className="text-center">
                <h2 className="text-lg font-semibold text-foreground">Install the CLI Hook</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Capture your prompts automatically from Claude Code, Codex, and more.
                </p>
              </div>

              <div className="space-y-3">
                <Card variant="outlined">
                  <CardContent className="p-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Install and configure
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <code className="min-w-0 flex-1 overflow-x-auto rounded bg-surface px-3 py-1.5 text-xs font-mono text-foreground">
                        {SETUP_COMMAND}
                      </code>
                      <CopyButton text={SETUP_COMMAND} />
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testConnection}
                  disabled={testConnectionStatus === "testing"}
                >
                  {testConnectionStatus === "testing" ? (
                    <>
                      <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Testing...
                    </>
                  ) : testConnectionStatus === "success" ? (
                    <>
                      <svg className="h-4 w-4 text-chart-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Connection looks good
                    </>
                  ) : testConnectionStatus === "error" ? (
                    <>
                      <svg className="h-4 w-4 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 4h.01M10.29 3.86l-8.82 15.28A2 2 0 003.2 22h17.6a2 2 0 001.73-2.86L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                      Retry connection
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Test connection
                    </>
                  )}
                </Button>
                <div aria-live="polite" aria-atomic="true">
                  {testConnectionStatus === "success" && (
                    <p className="text-xs text-chart-2">
                      Server and signed-in account verified.
                    </p>
                  )}
                  {testConnectionStatus === "error" && connectionError && (
                    <p role="alert" className="text-xs text-destructive">
                      {connectionError}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                  <Button variant="ghost" size="sm" onClick={handleBack}>
                    Back
                  </Button>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    <Button variant="ghost" size="sm" onClick={handleNext}>
                      I already have hooks installed
                    </Button>
                    <Button size="sm" onClick={handleNext}>
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Create Team */}
          {currentStep === "create_team" && (
            <div className="space-y-4">
              <div className="text-center">
                <h2 className="text-lg font-semibold text-foreground">Create a Team (Optional)</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Teams let you share prompts and collaborate with others.
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <label htmlFor="onboarding-team-name" className="text-sm font-medium text-secondary-foreground">
                    Team Name
                  </label>
                  <Input
                    id="onboarding-team-name"
                    name="teamName"
                    type="text"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="My Team"
                    maxLength={255}
                  />
                </div>
                {teamError && (
                  <div role="alert" className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                    {teamError}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button variant="ghost" size="sm" onClick={handleNext}>
                    Skip for now
                  </Button>
                  <Button
                    size="sm"
                    onClick={createTeam}
                    disabled={creatingTeam || !teamName.trim()}
                  >
                    {creatingTeam ? "Creating..." : "Create Team"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Explore */}
          {currentStep === "explore" && (
            <div className="space-y-4">
              <div className="text-center">
                <h2 className="text-lg font-semibold text-foreground">Explore Your Dashboard</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Here&apos;s what you can do with oh-my-prompt.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Card variant="outlined" className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-3 text-center space-y-2">
                    <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-chart-1/10 text-chart-1">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-foreground">Sessions</p>
                    <p className="text-xs text-muted-foreground">Browse captured sessions</p>
                  </CardContent>
                </Card>

                <Card variant="outlined" className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-3 text-center space-y-2">
                    <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-chart-2/10 text-chart-2">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-foreground">Analytics</p>
                    <p className="text-xs text-muted-foreground">Token usage & trends</p>
                  </CardContent>
                </Card>

                <Card variant="outlined" className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-3 text-center space-y-2">
                    <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-chart-3/10 text-chart-3">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-foreground">Search</p>
                    <p className="text-xs text-muted-foreground">Find past prompts</p>
                  </CardContent>
                </Card>

                <Card variant="outlined" className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-3 text-center space-y-2">
                    <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-chart-4/10 text-chart-4">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-foreground">Settings</p>
                    <p className="text-xs text-muted-foreground">Configure preferences</p>
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
                <Button size="sm" onClick={finishOnboarding}>
                  Start using oh-my-prompt
                </Button>
              </div>
            </div>
          )}

          {/* Dismiss */}
          <div className="text-center pt-2">
            <button
              onClick={onDismiss}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Dismiss and resume later
            </button>
          </div>
        </div>
    </Dialog>
  );
}
