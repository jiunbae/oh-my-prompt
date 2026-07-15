import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionCard } from "./session-card";

const session = {
  sessionId: "session-1",
  displayName: "Accessibility review",
  firstPrompt: "Review this interface",
  startedAt: "2026-07-15T08:00:00.000Z",
  endedAt: "2026-07-15T08:10:00.000Z",
  promptCount: 2,
  responseCount: 2,
};

describe("SessionCard", () => {
  it.each(["list", "grid"] as const)(
    "keeps the favorite button outside the session link in the %s variant",
    (variant) => {
      const markup = renderToStaticMarkup(
        <SessionCard {...session} variant={variant} />,
      );
      const linkMarkup = markup.match(/<a\b[^>]*>[\s\S]*?<\/a>/)?.[0];

      expect(linkMarkup).toBeDefined();
      expect(linkMarkup).not.toContain("<button");
      expect(markup).toContain("<button");
    },
  );

  it("preserves the composite team scope in its detail link", () => {
    const markup = renderToStaticMarkup(
      <SessionCard
        {...session}
        teamId="3ae33ee3-3737-437d-b53d-f60e96be5008"
        ownerId="a5efc606-d163-451f-b85b-c13cd04e32de"
        canFavorite={false}
      />,
    );

    expect(markup).toContain(
      "/sessions/session-1?teamId=3ae33ee3-3737-437d-b53d-f60e96be5008&amp;ownerId=a5efc606-d163-451f-b85b-c13cd04e32de",
    );
    expect(markup).not.toContain("<button");
  });
});
