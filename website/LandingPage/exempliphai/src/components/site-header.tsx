"use client";

import type { Route } from "next";
import Image from "next/image";
import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useState } from "react";
import { ActionButton } from "@/components/action-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { siteConfig } from "@/config/site-config";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";

export default function SiteHeader() {
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();

  return (
    <header className="absolute inset-x-0 top-0 z-20 bg-transparent py-4">
      <div className="container max-md:px-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between md:rounded-xl md:border md:bg-background/60 md:p-2.5 md:backdrop-blur">
          <Link href="/" className="flex items-center gap-3">
            <div className="inline-flex size-10 items-center justify-center rounded-lg bg-transparent">
              <Image
                src="/icons/logo-main.png"
                alt="exempliphai logo"
                width={28}
                height={28}
                priority
              />
            </div>
            <span
              className={cn(
                "text-lg tracking-tight",
                "font-black",
                "[font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Segoe UI',sans-serif]",
              )}
            >
              exempliphai
            </span>
          </Link>

          <section className="max-md:hidden">
            <nav aria-label="Primary" className="flex items-center gap-8 text-sm">
              {siteConfig.navItems.map((item) => (
                <Link
                  href={item.href as Route}
                  className="text-foreground/70 transition hover:text-foreground"
                  key={item.label}
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href={(user ? "/dashboard" : siteConfig.links.loginUrl) as Route}
                className="text-foreground/70 transition hover:text-foreground"
              >
                {user ? "Account" : "Log in"}
              </Link>
            </nav>
          </section>

          <section className="flex items-center gap-2 max-md:gap-2.5">
            <ThemeToggle />
            <Link href={siteConfig.links.waitlistUrl as Route} className="max-md:hidden">
              <ActionButton label="Add to Chrome" />
            </Link>
            <MobileNav open={isOpen} setOpen={setIsOpen} authed={!!user} className="flex md:hidden" />
          </section>
        </div>
      </div>
    </header>
  );
}

function MobileNav({
  open,
  setOpen,
  authed,
  className,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  authed: boolean;
  className?: string;
}) {
  const contentId = useId();

  // Prevent body scroll when the menu is open
  useEffect(() => {
    if (typeof window === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = open ? "hidden" : prev || "";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-expanded={open}
          aria-controls={contentId}
          className={cn(
            "extend-touch-target !p-0 flex size-9 touch-manipulation items-center justify-center",
            className,
          )}
        >
          <div className="relative flex h-8 w-4 items-center justify-center">
            <div className="relative size-4">
              <span
                className={cn(
                  "absolute left-0 block h-0.5 w-4 bg-foreground transition-all duration-100",
                  open ? "-rotate-45 top-[0.4rem]" : "top-1",
                )}
              />
              <span
                className={cn(
                  "absolute left-0 block h-0.5 w-4 bg-foreground transition-all duration-100",
                  open ? "top-[0.4rem] rotate-45" : "top-2.5",
                )}
              />
            </div>
            <span className="sr-only">Toggle Menu</span>
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        id={contentId}
        className="no-scrollbar h-(--radix-popper-available-height) w-(--radix-popper-available-width) overflow-y-auto rounded-none border-none bg-background/90 p-0 shadow-none backdrop-blur duration-150"
        align="start"
        side="bottom"
        alignOffset={-32}
        sideOffset={16}
      >
        <div className="flex flex-col gap-10 overflow-auto px-6 py-6">
          <div className="flex flex-col gap-4">
            <div className="font-medium text-muted-foreground text-sm">Menu</div>
            <div className="flex flex-col gap-3">
              {siteConfig.navItems.map((item) => (
                <MobileLink
                  key={item.label}
                  href={item.href as Route}
                  onOpenChange={setOpen}
                >
                  {item.label}
                </MobileLink>
              ))}
              <MobileLink
                href={(authed ? "/dashboard" : siteConfig.links.loginUrl) as Route}
                onOpenChange={setOpen}
              >
                {authed ? "Account" : "Log in"}
              </MobileLink>
              <MobileLink href={siteConfig.links.waitlistUrl as Route} onOpenChange={setOpen}>
                Add to Chrome
              </MobileLink>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MobileLink({
  href,
  onOpenChange,
  className,
  children,
  ...props
}: LinkProps<Route> & {
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={() => {
        router.push(href as Route);
        onOpenChange?.(false);
      }}
      className={cn("font-medium text-2xl", className)}
      {...props}
    >
      {children}
    </Link>
  );
}
