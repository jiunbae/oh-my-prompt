"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface PermissionRecord {
  id: string;
  userId: string;
  permission: "view" | "edit" | "admin";
  grantedBy: string | null;
  createdAt: string;
  userName: string | null;
  userEmail: string;
}

interface PromptAccessDialogProps {
  promptId: string;
  open: boolean;
  onClose: () => void;
}

export function PromptAccessDialog({ promptId, open, onClose }: PromptAccessDialogProps) {
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userEmail, setUserEmail] = useState("");
  const [selectedPermission, setSelectedPermission] = useState<"view" | "edit" | "admin">("view");
  const [granting, setGranting] = useState(false);

  const fetchPermissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${promptId}/permissions`);
      if (!res.ok) throw new Error("Failed to fetch permissions");
      const data = await res.json();
      setPermissions(data.permissions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch permissions");
    } finally {
      setLoading(false);
    }
  }, [promptId]);

  useEffect(() => {
    if (open) {
      fetchPermissions();
      setUserEmail("");
      setSelectedPermission("view");
    }
  }, [open, fetchPermissions]);

  const handleGrant = async () => {
    if (!userEmail.trim()) return;
    setGranting(true);
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${promptId}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail.trim(), permission: selectedPermission }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to grant permission");
      }

      setUserEmail("");
      await fetchPermissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant permission");
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (permissionId: string) => {
    try {
      const res = await fetch(`/api/prompts/${promptId}/permissions/${permissionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to revoke permission");
      await fetchPermissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke permission");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogTitle>Manage Access</DialogTitle>
      <DialogDescription>
        Control who can view or edit this prompt.
      </DialogDescription>

      <div className="mt-4 space-y-4">
        {/* Grant new permission */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Add user by email</label>
          <div className="flex gap-2">
            <Input
              type="email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="flex-1"
            />
            <select
              value={selectedPermission}
              onChange={(e) => setSelectedPermission(e.target.value as "view" | "edit" | "admin")}
              className="h-10 rounded-md border border-border bg-input-bg px-2 text-sm text-foreground"
            >
              <option value="view">View</option>
              <option value="edit">Edit</option>
              <option value="admin">Admin</option>
            </select>
            <Button onClick={handleGrant} disabled={granting || !userEmail.trim()}>
              {granting ? "..." : "Add"}
            </Button>
          </div>
        </div>

        {/* Permissions list */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">People with access</h4>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : permissions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No additional permissions granted.</p>
          ) : (
            <div className="space-y-2">
              {permissions.map((perm) => (
                <div
                  key={perm.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {perm.userName || perm.userEmail.split("@")[0]}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{perm.userEmail}</p>
                  </div>
                  <span
                    className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      perm.permission === "admin"
                        ? "bg-destructive/10 text-destructive"
                        : perm.permission === "edit"
                        ? "bg-primary/10 text-primary"
                        : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {perm.permission}
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-destructive hover:text-destructive/80"
                    onClick={() => handleRevoke(perm.id)}
                    title="Revoke access"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
