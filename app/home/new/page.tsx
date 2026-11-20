"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

import ReportLayout from '@/components/ReportLayout';
import AiAssistant from '@/components/AiAssistant';
import SectionForm from '@/components/template/SectionForm';
import { logActivity } from '@/lib/logger';
import { normalizeReportData, type ReportStatus } from '@/lib/reportData';
import { firstIncompleteSection, sectionProblems, reportTitleFrom, type ReportValues, type TemplateRecord } from '@/lib/template';
import { loadActiveTemplate, loadTemplate } from '@/lib/templateStore';
import { mergeAiValues } from '@/lib/aiFill';
import { kickEmailDispatch } from '@/lib/notifyClient';

import { Loader2, Lock, MessageSquareWarning, ExternalLink } from 'lucide-react';

type Access = 'owner' | 'editor' | 'viewer' | 'admin';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 4000;

function ReportEditorContent() {
    const [supabase] = useState(createClient);
    const searchParams = useSearchParams();
    const router = useRouter();
    const existingId = searchParams.get('id');

    const [reportId, setReportId] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [templateRecord, setTemplateRecord] = useState<TemplateRecord | null>(null);
    const [status, setStatus] = useState<ReportStatus>('draft');
    const [access, setAccess] = useState<Access>('owner');
    const [adminFeedback, setAdminFeedback] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Prevents saving an empty form over a report that has not finished loading.
    const [isInitialLoadDone, setIsInitialLoadDone] = useState(false);
    const [viewMode, setViewMode] = useState<'editor' | 'assets'>('editor');
    const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
    const [reportData, setReportData] = useState<ReportValues>(() => normalizeReportData({}));
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    // JSON of the last version stored in the database; differs from the form => unsaved changes.
    const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(normalizeReportData({})));
    const savingRef = useRef(false);
    // Latest report id, readable from async code before React re-renders.
    const reportIdRef = useRef<string | null>(null);
    const creatingRef = useRef<Promise<string | null> | null>(null);
    // `updated_at` of the version this editor last loaded or saved. Saves only succeed if the
    // row still has this value, so two people editing at once cannot overwrite each other.
    const versionRef = useRef<string | null>(null);
    const [conflictError, setConflictError] = useState<string | null>(null);

    const template = templateRecord?.definition ?? null;
    const sections = template?.sections ?? [];
    const activeIndex = Math.max(0, sections.findIndex((s) => s.id === activeSectionId));
    const activeSection = sections[activeIndex];

    // Drafts are editable by the owner and by accepted "Editor" collaborators only.
    // Submitted/approved reports are locked (the database enforces the same rule).
    const readOnly = status !== 'draft' || access === 'viewer' || access === 'admin' || !!loadError;

    // A section must be complete before moving past it. `errorSectionId` is the section whose
    // missing fields are highlighted; `errorTick` changes on every blocked attempt so the form scrolls to the list.
    const [errorSectionId, setErrorSectionId] = useState<string | null>(null);
    const [errorTick, setErrorTick] = useState(0);
    const showErrorsFor = (sectionId: string) => {
        setActiveSectionId(sectionId);
        setViewMode('editor');
        setErrorSectionId(sectionId);
        setErrorTick((t) => t + 1);
    };
    /** Opens a section; moving forward is only allowed once every earlier section is complete. */
    const goToSection = (sectionId: string) => {
        const target = sections.findIndex((s) => s.id === sectionId);
        if (readOnly || !template || target <= activeIndex) {
            setActiveSectionId(sectionId);
            return;
        }
        const blocked = sections.slice(0, target).findIndex((s) => sectionProblems(s, reportData).length > 0);
        if (blocked === -1) {
            setErrorSectionId(null);
            setActiveSectionId(sectionId);
        } else {
            showErrorsFor(sections[blocked].id);
        }
    };

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (cancelled) return;
            if (!user) {
                router.push('/login');
                return;
            }
            setUserId(user.id);

            if (!existingId) {
                const active = await loadActiveTemplate(supabase);
                setSavedSnapshot(JSON.stringify(normalizeReportData({})));
                if (cancelled) return;
                setTemplateRecord(active);
                setIsInitialLoadDone(true);
                return;
            }

            const { data, error } = await supabase
                .from('reports')
                .select('id, owner_id, status, data, admin_feedback, template_id, updated_at')
                .eq('id', existingId)
                .maybeSingle();
            if (cancelled) return;

            if (error || !data) {
                console.error("Error loading report:", error);
                setTemplateRecord(await loadActiveTemplate(supabase));
                setLoadError("This report does not exist or you do not have access to it.");
                setIsInitialLoadDone(true);
                return;
            }

            let nextAccess: Access = 'owner';
            if (data.owner_id !== user.id) {
                const { data: collab } = await supabase
                    .from('collaborators')
                    .select('role')
                    .eq('report_id', data.id)
                    .eq('user_id', user.id)
                    .eq('status', 'accepted')
                    .maybeSingle();
                if (collab) {
                    nextAccess = collab.role === 'Editor' ? 'editor' : 'viewer';
                } else {
                    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
                    nextAccess = me?.role === 'admin' ? 'admin' : 'viewer';
                }
            }
            // Each report keeps the template version it was created with.
            const record = await loadTemplate(supabase, data.template_id);
            if (cancelled) return;

            setTemplateRecord(record);
            reportIdRef.current = data.id;
            versionRef.current = data.updated_at ?? null;
            setReportId(data.id);
            setStatus(data.status as ReportStatus);
            setAccess(nextAccess);
            setAdminFeedback(data.admin_feedback ?? null);
            const loaded = normalizeReportData(data.data);
            setReportData(loaded);
            setSavedSnapshot(JSON.stringify(loaded));
            setIsInitialLoadDone(true);
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [existingId, supabase, router]);

    const handleDataUpdate = useCallback((patch: ReportValues) => {
        setReportData((prev) => ({ ...prev, ...patch }));
    }, []);

    const handleAiApply = (values: ReportValues, overwrite: boolean): number => {
        if (!template) return 0;
        const merged = mergeAiValues(template, reportData, values, overwrite);
        const changed = Object.keys(merged).filter((k) => JSON.stringify(merged[k]) !== JSON.stringify(reportData[k])).length;
        setReportData(merged);
        if (changed > 0) {
            setViewMode('editor');
            setActiveSectionId(sections[0]?.id ?? null);
        }
        return changed;
    };

    const currentJson = useMemo(() => JSON.stringify(reportData), [reportData]);
    const hasUnsavedChanges = isInitialLoadDone && !readOnly && currentJson !== savedSnapshot;

    /** Inserts or updates the report. Returns the report id, or null on failure. */
    const persist = async (currentData: ReportValues, nextStatus: 'draft' | 'completed', opts: { log?: boolean } = {}): Promise<string | null> => {
        if (!template) return null;
        const log = opts.log ?? true;
        const title = reportTitleFrom(template, currentData);
        const now = new Date().toISOString();

        const existingId = reportId ?? reportIdRef.current;
        if (existingId) {
            let query = supabase
                .from('reports')
                .update({
                    title,
                    data: currentData,
                    status: nextStatus,
                    updated_at: now,
                    // Feedback has been addressed once the report is resubmitted.
                    ...(nextStatus === 'completed' ? { admin_feedback: null } : {}),
                })
                .eq('id', existingId);
            // Only overwrite the version this editor has seen (optimistic locking).
            if (versionRef.current) query = query.eq('updated_at', versionRef.current);
            const { data: updated, error } = await query.select('id, updated_at');
            if (error) throw error;
            // 0 rows: someone else saved in between, a co-editor submitted it, or access was revoked (RLS).
            if (!updated || updated.length === 0) {
                const message = 'Someone else changed this report since you opened it (or it was submitted, or your access changed). '
                    + 'Your latest changes were NOT saved. Copy anything you need, then reload the page.';
                setConflictError(message);
                throw new Error(message);
            }
            versionRef.current = updated[0].updated_at ?? now;
            if (log) await logActivity(nextStatus === 'completed' ? 'REPORT_COMPLETED' : 'REPORT_SAVED',
                nextStatus === 'completed' ? `submitted "${title}" for review` : `saved draft "${title}"`, existingId);
            return existingId;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            alert("Your session has expired. Please sign in again.");
            return null;
        }
        const { data, error } = await supabase
            .from('reports')
            .insert([{ owner_id: user.id, title, data: currentData, status: nextStatus, template_id: templateRecord?.id ?? null }])
            .select('id, updated_at')
            .single();
        if (error) throw error;
        reportIdRef.current = data.id;
        versionRef.current = data.updated_at ?? null;
        setReportId(data.id);
        // Keep the id in the URL so a refresh re-opens this report instead of a blank one.
        window.history.replaceState(null, '', `/home/new?id=${data.id}`);
        await logActivity(nextStatus === 'completed' ? 'REPORT_COMPLETED' : 'REPORT_SAVED',
            nextStatus === 'completed' ? `submitted "${title}" for review` : `created draft "${title}"`, data.id);
        return data.id;
    };

    /** Saves the draft; used by the Save button (logged) and by autosave (silent). */
    const saveDraft = async (currentData: ReportValues, manual: boolean) => {
        if (!isInitialLoadDone || readOnly || savingRef.current || conflictError) return;
        savingRef.current = true;
        setIsSaving(true);
        setSaveState('saving');
        const json = JSON.stringify(currentData);
        try {
            if (await persist(currentData, 'draft', { log: manual })) {
                setSavedSnapshot(json);
                setLastSavedAt(new Date());
                setSaveState('saved');
            }
        } catch (error) {
            console.error("Error saving draft:", error);
            setSaveState('error');
            if (manual) alert(error instanceof Error && error.message.startsWith('Someone else') ? error.message : "Failed to save draft. Please check your connection and try again.");
        } finally {
            savingRef.current = false;
            setIsSaving(false);
        }
    };
    const handleSaveDraft = (currentData: ReportValues) => saveDraft(currentData, true);

    /**
     * New reports get their database row before the first upload, so every file is stored
     * in the report's own folder (the folder storage policies share with collaborators).
     */
    const ensureReportId = (): Promise<string | null> => {
        if (reportIdRef.current) return Promise.resolve(reportIdRef.current);
        if (!creatingRef.current) {
            creatingRef.current = (async () => {
                while (savingRef.current) await new Promise((r) => setTimeout(r, 200)); // an autosave may be creating it
                if (reportIdRef.current) return reportIdRef.current;
                savingRef.current = true;
                setIsSaving(true);
                setSaveState('saving');
                const json = JSON.stringify(reportData);
                try {
                    const id = await persist(reportData, 'draft', { log: false });
                    if (id) {
                        setSavedSnapshot(json);
                        setLastSavedAt(new Date());
                        setSaveState('saved');
                    }
                    return id;
                } catch (err) {
                    console.error('Could not create the draft:', err);
                    setSaveState('error');
                    return null;
                } finally {
                    savingRef.current = false;
                    setIsSaving(false);
                    creatingRef.current = null;
                }
            })();
        }
        return creatingRef.current;
    };
    const uploadFolder = reportId ?? (userId ? ensureReportId : null);

    // Autosave a few seconds after the last change. New reports are created once they have a title.
    const titleFilled = !!template && reportTitleFrom(template, reportData) !== 'Untitled Report';
    useEffect(() => {
        if (!hasUnsavedChanges || isSaving || conflictError || (!reportId && !titleFilled)) return;
        const timer = setTimeout(() => { void saveDraft(reportData, false); }, saveState === 'error' ? AUTOSAVE_DELAY_MS * 4 : AUTOSAVE_DELAY_MS);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- saveDraft is recreated every render; the data/flags below drive autosave
    }, [currentJson, hasUnsavedChanges, isSaving, reportId, titleFilled, saveState, conflictError]);

    // Warn before closing the tab with unsaved changes.
    useEffect(() => {
        if (!hasUnsavedChanges) return;
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [hasUnsavedChanges]);

    const saveStatus = readOnly || !isInitialLoadDone ? '' :
        saveState === 'saving' ? 'Saving…' :
        conflictError ? 'Not saved: reload the page' :
        saveState === 'error' ? 'Autosave failed. Retrying…' :
        hasUnsavedChanges ? (reportId || titleFilled ? 'Unsaved changes' : 'Add a title to start autosaving') :
        lastSavedAt ? `All changes saved · ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` :
        reportId ? 'All changes saved' : '';

    const handleMarkCompleted = async (currentData: ReportValues) => {
        // Also wait for an in-flight autosave, or both would write the same version.
        if (!isInitialLoadDone || readOnly || isSaving || savingRef.current || conflictError || !template) return;
        const incomplete = firstIncompleteSection(template, currentData);
        if (incomplete !== -1) {
            showErrorsFor(template.sections[incomplete].id);
            alert(`Some fields are still empty. Please complete "${template.sections[incomplete].title}" first (the missing fields are marked in red).`);
            return;
        }
        if (!confirm("Submit this report for admin review? You will not be able to edit it unless the admin sends it back.")) return;

        savingRef.current = true;
        setIsSaving(true);
        try {
            if (await persist(currentData, 'completed')) {
                setSavedSnapshot(JSON.stringify(currentData));
                setStatus('completed');
                kickEmailDispatch(); // admins are notified by a database trigger
                alert("Report submitted for review!");
                router.push('/home');
            }
        } catch (error) {
            console.error("Error submitting report:", error);
            alert(error instanceof Error && error.message.startsWith('Someone else') ? error.message : "Failed to submit report.");
        } finally {
            savingRef.current = false;
            setIsSaving(false);
        }
    };

    const banner = loadError ? (
        { tone: 'red', text: loadError }
    ) : conflictError ? (
        { tone: 'red', text: conflictError }
    ) : status === 'approved' ? (
        { tone: 'green', text: 'This report was approved and archived. It can no longer be edited.' }
    ) : status === 'completed' ? (
        { tone: 'blue', text: 'Submitted for review. Editing is locked unless the admin requests changes.' }
    ) : access === 'viewer' ? (
        { tone: 'gray', text: 'You have view-only access to this report.' }
    ) : access === 'admin' ? (
        { tone: 'gray', text: 'Viewing as admin. Review reports from the Admin dashboard.' }
    ) : null;
    const toneClasses: Record<string, string> = {
        red: 'bg-red-50 border-red-200 text-red-700',
        green: 'bg-green-50 border-green-200 text-green-700',
        blue: 'bg-blue-50 border-blue-200 text-blue-700',
        gray: 'bg-gray-50 border-gray-200 text-gray-700',
    };
    const driveLink = typeof reportData.drive_link === 'string' ? reportData.drive_link : '';

    return (
        <ReportLayout
            activeSectionId={activeSection?.id ?? ''}
            onSectionChange={goToSection}
            template={template}
            previewData={reportData}
            onSaveDraft={handleSaveDraft}
            onMarkCompleted={handleMarkCompleted}
            reportId={reportId}
            readOnly={readOnly || !isInitialLoadDone}
            saveStatus={saveStatus}
            hasUnsavedChanges={hasUnsavedChanges}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
        >
            {!isInitialLoadDone && (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                    <Loader2 size={32} className="animate-spin text-[#3168d8] mb-4" />
                    <p className="font-bold text-xs uppercase tracking-widest">Loading Document...</p>
                </div>
            )}

            {banner && (
                <div className={`mb-6 p-4 border rounded-xl flex items-start gap-3 text-sm ${toneClasses[banner.tone]}`}>
                    <Lock size={18} className="shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium">{banner.text}</p>
                        {status === 'approved' && driveLink.startsWith('https://') && (
                            <a href={driveLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 font-bold underline">
                                Open archived PDF <ExternalLink size={12} />
                            </a>
                        )}
                    </div>
                </div>
            )}

            {status === 'draft' && adminFeedback && (
                <div className="mb-6 p-4 border rounded-xl flex items-start gap-3 text-sm bg-orange-50 border-orange-200 text-orange-800">
                    <MessageSquareWarning size={18} className="shrink-0 mt-0.5" />
                    <div>
                        <p className="font-bold">Changes requested by the admin</p>
                        <p className="mt-1 whitespace-pre-wrap">{adminFeedback}</p>
                    </div>
                </div>
            )}

            {template && (
                <fieldset
                    disabled={readOnly || !isInitialLoadDone}
                    className={!isInitialLoadDone ? "opacity-30 pointer-events-none" : readOnly ? "opacity-70" : "transition-opacity duration-300"}
                >
                    {viewMode === 'assets' ? (
                        <AiAssistant template={template} templateId={templateRecord?.id ?? null} data={reportData} uploadFolder={uploadFolder}
                            onUpdate={handleDataUpdate} onApply={handleAiApply} />
                    ) : activeSection ? (
                        <SectionForm
                            key={activeSection.id}
                            section={activeSection}
                            data={reportData}
                            onUpdate={handleDataUpdate}
                            uploadFolder={uploadFolder}
                            onNext={activeIndex < sections.length - 1 ? () => goToSection(sections[activeIndex + 1].id) : undefined}
                            problems={!readOnly && errorSectionId === activeSection.id ? sectionProblems(activeSection, reportData) : []}
                            errorTick={errorTick}
                            onFinish={() => handleMarkCompleted(reportData)}
                            canFinish={!readOnly}
                        />
                    ) : null}
                </fieldset>
            )}
        </ReportLayout>
    );
}

export default function NewReportPage() {
    return (
        <Suspense fallback={
            <div className="flex h-screen w-full items-center justify-center bg-[#F4F7FE] text-gray-500 font-medium">
                <Loader2 className="animate-spin mr-2" size={24} /> Loading editor...
            </div>
        }>
            <ReportEditorContent />
        </Suspense>
    );
}
