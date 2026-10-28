import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { HouseholdProvider } from "@/components/HouseholdProvider";
import { PricesProvider } from "@/components/PricesProvider";
import { SplashScreen } from "@/components/SplashScreen";
import { TextSize } from "@/components/TextSize";

// Runs before first paint so the saved text size never flashes. Keep in sync
// with components/TextSize.tsx (key + scales).
const TEXT_SIZE_SCRIPT = `try{var s=localStorage.getItem("rto-text-size");var z=s==="larger"?"1.12":s==="largest"?"1.25":"";if(z)document.documentElement.style.zoom=z}catch(e){}`;

export const metadata: Metadata = {
  title: "Retirement Tax Optimizer",
  description:
    "Plan tax-efficient withdrawals across your 401(k)s, IRAs, Roth, brokerage, and Social Security — filing jointly.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Retire Tax" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
};

export const viewport: Viewport = {
  themeColor: "#0d4f4a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEXT_SIZE_SCRIPT }} />
      </head>
      <body className="min-h-full text-foreground antialiased">
        {/* iOS 26 scroll-edge fade suppressor: see .top-band in globals.css. */}
        <div className="top-band" aria-hidden="true" />
        <HouseholdProvider>
          <PricesProvider>
            {/* Offset for the desktop sidebar; phone has a bottom bar instead. */}
            <div className="lg:pl-56">
              <main
                className="page-enter mx-auto w-full max-w-md px-4 lg:max-w-4xl lg:px-8 lg:py-6 xl:max-w-5xl"
                style={{
                  paddingTop: "calc(var(--safe-top) + var(--top-band))",
                  paddingBottom: "calc(6rem + env(safe-area-inset-bottom))",
                }}
              >
                {children}
              </main>
            </div>
            <TabBar />
            <TextSize />
            {/* Launch splash: server-rendered, so it's on screen from the first
                paint while the app hydrates underneath. */}
            <SplashScreen />
          </PricesProvider>
        </HouseholdProvider>
      </body>
    </html>
  );
}
