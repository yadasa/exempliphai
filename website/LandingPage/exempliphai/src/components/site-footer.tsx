import Image from "next/image";
import Link from "next/link";
import { Github, Instagram, Linkedin, Twitter } from "lucide-react";
import { siteConfig } from "@/config/site-config";

export default function SiteFooter() {
  return (
    <footer className="mt-20 border-t bg-background">
      <div className="container py-12">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          {/* Left */}
          <div className="space-y-5 text-sm text-muted-foreground">
            <div className="flex items-center gap-3">
              <div className="inline-flex size-11 items-center justify-center rounded-xl border bg-card">
                <Image
                  src="/icons/logo-main.png"
                  alt="exempliphai logo"
                  width={30}
                  height={30}
                />
              </div>
              <div className="font-semibold text-foreground">exempliphai</div>
            </div>

            <p className="max-w-md">
              From summarization to strategy, exempliphai helps your team move
              from information to action — faster.
            </p>

            <ul className="flex flex-wrap gap-x-8 gap-y-3">
              <li>
                <a className="hover:text-primary" href="#features">
                  Features
                </a>
              </li>
              <li>
                <a className="hover:text-primary" href="#how-it-works">
                  How it works
                </a>
              </li>
              <li>
                <a className="hover:text-primary" href="#testimonials">
                  Testimonials
                </a>
              </li>
              <li>
                <a className="hover:text-primary" href="#waitlist">
                  Join waitlist
                </a>
              </li>
            </ul>
          </div>

          {/* Right */}
          <div className="rounded-xl border bg-card p-6">
            <h3 className="font-semibold text-foreground">
              Subscribe to updates
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Product updates, launch notes, and resources — occasionally.
            </p>
            <form className="mt-5 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                placeholder="Enter your email"
                className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none"
              />
              <button
                type="submit"
                className="h-11 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
              >
                Subscribe
              </button>
            </form>
          </div>
        </div>

        <div className="my-8 h-px w-full bg-border" />

        <div className="flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} exempliphai. All rights reserved.</p>

          <div className="flex items-center gap-4">
            <Link
              href={siteConfig.links.repositoryUrl || "#"}
              aria-label="GitHub"
              className="hover:text-foreground"
            >
              <Github className="size-4" />
            </Link>
            <Link href="#" aria-label="Twitter" className="hover:text-foreground">
              <Twitter className="size-4" />
            </Link>
            <Link
              href="#"
              aria-label="LinkedIn"
              className="hover:text-foreground"
            >
              <Linkedin className="size-4" />
            </Link>
            <Link
              href="#"
              aria-label="Instagram"
              className="hover:text-foreground"
            >
              <Instagram className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
