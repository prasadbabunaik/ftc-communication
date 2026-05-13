import { GovLoader } from '@/components/ui/gov-loader';

export default function Loading() {
  return (
    <GovLoader
      overlay
      size="page"
      theme="navy"
      label="Loading the portal"
      sublabel="Please wait. Do not refresh this page."
    />
  );
}
