"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string }[] = [
  { href: "/", label: "Portfolio" },
  { href: "/schemas", label: "Schemas" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function NavBar() {
  const pathname = usePathname() || "/";
  return (
    <nav className="flex items-center gap-1 text-sm">
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
  );
}
