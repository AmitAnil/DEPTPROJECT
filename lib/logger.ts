import { createClient } from '@/utils/supabase/client';

/** Appends an entry to the admin activity feed. Failures are logged, never thrown. */
export const logActivity = async (actionType: string, description: string, targetId?: string) => {
    try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
        const metaName = [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(' ');

        const { error } = await supabase.from('activity_logs').insert({
            user_id: user.id,
            user_name: profile?.full_name || metaName || user.email,
            action_type: actionType,
            description,
            target_id: targetId,
        });
        if (error) console.error('Activity log failed:', error.message);
    } catch (err) {
        console.error('Activity log failed:', err);
    }
};
