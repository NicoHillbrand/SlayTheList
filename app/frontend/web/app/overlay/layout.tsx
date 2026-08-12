import type { ReactNode } from "react";

/**
 * Surface rules for the overlay routes, applied in the SERVER-RENDERED HTML.
 *
 * This used to be a class toggled from a `useEffect` in the page, which is too
 * late by construction: the browser paints the document — background image and
 * all — before React hydrates, so every panel launch flashed the main app's
 * artwork before turning into a panel. A style tag in the layout is in the markup
 * from the first byte, so there is no frame where the wrong thing is painted.
 *
 * Targets `html`/`body` with no class, because this style only exists in the
 * documents this layout renders — the overlay routes. React removes it again if
 * the user ever client-navigates out, so it cannot leak into the main app.
 *
 * What it does, and why each part earns its `!important` (it is overriding
 * globals.css, which legitimately wants these values everywhere else):
 *
 *  - NO ARTWORK, FLAT PANEL COLOUR. The panel windows hug their content, so any
 *    pixel the page does not cover is painted by the body — and #16162a is also
 *    the WPF window background and the strip either side of the WebView (held off
 *    the edge so the resize border is grabbable). One colour across all three
 *    means no seam and no visible bands, whatever the fit rounds to.
 *  - NO SCROLLBARS, EVER. Resizing rescales the page, and mid-reflow the content
 *    can exceed the viewport for a frame or two, which flickered a scrollbar in
 *    and out. There is nothing to scroll to in a panel that is sized to its
 *    content, so the scrollbar is only ever an artefact.
 */
const OVERLAY_SURFACE_CSS = `
html,
body {
  background-image: none !important;
  background-color: #16162a !important;
  overflow: hidden !important;
  scrollbar-width: none !important;
}
html::-webkit-scrollbar,
body::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
}
`;

export default function OverlayLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: OVERLAY_SURFACE_CSS }} />
      {children}
    </>
  );
}
