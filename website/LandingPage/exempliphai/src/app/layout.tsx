import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/app/globals.css";
import type { ReactNode } from "react";
import { siteConfig } from "@/config/site-config";
import { cn } from "@/lib/utils";
import Script from "next/script";
import { CustomCursor } from "@/components/custom-cursor";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: siteConfig.name,
  description: siteConfig.description,
  creator: siteConfig.creator,
  openGraph: {
    type: "website",
    url: siteConfig.links.deploymentUrl,
    title: siteConfig.name,
    description: siteConfig.description,
    images: [
      {
        url: siteConfig.openGraph.imageUrl,
        width: siteConfig.openGraph.imageWidth,
        height: siteConfig.openGraph.imageHeight,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    creator: siteConfig.twitter.creator,
    images: siteConfig.twitter.imageUrl,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          inter.className,
          "antialiased selection:bg-blue-500/20 selection:text-foreground",
        )}
        suppressHydrationWarning
      >
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const saved = localStorage.getItem('theme');
    const theme = saved === 'dark' || saved === 'light'
      ? saved
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
  } catch (_) {}
})();`,
          }}
        />
        <CustomCursor />
        <main className="flex min-h-screen flex-col">{children}</main>
      </body>
    </html>
  );
}
