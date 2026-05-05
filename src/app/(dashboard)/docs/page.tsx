"use client";

import { useState, useMemo } from "react";
import { apiEndpoints, apiCategories, type ApiEndpoint } from "@/lib/api-docs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "bg-green-500/10 text-green-600 border-green-500/20",
    POST: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    PUT: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
    DELETE: "bg-red-500/10 text-red-600 border-red-500/20",
    PATCH: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold border ${colors[method] || colors.GET}`}>
      {method}
    </span>
  );
}

function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const [expanded, setExpanded] = useState(false);

  const curlExample = `curl -X ${endpoint.method} \\
  ${endpoint.auth ? "-H \"X-User-Token: YOUR_TOKEN\" \\\n  " : ""}${endpoint.path}${endpoint.body ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(endpoint.body, null, 2).replace(/'/g, "\\'")}'` : ""}`;

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 flex items-center gap-3 hover:bg-accent/50 transition-colors"
      >
        <MethodBadge method={endpoint.method} />
        <code className="text-sm font-mono text-foreground">{endpoint.path}</code>
        {endpoint.auth && (
          <Badge variant="secondary" className="text-xs">Auth</Badge>
        )}
        {endpoint.adminOnly && (
          <Badge variant="destructive" className="text-xs">Admin</Badge>
        )}
        <span className="text-sm text-muted-foreground ml-auto hidden sm:inline">{endpoint.description}</span>
      </button>
      {expanded && (
        <CardContent className="border-t bg-muted/30 p-4 space-y-3">
          <p className="text-sm text-muted-foreground">{endpoint.description}</p>

          {endpoint.query && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Query Parameters</p>
              <div className="rounded border bg-background p-2 text-xs font-mono space-y-1">
                {Object.entries(endpoint.query).map(([k, v]) => (
                  <div key={k}><span className="text-primary">{k}</span>: <span className="text-muted-foreground">{v}</span></div>
                ))}
              </div>
            </div>
          )}

          {endpoint.body && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Request Body</p>
              <div className="rounded border bg-background p-2 text-xs font-mono space-y-1">
                {Object.entries(endpoint.body).map(([k, v]) => (
                  <div key={k}><span className="text-primary">{k}</span>: <span className="text-muted-foreground">{v}</span></div>
                ))}
              </div>
            </div>
          )}

          {endpoint.response && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Response</p>
              <div className="rounded border bg-background p-2 text-xs font-mono space-y-1">
                {Object.entries(endpoint.response).map(([k, v]) => (
                  <div key={k}><span className="text-primary">{k}</span>: <span className="text-muted-foreground">{v}</span></div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Example</p>
            <div className="relative rounded border bg-background p-2">
              <pre className="text-xs font-mono text-foreground overflow-x-auto">{curlExample}</pre>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(curlExample);
                }}
                className="absolute top-2 right-2 rounded px-2 py-1 text-xs bg-accent hover:bg-accent/80 transition-colors"
              >
                Copy
              </button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function ApiDocsPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return apiEndpoints.filter((e) => {
      const matchesSearch = !search ||
        e.path.toLowerCase().includes(search.toLowerCase()) ||
        e.description.toLowerCase().includes(search.toLowerCase()) ||
        e.method.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = !activeCategory || e.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [search, activeCategory]);

  const grouped = useMemo(() => {
    const map = new Map<string, ApiEndpoint[]>();
    for (const e of filtered) {
      if (!map.has(e.category)) map.set(e.category, []);
      map.get(e.category)!.push(e);
    }
    return map;
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">API Reference</h1>
        <p className="text-sm text-muted-foreground mt-1">
          HTTP endpoints for the oh-my-prompt API.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          type="search"
          placeholder="Search endpoints..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeCategory === null ? "bg-primary text-primary-foreground" : "bg-accent text-foreground hover:bg-accent/80"
            }`}
          >
            All
          </button>
          {apiCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                activeCategory === cat ? "bg-primary text-primary-foreground" : "bg-accent text-foreground hover:bg-accent/80"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([category, endpoints]) => (
          <div key={category}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {category}
            </h2>
            <div className="space-y-2">
              {endpoints.map((e) => (
                <EndpointCard key={`${e.method}${e.path}`} endpoint={e} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No endpoints match your search.
        </div>
      )}
    </div>
  );
}
