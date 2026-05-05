import { NextResponse } from "next/server";
import { apiEndpoints } from "@/lib/api-docs";

export const dynamic = "force-dynamic";

export async function GET() {
  const paths: Record<string, any> = {};

  for (const ep of apiEndpoints) {
    const openApiPath = ep.path.replace(/:([^/]+)/g, "{$1}");
    if (!paths[openApiPath]) paths[openApiPath] = {};
    paths[openApiPath][ep.method.toLowerCase()] = {
      summary: ep.description,
      security: ep.auth ? [{ bearerAuth: [] }] : undefined,
      parameters: ep.query
        ? Object.entries(ep.query).map(([name, schema]) => ({
            name,
            in: "query",
            schema: { type: "string" },
            required: !schema.includes("?"),
          }))
        : undefined,
      requestBody: ep.body
        ? {
            content: {
              "application/json": {
                schema: { type: "object", properties: Object.fromEntries(Object.entries(ep.body).map(([k]) => [k, { type: "string" }])) },
              },
            },
          }
        : undefined,
      responses: {
        "200": {
          description: "Success",
          content: ep.response
            ? {
                "application/json": {
                  schema: { type: "object", properties: Object.fromEntries(Object.entries(ep.response).map(([k]) => [k, { type: "string" }])) },
                },
              }
            : undefined,
        },
      },
    };
  }

  const spec = {
    openapi: "3.0.3",
    info: {
      title: "oh-my-prompt API",
      version: "2026.505.1",
      description: "API for the oh-my-prompt prompt analytics platform.",
    },
    servers: [{ url: "/api" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "X-User-Token header or session cookie",
        },
      },
    },
    paths,
  };

  return NextResponse.json(spec);
}
