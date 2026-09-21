/** Resources copied by a run. */

/** Account-wide collections, written under `_account/`. */
export const ACCOUNT_RESOURCES: Array<{
  file: string;
  path: string;
  single?: boolean;
}> = [
  { file: "company", path: "/public_api/v1/companies/current", single: true },
  { file: "users", path: "/public_api/v1/users" },
  { file: "groups", path: "/public_api/v1/groups" },
  { file: "tags", path: "/public_api/v1/tags" },
  { file: "labels", path: "/public_api/v1/labels" },
  { file: "customers", path: "/public_api/v1/customers" },
  { file: "project_groups", path: "/public_api/v1/project_groups" },
  { file: "boards", path: "/public_api/v1/boards" },
  { file: "document_folders", path: "/public_api/v1/document_folders" },
  { file: "custom_field_definitions", path: "/public_api/v1/custom_field_definitions" },
  { file: "checklist_templates", path: "/public_api/v1/templates/conditional_checklists" },
];

export interface ProjectResource {
  file: string;
  path: string;
  single?: boolean;
}

/** Per-project collections, written under the project folder. */

/** Per-project collections, written under the project folder. */
export const PROJECT_RESOURCES: ProjectResource[] = [
  { file: "photos", path: "/public_api/v1/projects/{id}/photos" },
  { file: "videos", path: "/public_api/v1/projects/{id}/videos" },
  { file: "documents", path: "/public_api/v1/projects/{id}/documents" },
  { file: "document_folders", path: "/public_api/v1/projects/{id}/document_folders" },
  { file: "pages", path: "/public_api/v1/projects/{id}/pages" },
  { file: "checklists", path: "/public_api/v1/projects/{id}/conditional_checklists" },
  { file: "comments", path: "/public_api/v1/projects/{id}/comments" },
  { file: "custom_fields", path: "/public_api/v1/projects/{id}/custom_fields" },
  { file: "labels", path: "/public_api/v1/projects/{id}/labels" },
  { file: "assigned_users", path: "/public_api/v1/projects/{id}/assigned_users" },
  { file: "collaborators", path: "/public_api/v1/projects/{id}/collaborators" },
  { file: "tasks", path: "/public_api/v1/projects/{id}/project_tasks" },
  { file: "photo_tags", path: "/public_api/v1/projects/{id}/photos/tags" },
  { file: "customer", path: "/public_api/v1/projects/{id}/customer", single: true },
];

/** Files to archive for a photo: the original, plus the annotated rendering when it differs. */
export function photoFiles(photo: any): Array<{ url: string; suffix: string }> {
  const uris: Array<{ type?: string; url?: string; uri?: string }> = photo?.uris ?? [];
  const byType = (t: string) => uris.find((u) => u.type === t);
  const href = (u?: { url?: string; uri?: string }) => u?.url ?? u?.uri ?? null;

  const out: Array<{ url: string; suffix: string }> = [];
  const main =
    href(byType("original")) ?? href(byType("web")) ?? href(uris[0]) ?? photo?.photo_url ?? null;
  if (main) out.push({ url: main, suffix: "" });

  const annotated = href(byType("original_annotation")) ?? href(byType("web_annotation"));
  if (annotated && annotated !== main) out.push({ url: annotated, suffix: "-annotated" });

  return out;
}

export function videoUrl(video: any): string | null {
  return video?.playback_url ?? null;
}

export function documentUrl(doc: any): string | null {
  return doc?.url ?? null;
}
