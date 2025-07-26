// app/layout.tsx
import './globals.css';
import TopBar from '@/components/TopBar';
import { Inter } from 'next/font/google';
import { Metadata } from 'next';
import AudioPlayerBar from "@/components/AudioPlayerBar"; // adjust path if needed


const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Podcast App',
  description: 'Listen and search podcasts',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen font-sans bg-white dark:bg-black text-black dark:text-white flex flex-col`}>
        <TopBar />
        <main className="flex-1 overflow-y-auto px-6 py-8">{children}</main>
        <AudioPlayerBar />
      </body>
    </html>
  );
}
