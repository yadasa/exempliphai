export const siteConfig = {
  name: "exempliphai",
  description:
    "exempliphai automates your job search with auto-search, resume tailoring, autofill, and tracking — privacy first.",
  creator: "exempliphai",
  links: {
    repositoryUrl: "",
    creatorGithubUrl: "",
    // Used for OpenGraph/Twitter URL resolution.
    // Set NEXT_PUBLIC_SITE_URL in production to avoid Next.js metadataBase warnings.
    deploymentUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    loginUrl: "/login",
    waitlistUrl: "/download",
  },
  openGraph: {
    imageUrl: "/product-image.jpg",
    imageWidth: 1200,
    imageHeight: 630,
  },
  twitter: {
    creator: "@exempliphai",
    cardType: "summary_large_image",
    imageUrl: "/product-image.jpg",
  },
  navItems: [
    { label: "Features", href: "https://exempliph.ai/#features" },
    { label: "How it works", href: "https://exempliph.ai/#how-it-works" },
    { label: "Testimonials", href: "https://exempliph.ai/#testimonials" },
    { label: "FAQ", href: "https://exempliph.ai/#faq" },
  ],
} as const;

export type SiteConfig = typeof siteConfig;
