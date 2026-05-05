"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@/contexts/user-context";
import OnboardingWizard, { type OnboardingStepValue } from "@/components/onboarding-wizard";

interface OnboardingStatus {
  completed: boolean;
  step: string;
}

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: userLoading } = useUser();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/onboarding/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // Silently fail — don't block the app
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!userLoading) {
      fetchStatus();
    }
  }, [userLoading, fetchStatus]);

  const handleComplete = useCallback(() => {
    setStatus({ completed: true, step: "completed" });
    setDismissed(true);
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  const showWizard =
    !userLoading &&
    !loading &&
    user &&
    status &&
    !status.completed &&
    !dismissed;

  const initialStep: OnboardingStepValue =
    (status?.step as OnboardingStepValue) || "welcome";

  return (
    <>
      {children}
      {showWizard && (
        <OnboardingWizard
          initialStep={initialStep}
          onComplete={handleComplete}
          onDismiss={handleDismiss}
        />
      )}
    </>
  );
}
