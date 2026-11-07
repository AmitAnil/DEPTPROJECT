"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Mic, Square, Paperclip, AudioLines, Image as ImageIcon, FileText } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { describeUploadError, processAttachment, resolveUploadFolder, uploadImage, uploadVoiceNote, type UploadFolder } from '@/lib/files';
import { newItemId, type AttachmentFile } from '@/lib/reportData';
import { AI_NOTES_KEY, AI_REFERENCE_FILES_KEY } from '@/lib/aiFill';
import { allFields, listValue, textValue, type ReportTemplate, type ReportValues } from '@/lib/template';
import AttachmentsField from '@/components/template/AttachmentsField';

// Minimal typing for the Web Speech API (Chrome/Edge/Safari; not in TypeScript's DOM lib).
interface SpeechRecognitionResultLike { isFinal: boolean; 0: { transcript: string } }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionLike {
    lang: string; continuous: boolean; interimResults: boolean;
    onresult: ((e: SpeechRecognitionEventLike) => void) | null;
    onerror: ((e: { error: string }) => void) | null;
    onend: (() => void) | null;
    start(): void; stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface Props {
    template: ReportTemplate;
    templateId: string | null;
    data: ReportValues;
    uploadFolder: UploadFolder;
    onUpdate: (patch: ReportValues) => void;
    /** Receives validated values from the AI; the editor merges them. Returns how many fields changed. */
    onApply: (values: ReportValues, overwrite: boolean) => number;
}

export default function AiAssistant({ template, templateId, data, uploadFolder, onUpdate, onApply }: Props) {
    const [supabase] = useState(createClient);
    const notes = textValue(data, AI_NOTES_KEY);
    const referenceFiles = listValue(data, AI_REFERENCE_FILES_KEY) as unknown as AttachmentFile[];

    const [interim, setInterim] = useState('');
    const [dictating, setDictating] = useState(false);
    const [recording, setRecording] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [overwrite, setOverwrite] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [speechSupported, setSpeechSupported] = useState(false);

    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const notesRef = useRef(notes);
    useEffect(() => { notesRef.current = notes; }, [notes]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection must run in the browser
        setSpeechSupported(getSpeechRecognition() !== null);
        return () => {
            recognitionRef.current?.stop();
            if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        };
    }, []);

    const setNotes = (value: string) => onUpdate({ [AI_NOTES_KEY]: value });

