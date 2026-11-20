"use client";

import React, { useState } from 'react';

/** The extra choice that lets people type their own answer. */
export const OTHER_CHOICE = '__other__';
export const OTHER_LABEL = 'Others (type your own)';

/** An existing "Other"/"Others" option is replaced by the typed-answer choice. */
const isOtherOption = (o: string) => /^others?$/i.test(o.trim());

interface Props {
    value: string;
    options: string[];
    onChange: (value: string) => void;
    /** Text of the empty choice, e.g. "Select Venue". */
    placeholder: string;
    id?: string;
    ariaLabel?: string;
    selectClassName: string;
    inputClassName: string;
}

/**
 * A dropdown with an "Others (type your own)" choice. Picking it shows a text box; whatever is
 * typed is stored as the value, so the PDF and lists show it like any other answer.
 */
export default function SelectOrOther({ value, options, onChange, placeholder, id, ariaLabel, selectClassName, inputClassName }: Props) {
    const choices = options.filter((o) => !isOtherOption(o));
    const isCustom = value !== '' && !choices.includes(value);
    // "Others" picked but nothing typed yet: the stored value is still empty.
    const [typing, setTyping] = useState(false);
    const showInput = typing || isCustom;

    return (
        <div className="space-y-2">
            <select id={id} aria-label={ariaLabel} className={selectClassName} value={showInput ? OTHER_CHOICE : value}
                onChange={(e) => {
                    if (e.target.value === OTHER_CHOICE) {
                        setTyping(true);
                        if (!isCustom) onChange('');
                    } else {
                        setTyping(false);
                        onChange(e.target.value);
                    }
                }}>
                <option value="">{placeholder}</option>
                {choices.map((o) => <option key={o} value={o}>{o}</option>)}
                <option value={OTHER_CHOICE}>{OTHER_LABEL}</option>
            </select>
            {showInput && (
                <input type="text" className={inputClassName} value={value} autoFocus={typing && !isCustom}
                    aria-label={`${ariaLabel ?? placeholder}: your own answer`} placeholder="Type your own..."
                    onChange={(e) => onChange(e.target.value)} />
            )}
        </div>
    );
}
