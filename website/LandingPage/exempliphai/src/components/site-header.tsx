"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { cn, uiText } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";

export default function SiteHeader() {
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();
  const pathname = usePathname() || "";

  // Hide the Account button on /dashboard only (requested).
  const showAccountButton = !!user && pathname !== "/dashboard";

  return (
    <header className="fixed inset-x-0 top-0 z-50 py-4">
      <div className="container max-md:px-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between rounded-xl bg-background/60 p-2.5 backdrop-blur">
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
                <a
                  href={item.href}
                  className="text-foreground/70 transition hover:text-foreground"
                  key={item.label}
                >
                  {uiText(item.label)}
                </a>
              ))}
              <Link
                href={
                  user
                    ? (pathname.startsWith("/dashboard")
                        ? ("/account" as any)
                        : ("/dashboard" as any))
                    : (siteConfig.links.loginUrl as any)
                }
                className="text-foreground/70 transition hover:text-foreground"
              >
                {user
                  ? pathname.startsWith("/dashboard")
                    ? uiText("Account")
                    : uiText("Dashboard")
                  : uiText("Log in")}
              </Link>
            </nav>
          </section>

          <section className="flex items-center gap-2 max-md:gap-2.5">
            {showAccountButton ? (
              <Link
                href={"/account" as any}
                className={cn(
                  "inline-flex h-9 items-center justify-center rounded-md border bg-background/70 px-3 text-sm font-semibold text-foreground/80 backdrop-blur",
                  "shadow-sm transition hover:bg-background/90 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {uiText("Account")}
              </Link>
            ) : null}

            <ThemeToggle />
            <a
              href="https://chromewebstore.google.com/detail/exempliphai/aadcbojbcgmpfgegdmojpjmnkeibiemc"
              target="_blank"
              rel="noreferrer"
              className="max-md:hidden"
            >
              <ActionButton label={uiText("Add To Chrome")} />
            </a>
            <MobileNav
              open={isOpen}
              setOpen={setIsOpen}
              authed={!!user}
              currentPath={pathname}
              className="flex md:hidden"
            />
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
  currentPath,
  className,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  authed: boolean;
  currentPath: string;
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
            <div className="font-medium text-muted-foreground text-sm">{uiText("Menu")}</div>
            <div className="flex flex-col gap-3">
              {siteConfig.navItems.map((item) => (
                <MobileAnchor
                  key={item.label}
                  href={item.href}
                  onOpenChange={setOpen}
                >
                  {uiText(item.label)}
                </MobileAnchor>
              ))}
              <MobileLink
                href={
                  authed
                    ? currentPath.startsWith("/dashboard")
                      ? "/account"
                      : "/dashboard"
                    : siteConfig.links.loginUrl
                }
                onOpenChange={setOpen}
              >
                {authed
                  ? currentPath.startsWith("/dashboard")
                    ? uiText("Account")
                    : uiText("Dashboard")
                  : uiText("Log in")}
              </MobileLink>
              <MobileAnchor
                href="https://chromewebstore.google.com/detail/exempliphai/aadcbojbcgmpfgegdmojpjmnkeibiemc"
                onOpenChange={setOpen}
              >
                {uiText("Add To Chrome")}
              </MobileAnchor>
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
}: {
  href: string;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <Link
      href={href as any}
      onClick={() => {
        router.push(href as any);
        onOpenChange?.(false);
      }}
      className={cn("font-medium text-2xl", className)}
    >
      {children}
    </Link>
  );
}

function MobileAnchor({
  href,
  onOpenChange,
  className,
  children,
}: {
  href: string;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      onClick={() => onOpenChange?.(false)}
      className={cn("font-medium text-2xl", className)}
    >
      {children}
    </a>
  );
}
