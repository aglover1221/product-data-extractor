"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const ITEMS: { href: string; label: string }[] = [
  { href: "/", label: "Portfolio" },
  { href: "/inbox", label: "Inbox" },
  { href: "/pipeline/discover", label: "Discover" },
  { href: "/pipeline/sources", label: "Sources" },
  { href: "/pipeline/parse", label: "Parse" },
  { href: "/pipeline/schema", label: "Schemas" },
  { href: "/pipeline/extract", label: "Extract" },
  { href: "/pipeline/runs", label: "Runs" },
  { href: "/pipeline/audit", label: "Audit" },
  { href: "/usage", label: "Usage" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function findActiveItem(pathname: string) {
  let best: { href: string; label: string } | undefined;
  for (const it of ITEMS) {
    if (!isActive(pathname, it.href)) continue;
    if (!best || it.href.length > best.href.length) best = it;
  }
  return best;
}

export default function NavBar() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeItem = useMemo(() => findActiveItem(pathname), [pathname]);
  const breadcrumbLabel = useMemo(() => {
    const base = activeItem?.label ?? "Menu";
    if (!activeItem) return base;
    const remainder = pathname
      .slice(activeItem.href === "/" ? 1 : activeItem.href.length)
      .split("/")
      .filter(Boolean)
      .map((seg) => {
        try {
          return decodeURIComponent(seg);
        } catch {
          return seg;
        }
      });
    if (remainder.length === 0) return base;
    return [base, ...remainder].join(" / ");
  }, [activeItem, pathname]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="sm:hidden inline-flex items-center gap-2 rounded px-2 py-1 text-sm text-white/80 hover:text-white hover:bg-white/5 transition max-w-[60vw]"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="navbar-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{breadcrumbLabel}</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 text-white/60 transition ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.7a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open ? (
        <div
          id="navbar-menu"
          role="menu"
          className="sm:hidden absolute right-0 mt-2 w-64 rounded-md border border-white/10 bg-[#0a0a0b] shadow-xl shadow-black/40 p-1"
        >
          {ITEMS.map((it) => {
            const active = isActive(pathname, it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                role="menuitem"
                className={`block px-3 py-2 rounded text-sm transition ${
                  active
                    ? "text-white bg-white/10"
                    : "text-white/70 hover:text-white hover:bg-white/5"
                }`}
                onClick={() => setOpen(false)}
              >
                {it.label}
              </Link>
            );
          })}
        </div>
      ) : null}

      <nav className="hidden sm:flex items-center flex-wrap gap-1 text-sm">
        {ITEMS.map((it) => {
          const active = isActive(pathname, it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`px-2 py-1 rounded transition ${
                active
                  ? "text-white bg-white/10"
                  : "text-white/60 hover:text-white/90 hover:bg-white/5"
              }`}
            >
              {it.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
