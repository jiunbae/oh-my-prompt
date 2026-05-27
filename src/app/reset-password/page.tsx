"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function ResetPasswordForm() {
  const tAuth = useTranslations("auth");
  const tAuthErrors = useTranslations("auth.errors");

  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <img
                src="/logo-dark.svg"
                alt="Oh My Prompt"
                className="h-10 w-auto dark:invert-0 invert"
              />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {tAuth("resetInvalidTitle")}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              {tAuth("resetInvalidMessage")}
            </p>
            <Link href="/login">
              <Button variant="outline" className="w-full">
                {tAuth("backToLogin")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <img
                src="/logo-dark.svg"
                alt="Oh My Prompt"
                className="h-10 w-auto dark:invert-0 invert"
              />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {tAuth("resetSuccessTitle")}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              {tAuth("resetSuccessMessage")}
            </p>
            <Link href="/login">
              <Button className="w-full">{tAuth("goToLogin")}</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(tAuthErrors("passwordsDontMatch"));
      return;
    }

    if (password.length < 8) {
      setError(tAuthErrors("passwordTooShort"));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(true);
      } else {
        setError(data.error || tAuthErrors("resetFailed"));
      }
    } catch {
      setError(tAuthErrors("generic"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <img
              src="/logo-dark.svg"
              alt="Oh My Prompt"
              className="h-10 w-auto dark:invert-0 invert"
            />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {tAuth("resetSubtitle")}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                type="password"
                placeholder={tAuth("newPassword")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div>
              <Input
                type="password"
                placeholder={tAuth("confirmNewPassword")}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-destructive text-sm text-center">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !password || !confirmPassword}
            >
              {loading ? "..." : tAuth("resetButton")}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-primary"
            >
              {tAuth("backToLogin")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
