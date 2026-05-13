import { Inter } from 'next/font/google';
import '@/css/styles.css';
import { Toaster } from 'sonner';
import { SettingsProvider } from '@/providers/settings-provider';
import { AuthProvider } from '@/providers/auth-provider';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'FTC Communication Portal',
  description: 'First Time Charging Communication System for Load Dispatch Centers',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <SettingsProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </SettingsProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
