"use client";

import { BaseOverlayMini } from "../OverlayMini";
import styles from "../base.module.css";

/** Standalone chromeless mini base view (kept for direct embedding/linking;
 *  the desktop overlay taskbar embeds /overlay, which includes this too). */
export default function BaseOverlayPage() {
  return (
    <div className={styles.root} style={{ minHeight: "100vh", padding: "6px 8px 8px", overflow: "hidden" }}>
      <BaseOverlayMini />
    </div>
  );
}
