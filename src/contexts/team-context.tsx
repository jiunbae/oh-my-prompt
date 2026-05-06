"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

export interface Team {
  id: string;
  name: string;
  slug: string;
  role: string;
  joinedAt: string;
  createdAt: string;
  inviteOnly?: boolean;
}

interface TeamContextType {
  teams: Team[];
  selectedTeamId: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  selectTeam: (teamId: string | null) => void;
  isTeamContext: boolean;
}

const TEAM_STORAGE_KEY = "omp-selected-team";

const TeamContext = createContext<TeamContextType | undefined>(undefined);

export function TeamProvider({ children }: { children: ReactNode }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Restore selection from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TEAM_STORAGE_KEY);
      if (stored) {
        setSelectedTeamId(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchTeams = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/teams");
      if (res.ok) {
        const data = await res.json();
        setTeams(data.teams ?? []);
        // If selected team no longer exists, clear it
        if (selectedTeamId && !data.teams?.find((t: Team) => t.id === selectedTeamId)) {
          setSelectedTeamId(null);
          localStorage.removeItem(TEAM_STORAGE_KEY);
        }
      } else if (res.status === 401) {
        setTeams([]);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to fetch teams");
      }
    } catch {
      setError("Failed to fetch teams");
    } finally {
      setLoading(false);
    }
  }, [selectedTeamId]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const selectTeam = useCallback((teamId: string | null) => {
    setSelectedTeamId(teamId);
    try {
      if (teamId) {
        localStorage.setItem(TEAM_STORAGE_KEY, teamId);
      } else {
        localStorage.removeItem(TEAM_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, []);

  const isTeamContext = selectedTeamId !== null;

  return (
    <TeamContext.Provider
      value={{
        teams,
        selectedTeamId,
        loading,
        error,
        refetch: fetchTeams,
        selectTeam,
        isTeamContext,
      }}
    >
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  const context = useContext(TeamContext);
  if (context === undefined) {
    throw new Error("useTeam must be used within a TeamProvider");
  }
  return context;
}
