import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "AI Investment Analyst",
  description: "AI-assisted investment research and portfolio allocation — not personalized financial advice.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
