"use client";

/**
 * /crawl — the full-window view of the overlay dungeon run.
 *
 * Same component and same server-side run as the overlay panel, just with room
 * to breathe. The panel is the intended way to play (hotkey, glance, close);
 * this page exists for setting up, reading the deck, and playing without the
 * desktop agent running.
 */
import { CrawlView } from "../../lib/crawl/CrawlView";
import styles from "./page.module.css";

export default function CrawlPage() {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.head}>
          <div>
            <h1 className={styles.title}>The Crawl</h1>
            <p className={styles.sub}>
              Energy is the gold you earned today. It expires at midnight and never touches your
              balance — the thing you spend here is the day&apos;s work.
            </p>
          </div>
          <a className={styles.back} href="/">
            ← App
          </a>
        </div>
        <div className={styles.panel}>
          <CrawlView />
        </div>
      </div>
    </div>
  );
}
