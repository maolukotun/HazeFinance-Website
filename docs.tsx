import { createFileRoute } from "@tanstack/react-router";
import { RawPage } from "@/components/RawPage";
import css from "@/content/docs.css?raw";
import html from "@/content/docs.html?raw";
import script0 from "@/content/docs.0.classic.js?raw";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation — Haze" },
      {
        name: "description",
        content:
          "How Haze works: data collection, anonymization, the fingerprint model, payouts and privacy guarantees.",
      },
      { property: "og:title", content: "Documentation — Haze" },
      {
        property: "og:description",
        content: "How Haze works: anonymization, the fingerprint model, payouts and privacy.",
      },
    ],
  }),
  component: Docs,
});

function Docs() {
  return <RawPage css={css} html={html} scripts={[{ code: script0 }]} />;
}
