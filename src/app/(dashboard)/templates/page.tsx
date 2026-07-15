"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useUser } from "@/contexts/user-context";
import { PublishTemplateDialog } from "@/components/publish-template-dialog";

interface TemplateVariable {
  name: string;
  default: string;
  description: string;
}

interface Template {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  template: string;
  variables: TemplateVariable[];
  category: string | null;
  usageCount: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  "debugging",
  "code-review",
  "feature",
  "refactoring",
  "testing",
  "documentation",
  "other",
];

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{\s*(\w+)\s*\}\}/g) || [];
  const names = matches.map((m) => m.replace(/\{\{\s*|\s*\}\}/g, ""));
  return [...new Set(names)];
}

export default function TemplatesPage() {
  const { user } = useUser();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewResult, setPreviewResult] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<Template | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formTemplate, setFormTemplate] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formIsPublic, setFormIsPublic] = useState(false);
  const [formVariables, setFormVariables] = useState<TemplateVariable[]>([]);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const url = filterCategory
        ? `/api/templates?category=${encodeURIComponent(filterCategory)}`
        : "/api/templates";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates);
      }
    } catch (error) {
      console.error("Failed to fetch templates:", error);
    } finally {
      setLoading(false);
    }
  }, [filterCategory]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const resetForm = () => {
    setFormTitle("");
    setFormDescription("");
    setFormTemplate("");
    setFormCategory("");
    setFormIsPublic(false);
    setFormVariables([]);
    setFormError("");
    setEditingId(null);
    setShowForm(false);
  };

  const handleEditClick = (t: Template) => {
    setFormTitle(t.title);
    setFormDescription(t.description || "");
    setFormTemplate(t.template);
    setFormCategory(t.category || "");
    setFormIsPublic(t.isPublic);
    setFormVariables(t.variables || []);
    setEditingId(t.id);
    setShowForm(true);
  };

  const handleTemplateTextChange = (text: string) => {
    setFormTemplate(text);
    // Auto-detect variables and sync with form variables
    const detectedNames = extractVariables(text);
    setFormVariables((prev) => {
      const existing = new Map(prev.map((v) => [v.name, v]));
      return detectedNames.map((name) =>
        existing.get(name) || { name, default: "", description: "" }
      );
    });
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formTemplate.trim()) {
      setFormError("Title and template text are required.");
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      const payload = {
        title: formTitle.trim(),
        description: formDescription.trim() || null,
        template: formTemplate,
        variables: formVariables,
        category: formCategory || null,
        isPublic: formIsPublic,
      };

      const res = editingId
        ? await fetch(`/api/templates/${editingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (res.ok) {
        resetForm();
        await fetchTemplates();
      } else {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error || "Failed to save template");
      }
    } catch {
      setFormError("An error occurred while saving.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmTarget(id);
    setConfirmOpen(true);
  };

  const executeDelete = async () => {
    if (!confirmTarget) return;
    const id = confirmTarget;
    setConfirmOpen(false);
    setConfirmTarget(null);
    try {
      const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchTemplates();
      }
    } catch (error) {
      console.error("Delete error:", error);
    }
  };

  const handlePublish = (t: Template) => {
    setPublishTarget(t);
    setPublishOpen(true);
  };

  const handlePreview = (t: Template) => {
    if (previewId === t.id) {
      setPreviewId(null);
      setPreviewValues({});
      setPreviewResult("");
      return;
    }
    setPreviewId(t.id);
    const defaults: Record<string, string> = {};
    for (const v of t.variables || []) {
      defaults[v.name] = v.default || "";
    }
    setPreviewValues(defaults);
    // Render locally with escaped regex and replacer callback
    let rendered = t.template;
    for (const [key, val] of Object.entries(defaults)) {
      const regex = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
      rendered = rendered.replace(regex, () => val || `{{${key}}}`);
    }
    setPreviewResult(rendered);
  };

  const updatePreviewValue = (name: string, value: string, template: Template) => {
    const newValues = { ...previewValues, [name]: value };
    setPreviewValues(newValues);
    let rendered = template.template;
    for (const [key, val] of Object.entries(newValues)) {
      const regex = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
      rendered = rendered.replace(regex, () => val || `{{${key}}}`);
    }
    setPreviewResult(rendered);
  };

  const handleUseTemplate = async (t: Template) => {
    try {
      const values = previewId === t.id ? previewValues : {};
      const res = await fetch(`/api/templates/${t.id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (res.ok) {
        const data = await res.json();
        await navigator.clipboard.writeText(data.rendered);
        setCopiedId(t.id);
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
      }
    } catch (error) {
      console.error("Use template error:", error);
    }
  };

  const isOwner = (t: Template) => user?.id === t.userId;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reusable prompt patterns with variables
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button
            className="flex-1 sm:flex-none"
            variant="outline"
            onClick={() => window.location.href = "/marketplace"}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Marketplace
          </Button>
          <Button
            className="flex-1 sm:flex-none"
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Template
          </Button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Filter:</span>
        <button
          onClick={() => setFilterCategory("")}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            !filterCategory
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          All
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat === filterCategory ? "" : cat)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors capitalize ${
              filterCategory === cat
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Create/Edit form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? "Edit Template" : "Create Template"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Title
                </label>
                <Input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g., Code Review Request"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Category
                </label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">No category</option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-secondary-foreground">
                Description
              </label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Brief description of what this template is for"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-secondary-foreground">
                Template Text{" "}
                <span className="font-normal text-muted-foreground">
                  (use {"{{variable}}"} for placeholders)
                </span>
              </label>
              <textarea
                value={formTemplate}
                onChange={(e) => handleTemplateTextChange(e.target.value)}
                rows={8}
                className="flex w-full rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={"Review the following {{language}} code for potential issues:\n\n```{{language}}\n{{code}}\n```\n\nFocus on: {{focus_areas}}"}
              />
            </div>

            {/* Auto-detected variables */}
            {formVariables.length > 0 && (
              <div className="space-y-3">
                <label className="text-sm font-medium text-secondary-foreground">
                  Variables
                </label>
                <div className="space-y-2">
                  {formVariables.map((v, i) => (
                    <div
                      key={v.name}
                      className="grid grid-cols-3 gap-2 items-center"
                    >
                      <div className="text-sm font-mono text-foreground px-2 py-1.5 bg-secondary rounded">
                        {`{{${v.name}}}`}
                      </div>
                      <Input
                        value={v.default}
                        onChange={(e) => {
                          const updated = [...formVariables];
                          updated[i] = { ...v, default: e.target.value };
                          setFormVariables(updated);
                        }}
                        placeholder="Default value"
                      />
                      <Input
                        value={v.description}
                        onChange={(e) => {
                          const updated = [...formVariables];
                          updated[i] = { ...v, description: e.target.value };
                          setFormVariables(updated);
                        }}
                        placeholder="Description"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formIsPublic}
                  onChange={(e) => setFormIsPublic(e.target.checked)}
                  className="h-4 w-4 border-border bg-input-bg text-primary focus:ring-ring rounded"
                />
                <span className="text-sm text-secondary-foreground">
                  Make public (visible to all users)
                </span>
              </label>
            </div>

            {formError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                {formError}
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update Template" : "Create Template"}
              </Button>
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Templates list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-skeleton rounded-lg animate-pulse" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center text-muted-foreground">
          <p>No templates found.</p>
          <p className="text-sm mt-1">
            Create your first prompt template to get started.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => { resetForm(); setShowForm(true); }}>
              Create first template
            </Button>
            <Button variant="outline" onClick={() => { window.location.href = "/marketplace"; }}>
              Browse Marketplace
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-4">
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground">{t.title}</h3>
                      {t.category && (
                        <Badge variant="secondary" className="capitalize">
                          {t.category}
                        </Badge>
                      )}
                      {t.isPublic && (
                        <Badge variant="success">Public</Badge>
                      )}
                    </div>
                    {t.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {t.description}
                      </p>
                    )}
                    <pre className="mt-2 text-xs text-muted-foreground font-mono bg-surface rounded p-3 overflow-x-auto max-h-32 whitespace-pre-wrap">
                      {t.template}
                    </pre>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>Used {t.usageCount} times</span>
                      {t.variables && (t.variables as TemplateVariable[]).length > 0 && (
                        <span>
                          {(t.variables as TemplateVariable[]).length} variable
                          {(t.variables as TemplateVariable[]).length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePreview(t)}
                    >
                      {previewId === t.id ? "Close" : "Preview"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUseTemplate(t)}
                    >
                      {copiedId === t.id ? "Copied!" : "Use"}
                    </Button>
                    {isOwner(t) && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePublish(t)}
                          title="Publish to marketplace"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditClick(t)}
                          title="Edit"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(t.id)}
                          className="text-destructive hover:text-destructive/80"
                          title="Delete"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Preview panel */}
                {previewId === t.id && (
                  <div className="mt-4 border-t border-border pt-4 space-y-3">
                    <p className="text-sm font-medium text-secondary-foreground">
                      Preview with values:
                    </p>
                    {(t.variables as TemplateVariable[])?.length > 0 && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(t.variables as TemplateVariable[]).map((v) => (
                          <div key={v.name} className="space-y-1">
                            <label className="text-xs text-muted-foreground">
                              {v.name}
                              {v.description && (
                                <span className="ml-1 text-muted-foreground/60">
                                  - {v.description}
                                </span>
                              )}
                            </label>
                            <Input
                              value={previewValues[v.name] || ""}
                              onChange={(e) =>
                                updatePreviewValue(v.name, e.target.value, t)
                              }
                              placeholder={v.default || v.name}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="bg-surface rounded-lg p-4">
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        Rendered output:
                      </p>
                      <pre className="text-sm text-foreground whitespace-pre-wrap font-mono">
                        {previewResult}
                      </pre>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmTarget(null); }}
        onConfirm={executeDelete}
        title="Delete template"
        description="Are you sure you want to delete this template?"
        confirmLabel="Delete"
        variant="destructive"
      />

      {publishTarget && (
        <PublishTemplateDialog
          open={publishOpen}
          onClose={() => { setPublishOpen(false); setPublishTarget(null); }}
          templateId={publishTarget.id}
          templateTitle={publishTarget.title}
          onPublished={fetchTemplates}
        />
      )}
    </div>
  );
}
