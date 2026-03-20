"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ForgotPasswordPage() {
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
            Reset your password
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <p className="text-sm text-foreground font-medium mb-2">
              Self-hosted instance
            </p>
            <p className="text-sm text-muted-foreground">
              This is a self-hosted installation without email service. To reset
              your password, contact your administrator. They can generate a
              password reset link for you from the admin panel.
            </p>
          </div>
          <Link href="/login">
            <Button variant="outline" className="w-full">
              Back to Login
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
