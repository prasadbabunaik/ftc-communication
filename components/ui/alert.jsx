import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva('flex items-stretch w-full gap-2', {
  variants: {
    variant: {
      default: 'bg-muted text-foreground rounded-lg p-3.5 gap-2.5 text-sm',
      destructive: 'bg-red-50 text-red-700 border border-red-200 rounded-lg p-3.5 gap-2.5 text-sm dark:bg-red-950 dark:text-red-400 dark:border-red-900',
      warning: 'bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-lg p-3.5 gap-2.5 text-sm dark:bg-yellow-950 dark:text-yellow-400',
      success: 'bg-green-50 text-green-700 border border-green-200 rounded-lg p-3.5 gap-2.5 text-sm dark:bg-green-950 dark:text-green-400',
      info: 'bg-blue-50 text-blue-700 border border-blue-200 rounded-lg p-3.5 gap-2.5 text-sm dark:bg-blue-950 dark:text-blue-400',
    },
    size: {
      lg: 'rounded-lg p-4 gap-3 text-base',
      md: 'rounded-lg p-3.5 gap-2.5 text-sm',
      sm: 'rounded-md px-3 py-2.5 gap-2 text-xs',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

function Alert({ className, variant, size, ...props }) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant, size }), className)}
      {...props}
    />
  );
}

function AlertIcon({ className, ...props }) {
  return (
    <div
      data-slot="alert-icon"
      className={cn('flex shrink-0 [&_svg]:size-5', className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }) {
  return (
    <div
      data-slot="alert-title"
      className={cn('flex items-center font-medium', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-sm', className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertIcon, AlertTitle };
