'use client';

import { Container } from '@/components/common/container';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer border-t border-border">
      <Container width="fluid">
        <div className="flex items-center justify-between py-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span>{currentYear} &copy;</span>
            <span className="text-secondary-foreground font-medium">Grid India</span>
            <span className="mx-1 opacity-40">·</span>
            <span>FTC Communication Portal</span>
          </div>
          <span>Designed and Developed by NLDC COE-SW</span>
        </div>
      </Container>
    </footer>
  );
}
