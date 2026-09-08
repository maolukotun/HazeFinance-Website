import { createFileRoute } from "@tanstack/react-router";
import { RawPage } from "@/components/RawPage";
import css from "@/content/dashboard.css?raw";
import html from "@/content/dashboard.html?raw";
import script0 from "@/content/dashboard.0.classic.js?raw";

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
