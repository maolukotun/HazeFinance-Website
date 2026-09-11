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
      if (s.module) {
        el.type = "module";
        el.textContent = s.code;
      } else {
        // Classic (non-module) scripts declare their top-level `const`/`let`
        // bindings directly in the shared global lexical scope, and that
        // scope outlives this one <script> element for the lifetime of the
        // page. If this effect ever re-runs (e.g. this component remounts
        // after an unrelated error elsewhere on the page gets caught by a
        // React error boundary and the tree is recreated from scratch),
        // re-injecting the exact same script text throws
        // `SyntaxError: Identifier '...' has already been declared` instead
        // of quietly re-running. Wrapping in an IIFE gives each injected
        // script its own function scope, so re-running it is harmless.
        el.textContent = `(function(){\n${s.code}\n})();`;
      }
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
