import type { Metadata } from "next";
import { Manrope, DM_Serif_Display } from "next/font/google";
import { TrpcProvider } from "@/components/trpc-provider";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "POS",
  description: "Restaurant & cafe point of sale",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${dmSerifDisplay.variable}`}>
      <body className="font-sans bg-bg text-text antialiased">
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
