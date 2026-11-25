import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = {
  title: 'CATE',
  description: 'Consume All Tokens Effectively: one chat that hands work to all your AI accounts.',
  robots: { index: false, follow: false },
};

export const viewport = { themeColor: '#0f1214', width: 'device-width', initialScale: 1 };

// Dark by default; a saved choice is applied before paint so there is no flash.
const themeScript = `try{var t=localStorage.getItem('cate-theme');if(t==='light')document.documentElement.dataset.theme='light'}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable} data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
