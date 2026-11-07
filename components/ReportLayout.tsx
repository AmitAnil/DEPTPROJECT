"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
    Home, FolderOpen, Save, UserPlus, Download, Menu, Eye, UserCircle, FileText, CheckCircle, User, Settings as SettingsIcon, LogOut
} from 'lucide-react';
import { pdf } from '@react-pdf/renderer';

import LivePreview from './LivePreview';
import { ReportPDF } from './ReportPDF';
import ManageAccessModal from './ManageAccessModal';
import NotificationBell from '@/components/NotificationBell';
import { createClient } from '@/utils/supabase/client';
import { resolveForBrowser } from '@/lib/storageClient';
import { reportTitleFrom, type ReportTemplate, type ReportValues } from '@/lib/template';
import { iconFor } from './sectionIcons';

interface Props {
    children: React.ReactNode;
    activeSectionId: string;
    onSectionChange: (sectionId: string) => void;
    /** null while loading */
    template: ReportTemplate | null;
    previewData: ReportValues;
    onSaveDraft?: (data: ReportValues) => void | Promise<void>;
    onMarkCompleted?: (data: ReportValues) => void | Promise<void>;
    reportId?: string | null;
    /** When true, save/submit are disabled (submitted, approved, or view-only access). */
    readOnly?: boolean;
    /** e.g. "All changes saved · 10:42" */
    saveStatus?: string;
    /** Ask before navigating away inside the app. */
    hasUnsavedChanges?: boolean;
    viewMode?: 'editor' | 'assets';
    onViewModeChange?: (mode: 'editor' | 'assets') => void;
}

