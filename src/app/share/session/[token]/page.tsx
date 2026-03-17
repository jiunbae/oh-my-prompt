import { notFound } from "next/navigation";
import { getSharedSession } from "@/lib/shared-session";
import { SharedSessionView } from "@/components/shared-session-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getSharedSession(token);

  if (!session) {
    return { title: "Shared Session - Oh My Prompt" };
  }

  return {
    title: `Shared Session${session.projectName ? ` - ${session.projectName}` : ""} (${session.promptCount} prompts) | Oh My Prompt`,
    description: `A shared coding session with ${session.promptCount} prompts${session.projectName ? ` in ${session.projectName}` : ""}`,
  };
}

export default async function SharedSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getSharedSession(token, { incrementViewCount: true });

  if (!session) {
    notFound();
  }

  return (
    <SharedSessionView
      sessionId={session.sessionId}
      projectName={session.projectName}
      source={session.source}
      startedAt={session.startedAt.toISOString()}
      endedAt={session.endedAt.toISOString()}
      promptCount={session.promptCount}
      prompts={session.prompts.map((p) => ({
        id: p.id,
        promptText: p.promptText,
        responseText: p.responseText,
        timestamp: p.timestamp.toISOString(),
        tokenEstimate: p.tokenEstimate,
        tokenEstimateResponse: p.tokenEstimateResponse,
      }))}
    />
  );
}
