"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
    User, Settings as SettingsIcon, LogOut, FileText, Edit,
    Lock, Settings2, Check, UserCircle, ArrowLeft, UploadCloud, Loader2, Bell
} from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import StoredImage from '@/components/StoredImage';
import { DEPARTMENT_NAME } from '@/lib/constants';
import { describeUploadError, uploadSignature } from '@/lib/files';
import { kickEmailDispatch } from '@/lib/notifyClient';

interface Profile {
    id: string;
    full_name: string;
    designation: string;
    department: string;
    email: string;
    signature_url: string;
    email_notifications: boolean;
}

interface CollabRequest {
    id: string;
    status: string;
    reports: { title: string | null; profiles: { full_name: string | null; email: string | null } | null } | null;
}

type SettingsTabId = 'Profile' | 'Requests' | 'Settings';
const TABS: SettingsTabId[] = ['Profile', 'Requests', 'Settings'];

// --- SUB-COMPONENTS ---

interface ProfileTabProps {
    profile: Profile;
    setProfile: React.Dispatch<React.SetStateAction<Profile>>;
    onSave: () => void;
    isSaving: boolean;
    onUploadSignature: (e: React.ChangeEvent<HTMLInputElement>) => void;
    isUploading: boolean;
}

const ProfileTab = ({ profile, setProfile, onSave, isSaving, onUploadSignature, isUploading }: ProfileTabProps) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    return (
        <div className="animate-in fade-in duration-300">
            <div className="flex items-start space-x-6 mb-8">
                <div className="w-24 h-24 bg-gray-900 rounded-full flex items-center justify-center text-white shrink-0 overflow-hidden relative">
                    <UserCircle size={64} strokeWidth={1} />
                </div>
                <div className="flex flex-col pt-2">
                    <h2 className="text-2xl font-bold text-gray-900">{profile.full_name || 'Your Name'}</h2>
                    <span className="text-sm text-gray-500 font-medium">{profile.designation || 'Designation'} &gt;</span>
                    <span className="text-sm text-gray-500 font-medium mb-2">{profile.department || 'Department'} &gt;</span>
                    <div className="flex items-center space-x-4 text-sm text-gray-400">
                        <span>{profile.email}</span>
                    </div>
                </div>
            </div>

            <div className="border border-gray-200 rounded-2xl p-6 bg-white/50">
                <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-sm font-bold text-gray-700">Name</label>
                            <Edit size={14} className="text-gray-400" />
                        </div>
                        <input
                            type="text"
                            value={profile.full_name || ''}
                            onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                            className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#3b5998]"
                        />
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-sm font-bold text-gray-700">Designation</label>
                            <Edit size={14} className="text-gray-400" />
                        </div>
                        <input
                            type="text"
                            value={profile.designation || ''}
                            onChange={(e) => setProfile({ ...profile, designation: e.target.value })}
                            className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#3b5998]"
                        />
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-sm font-bold text-gray-700">Department</label>
                            <Edit size={14} className="text-gray-400" />
                        </div>
                        <input
                            type="text"
                            value={profile.department || ''}
                            onChange={(e) => setProfile({ ...profile, department: e.target.value })}
                            className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#3b5998]"
                        />
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-sm font-bold text-gray-700">Email (Read Only)</label>
                            <Lock size={14} className="text-gray-400" />
                        </div>
                        <input
                            type="email"
                            value={profile.email || ''}
                            disabled
                            className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 cursor-not-allowed"
                        />
                    </div>

                    <div className="space-y-2 col-span-2">
                        <div className="flex justify-between items-center">
                            <label className="text-sm font-bold text-gray-700">Digital Signature</label>
                        </div>

                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full h-32 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 flex flex-col items-center justify-center text-gray-400 text-sm hover:bg-gray-100 transition-colors cursor-pointer relative overflow-hidden"
                        >
                            {isUploading ? (
                                <div className="flex flex-col items-center text-[#3b5998]">
                                    <Loader2 className="animate-spin mb-2" size={24} />
                                    <span>Uploading...</span>
                                </div>
                            ) : profile.signature_url ? (
                                <StoredImage src={profile.signature_url} alt="Signature" className="absolute inset-0 w-full h-full object-contain p-2" />
                            ) : (
                                <div className="flex flex-col items-center">
                                    <UploadCloud size={24} className="mb-2" />
                                    <span>Click to upload signature image</span>
                                </div>
                            )}
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={onUploadSignature}
                                accept="image/*"
                                className="hidden"
                            />
                        </div>
                        {profile.signature_url && (
                            <p className="text-xs text-right text-gray-400 mt-1">Click the image to replace</p>
                        )}
                    </div>
                </div>

                <button
                    onClick={onSave}
                    disabled={isSaving}
                    className="mt-8 bg-[#3b5998] text-white px-8 py-3 rounded-lg font-bold text-sm hover:bg-[#2d4373] transition-colors shadow-sm active:scale-95 disabled:opacity-70"
                >
                    {isSaving ? 'Saving Changes...' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
};

// --- REAL REQUESTS TAB UI ---
const RequestsTab = ({ requests, onAccept, onDismiss }: { requests: CollabRequest[]; onAccept: (id: string) => void; onDismiss: (id: string) => void }) => (
    <div className="animate-in fade-in duration-300 space-y-4">
        {requests.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
                <FileText size={48} className="mx-auto mb-4 opacity-20" />
                <p>No pending collaboration requests.</p>
            </div>
        ) : (
            requests.map((req) => (
                <div key={req.id} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start">
                        <div className="flex items-center space-x-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-[#3b5998] font-bold shrink-0">
                                <UserCircle size={32} />
                            </div>
                            <div>
                                {/* Extracting from the joined profiles table (report owner) */}
                                <h3 className="text-lg font-bold text-gray-900">{req.reports?.profiles?.full_name || 'Unknown User'}</h3>
                                <p className="text-sm text-gray-500">{req.reports?.profiles?.email || 'Unknown Email'}</p>
                            </div>
                        </div>
                        <div className="flex space-x-3">
                            <button
                                onClick={() => onAccept(req.id)}
                                className="bg-[#3b5998] hover:bg-[#2d4373] text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center space-x-2 transition-colors"
                            >
                                <Check size={16} /><span>Accept</span>
                            </button>
                            <button
                                onClick={() => onDismiss(req.id)}
                                className="bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                    <div className="mt-6 pt-6 border-t border-gray-100">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Invited you to collaborate on:</p>
                        <h4 className="text-[#3b5998] font-bold text-lg">{req.reports?.title || 'Untitled Report'}</h4>
                    </div>
                </div>
            ))
        )}
    </div>
);

