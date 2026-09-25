import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useData } from "@/hooks/useData";
import type { Level, ModuleKey } from "@/lib/types";

export interface FieldDef {
  name: string;
  label: string;
  type: "string" | "text" | "richtext" | "email" | "phone" | "url" | "image" | "file" | "int" | "number" | "money" | "bool" | "date" | "datetime" | "time" | "enum" | "ref" | "json";
  required?: boolean;
  options?: string[];
  optionLabels?: Record<string, string>;
  ref?: string;
  relation?: string;
  list?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  help?: string;
  default?: unknown;
  min?: number;
  max?: number;
}

export interface ResourceSchema {
  key: string;
  model: string;
  label: string;
  singular: string;
  description?: string;
  module: ModuleKey;
  titleField: string;
  fields: FieldDef[];
  search?: string[];
  filters?: string[];
  sort?: { field: string; dir: "asc" | "desc" };
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  deleteLevel: Level;
  cascades?: boolean;
  isPublic: boolean;
}

const SchemaContext = createContext<Map<string, ResourceSchema>>(new Map());

/** The descriptions of every record type, from the API (GET /r/_schema). Loaded once per visit. */
export function SchemaProvider({ children }: { children: ReactNode }) {
  const { data } = useData<ResourceSchema[]>("/r/_schema");
  const map = useMemo(() => new Map((data ?? []).map((r) => [r.key, r])), [data]);
  return <SchemaContext.Provider value={map}>{children}</SchemaContext.Provider>;
}

export function useSchema(key: string | undefined): ResourceSchema | undefined {
  return useContext(SchemaContext).get(key ?? "");
}

export function useSchemaReady(): boolean {
  return useContext(SchemaContext).size > 0;
}
