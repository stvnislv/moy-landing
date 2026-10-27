import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import { site } from "@/config/site";
import "./globals.css";

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500"],
  variable: "--font-onest",
  display: "swap",
});

const title = `${site.name}: ${site.role}`;

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title,
  description: site.description,
  openGraph: {
    title,
    description: site.description,
    type: "website",
    locale: "ru_RU",
  },
};

export const viewport: Viewport = {
  themeColor: "#f2f2f4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={onest.variable}>
      <body className="font-sans">
        <div className="backdrop" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
