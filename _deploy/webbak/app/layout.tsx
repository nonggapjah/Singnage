import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const notoThai = Noto_Sans_Thai({
  weight: ['100', '300', '400', '500', '700', '900'],
  subsets: ["latin", "thai"],
  variable: "--font-noto-sans-thai",
});

export const metadata: Metadata = {
  title: "Signage Unicorn | Admin Console",
  description: "Enterprise Signage Network Management",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#000000",
};

import { Providers } from "@/components/providers/Providers";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body className={`${notoThai.variable} font-sans antialiased bg-background text-foreground min-h-screen text-base leading-relaxed`}>
        <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,242,255,0.05)_0%,transparent_50%)] pointer-events-none" />
        <Providers>
          <ServiceWorkerRegistration />
          <main className="relative z-10">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
