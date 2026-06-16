import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { HouseholdProvider } from "@/components/HouseholdProvider";
import { ModeBanner } from "@/components/ModeBanner";

export const metadata: Metadata = {
  title: "Retirement Tax Optimizer",
  description:
    "Plan tax-efficient withdrawals across your 401(k)s, IRAs, Roth, brokerage, and Social Security — filing jointly.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Retire Tax" },
  formatDetection: { telephone: false },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0d4f4a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full text-foreground antialiased">
        <HouseholdProvider>
          <main
            className="page-enter mx-auto w-full max-w-md px-4"
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "calc(6rem + env(safe-area-inset-bottom))",
            }}
          >
            <ModeBanner />
            {children}
          </main>
          <TabBar />
        </HouseholdProvider>
      </body>
    </html>
  );
}
