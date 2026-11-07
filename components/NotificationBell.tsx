'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCircle2 } from 'lucide-react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/client';
import { isSafeInternalLink } from '@/lib/redirect';

interface Notification {
    id: string;
    user_id: string;
    title: string;
    message?: string;
    link?: string;
    is_read: boolean;
    created_at: string;
}

export default function NotificationBell() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [supabase] = useState(createClient);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const unreadCount = notifications.filter((n) => !n.is_read).length;

    useEffect(() => {
        let channel: RealtimeChannel | null = null;
        let cancelled = false;

        const setup = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user || cancelled) return;

            const { data } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(30);
            if (cancelled) return;
            if (data) setNotifications(data as Notification[]);

            channel = supabase
                .channel(`notifications:${user.id}`)
                .on(
                    'postgres_changes',
                    { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
                    (payload) => {
                        setNotifications((prev) => [payload.new as Notification, ...prev].slice(0, 30));
                    },
                )
                .subscribe();
        };
        setup();

        return () => {
            cancelled = true;
            if (channel) supabase.removeChannel(channel);
        };
    }, [supabase]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleToggleDropdown = async () => {
        const opening = !isOpen;
        setIsOpen(opening);
        if (!opening || unreadCount === 0) return;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
        await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
    };

    const handleNotificationClick = (link?: string) => {
        setIsOpen(false);
        // Only follow links inside this app; stored links are never trusted blindly.
        if (isSafeInternalLink(link)) router.push(link);
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={handleToggleDropdown}
                aria-label="Notifications"
                className={`p-2 rounded-full transition-colors ${isOpen ? 'bg-gray-100' : 'hover:bg-gray-100'}`}
            >
                <Bell size={20} className="text-gray-600" />
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white border-2 border-white">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-3 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50 animate-in fade-in zoom-in-95">
                    <div className="px-4 py-3 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                        <h3 className="font-bold text-sm text-gray-900">Notifications</h3>
                    </div>

                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                        {notifications.length === 0 ? (
                            <div className="p-8 text-center text-sm text-gray-400 flex flex-col items-center">
                                <CheckCircle2 size={32} className="text-gray-200 mb-3" />
                                You&apos;re all caught up!
                            </div>
                        ) : (
                            notifications.map((notif) => {
                                const clickable = isSafeInternalLink(notif.link);
                                return (
                                    <div
                                        key={notif.id}
                                        onClick={() => handleNotificationClick(notif.link)}
                                        className={`px-4 py-4 border-b border-gray-50 last:border-0 transition-colors ${clickable ? 'cursor-pointer hover:bg-gray-50' : ''} ${notif.is_read ? 'opacity-75' : 'bg-blue-50/30'}`}
                                    >
                                        <div className="flex justify-between items-start gap-2">
                                            <p className="text-sm font-bold text-gray-900 leading-tight">{notif.title}</p>
                                            {!notif.is_read && <span className="h-2 w-2 rounded-full bg-blue-500 mt-1 shrink-0"></span>}
                                        </div>
                                        {notif.message && (
                                            <p className="text-xs text-gray-600 mt-1.5 line-clamp-3 leading-relaxed">{notif.message}</p>
                                        )}
                                        <p className="text-[10px] text-gray-400 mt-2 font-medium">
                                            {new Date(notif.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
