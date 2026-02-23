import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Sniper - Auto-Buy Collectibles",
  description:
    "Monitor product availability and auto-purchase collectible boxes from Target, Walmart, and more.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-neutral-950 text-neutral-100">
        {children}
      </body>
    </html>
  );
}
