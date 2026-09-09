import { createFileRoute } from "@tanstack/react-router";
import { RawPage } from "@/components/RawPage";
import css from "@/content/dashboard.css?raw";
import html from "@/content/dashboard.html?raw";
import script0Raw from "@/content/dashboard.0.classic.js?raw";

// dashboard.0.classic.js runs as a plain inline <script> tag, not an ES
// module, so it has no access to import.meta.env itself. This is the one
// place that IS a real module (Vite processes this file), so the API
// base URL substitution happens here: set VITE_HAZE_API_URL in your .env
// to point at a non-local backend; defaults to the haze-backend dev
// server. See haze-backend/README.md for what this API serves.
const HAZE_API_BASE = import.meta.env.VITE_HAZE_API_URL ?? "http://localhost:8402";
const script0 = script0Raw.replace('"__HAZE_API_BASE__"', JSON.stringify(HAZE_API_BASE));

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Haze" },
      {
        name: "description",
        content:
          "Track your Haze earnings, wallet activity, data streams and payouts in one live dashboard.",
      },
      { property: "og:title", content: "Dashboard — Haze" },
      {
        property: "og:description",
        content: "Track your Haze earnings, activity and payouts in one live dashboard.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  return <RawPage css={css} html={html} scripts={[{ code: script0 }]} />;
}
