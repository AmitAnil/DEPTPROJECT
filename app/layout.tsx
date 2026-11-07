import type { Metadata } from "next";
// Self-hosted Geist fonts (no build-time download from Google Fonts, so builds work offline / behind proxies).
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { DEPARTMENT_NAME } from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: "DeptDocs | Christ University",
  description: `Automated Report Generation for the ${DEPARTMENT_NAME}`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
