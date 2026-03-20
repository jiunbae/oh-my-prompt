"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/contexts/user-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface UserInfo {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface ResetLinkInfo {
  resetUrl: string;
  expiresAt: string;
  userEmail: string;
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));
}

function formatDateTime(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));
}

export default function AdminUsersPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Reset password dialog state
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetUserEmail, setResetUserEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetLink, setResetLink] = useState<ResetLinkInfo | null>(null);
  const [resetError, setResetError] = useState("");
  const [copied, setCopied] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/admin/users");

      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      } else if (res.status === 403) {
        router.push("/sessions");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to fetch users");
      }
    } catch {
      setError("Failed to fetch users");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!userLoading) {
      if (!user?.isAdmin) {
        router.push("/sessions");
      } else {
        fetchUsers();
      }
    }
  }, [user, userLoading, router, fetchUsers]);

  const handleToggleAdmin = async (userId: string, currentIsAdmin: boolean) => {
    setTogglingId(userId);
    setError("");

    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, isAdmin: !currentIsAdmin }),
      });

      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, isAdmin: !currentIsAdmin } : u
          )
        );
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update user");
      }
    } catch {
      setError("Failed to update user");
    } finally {
      setTogglingId(null);
    }
  };

  const openResetDialog = (userId: string, email: string) => {
    setResetUserId(userId);
    setResetUserEmail(email);
    setResetLink(null);
    setResetError("");
    setCopied(false);
    setResetDialogOpen(true);
  };

  const closeResetDialog = () => {
    setResetDialogOpen(false);
    setResetUserId(null);
    setResetUserEmail("");
    setResetLink(null);
    setResetError("");
    setCopied(false);
  };

  const handleGenerateResetLink = async () => {
    if (!resetUserId) return;
    setResetLoading(true);
    setResetError("");
    setCopied(false);

    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: resetUserId }),
      });

      const data = await res.json();

      if (res.ok) {
        setResetLink({
          resetUrl: data.resetUrl,
          expiresAt: data.expiresAt,
          userEmail: data.userEmail,
        });
      } else {
        setResetError(data.error || "Failed to generate reset link");
      }
    } catch {
      setResetError("Failed to generate reset link");
    } finally {
      setResetLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!resetLink) return;
    try {
      await navigator.clipboard.writeText(resetLink.resetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the input text
    }
  };

  if (userLoading || !user?.isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Users</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage user accounts and permissions
        </p>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            {users.length} registered user{users.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No users found.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {/* Header */}
              <div className="hidden md:grid md:grid-cols-[1fr_1fr_100px_120px_120px_140px] gap-4 py-2 text-xs text-muted-foreground font-medium">
                <span>Email</span>
                <span>Name</span>
                <span>Role</span>
                <span>Created</span>
                <span>Last Login</span>
                <span></span>
              </div>
              {users.map((u) => {
                const isSelf = u.id === user?.id;
                return (
                  <div
                    key={u.id}
                    className="flex flex-col md:grid md:grid-cols-[1fr_1fr_100px_120px_120px_140px] gap-2 md:gap-4 py-4 md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground text-sm truncate">
                        {u.email}
                        {isSelf && (
                          <span className="text-xs text-muted-foreground ml-2">(you)</span>
                        )}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-muted-foreground text-sm truncate">
                        {u.name || "\u2014"}
                      </p>
                    </div>
                    <div>
                      {u.isAdmin ? (
                        <Badge variant="default" className="bg-chart-1/20 text-chart-1 border-chart-1/30">
                          Admin
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">User</span>
                      )}
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(u.createdAt)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">
                        {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openResetDialog(u.id, u.email)}
                        className="text-muted-foreground hover:text-foreground text-xs"
                      >
                        Reset PW
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleAdmin(u.id, u.isAdmin)}
                        disabled={isSelf || togglingId === u.id}
                        className={
                          u.isAdmin
                            ? "text-destructive hover:text-destructive/80 hover:bg-destructive/10 text-xs"
                            : "text-chart-1 hover:text-chart-1/80 hover:bg-chart-1/10 text-xs"
                        }
                        title={isSelf ? "Cannot change your own role" : undefined}
                      >
                        {togglingId === u.id ? (
                          <span className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                        ) : u.isAdmin ? (
                          "Revoke"
                        ) : (
                          "Grant"
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reset Password Dialog */}
      <Dialog open={resetDialogOpen} onClose={closeResetDialog}>
        <DialogTitle>Reset Password</DialogTitle>
        <DialogDescription>
          Generate a password reset link for <strong>{resetUserEmail}</strong>.
          The link will expire in 1 hour.
        </DialogDescription>

        {resetError && (
          <p className="mt-3 text-destructive text-sm">{resetError}</p>
        )}

        {resetLink ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Share this link with the user. It expires{" "}
              {formatDateTime(resetLink.expiresAt)}.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={resetLink.resetUrl}
                className="text-xs font-mono"
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
                className="shrink-0"
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeResetDialog}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={closeResetDialog} disabled={resetLoading}>
              Cancel
            </Button>
            <Button onClick={handleGenerateResetLink} disabled={resetLoading}>
              {resetLoading ? "..." : "Generate Link"}
            </Button>
          </DialogFooter>
        )}
      </Dialog>
    </div>
  );
}
