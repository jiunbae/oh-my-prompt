"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");
  const tAuthErrors = useTranslations("auth.errors");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || tAuthErrors("invalidCredentials"));
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
            <Image
              src="/logo-dark.svg"
              alt="Oh My Prompt"
              width={160}
              height={40}
              className="h-10 w-auto dark:invert-0 invert"
            />
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            {tAuth("loginTitle")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tAuth("loginTagline")}
          </p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit}
            className="space-y-4"
            aria-busy={loading}
          >
            <div className="space-y-2">
              <label htmlFor="login-email" className="text-sm font-medium text-foreground">
                {tAuth("email")}
              </label>
              <Input
                id="login-email"
                name="email"
                type="email"
                placeholder={tAuth("email")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="login-password" className="text-sm font-medium text-foreground">
                {tAuth("password")}
              </label>
              <Input
                id="login-password"
                name="password"
                type="password"
                placeholder={tAuth("password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <p
                id="login-error"
                role="alert"
                aria-live="assertive"
                className="text-destructive text-sm text-center"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !email || !password}
            >
              {loading ? tCommon("submitting") : tCommon("signIn")}
            </Button>
          </form>
          <div className="mt-3 text-center">
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              {tAuth("forgotPassword")}
            </Link>
          </div>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {tAuth("noAccount")}{" "}
            <Link href="/register" className="text-primary hover:text-primary/80">
              {tAuth("register")}
            </Link>
          </div>
          {process.env.NEXT_PUBLIC_APP_VERSION && (
            <div className="mt-6 pt-4 border-t border-border text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                {tAuth("build")}: {process.env.NEXT_PUBLIC_APP_VERSION}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