const SettingsTab = ({ onNavigate, emailNotifications, onToggleEmail }: { onNavigate: (path: string) => void; emailNotifications: boolean; onToggleEmail: (on: boolean) => void }) => (
    <div className="animate-in fade-in duration-300 space-y-8">
        <div>
            <h3 className="text-sm font-bold text-gray-800 mb-3">Notifications</h3>
            <label className="flex items-center justify-between p-4 border border-gray-200 rounded-xl bg-white cursor-pointer">
                <div className="flex items-center space-x-3">
                    <Bell size={20} className="text-[#3b5998]" />
                    <div>
                        <span className="font-bold text-gray-700 block">Email notifications</span>
                        <span className="text-xs text-gray-400">Invites, review requests, revisions and approvals are also sent to your email. In-app notifications are always on.</span>
                    </div>
                </div>
                <input type="checkbox" role="switch" checked={emailNotifications} onChange={(e) => onToggleEmail(e.target.checked)} className="w-5 h-5 accent-[#3b5998]" />
            </label>
        </div>
        <div>
            <h3 className="text-sm font-bold text-gray-800 mb-3">Account Settings</h3>
            <div className="flex items-center justify-between p-4 border border-gray-200 rounded-xl bg-white">
                <div className="flex items-center space-x-3">
                    <Lock size={20} className="text-[#3b5998]" />
                    <span className="font-bold text-gray-700">Change Password</span>
                </div>
                <button onClick={() => onNavigate('/settings/change-password')} className="border border-gray-300 px-4 py-1.5 rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                    Change
                </button>
            </div>
        </div>
        <div>
            <h3 className="text-sm font-bold text-gray-800 mb-3">Manage Access</h3>
            <div className="flex items-center justify-between p-4 border border-gray-200 rounded-xl bg-white">
                <div className="flex items-center space-x-3">
                    <Settings2 size={20} className="text-[#3b5998]" />
                    <div>
                        <span className="font-bold text-gray-700 block">Add / Remove Collaborators</span>
                        <span className="text-xs text-gray-400">Access is managed per report from the Document Library.</span>
                    </div>
                </div>
                <button onClick={() => onNavigate('/home/open')} className="border border-gray-300 px-4 py-1.5 rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                    Open Library
                </button>
            </div>
        </div>
    </div>
);

