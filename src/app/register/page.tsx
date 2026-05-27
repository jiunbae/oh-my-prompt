"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");
  const tAuthErrors = useTranslations("auth.errors");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(false);

    // Client-side validation
    if (password !== confirmPassword) {
      setError(tAuthErrors("passwordsDontMatch"));
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError(tAuthErrors("passwordTooShort"));
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: name || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(true);
        setEmail("");
        setPassword("");
        setConfirmPassword("");
        setName("");
      } else {
        setError(data.error || tAuthErrors("registrationFailed"));
      }
    } catch {
      setError(tAuthErrors("generic"));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle>{tAuth("registerSuccessTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-muted-foreground mb-4">
              {tAuth("registerSuccessMessage")}
            </p>
            <Link href="/login">
              <Button className="w-full">{tAuth("goToLogin")}</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

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
            {tAuth("registerTitle")}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                type="email"
                placeholder={tAuth("email")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div>
              <Input
                type="text"
                placeholder={tAuth("nameOptional")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Input
                type="password"
                placeholder={tAuth("password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <Input
                type="password"
                placeholder={tAuth("confirmPassword")}
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
              disabled={loading || !email || !password || !confirmPassword}
            >
              {loading ? "..." : tAuth("register")}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {tAuth("alreadyHaveAccount")}{" "}
            <Link href="/login" className="text-primary hover:text-primary/80">
              {tCommon("signIn")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
