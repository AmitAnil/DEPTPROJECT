"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Search, X, Lock, ChevronDown, Link as LinkIcon, Trash2, UserCircle, Loader2 } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/client';
import { kickEmailDispatch } from '@/lib/notifyClient';

interface ManageAccessModalProps {
    isOpen: boolean;
    onClose: () => void;
    reportId?: string | null;
}

interface PersonSummary {
    id: string;
    full_name: string | null;
    email: string | null;
}

interface CollaboratorRow {
    id: string;
    status: 'pending' | 'accepted' | 'declined';
    role: 'Viewer' | 'Editor';
    user_id: string;
    profiles: PersonSummary | PersonSummary[] | null;
}

const unwrap = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default function ManageAccessModal({ isOpen, onClose, reportId }: ManageAccessModalProps) {
    const [supabase] = useState(createClient);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);

    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [owner, setOwner] = useState<PersonSummary | null>(null);
    const [collaborators, setCollaborators] = useState<CollaboratorRow[]>([]);
    const isOwner = !!currentUser && currentUser.id === owner?.id;

    const fetchAccessData = useCallback(async () => {
        if (!reportId) return;
        setIsLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUser(user);

        // 1. Fetch the Report Owner
        const { data: reportData, error: reportError } = await supabase
            .from('reports')
            .select(`
                owner_id, 
                profiles:owner_id (id, full_name, email)
            `)
            .eq('id', reportId)
            .single();

        if (!reportError && reportData) {
            setOwner(unwrap(reportData.profiles as PersonSummary | PersonSummary[] | null));
        }

        // 2. Fetch the Collaborators
        const { data: collabData, error: collabError } = await supabase
            .from('collaborators')
            .select(`
                id, 
                status, 
                role, 
                user_id, 
                profiles:user_id (id, full_name, email)
            `)
            .eq('report_id', reportId);

        if (!collabError && collabData) {
            setCollaborators(collabData as CollaboratorRow[]);
        }
        setIsLoading(false);
    }, [reportId, supabase]);

    useEffect(() => {
        if (isOpen && reportId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- loading remote data on open
            void fetchAccessData();
        }
    }, [isOpen, reportId, fetchAccessData]);

    const handleSendInvite = async () => {
        if (!inputValue.trim() || !reportId || !isOwner) return;
        setIsSending(true);

        try {
            // Find the user by email
            const { data: targetUser, error: searchError } = await supabase
                .from('profiles')
                .select('id, full_name')
                .eq('email', inputValue.trim().toLowerCase())
                .single();

            if (searchError || !targetUser) {
                alert("User not found! Make sure they have signed up for DeptDocs.");
                setIsSending(false);
                return;
            }

            if (targetUser.id === owner?.id) {
                alert("You cannot invite the owner of the document.");
                setIsSending(false);
                return;
            }

            // Insert the invite
            const { error: insertError } = await supabase
                .from('collaborators')
                .insert({
                    report_id: reportId,
                    user_id: targetUser.id,
                    role: 'Editor', // Default role
                    status: 'pending'
                });

            if (insertError) {
                if (insertError.code === '23505') alert("This user has already been invited.");
                else throw insertError;
            } else {
                setInputValue('');
                kickEmailDispatch(); // the invitee is notified by a database trigger
                alert(`Invite sent to ${targetUser.full_name || inputValue}!`);
                fetchAccessData(); // Refresh list to show them as 'Pending'
            }
        } catch (err) {
            console.error(err);
            alert("Failed to send invite.");
        } finally {
            setIsSending(false);
        }
    };

    const handleRemoveAccess = async (collabId: string) => {
        const { error } = await supabase
            .from('collaborators')
            .delete()
            .eq('id', collabId);

        if (error) {
            console.error("Failed to remove collaborator:", error);
            alert("Could not remove access. Please check your database RLS policies.");
        } else {
            fetchAccessData(); // Refresh list only on success
        }
    };

    const handleUpdateRole = async (collabId: string, newRole: string) => {
        const { error } = await supabase
            .from('collaborators')
            .update({ role: newRole })
            .eq('id', collabId);

        if (error) {
            console.error("Failed to update role:", error);
            alert("Could not update role. Please check your database RLS policies.");
            fetchAccessData(); // Re-fetch to snap the dropdown back to its original state if it fails
        } else {
            fetchAccessData(); // Refresh list on success
        }
    };

    const handleCopyLink = () => {
        navigator.clipboard.writeText(`${window.location.origin}/home/new?id=${reportId}`);
        alert("Link copied to clipboard!");
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity" onClick={onClose}></div>

            <div className="relative bg-white rounded-3xl w-full max-w-[520px] shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex justify-between items-center px-6 pt-6 pb-4">
                    <h2 className="text-xl font-medium text-gray-900 tracking-tight">Add people and manage access</h2>
                    <div className="flex items-center space-x-3 text-gray-500">
                        <button className="p-1.5 hover:bg-gray-100 rounded-full transition-colors" title="Close" onClick={onClose}>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* If no report ID is passed */}
                {!reportId ? (
                    <div className="px-6 pb-8 pt-4 text-center">
                        <div className="w-16 h-16 bg-orange-50 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Lock size={24} />
                        </div>
                        <h3 className="font-bold text-gray-900 mb-2">Save Report First</h3>
                        <p className="text-sm text-gray-500">You must save this report as a draft before you can invite collaborators.</p>
                    </div>
                ) : (
                    <>
                        {/* Search / Invite Input (owner only) */}
                        {isOwner ? (
                        <div className="px-6 pb-5">
                            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:border-[#3168d8] focus-within:ring-1 focus-within:ring-[#3168d8] transition-all bg-white">
                                <div className="pl-3 text-gray-400"><Search size={18} /></div>
                                <input
                                    type="text"
                                    placeholder="Enter colleague's email address..."
                                    className="flex-1 py-3 px-3 outline-none text-sm text-gray-700 placeholder-gray-500"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSendInvite()}
                                />
                                <button
                                    onClick={handleSendInvite}
                                    disabled={isSending || !inputValue.trim()}
                                    className="bg-[#3168d8] hover:bg-[#2552b0] text-white px-6 py-3 text-sm font-medium transition-colors h-full disabled:opacity-50 flex items-center"
                                >
                                    {isSending ? <Loader2 size={16} className="animate-spin" /> : "Invite"}
                                </button>
                            </div>
                        </div>
                        ) : (
                            <p className="px-6 pb-5 text-sm text-gray-500">Only the owner of this report can invite people or change roles.</p>
                        )}

                        {/* People List */}
                        <div className="px-6 pb-4">
                            <h3 className="text-sm font-medium text-gray-800 mb-3">People with access</h3>

                            {isLoading ? (
                                <div className="py-4 text-center text-sm text-gray-400 flex justify-center items-center gap-2">
                                    <Loader2 size={16} className="animate-spin" /> Loading access list...
                                </div>
                            ) : (
                                <div className="space-y-4 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">

                                    {/* 1. Show Owner */}
                                    {owner && (
                                        <div className="flex items-center justify-between group">
                                            <div className="flex items-center space-x-3 overflow-hidden">
                                                <div className="w-9 h-9 rounded-full bg-[#112a53] text-white flex items-center justify-center shrink-0 text-xs font-bold">
                                                    {owner.full_name?.charAt(0).toUpperCase() || <UserCircle size={20} />}
                                                </div>
                                                <div className="flex flex-col truncate">
                                                    <span className="text-sm font-medium text-gray-900 flex items-center space-x-1">
                                                        <span>{owner.full_name || 'Unnamed User'}</span>
                                                        {currentUser?.id === owner.id && <span className="text-gray-500 font-normal">(you)</span>}
                                                    </span>
                                                    <span className="text-[13px] text-gray-500 truncate">{owner.email}</span>
                                                </div>
                                            </div>
                                            <div className="text-sm text-gray-500 font-medium ml-4 shrink-0">Owner</div>
                                        </div>
                                    )}

                                    {/* 2. Show Collaborators */}
                                    {collaborators.map((collab) => {
                                        const profile = unwrap(collab.profiles);
                                        const isYou = currentUser?.id === collab.user_id;

                                        return (
                                            <div key={collab.id} className="flex items-center justify-between group">
                                                <div className="flex items-center space-x-3 overflow-hidden">
                                                    <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 text-xs font-bold">
                                                        {profile?.full_name?.charAt(0).toUpperCase() || <UserCircle size={20} />}
                                                    </div>
                                                    <div className="flex flex-col truncate">
                                                        <span className="text-sm font-medium text-gray-900 flex items-center space-x-2">
                                                            <span>{profile?.full_name || 'Unnamed User'}</span>
                                                            {isYou && <span className="text-gray-500 font-normal">(you)</span>}
                                                            {collab.status === 'pending' && <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Pending</span>}
                                                        </span>
                                                        <span className="text-[13px] text-gray-500 truncate">{profile?.email}</span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center space-x-1 shrink-0 ml-4">
                                                    <div className="relative">
                                                        <select
                                                            className="appearance-none text-sm text-gray-600 bg-transparent hover:bg-gray-50 border border-transparent hover:border-gray-300 px-3 py-1.5 pr-8 rounded-md cursor-pointer outline-none transition-colors"
                                                            value={collab.role}
                                                            onChange={(e) => handleUpdateRole(collab.id, e.target.value)}
                                                            disabled={!isOwner}
                                                        >
                                                            <option value="Viewer">Viewer</option>
                                                            <option value="Editor">Editor</option>
                                                        </select>
                                                        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                                    </div>

                                                    {(isOwner || isYou) && (
                                                        <button
                                                            onClick={() => handleRemoveAccess(collab.id)}
                                                            className="p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                                                            title="Remove access"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 flex justify-between items-center border-t border-gray-100">
                            <button
                                onClick={handleCopyLink}
                                className="flex items-center space-x-2 border border-gray-300 rounded-full px-4 py-2 text-sm font-medium text-[#3168d8] hover:bg-blue-50 transition-colors"
                            >
                                <LinkIcon size={16} />
                                <span>Copy link</span>
                            </button>

                            <button onClick={onClose} className="bg-[#3168d8] hover:bg-[#2552b0] text-white px-6 py-2.5 rounded-full text-sm font-medium transition-colors shadow-sm active:scale-95">
                                Done
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}