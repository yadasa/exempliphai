import { Star } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { Icons } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/config/site-config";
import { cn } from "@/lib/utils";

export default function SiteFooter() {
  return (
    <>
      <footer className="border-t-2 py-6 md:px-8 md:py-0">
        <div className="container flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row md:px-20">
          <section className="flex items-center gap-3">
            <div className="inline-flex size-8 items-center justify-center rounded-lg border">
              <Icons.logo className="size-6 h-auto" />
            </div>
            <p className="font-medium">AI Startup Landing Page</p>
          </section>
          <div>
            <ul className="flex justify-center gap-3 text-white/40">
              <li className="cursor-pointer hover:text-white">
                <Icons.x />
              </li>
              <li className="cursor-pointer hover:text-white">
                <Icons.instagram />
              </li>
              <li className="cursor-pointer hover:text-white">
                <Icons.youtube />
              </li>
            </ul>
          </div>
        </div>
      </footer>
      <CreatorSection />
    </>
  );
}

function CreatorSection() {
  return (
    <section className="border-t-2 bg-black p-4">
      <div className="container flex items-center justify-between max-md:flex-col max-md:gap-4 md:px-20">
        <div className="text-muted-foreground text-sm max-md:text-balance max-md:text-center">
          Build by{" "}
          <a
            href={siteConfig.links.creatorGithubUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-4"
          >
            Moussa
          </a>
          . The source code is available on{" "}
          <a
            href={siteConfig.links.repositoryUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-4"
          >
            GitHub
          </a>
          .
        </div>
        <div className="max-md:hidden">
          <Link
            href={siteConfig.links.repositoryUrl as Route}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Star className="size-4 fill-current" /> Star on GitHub
          </Link>
        </div>
      </div>
    </section>
  );
}
