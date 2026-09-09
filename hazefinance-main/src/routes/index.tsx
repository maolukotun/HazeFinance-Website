import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { RawPage } from "@/components/RawPage";
import { initLandingScene } from "@/content/landing-scene.js";
import css from "@/content/landing.css?raw";
import html from "@/content/landing.html?raw";
import script0 from "@/content/landing.0.classic.js?raw";

export const Route = createFileRoute("/")({
  head: () => ({
    links: [
      { rel: "preload", as: "image", href: "/hero-poster.jpg" },
      { rel: "preload", as: "fetch", href: "/model.glb", crossOrigin: "anonymous" },
    ],
    meta: [
      { title: "Haze — Turn wallet data into passive yield" },
      {
        name: "description",
        content:
          "Haze lets you monetize anonymized on-chain wallet activity and earn continuous yield while staying private.",
      },
      { property: "og:title", content: "Haze — Turn wallet data into passive yield" },
      {
        property: "og:description",
        content:
          "Monetize anonymized on-chain wallet activity and earn continuous yield while staying private.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  useEffect(() => {
    return initLandingScene();
  }, []);

  return <RawPage css={css} html={html} scripts={[{ code: script0 }]} />;
}
