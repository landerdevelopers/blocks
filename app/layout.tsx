import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import MobileGate from "./components/MobileGate";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Resolves relative OG/twitter image paths to absolute URLs for crawlers.
  // Set NEXT_PUBLIC_SITE_URL to the production domain in env.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "Blocks — Production-Ready Figma Source Files",
  description:
    "Premium web, mobile, dashboard, and branding design source files. Fully editable, production-ready, and built to accelerate your next project.",
  keywords: [
    "Figma",
    "Figma blocks",
    "Figma components",
    "UI design",
    "design resources",
    "Lander Studio",
  ],
  authors: [{ name: "Lander Studio", url: "https://lander.studio/" }],
  openGraph: {
    title: "Blocks — Production-Ready Figma Source Files",
    description:
      "Premium web, mobile, dashboard, and branding design source files. Fully editable, production-ready, and built to accelerate your next project.",
    type: "website",
    siteName: "Blocks",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Blocks — Production-Ready Figma Source Files",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Blocks — Production-Ready Figma Source Files",
    description:
      "Premium web, mobile, dashboard, and branding design source files. Fully editable, production-ready, and built to accelerate your next project.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased bg-[#f5f5f5]`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
        <MobileGate />
      </body>
    </html>
  );
}
