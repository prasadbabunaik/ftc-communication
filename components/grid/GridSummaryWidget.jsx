'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Zap, FileText, Cable, TrendingUp } from 'lucide-react';

export function GridSummaryWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/grid/summary')
      .then((r) => r.json())
      .then((d) => { setData(d.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border bg-card p-5 animate-pulse">
        <div className="h-4 w-48 bg-muted rounded mb-4" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const cards = [
    {
      icon: FileText,
      label: 'CONTD-4 Pending',
      value: data.contd4.pending,
      sub: `of ${data.contd4.total} total`,
      href: '/contd4',
      color: 'amber',
    },
    {
      icon: Zap,
      label: 'Pending FTC (MW)',
      value: data.generation.pendingFtcMw.toFixed(0),
      sub: `${data.generation.totalProjectsMw.toFixed(0)} MW total projects`,
      href: '/generation',
      color: 'blue',
    },
    {
      icon: TrendingUp,
      label: 'COD This Month (MW)',
      value: data.generation.codThisMonthMw.toFixed(0),
      sub: `${data.generation.commissionedMw.toFixed(0)} MW all time`,
      href: '/generation',
      color: 'emerald',
    },
    {
      icon: Cable,
      label: 'Tx Elements (FTC)',
      value: data.transmission.pending,
      sub: `of ${data.transmission.total} total`,
      href: '/transmission',
      color: 'purple',
    },
  ];

  const colorMap = {
    amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   value: 'text-amber-700' },
    blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',    value: 'text-blue-700' },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', value: 'text-emerald-700' },
    purple:  { bg: 'bg-purple-50',  icon: 'text-purple-600',  value: 'text-purple-700' },
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-foreground text-sm">Grid Integration Tracker</h2>
        <Link href="/generation" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
          View all →
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((card) => {
          const c = colorMap[card.color];
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className={`rounded-lg p-4 ${c.bg} hover:opacity-90 transition-opacity`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`size-4 ${c.icon}`} />
                <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
              </div>
              <p className={`text-2xl font-bold ${c.value}`}>{card.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
