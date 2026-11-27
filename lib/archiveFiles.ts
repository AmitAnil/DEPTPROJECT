import { allFields, listValue, textValue, type ListItem, type ReportTemplate, type ReportValues } from './template';

/** An original upload of a report, to be copied next to the PDF in the archive. */
export interface OriginalFile {
    /** sb:// reference of the stored file. */
    ref: string;
    /** File name in the archive folder, e.g. "Brochure - poster.pdf". */
    name: string;
}

const extOf = (ref: string) => {
    const m = /\.([a-z0-9]{1,6})(?:$|[?#])/i.exec(ref);
    return m ? `.${m[1].toLowerCase()}` : '';
};

const hasExt = (name: string) => /\.[a-z0-9]{1,6}$/i.test(name);

/**
 * Every original upload in the report, in template order: documents of upload fields
 * (named after their section), activity photos, and pictures in lists (e.g. speaker photos).
 * Each stored file appears once.
 */
export function collectOriginalFiles(template: ReportTemplate, data: ReportValues): OriginalFile[] {
    const out: OriginalFile[] = [];
    const seen = new Set<string>();
    const add = (ref: unknown, name: string) => {
        if (typeof ref !== 'string' || !ref.startsWith('sb://') || seen.has(ref)) return;
        seen.add(ref);
        out.push({ ref, name: hasExt(name) ? name : `${name}${extOf(ref)}` });
    };

    for (const section of template.sections) {
        for (const field of section.fields) {
            if (field.type === 'attachments') {
                for (const file of listValue(data, field.id)) {
                    add(file.source, `${section.title} - ${textValue(file, 'name') || 'file'}`);
                }
            } else if (field.type === 'photos') {
                listValue(data, field.id).forEach((photo, i) => add(photo.url, `Photo ${i + 1}`));
            } else if (field.type === 'list') {
                const pictures = (field.subfields ?? []).filter((sf) => sf.type === 'image');
                if (pictures.length === 0) continue;
                // The name may be a column of the same list shown in another section (e.g. speakers).
                const textCols = allFields(template)
                    .filter((f) => f.type === 'list' && f.id === field.id)
                    .flatMap((f) => (f.subfields ?? []).filter((sf) => sf.type === 'text'));
                const nameOf = (item: ListItem) =>
                    textCols.map((sf) => textValue(item, sf.id).trim()).find((v) => v !== '') ?? '';
                listValue(data, field.id).forEach((item, i) => {
                    const who = nameOf(item) || `${field.itemLabel ?? 'Entry'} ${i + 1}`;
                    for (const sf of pictures) add(item[sf.id], `${sf.label} - ${who}`);
                });
            }
        }
    }
    return out;
}

const MIME: Record<string, string> = {
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Content type for a file name, falling back to a generic binary type. */
export const mimeFor = (name: string) => MIME[extOf(name)] ?? 'application/octet-stream';
