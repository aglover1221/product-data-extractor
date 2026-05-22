import type { Metadata } from "next";
import Link from "next/link";
import NavBar from "./_components/NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Product Data Extractor",
  description: "Studio for product data extraction — portfolio, schemas, source manifests, and pipeline orchestration."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0b]/80 backdrop-blur">
          <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
            <Link href="/" className="shrink-0 font-semibold tracking-tight">
              product-data-extractor <span className="text-white/40 font-normal">studio</span>
            </Link>
            <div className="min-w-0 flex items-center justify-end">
              <NavBar />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
