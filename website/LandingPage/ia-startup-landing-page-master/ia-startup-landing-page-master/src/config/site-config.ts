export const siteConfig = {
  name: "AI Startup Landing Page",
  description: "AI SaaS Landing Page. Built by MrInspection.",
  creator: "MrInspection",
  links: {
    repositoryUrl: "https://github.com/MrInspection/ia-startup-landing-page",
    creatorGithubUrl: "https://github.com/MrInspection/",
    deploymentUrl: "https://splabs-ai-startup-lp.vercel.app/",
  },
  openGraph: {
    imageUrl: "https://splabs-ai-startup-lp.vercel.app/opengraph-image.png",
    imageWidth: 1200,
    imageHeight: 630,
  },
  twitter: {
    creator: "@MrInspection",
    cardType: "summary_large_image",
    imageUrl: "https://splabs-ai-startup-lp.vercel.app/opengraph-image.png",
  },
  navItems: [
    {
      label: "Features",
      href: "#",
    },
    {
      label: "Developers",
      href: "#",
    },
    {
      label: "Pricing",
      href: "#",
    },
    {
      label: "Changelog",
      href: "#",
    },
  ],
};
export type SiteConfig = typeof siteConfig;
