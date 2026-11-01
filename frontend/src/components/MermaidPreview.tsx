"use client";

import { useEffect, useId, useState } from "react";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { useTheme } from "@/lib/theme/ThemeProvider";

const DARK_THEME_VARIABLES = {
  background: "#121212",
  primaryColor: "#1c1c1c",
  primaryTextColor: "#f5f5f5",
  primaryBorderColor: "#f5f5f5",
  lineColor: "#8a8a8a",
  secondaryColor: "#1c1c1c",
  tertiaryColor: "#1c1c1c",
};

const LIGHT_THEME_VARIABLES = {
  background: "#ffffff",
  primaryColor: "#eceef2",
  primaryTextColor: "#15161a",
  primaryBorderColor: "#15161a",
  lineColor: "#63656d",
  secondaryColor: "#eceef2",
  tertiaryColor: "#eceef2",
};

export function MermaidPreview({ source }: { source: string }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const id = useId().replace(/:/g, "-");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!source.trim()) return;
    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        fontFamily: "var(--font-inter)",
        suppressErrorRendering: true,
        themeVariables: theme === "light" ? LIGHT_THEME_VARIABLES : DARK_THEME_VARIABLES,
      });
      try {
        const { svg: rendered } = await mermaid.render(`mermaid-${id}`, source);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setSvg(null);
          setError(t.mermaid.syntaxError);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source, id, t, theme]);

  if (!source.trim()) return null;
  if (error) return <p className="text-xs text-alert">{error}</p>;
  if (!svg) return null;

  return <div className="flex justify-center overflow-x-auto py-2" dangerouslySetInnerHTML={{ __html: svg }} />;
}
