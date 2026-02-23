import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Sniper — Auto-Buy Collectibles",
  description:
    "Monitor product availability and auto-purchase collectible boxes from Target, Walmart, and more.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-[family-name:var(--font-display)] antialiased bg-[var(--color-surface-0)] text-[var(--color-text-primary)] min-h-screen">
        {children}
      </body>
    </html>
  );
}
