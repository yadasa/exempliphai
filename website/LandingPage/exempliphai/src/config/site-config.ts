export const siteConfig = {
  name: "exempliphai",
  description:
    "ExempliPhai automates your job search with auto-search, resume tailoring, autofill, and tracking — privacy first.",
  creator: "exempliphai",
  links: {
    repositoryUrl: "",
    creatorGithubUrl: "",
    // Used for OpenGraph/Twitter URL resolution.
    // Set NEXT_PUBLIC_SITE_URL in production to avoid Next.js metadataBase warnings.
    deploymentUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    loginUrl: "/login",
    waitlistUrl: "/#waitlist",
  },
  openGraph: {
    imageUrl: "/opengraph-image.png",
    imageWidth: 1200,
    imageHeight: 630,
  },
  twitter: {
    creator: "@exempliphai",
    cardType: "summary_large_image",
    imageUrl: "/opengraph-image.png",
  },
  navItems: [
    { label: "Features", href: "#features" },
    { label: "How it works", href: "#how-it-works" },
    { label: "Testimonials", href: "#testimonials" },
    { label: "FAQ", href: "#faq" },
  ],
} as const;

export type SiteConfig = typeof siteConfig;
