"use client";

import React, { useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import type { Organizer } from '@/lib/reportData';
import { FACULTY_DESIGNATIONS, listValue, textValue, type ReportValues } from '@/lib/template';
import StoredImage from '@/components/StoredImage';

const EMPTY_ORGANIZER: Organizer = { name: '', designation: '', signatureImage: '' };

interface Props {
    fieldId: string;
    data: ReportValues;
    onUpdate: (patch: ReportValues) => void;
}

/** "Report prepared by": name, designation and the signed-in user's own signature. */
export default function PreparedByField({ fieldId, data, onUpdate }: Props) {
    const [loading, setLoading] = useState(false);
    const stored = listValue(data, fieldId).map((o) => ({
        name: textValue(o, 'name'), designation: textValue(o, 'designation'), signatureImage: textValue(o, 'signatureImage'),
    }));
    const organizers: Organizer[] = stored.length > 0 ? stored : [EMPTY_ORGANIZER];
    const useProfileKey = fieldId === 'organizersList' ? 'useProfile' : `${fieldId}UseProfile`;
    const useProfile = data[useProfileKey] === true;

    const updateOrganizer = (field: 'name' | 'designation', value: string) => {
        const updated = [...organizers];
        updated[0] = { ...updated[0], [field]: value };
        onUpdate({ [fieldId]: updated });
    };

    // The signature can only come from the signed-in user's own profile, so nobody can
    // attach somebody else's signature to a report.
    const handleToggleProfile = async (checked: boolean) => {
        const updated = [...organizers];
        if (!checked) {
            updated[0] = EMPTY_ORGANIZER;
            onUpdate({ [fieldId]: updated, [useProfileKey]: false });
            return;
        }
        setLoading(true);
        try {
            const supabase = createClient();
            const { data: { user }, error: authError } = await supabase.auth.getUser();
            if (authError || !user) throw new Error("User not authenticated");

            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('full_name, designation, signature_url')
                .eq('id', user.id)
                .single();
            if (profileError) throw profileError;

            updated[0] = {
                name: profile.full_name || '',
                designation: profile.designation || '',
                signatureImage: profile.signature_url || '',
            };
            onUpdate({ [fieldId]: updated, [useProfileKey]: true });
        } catch (error) {
            console.error("Error fetching profile data:", error);
            alert("Could not load your profile. Please try again.");
            onUpdate({ [useProfileKey]: false });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-8">
            <div className="space-y-6">
                {/* Name Input */}
                <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700">Name <span className="text-red-500">*</span></label>
                    <input
                        type="text"
                        value={organizers[0].name || ''}
                        onChange={(e) => updateOrganizer('name', e.target.value)}
                        className="w-full p-3 border rounded-lg bg-gray-50 outline-none focus:ring-2 focus:ring-[#3b5998]"
                        disabled={loading}
                    />
                </div>

                {/* Designation Input */}
                <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700">Designation <span className="text-red-500">*</span></label>
                    <datalist id={`${fieldId}-designations`}>{FACULTY_DESIGNATIONS.map((d) => <option key={d} value={d} />)}</datalist>
                    <input
                        type="text"
                        list={`${fieldId}-designations`}
                        placeholder="Pick or type your designation"
                        value={organizers[0].designation || ''}
                        onChange={(e) => updateOrganizer('designation', e.target.value)}
                        className="w-full p-3 border rounded-lg bg-gray-50 outline-none focus:ring-2 focus:ring-[#3b5998]"
                        disabled={loading}
                    />
                </div>

                {/* Digital Signature Display */}
                <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-700">Digital Signature</label>
                    <div className="border-2 border-dashed border-gray-100 rounded-2xl p-10 flex flex-col items-center justify-center bg-gray-50/30">
                        {organizers[0].signatureImage ? (
                            <StoredImage src={organizers[0].signatureImage} alt="Signature" className="h-20 object-contain" />
                        ) : (
                            <p className="text-xs text-gray-400 text-center">
                                Tick &quot;Use saved info from profile&quot; below to attach your signature.<br />
                                You can change your signature in Settings &rarr; Profile.
                            </p>
                        )}
                    </div>
                </div>

                {/* Checkbox Options */}
                <div className="space-y-4 pt-4 border-t border-gray-100">
                    <label className="flex items-center space-x-3 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={useProfile}
                            onChange={(e) => handleToggleProfile(e.target.checked)}
                            disabled={loading}
                            className="w-5 h-5 accent-[#3b5998] cursor-pointer disabled:opacity-50"
                        />
                        <span className="text-sm font-medium text-gray-600 group-hover:text-black">
                            {loading ? "Fetching Profile..." : "Use saved info from profile"}
                        </span>
                    </label>

                </div>
            </div>

        </div>
    );
}
