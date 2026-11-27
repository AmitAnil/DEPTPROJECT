import { NextResponse } from 'next/server';
import { getAuthContext, unauthorized } from '@/lib/auth';
import { sortArchive, toArchivedReport } from '@/lib/archive';
import { createAdminClient } from '@/utils/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Every approved (archived) report, for any signed-in DeptDocs user. Only list details are
 * returned (title, date, type, venue, organizer); the PDF is opened through /api/archive/[id]/pdf.
 */
export async function GET() {
    const ctx = await getAuthContext();
    if (!ctx) return unauthorized();

    const { data, error } = await createAdminClient()
        .from('reports')
        .select('id, title, data, updated_at, profiles!reports_owner_id_fkey(full_name)')
        .eq('status', 'approved')
        .order('updated_at', { ascending: false })
        .limit(2000);
    if (error) {
        console.error('Archive list failed:', error.message);
        return NextResponse.json({ error: 'Could not load the archive.' }, { status: 500 });
    }
    return NextResponse.json({ reports: sortArchive((data ?? []).map(toArchivedReport)) });
}
