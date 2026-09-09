import { useEffect } from "react";

type Script = { code: string; module?: boolean };

/**
 * Renders a self-contained HTML page (markup + CSS + inline scripts) inside the app.
 */
export function RawPage({
  css,
  html,
  scripts = [],
}: {
  css: string;
  html: string;
  scripts?: Script[];
}) {
  useEffect(() => {
    const added: HTMLScriptElement[] = [];
    for (const s of scripts) {
      const el = document.createElement("script");
      if (s.module) el.type = "module";
      el.textContent = s.code;
      document.body.appendChild(el);
      added.push(el);
    }
    return () => {
      added.forEach((el) => el.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}
