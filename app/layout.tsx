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
        <header className="border-b border-white/10">
          <div className="mx-auto max-w-[1400px] px-6 py-3 flex items-center gap-6">
            <Link href="/" className="font-semibold tracking-tight">
              product-data-extractor <span className="text-white/40 font-normal">studio</span>
            </Link>
            <NavBar />
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
