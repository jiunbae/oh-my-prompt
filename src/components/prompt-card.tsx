import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PromptCardProps {
  id: string;
  timestamp: Date;
  projectName?: string | null;
  preview: string;
  promptType: "user_input" | "task_notification" | "system" | "user" | "assistant";
  tokenCount: number;
  tags?: string[];
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

const promptTypeColors: Record<string, "default" | "secondary" | "success"> = {
  user: "default",
  system: "secondary",
  assistant: "success",
};

export function PromptCard({
  id,
  timestamp,
  projectName,
  preview,
  promptType,
  tokenCount,
  tags = [],
}: PromptCardProps) {
  return (
    <Link href={`/prompts/${id}`}>
      <Card className="p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800/50 cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{formatDate(timestamp)}</span>
            {projectName && (
              <Badge variant="secondary" className="w-fit">
                {projectName}
              </Badge>
            )}
          </div>
          <Badge variant={promptTypeColors[promptType]}>{promptType}</Badge>
        </div>

        <p className="text-sm text-zinc-300 line-clamp-3 mb-3 font-mono">
          {preview}
        </p>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5 flex-wrap">
            {tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {tags.length > 3 && (
              <Badge variant="secondary" className="text-xs">
                +{tags.length - 3}
              </Badge>
            )}
          </div>
          <span className="text-xs text-zinc-500">
            {formatTokenCount(tokenCount)} tokens
          </span>
        </div>
      </Card>
    </Link>
  );
}
