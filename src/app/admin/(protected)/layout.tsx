import { redirect } from 'next/navigation';
import { adminAuthenticated } from '@/lib/server/auth';
import { AdminShell } from '@/components/admin-shell';
export const dynamic = 'force-dynamic';
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let authenticated = false;
  try {
    authenticated = await adminAuthenticated();
  } catch {
    /* Configuration failures cannot grant access. */
  }
  if (!authenticated) redirect('/admin/login');
  return <AdminShell>{children}</AdminShell>;
}
