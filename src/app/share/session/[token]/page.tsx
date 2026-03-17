import { notFound } from "next/navigation";
import Link from "next/link";
import { getSharedSession } from "@/lib/shared-session";
import { SharedSessionView } from "@/components/shared-session-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await getSharedSession(token);

  if (result.error) {
    return { title: result.error === "expired" ? "Expired Session - Oh My Prompt" : "Shared Session - Oh My Prompt" };
  }

  const session = result.data;
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
  const result = await getSharedSession(token, { incrementViewCount: true });

  if (result.error === "expired") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-yellow-600/20 mb-2">
            <svg className="h-8 w-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-foreground">This share link has expired</h1>
          <p className="text-sm text-muted-foreground">
            The owner of this session set an expiration on this share link. Ask them to create a new one if you still need access.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors"
          >
            Go to Oh My Prompt
          </Link>
        </div>
      </div>
    );
  }

  if (result.error) {
    notFound();
  }

  const session = result.data;
  return (
    <SharedSessionView
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