    // ---- Live dictation (speech -> text in the box)
    const toggleDictation = () => {
        if (dictating) {
            recognitionRef.current?.stop();
            return;
        }
        const Ctor = getSpeechRecognition();
        if (!Ctor) return;
        const rec = new Ctor();
        rec.lang = 'en-IN';
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (e) => {
            let finalText = '';
            let interimText = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i];
                if (r.isFinal) finalText += r[0].transcript;
                else interimText += r[0].transcript;
            }
            if (finalText) {
                const current = notesRef.current;
                setNotes(`${current}${current && !/\s$/.test(current) ? ' ' : ''}${finalText.trim()}`);
            }
            setInterim(interimText);
        };
        rec.onerror = (e) => {
            if (e.error === 'not-allowed') alert('Microphone access was blocked. Allow it in the browser to dictate.');
        };
        rec.onend = () => {
            setDictating(false);
            setInterim('');
        };
        recognitionRef.current = rec;
        rec.start();
        setDictating(true);
    };

    // ---- Voice note (recorded audio, transcribed by the AI) - works in every modern browser
    const toggleRecording = async () => {
        if (recording) {
            recorderRef.current?.stop();
            return;
        }
        if (!uploadFolder) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            const chunks: Blob[] = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = async () => {
                stream.getTracks().forEach((t) => t.stop());
                setRecording(false);
                const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
                if (blob.size === 0) return;
                setBusy('voice');
                try {
                    const folder = await resolveUploadFolder(uploadFolder);
                    if (!folder) throw new Error('Could not create the draft for this voice note.');
                    const note = await uploadVoiceNote({ supabase, folder }, blob);
                    onUpdate({ [AI_REFERENCE_FILES_KEY]: [...referenceFiles, note] });
                } catch (err) {
                    alert(describeUploadError(err));
                } finally {
                    setBusy(null);
                }
            };
            recorderRef.current = recorder;
            recorder.start();
            setRecording(true);
        } catch {
            alert('Could not access the microphone. Check the browser permission.');
        }
    };

    // ---- Quick uploads straight into the report's photo/attachment fields
    const fileFields = allFields(template).filter((f) => f.type === 'photos' || f.type === 'attachments')
        .filter((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i);

    const quickUpload = async (fieldId: string, type: string, allowSpreadsheets: boolean, files: File[]) => {
        if (!uploadFolder || files.length === 0) return;
        setBusy(fieldId);
        const folder = await resolveUploadFolder(uploadFolder).catch(() => null);
        if (!folder) {
            setBusy(null);
            alert('Could not create the draft for this upload. Please try again.');
            return;
        }
        const ctx = { supabase, folder };
        const added: unknown[] = [];
        const errors: string[] = [];
        for (const file of files) {
            try {
                added.push(type === 'photos'
                    ? { id: newItemId(), url: await uploadImage(ctx, file, fieldId), caption: '' }
                    : await processAttachment(ctx, file, fieldId, allowSpreadsheets));
            } catch (err) {
                errors.push(describeUploadError(err));
            }
        }
        if (added.length > 0) onUpdate({ [fieldId]: [...listValue(data, fieldId), ...added] });
        if (errors.length > 0) alert(errors.join('\n'));
        setBusy(null);
    };

    // ---- Ask the AI
    const runAI = async () => {
        const refs = [
            ...referenceFiles.map((f) => f.source || f.pages?.[0] || ''),
            ...fileFields.flatMap((f) => listValue(data, f.id).map((item) =>
                f.type === 'photos' ? textValue(item, 'url') : textValue(item, 'source') || (Array.isArray(item.pages) ? String(item.pages[0] ?? '') : ''))),
        ].filter(Boolean);
        if (refs.length === 0 && notes.trim().length < 20) {
            alert('Describe the event (or dictate it) and/or attach documents first.');
            return;
        }
        setBusy('ai');
        setResult(null);
        try {
            const res = await fetch('/api/ai/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes, refs, templateId }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'AI auto-fill failed.');
            const changed = onApply(body.values ?? {}, overwrite);
            setResult(changed > 0
                ? `Filled ${changed} field${changed === 1 ? '' : 's'}. Review each section before submitting.`
                : overwrite ? 'The AI found nothing new to fill.' : 'Nothing new to fill: the fields the AI found are already filled. Tick "Replace" to overwrite them.');
        } catch (err) {
            alert(err instanceof Error ? err.message : 'AI auto-fill failed.');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="space-y-10 bg-white rounded-xl">
            <div>
                <div className="border-b-2 border-[#3358a8] pb-2 mb-3 w-fit pr-10">
                    <h2 className="text-xl font-bold text-[#2d4373] flex items-center gap-2"><Sparkles size={20} /> AI Assistant</h2>
                </div>
                <p className="text-sm text-gray-500">Describe the event in your own words, or dictate it, and attach the documents. The AI fills in the report; you review and edit before submitting.</p>
            </div>

            {/* 1. Description / dictation */}
            <div className="space-y-3">
                <label htmlFor="ai-notes" className="text-sm font-bold text-gray-700">1. Describe the event</label>
                <div className="relative">
                    <textarea id="ai-notes" rows={7} value={notes} onChange={(e) => setNotes(e.target.value)}
                        placeholder="e.g. On 12 March we held a two-day workshop on Generative AI in the Panel Room, Block IV. Dr. Asha Rao from IISc spoke about... About 60 students and 8 faculty attended. Key takeaways were..."
                        className="w-full p-4 border rounded-xl bg-gray-50 focus:ring-2 focus:ring-[#4F65F6] outline-none text-sm leading-relaxed" />
                    {interim && <p className="absolute bottom-3 left-4 right-4 text-sm text-gray-400 italic truncate">{interim}…</p>}
                </div>
                <div className="flex flex-wrap gap-3">
                    <button type="button" onClick={toggleDictation} disabled={!speechSupported}
                        title={speechSupported ? 'Speak and the text appears in the box' : 'Live dictation needs Chrome, Edge or Safari. Use "Record voice note" instead.'}
                        className={`px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${dictating ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-gray-200 text-gray-700 hover:border-[#4F65F6]'}`}>
                        {dictating ? <><Square size={14} /> Stop dictation</> : <><Mic size={14} /> Dictate</>}
                    </button>
                    <button type="button" onClick={toggleRecording} disabled={!uploadFolder || busy === 'voice'}
                        title="Record a voice note; the AI listens to it"
                        className={`px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 border transition-colors disabled:opacity-40 ${recording ? 'bg-red-50 border-red-200 text-red-600 animate-pulse' : 'bg-white border-gray-200 text-gray-700 hover:border-[#4F65F6]'}`}>
                        {busy === 'voice' ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : recording ? <><Square size={14} /> Stop recording</> : <><AudioLines size={14} /> Record voice note</>}
                    </button>
                </div>
            </div>

            {/* 2. Documents for the report */}
            {fileFields.length > 0 && (
                <div className="space-y-3">
                    <p className="text-sm font-bold text-gray-700">2. Attach the event documents</p>
                    <p className="text-xs text-gray-400">These go straight into the matching report sections and the AI reads them.</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {fileFields.map((f) => {
                            const count = listValue(data, f.id).length;
                            return (
                                <label key={f.id} className="relative border border-gray-100 rounded-2xl p-4 flex flex-col items-center gap-3 shadow-[0_2px_15px_rgba(0,0,0,0.03)] cursor-pointer hover:border-[#4F65F6]">
                                    {count > 0 && (
                                        <span className="absolute -top-2 -right-2 bg-green-500 text-white text-[10px] w-6 h-6 flex items-center justify-center rounded-full font-bold">{count}</span>
                                    )}
                                    {f.type === 'photos' ? <ImageIcon className="text-gray-300" size={32} /> : <FileText className="text-gray-300" size={32} />}
                                    <span className="text-xs font-semibold text-gray-500 text-center leading-tight">{template.sections.find((s) => s.fields.includes(f))?.title ?? f.label}</span>
                                    <span className="w-full bg-[#3358a8] text-white py-1.5 rounded-full flex items-center justify-center gap-2 text-xs font-medium">
                                        {busy === f.id ? <Loader2 className="animate-spin" size={14} /> : <Paperclip size={14} />} Upload
                                    </span>
                                    <input type="file" multiple className="hidden" disabled={!uploadFolder || busy !== null}
                                        accept={f.type === 'photos' ? 'image/*' : f.allowSpreadsheets ? '.jpg,.jpeg,.png,.webp,.pdf,.xlsx,.csv' : '.jpg,.jpeg,.png,.webp,.pdf'}
                                        onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void quickUpload(f.id, f.type, !!f.allowSpreadsheets, files); }} />
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 3. Reference material that is not printed */}
            <div className="space-y-3">
                <p className="text-sm font-bold text-gray-700">3. Other reference material (optional, not printed)</p>
                <AttachmentsField fieldId={AI_REFERENCE_FILES_KEY} uploadLabel="Minutes, emails, slides... anything that helps the AI" allowSpreadsheets
                    printed={false} data={data} onUpdate={onUpdate} uploadFolder={uploadFolder} />
            </div>

            {/* 4. Run */}
            <div className="flex flex-col items-center gap-3 pt-2">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="accent-[#3358a8]" />
                    Replace values I have already entered
                </label>
                <button type="button" onClick={runAI} disabled={busy !== null || recording || dictating}
                    className="bg-gradient-to-r from-indigo-600 to-[#3358a8] text-white px-8 py-3 rounded-full font-bold text-sm flex items-center gap-3 shadow-md hover:shadow-lg transition-all disabled:opacity-50">
                    {busy === 'ai' ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                    {busy === 'ai' ? 'AI is writing the report…' : 'Fill report with AI'}
                </button>
                {result && <p className="text-sm text-green-700 font-medium text-center">{result}</p>}
            </div>
        </div>
    );
}