export default function ReportLayout({
    children,
    activeSectionId,
    onSectionChange,
    template,
    previewData,
    onSaveDraft,
    onMarkCompleted,
    reportId,
    readOnly = false,
    saveStatus = '',
    hasUnsavedChanges = false,
    viewMode = 'editor',
    onViewModeChange
}: Props) {
    const nextRouter = useRouter();
    const router = {
        push: (path: string) => {
            if (hasUnsavedChanges && !confirm('You have unsaved changes. Leave this page anyway?')) return;
            nextRouter.push(path);
        },
    };
    const [supabase] = useState(createClient);

    const [showCollabModal, setShowCollabModal] = useState(false);
    const [showDownloadMenu, setShowDownloadMenu] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);

    // Activity logging happens in the page handlers (once, and only on success).
    const handleSave = () => { if (!readOnly && onSaveDraft) void onSaveDraft(previewData); };
    const handleComplete = () => { if (!readOnly && onMarkCompleted) void onMarkCompleted(previewData); };
    const title = template ? reportTitleFrom(template, previewData) : 'Untitled Report';

    const downloadAsPDF = async () => {
        setIsDownloading(true);
        try {
            if (!template) return;
            const resolved = await resolveForBrowser(previewData);
            const blob = await pdf(<ReportPDF data={resolved} template={template} />).toBlob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${title.replace(/[^a-zA-Z0-9]+/g, '_')}_Report.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Failed to generate PDF:", error);
            alert("Could not generate the PDF. Please try again.");
        } finally {
            setIsDownloading(false);
            setShowDownloadMenu(false);
        }
    };

    return (
        <div className="flex h-screen bg-[#F4F7FE] text-black overflow-hidden font-sans">

            {/* COLUMN 1: UTILITY BAR */}
            <aside className="w-16 bg-[#0B2244] flex flex-col items-center py-6 shrink-0 space-y-8 border-r border-white/5 relative z-50">
                <button className="text-white/60 hover:text-white transition-colors"><Menu size={24} /></button>
                <button onClick={() => router.push('/home')} className="text-white/60 hover:text-white transition-colors" title="Home"><Home size={24} /></button>
                <button onClick={() => router.push('/home/open')} className="text-white/60 hover:text-white transition-colors" title="Reports"><FolderOpen size={24} /></button>

                <button onClick={handleSave} disabled={readOnly} className="text-white/60 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title={readOnly ? "This report is read-only" : "Save Draft"}><Save size={24} /></button>
                <button onClick={handleComplete} disabled={readOnly} className="text-white/60 hover:text-green-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title={readOnly ? "This report is read-only" : "Submit for review"}><CheckCircle size={24} /></button>
                <button onClick={() => setShowCollabModal(true)} className="text-white/60 hover:text-white transition-colors" title="Collab"><UserPlus size={24} /></button>

                <div className="relative flex flex-col items-center">
                    <button onClick={() => setShowDownloadMenu(!showDownloadMenu)} className="text-white/60 hover:text-white transition-colors" title="Download"><Download size={24} /></button>
                    {showDownloadMenu && (
                        <div className="absolute left-14 top-0 bg-white shadow-xl rounded-xl py-2 w-48 border border-gray-100 animate-in fade-in zoom-in-95">
                            <button onClick={downloadAsPDF} disabled={isDownloading} className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-3">
                                <FileText size={16} className="text-red-500" />
                                <span className="font-medium">{isDownloading ? "Generating..." : "Download PDF"}</span>
                            </button>
                        </div>
                    )}
                </div>
            </aside>

            {/* COLUMN 2: SECTION NAVIGATION */}
            <aside className="w-64 bg-[#1a365d] text-white flex flex-col shrink-0">
                <div className="p-6 border-b border-white/10 flex justify-center">
                    <Image src="/christ-logo-white.png" alt="Christ University" width={150} height={40} className="brightness-0 invert object-contain" />
                </div>
                <nav className="flex-1 py-4 overflow-y-auto">
                    {(template?.sections ?? []).map((sec) => {
                        const Icon = iconFor(sec.icon);
                        const active = viewMode === 'editor' && activeSectionId === sec.id;
                        return (
                            <button
                                key={sec.id}
                                onClick={() => { onSectionChange(sec.id); onViewModeChange?.('editor'); }}
                                className={`w-full flex items-center space-x-3 px-6 py-4 transition-all text-xs font-medium text-left ${active ? 'bg-[#3b5998] border-l-4 border-white' : 'hover:bg-white/5 opacity-60'}`}
                            >
                                <Icon size={16} />
                                <span>{sec.title}</span>
                            </button>
                        );
                    })}
                </nav>
            </aside>

            {/* RIGHT AREA: HEADER + CONTENT */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <header className="h-14 bg-white border-b flex items-center justify-between px-8 shrink-0 relative z-40">
                    <div className="flex items-baseline gap-3 min-w-0">
                        <h2 className="text-sm font-bold text-gray-800 uppercase tracking-tight truncate">{title}</h2>
                        {saveStatus && (
                            <span role="status" className={`text-[11px] font-medium whitespace-nowrap ${saveStatus.startsWith('Autosave failed') ? 'text-red-600' : saveStatus.startsWith('Unsaved') ? 'text-orange-600' : 'text-gray-400'}`}>
                                {saveStatus}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center space-x-4">
                        <button className="flex items-center space-x-2 bg-gray-100 px-4 py-1.5 rounded-full text-[10px] font-bold text-gray-500 hover:bg-gray-200">
                            <span>LIVE PREVIEW</span> <Eye size={14} />
                        </button>

                        <NotificationBell />

                        <div className="relative">
                            <button onClick={() => setIsProfileOpen(!isProfileOpen)} className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center border border-gray-300">
                                <UserCircle size={20} className="text-gray-500" />
                            </button>

                                                        {isProfileOpen && (
                                <div className="absolute right-0 mt-3 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50 overflow-hidden animate-in fade-in zoom-in-95">
                                    <button onClick={() => router.push('/settings')} className="w-full text-left px-5 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors">
                                        <User size={18} className="text-gray-400" /> Profile
                                    </button>
                                    <button onClick={() => router.push('/settings')} className="w-full text-left px-5 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors">
                                        <SettingsIcon size={18} className="text-gray-400" /> Settings
                                    </button>
                                    <button onClick={() => router.push('/settings')} className="w-full text-left px-5 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors">
                                        <UserPlus size={18} className="text-gray-400" /> Requests
                                    </button>

                                    <div className="h-px bg-gray-100 my-1 mx-2"></div>

                                    <button onClick={async () => { await supabase.auth.signOut(); router.push('/'); }} className="w-full text-left px-5 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors">
                                        <LogOut size={18} /> Log Out
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <main className="flex-1 p-6 flex space-x-6 overflow-hidden">

                    {/* LEFT PANE: FORM & ASSET EDITOR */}
                    <div className="w-[450px] bg-white rounded-3xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">

                                                {onViewModeChange && (
                            <div className="flex items-center gap-2 p-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
                                {/* Form view */}
                                <button
                                    onClick={() => onViewModeChange('editor')}
                                    className={`px-6 py-2 rounded-full font-bold text-xs transition-colors ${viewMode === 'editor' ? 'bg-[#3b5998] text-white shadow-sm' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                                >
                                    Form
                                </button>
                                {/* AI assistant + uploads */}
                                <button
                                    onClick={() => onViewModeChange('assets')}
                                    className={`px-6 py-2 rounded-full font-bold text-xs transition-colors ${viewMode === 'assets' ? 'bg-[#3b5998] text-white shadow-sm' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                                >
                                    AI Assistant
                                </button>
                            </div>
                        )}

                        {/* CONTENT AREA */}
                        <div className="flex-1 overflow-y-auto p-8 scrollbar-hide">
                            {children}
                        </div>
                    </div>

                    {/* RIGHT PANE: LIVE PREVIEW */}
                    <div className="flex-1 bg-white rounded-3xl shadow-sm border border-gray-100 p-6 flex flex-col">
                        <div className="flex-1 overflow-hidden rounded-xl border border-gray-200">
                            {template && <LivePreview data={previewData} template={template} />}
                        </div>
                    </div>
                </main>
            </div>

            <ManageAccessModal isOpen={showCollabModal} onClose={() => setShowCollabModal(false)} reportId={reportId} />
        </div>
    );
}