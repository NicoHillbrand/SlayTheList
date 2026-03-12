import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SlayTheList",
  description: "Todo-powered game overlay",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
