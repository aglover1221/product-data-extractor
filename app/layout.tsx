import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import NavBar from "./_components/NavBar";

export const metadata: Metadata = {
  title: "product-mcp viewer",
  description: "Product portfolio + schema viewer."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-white/10">
          <div className="mx-auto max-w-[1400px] px-6 py-3 flex items-center gap-6">
            <Link href="/" className="font-semibold tracking-tight">
              product-mcp <span className="text-white/40 font-normal">viewer</span>
            </Link>
            <NavBar />
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
