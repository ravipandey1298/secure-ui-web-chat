import { Links } from '@/components/links';
import { config } from '@/lib/server/config';
export default function LinksPage() {
  return <Links defaultExpiry={config().LINK_EXPIRY_MINUTES} />;
}
