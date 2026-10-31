import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import AccountSync from "@/components/AccountSync";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Third Degree",
  description: "You built it. Now own it. Map any repo, then get grilled on it.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* Keeps the local streak, queue and shelf in step with the account,
            for anyone who has one (§10a). Renders nothing. */}
        <AccountSync />
        <footer className="px-6 py-4 text-center text-sm text-ink-muted"><a href="https://github.com/lgoyal6/third-degree" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">GitHub</a></footer>
      </body>
    </html>
  );
}
