"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ForgotPasswordPage() {
  const tAuth = useTranslations("auth");

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
            {tAuth("forgotTitle")}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <p className="text-sm text-foreground font-medium mb-2">
              {tAuth("forgotSelfHostedTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {tAuth("forgotSelfHostedMessage")}
            </p>
          </div>
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
