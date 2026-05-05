"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTeam } from "@/contexts/team-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TeamActivityFeed } from "@/components/team-activity-feed";

interface Member {
  userId: string;
  role: string;
  joinedAt: string;
  name: string | null;
  email: string;
}

interface TeamDetail {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export default function TeamDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { id } = params as { id: string };
  const { refetch: refetchTeams } = useTeam();

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";

  const fetchTeam = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/teams/${id}`);
      if (res.ok) {
        const data = await res.json();
        setTeam(data.team);
        setMembers(data.members);
        setMyRole(data.myRole);
      } else if (res.status === 403) {
        setError("You don't have access to this team");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to load team");
      }
    } catch {
      setError("Failed to load team");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const sendInvite = async () => {
    if (!inviteEmail.trim() || !canManage) return;
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(false);
    try {
      const res = await fetch(`/api/teams/${id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      if (res.ok) {
        setInviteEmail("");
        setInviteSuccess(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setInviteError(data.error || "Failed to send invite");
      }
    } catch {
      setInviteError("Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  const updateRole = async (userId: string, role: string) => {
    try {
      const res = await fetch(`/api/teams/${id}/members/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        await fetchTeam();
      }
    } catch {
      // ignore
    }
  };

  const removeMember = async (userId: string) => {
    try {
      const res = await fetch(`/api/teams/${id}/members/${userId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchTeam();
      }
    } catch {
      // ignore
    }
  };

  const deleteTeam = async () => {
    if (!isOwner) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/teams/${id}`, { method: "DELETE" });
      if (res.ok) {
        await refetchTeams();
        router.push("/teams");
      }
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-skeleton rounded animate-pulse" />
        <div className="h-64 bg-skeleton rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Team</h1>
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
          {error || "Team not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{team.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{team.slug} &middot; {members.length} members</p>
        </div>
        <Badge variant={isOwner ? "warning" : "default"}>{myRole}</Badge>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        <button className="px-4 py-2 text-sm font-medium text-foreground border-b-2 border-primary">
          Overview
        </button>
        <Link
          href={`/teams/${id}/activity`}
          className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Activity
        </Link>
      </div>

      {/* Activity Preview */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest prompts from team members</CardDescription>
          </div>
          <Link
            href={`/teams/${id}/activity`}
            className="text-sm text-primary hover:underline"
          >
            View all
          </Link>
        </CardHeader>
        <CardContent>
          <TeamActivityFeed teamId={id} preview />
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>People who have access to this team&apos;s prompts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {members.map((member) => (
              <div key={member.userId} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-medium">
                    {member.name?.[0]?.toUpperCase() || member.email[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{member.name || member.email.split("@")[0]}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && member.role !== "owner" ? (
                    <>
                      <select
                        value={member.role}
                        onChange={(e) => updateRole(member.userId, e.target.value)}
                        className="h-8 rounded-md border border-border bg-input-bg px-2 text-xs text-foreground"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        {isOwner && <option value="owner">Owner</option>}
                      </select>
                      <button
                        onClick={() => removeMember(member.userId)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Remove member"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground capitalize">{member.role}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Invite */}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invite Members</CardTitle>
            <CardDescription>Send an invite link to join this team</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="max-w-sm"
              />
              <Button onClick={sendInvite} disabled={inviting || !inviteEmail.trim()}>
                {inviting ? "Sending..." : "Send Invite"}
              </Button>
            </div>
            {inviteSuccess && (
              <div className="p-3 bg-chart-2/10 border border-chart-2/20 rounded-lg text-chart-2 text-sm">
                Invite sent successfully!
              </div>
            )}
            {inviteError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                {inviteError}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Danger Zone */}
      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>Destructive actions for this team</CardDescription>
          </CardHeader>
          <CardContent>
            {showDeleteConfirm ? (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 space-y-3">
                <p className="text-destructive text-sm">
                  Are you sure? This will permanently delete the team, all team prompts, and remove all members.
                  This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <Button variant="destructive" size="sm" onClick={deleteTeam} disabled={deleting}>
                    {deleting ? "Deleting..." : "Yes, Delete Team"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-destructive hover:text-destructive/80 hover:border-destructive/30"
              >
                <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete Team
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
