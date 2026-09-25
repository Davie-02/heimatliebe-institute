import { createContext, useContext, type ReactNode } from "react";
import { useData } from "@/hooks/useData";
import type { Institution, SiteText } from "@/lib/types";

interface SiteContent {
  institution: Institution;
  site: SiteText;
}

const SiteContext = createContext<{ content?: SiteContent; loading: boolean }>({ loading: true });

/** Website text and institute details, edited by staff and refreshed live when they change. */
export function SiteProvider({ children }: { children: ReactNode }) {
  const { data, loading } = useData<SiteContent>("/public/site", ["site-content"]);
  return <SiteContext.Provider value={{ content: data, loading }}>{children}</SiteContext.Provider>;
}

export function useSite() {
  return useContext(SiteContext);
}