// --- MAIN DASHBOARD COMPONENT ---

export default function ProfileDashboard() {
    const router = useRouter();
    const [supabase] = useState(createClient);

    // UI State
    const [activeTab, setActiveTab] = useState<SettingsTabId>('Profile');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    // Data State
    const [profile, setProfile] = useState<Profile>({ id: '', full_name: '', designation: '', department: '', email: '', signature_url: '', email_notifications: true });
    const [requests, setRequests] = useState<CollabRequest[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    // 1. Fetch Profile and Requests
    const loadData = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            // Load Profile
            const { data: profData } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            if (profData) setProfile({
                id: profData.id,
                full_name: profData.full_name ?? '',
                designation: profData.designation ?? '',
                department: profData.department ?? '',
                email: profData.email ?? user.email ?? '',
                signature_url: profData.signature_url ?? '',
                email_notifications: profData.email_notifications !== false,
            });

            // Load Pending Requests (Join with reports and the owner's profile)
            const { data: reqData, error: reqError } = await supabase
                .from('collaborators')
                .select(`
                    id,
                    status,
                    reports (
                        title,
                        profiles (
                            full_name,
                            email
                        )
                    )
                `)
                .eq('user_id', user.id)
                .eq('status', 'pending');

            if (!reqError && reqData) {
                setRequests(reqData as unknown as CollabRequest[]);
            }
        }
    }, [supabase]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
        void loadData();
        // Deep links such as /settings?tab=Requests (used in invite emails).
        const tab = new URLSearchParams(window.location.search).get('tab');
        if (tab && (TABS as string[]).includes(tab)) setActiveTab(tab as SettingsTabId);
    }, [loadData]);

    const handleToggleEmail = async (on: boolean) => {
        setProfile((prev) => ({ ...prev, email_notifications: on }));
        const { error } = await supabase.from('profiles').update({ email_notifications: on }).eq('id', profile.id);
        if (error) {
            setProfile((prev) => ({ ...prev, email_notifications: !on }));
            alert('Could not update your notification setting.');
        }
    };

    // 2. Accept Request Logic
    const handleAcceptRequest = async (collabId: string) => {
        try {
            const { error } = await supabase
                .from('collaborators')
                .update({ status: 'accepted' })
                .eq('id', collabId);

            if (error) throw error;

            // Remove from UI
            setRequests(prev => prev.filter(r => r.id !== collabId));
            kickEmailDispatch(); // the owner is notified by a database trigger
            alert("Invitation accepted! You can now access this report.");
        } catch (error) {
            console.error("Accept error:", error);
            alert("Failed to accept request.");
        }
    };

    // 3. Dismiss Request Logic
    const handleDismissRequest = async (collabId: string) => {
        try {
            const { error } = await supabase
                .from('collaborators')
                .update({ status: 'declined' })
                .eq('id', collabId);

            if (error) throw error;

            // Remove from UI
            setRequests(prev => prev.filter(r => r.id !== collabId));
        } catch (error) {
            console.error("Dismiss error:", error);
            alert("Failed to dismiss request.");
        }
    };

    // 4. Replace signature (stored in the private `signatures` bucket)
    const handleUploadSignature = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !profile.id) return;

        setIsUploading(true);
        try {
            const ref = await uploadSignature(supabase, profile.id, file);
            const { error } = await supabase.from('profiles').update({ signature_url: ref }).eq('id', profile.id);
            if (error) throw error;
            setProfile(prev => ({ ...prev, signature_url: ref }));
            alert("Signature updated successfully!");
        } catch (error) {
            console.error("Upload error:", error);
            alert(describeUploadError(error));
        } finally {
            setIsUploading(false);
        }
    };

    // 5. Save Text Changes
    const handleSaveProfile = async () => {
        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({
                    full_name: profile.full_name,
                    designation: profile.designation,
                    department: profile.department
                })
                .eq('id', profile.id);

            if (error) throw error;
            alert("Profile updated successfully!");
        } catch (error) {
            console.error("Profile update failed:", error);
            alert("Failed to update profile.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };

    return (
        <div className="min-h-screen bg-[#F4F7FE] font-sans">
            <header className="bg-white border-b border-gray-200 px-6 py-3 flex justify-between items-center sticky top-0 z-40">
                <div className="flex items-center space-x-6">
                    <button onClick={() => router.back()} className="p-2 bg-gray-50 text-gray-500 rounded-full hover:bg-gray-200 hover:text-gray-900 transition-colors" title="Go Back">
                        <ArrowLeft size={20} />
                    </button>
                    <Image src="/christ-logo.png" alt="Christ University" width={140} height={40} className="object-contain" />
                </div>

                <h1 className="text-sm font-bold text-gray-500 hidden md:block tracking-wide">
                    {DEPARTMENT_NAME}
                </h1>

                <div className="relative">
                    <button onClick={() => setIsDropdownOpen(!isDropdownOpen)} className="w-10 h-10 bg-gray-900 rounded-full flex items-center justify-center text-white hover:ring-2 hover:ring-gray-300 transition-all">
                        <UserCircle size={24} />
                    </button>

                    {isDropdownOpen && (
                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 animate-in fade-in slide-in-from-top-2 z-50">
                            <button onClick={() => { setActiveTab('Profile'); setIsDropdownOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center space-x-3 text-sm font-medium text-gray-700">
                                <User size={16} /> <span>Profile</span>
                            </button>
                            <button onClick={() => { setActiveTab('Requests'); setIsDropdownOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center space-x-3 text-sm font-medium text-gray-700">
                                <FileText size={16} /> <span>Requests</span>
                            </button>
                            <button onClick={() => { setActiveTab('Settings'); setIsDropdownOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center space-x-3 text-sm font-medium text-gray-700">
                                <SettingsIcon size={16} /> <span>Settings</span>
                            </button>
                            <div className="border-t border-gray-100 my-1"></div>
                            <button onClick={handleLogout} className="w-full text-left px-4 py-2 hover:bg-red-50 flex items-center space-x-3 text-sm font-medium text-red-600 transition-colors">
                                <LogOut size={16} /> <span>Log Out</span>
                            </button>
                        </div>
                    )}
                </div>
            </header>

            <main className="max-w-4xl mx-auto pt-10 px-6 pb-20">
                <div className="flex bg-gray-200/60 p-1 rounded-full w-fit mb-8 shadow-inner">
                    {TABS.map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-8 py-2.5 rounded-full text-sm font-bold transition-all ${activeTab === tab ? 'bg-[#3b5998] text-white shadow-md' : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 min-h-[500px]">
                    {activeTab === 'Profile' && (
                        <ProfileTab
                            profile={profile}
                            setProfile={setProfile}
                            onSave={handleSaveProfile}
                            isSaving={isSaving}
                            onUploadSignature={handleUploadSignature}
                            isUploading={isUploading}
                        />
                    )}
                    {activeTab === 'Requests' && (
                        <RequestsTab
                            requests={requests}
                            onAccept={handleAcceptRequest}
                            onDismiss={handleDismissRequest}
                        />
                    )}
                    {activeTab === 'Settings' && <SettingsTab onNavigate={(path) => router.push(path)} emailNotifications={profile.email_notifications} onToggleEmail={handleToggleEmail} />}
                </div>
            </main>

        </div>
    );
}