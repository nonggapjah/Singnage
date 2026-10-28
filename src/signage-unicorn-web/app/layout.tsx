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
  description: "Digital signage network management",
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
    // The interface copy is English; Thai content inside pages should carry lang="th" on its element.
    <html lang="en">
      <body className={`${notoThai.variable} font-sans antialiased bg-background text-foreground min-h-screen text-base leading-relaxed`}>
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
