"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { DEPARTMENT_NAME } from '@/lib/constants';
import PendingChecklist from '@/components/PendingChecklist';
import EventCalendar from '@/components/calendar/EventCalendar';
import ReportArchive from '@/components/ReportArchive';
import {
    Home,
    FilePlus,
    FolderOpen,
    Search,
    UserCircle,
    FileText,
    User,
    Settings as SettingsIcon,
    LogOut,
    Loader2,
    ShieldCheck
} from 'lucide-react';

export default function DashboardPage() {
    const router = useRouter();
    const supabase = createClient();

    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [userName, setUserName] = useState<string>("Faculty");
    const [isLoading, setIsLoading] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);

    // Fetch User Data on Load
    useEffect(() => {
        const fetchUser = async () => {
            setIsLoading(true);
            try {
                const { data: { user }, error: authError } = await supabase.auth.getUser();

                // Security Check: Kick out unauthenticated users
                if (authError || !user) {
                    router.push('/');
                    return;
                }

                // Try to get their actual name from the profiles table
                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('full_name, role, is_active')
                    .eq('id', user.id)
                    .single();

                setUserId(user.id);
                setIsAdmin(profileData?.role === 'admin' && profileData?.is_active !== false);
                if (profileData && profileData.full_name) {
                    // Extract first name for a friendly welcome
                    setUserName(profileData.full_name.split(' ')[0]);
                }
            } catch (error) {
                console.error("Error fetching user session:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchUser();
    }, [router, supabase]);

    const handleLogout = async () => {
        setIsProfileOpen(false);
        await supabase.auth.signOut();
        router.push('/');
    };

    if (isLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-[#F4F7FE] text-[#3168d8]">
                <Loader2 size={40} className="animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex min-h-screen bg-[#F4F7FE] text-black font-sans overflow-hidden">
            {/* Sidebar */}
            <aside className="w-64 bg-[#112a53] text-white flex flex-col shrink-0 relative z-50">
                <div className="p-6 flex items-center justify-center border-b border-white/10">
                    <Image
                        src="/christ-logo-white.png"
                        alt="Christ University"
                        width={160}
                        height={50}
                        className="brightness-0 invert object-contain"
                    />
                </div>

                <nav className="flex-1 mt-6 px-4 space-y-2">
                    {/* Active State (Home) */}
                    <button
                        onClick={() => router.push('/home')}
                        className="w-full flex items-center space-x-4 px-4 py-3 rounded-xl bg-[#3168d8] text-white shadow-md transition-colors"
                    >
                        <Home size={20} />
                        <span className="font-medium text-sm">Home</span>
                    </button>

                    <button
                        onClick={() => router.push('/home/new')}
                        className="w-full flex items-center space-x-4 px-4 py-3 rounded-xl text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                    >
                        <FilePlus size={20} />
                        <span className="font-medium text-sm">New</span>
                    </button>

                    <button
                        onClick={() => router.push('/home/open')}
                        className="w-full flex items-center space-x-4 px-4 py-3 rounded-xl text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                    >
                        <FolderOpen size={20} />
                        <span className="font-medium text-sm">Open</span>
                    </button>

                    {isAdmin && (
                        <button
                            onClick={() => router.push('/admin')}
                            className="w-full flex items-center space-x-4 px-4 py-3 rounded-xl text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                        >
                            <ShieldCheck size={20} />
                            <span className="font-medium text-sm">Admin dashboard</span>
                        </button>
                    )}
                </nav>
            </aside>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Top Navigation */}
                <header className="h-20 bg-white border-b border-gray-200 flex items-center justify-between px-10 shrink-0 relative z-40">
                    <h2 className="text-gray-500 font-bold text-sm uppercase tracking-wider">
                        {DEPARTMENT_NAME}
                    </h2>

                    <div className="flex items-center space-x-6">
                        <button className="text-gray-400 hover:text-gray-900 transition-colors">
                            <Search size={24} />
                        </button>

                        {/* Profile Dropdown */}
                        <div className="relative">
                            <button
                                onClick={() => setIsProfileOpen(!isProfileOpen)}
                                className="text-gray-500 hover:text-gray-900 transition-colors focus:outline-none flex items-center"
                            >
                                <UserCircle size={28} />
                            </button>

                            {isProfileOpen && (
                                <div className="absolute right-0 mt-3 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 animate-in fade-in zoom-in-95 z-50">
                                    <button onClick={() => { setIsProfileOpen(false); router.push('/settings'); }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center space-x-3 text-sm font-medium text-gray-700">
                                        <User size={16} className="text-gray-400" /> <span>Profile</span>
                                    </button>
                                    <button onClick={() => { setIsProfileOpen(false); router.push('/settings'); }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center space-x-3 text-sm font-medium text-gray-700">
                                        <FileText size={16} className="text-gray-400" /> <span>Requests</span>
                                    </button>
                                    <button onClick={() => { setIsProfileOpen(false); router.push('/settings'); }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center space-x-3 text-sm font-medium text-gray-700">
                                        <SettingsIcon size={16} className="text-gray-400" /> <span>Settings</span>
                                    </button>
                                    <div className="border-t border-gray-100 my-1"></div>
                                    <button
                                        onClick={handleLogout}
                                        className="w-full text-left px-4 py-2.5 hover:bg-red-50 flex items-center space-x-3 text-sm font-medium text-red-600 transition-colors"
                                    >
                                        <LogOut size={16} /> <span>Log Out</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                {/* Welcome Dashboard Content */}
                <main className="flex-1 p-8 overflow-y-auto">
                    <div className="max-w-7xl mx-auto space-y-8 pb-12">
                        {/* Welcome + quick actions */}
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-in fade-in duration-500">
                            <div>
                                <h1 className="text-3xl font-extrabold text-[#112a53] tracking-tight">Welcome, {userName}!</h1>
                                <p className="text-sm text-gray-500 mt-1">DeptDocs: activity reports for the {DEPARTMENT_NAME}.</p>
                            </div>
                            <div className="flex flex-wrap gap-3">
                                <button
                                    onClick={() => router.push('/home/new')}
                                    className="bg-[#3168d8] hover:bg-[#2552b0] text-white px-5 py-3 rounded-2xl font-bold text-sm flex items-center gap-2 transition-all shadow-md hover:shadow-lg"
                                >
                                    <FilePlus size={18} />
                                    <span>Create New Report</span>
                                </button>
                                <button
                                    onClick={() => router.push('/home/open')}
                                    className="bg-white border-2 border-gray-200 text-gray-700 hover:border-[#3168d8] hover:text-[#3168d8] px-5 py-3 rounded-2xl font-bold text-sm flex items-center gap-2 transition-all"
                                >
                                    <FolderOpen size={18} />
                                    <span>Open Existing</span>
                                </button>
                            </div>
                        </div>

                        {/* Faculty: the department's archive of approved reports (from Google Drive) */}
                        {userId && !isAdmin && <ReportArchive />}

                        {/* Admins: event calendar + checklist */}
                        {userId && isAdmin && (
                            <div className="grid grid-cols-1 xl:grid-cols-5 gap-8 items-start">
                                {/* Left: department events (admins schedule them here) */}
                                <div className="xl:col-span-3">
                                    <EventCalendar userId={userId} isAdmin={isAdmin} />
                                </div>
                                {/* Right: what this user still has to do */}
                                <div className="xl:col-span-2">
                                    <PendingChecklist userId={userId} isAdmin={isAdmin} />
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}
