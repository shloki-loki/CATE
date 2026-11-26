import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = {
  title: 'CATE',
  description: 'Consume All Tokens Effectively: one chat that hands work to all your AI accounts.',
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#fafafa' }, { media: '(prefers-color-scheme: dark)', color: '#0b0d0f' }],
  width: 'device-width', initialScale: 1,
};

// Follows the operating system unless the user picked a theme with the top-right button (see ThemeButton).
// Applied before paint so there is no flash.
const themeScript = `try{var t=localStorage.getItem('cate-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable} data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
