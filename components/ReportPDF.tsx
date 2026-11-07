/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> renders into a PDF and has no alt attribute */
import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import type { SpreadsheetRow } from '@/lib/reportData';
import {
    DEFAULT_TEMPLATE, TABLE_ROW_LABEL_KEY, filledCount, formatDate, formatFieldValue, interpolate, isScalarField, listValue, tableRows, tableTotals, textValue,
    type ListItem, type ReportTemplate, type ReportValues, type TemplateField, type TemplateSection, type TemplateSubfield,
} from '@/lib/template';

// Styles of the official University A4 layout.
const styles = StyleSheet.create({
    page: { padding: '25.4mm', fontFamily: 'Times-Roman', fontSize: 12, lineHeight: 1.2, paddingBottom: '30mm' },
    headerContainer: { alignItems: 'center', marginBottom: 15, borderBottom: '1.5px solid black', paddingBottom: 10 },
    headerLine0: { fontSize: 16, fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' },
    headerLine1: { fontSize: 14, fontWeight: 'bold', textAlign: 'center' },
    headerLineN: { fontSize: 13, fontWeight: 'bold', textAlign: 'center' },
    reportTitle: { fontSize: 18, fontWeight: 'bold', textDecoration: 'underline', marginTop: 15, textTransform: 'uppercase' },

    section: { marginTop: 20 },
    sectionTitle: { fontSize: 13, fontWeight: 'bold', marginBottom: 8 },
    subtitle: { textAlign: 'center', marginBottom: 20, fontStyle: 'italic' },

    table: { width: '100%', border: '1px solid black' },
    row: { flexDirection: 'row', borderBottom: '1px solid black' },
    lastRow: { flexDirection: 'row' },
    labelCell: { width: '35%', padding: 6, borderRight: '1px solid black', fontWeight: 'bold', textTransform: 'uppercase', fontStyle: 'italic', fontSize: 11 },
    valueCell: { width: '65%', padding: 6, fontSize: 12 },

    halfLabelCell: { padding: 6, borderRight: '1px solid black', fontWeight: 'bold', fontSize: 11 },
    halfValueCell: { padding: 6, fontSize: 11, borderRight: '1px solid black' },
    lastHalfValueCell: { padding: 6, fontSize: 11 },

    signatureImage: { height: 40, objectFit: 'contain', marginTop: 2 },
    speakerPhoto: { width: 150, height: 150, objectFit: 'cover', marginVertical: 10, alignSelf: 'center', border: '1px solid #ccc' },
    activityPhoto: { width: '100%', maxHeight: 400, objectFit: 'contain', marginBottom: 5, border: '1px solid #ccc' },
    attachmentPhoto: { width: '100%', marginBottom: 15, border: '1px solid #ccc' },

    caption: { fontSize: 11, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
    centeredTitle: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
    bodyText: { fontSize: 12, textAlign: 'justify', marginBottom: 10, lineHeight: 1.4 },

    footer: { position: 'absolute', bottom: '15mm', fontSize: 10, textAlign: 'center', left: 0, right: 0 },
});

const filled = (v: string | null | undefined): v is string => !!v && v.trim() !== '' && v !== '—';

const ExcelTable = ({ rows }: { rows: SpreadsheetRow[] }) => {
    if (rows.length === 0) return null;
    // At most 5 columns so the table fits on A4.
    const headers = Object.keys(rows[0]).slice(0, 5);
    const colWidth = `${100 / headers.length}%`;
    return (
        <View style={[styles.table, { marginTop: 10 }]}>
            <View style={[styles.row, { backgroundColor: '#f3f4f6' }]}>
                {headers.map((h, i) => (
                    <Text key={i} style={[styles.halfLabelCell, { width: colWidth }, i === headers.length - 1 ? { borderRight: 'none' } : {}]}>{h}</Text>
                ))}
            </View>
            {rows.map((row, i) => (
                <View key={i} style={i === rows.length - 1 ? styles.lastRow : styles.row} wrap={false}>
                    {headers.map((h, j) => (
                        <Text key={j} style={[j === headers.length - 1 ? styles.lastHalfValueCell : styles.halfValueCell, { width: colWidth }]}>
                            {row[h] != null && row[h] !== '' ? String(row[h]) : '—'}
                        </Text>
                    ))}
                </View>
            ))}
        </View>
    );
};

/** Label/value table; callers pass only filled rows. */
const LabelValueTable = ({ rows }: { rows: { label: string; value: React.ReactNode }[] }) => {
    if (rows.length === 0) return null;
    return (
        <View style={styles.table}>
            {rows.map((r, i) => (
                <View key={i} style={i === rows.length - 1 ? styles.lastRow : styles.row} wrap={false}>
                    <Text style={styles.labelCell}>{r.label}</Text>
                    {typeof r.value === 'string' ? <Text style={styles.valueCell}>{r.value}</Text> : <View style={styles.valueCell}>{r.value}</View>}
                </View>
            ))}
        </View>
    );
};

const subValue = (item: ListItem, sf: TemplateSubfield): string => {
    const v = textValue(item, sf.id).trim();
    return sf.type === 'date' && v ? formatDate(v) : v;
};

function ListBlock({ field, data }: { field: TemplateField; data: ReportValues }) {
    const subfields = field.subfields ?? [];
    const items = listValue(data, field.id).filter((item) => subfields.some((sf) => filled(textValue(item, sf.id))));
    if (items.length === 0) return null;
    const textCols = subfields.filter((sf) => sf.type !== 'image');
    const imageCols = subfields.filter((sf) => sf.type === 'image');

    if (field.pdfLayout === 'table') {
        const colWidth = `${100 / Math.max(textCols.length, 1)}%`;
        return (
            <View style={styles.table} wrap={false}>
                <View style={[styles.row, { backgroundColor: '#f9fafb' }]}>
                    {textCols.map((sf, i) => (
                        <Text key={sf.id} style={[styles.halfLabelCell, { width: colWidth }, i === textCols.length - 1 ? { borderRight: 'none' } : {}]}>{sf.pdfLabel || sf.label}</Text>
                    ))}
                </View>
                {items.map((item, idx) => (
                    <View key={idx} style={idx === items.length - 1 ? styles.lastRow : styles.row} wrap={false}>
                        {textCols.map((sf, i) => (
                            <Text key={sf.id} style={[i === textCols.length - 1 ? styles.lastHalfValueCell : styles.halfValueCell, { width: colWidth }]}>{subValue(item, sf)}</Text>
                        ))}
                    </View>
                ))}
            </View>
        );
    }

    if (field.pdfLayout === 'profile') {
        return (
            <View>
                {items.map((item, idx) => (
                    <View key={idx} style={{ marginBottom: 20 }} wrap={false}>
                        {imageCols.filter((sf) => filled(textValue(item, sf.id))).map((sf) => (
                            <Image key={sf.id} src={textValue(item, sf.id)} style={styles.speakerPhoto} />
                        ))}
                        {textCols.filter((sf) => filled(subValue(item, sf))).map((sf) => (
                            <Text key={sf.id} style={styles.bodyText}>{subValue(item, sf)}</Text>
                        ))}
                    </View>
                ))}
            </View>
        );
    }

    // 'cards': one label/value table per item
    return (
        <View>
            {items.map((item, idx) => {
                const rows: { label: string; value: React.ReactNode }[] = textCols
                    .map((sf) => ({ label: sf.pdfLabel || sf.label, value: subValue(item, sf) }))
                    .filter((r) => filled(r.value));
                for (const sf of imageCols) {
                    const src = textValue(item, sf.id);
                    if (filled(src)) rows.push({ label: sf.pdfLabel || sf.label, value: <Image src={src} style={styles.signatureImage} /> });
                }
                return (
                    <View key={idx} style={{ marginBottom: 10 }} wrap={false}>
                        <LabelValueTable rows={rows} />
                    </View>
                );
            })}
        </View>
    );
}

function TableBlock({ field, data }: { field: TemplateField; data: ReportValues }) {
    const columns = (field.subfields ?? []).filter((sf) => sf.type !== 'image');
    const fixed = !!field.rowLabels;
    // Fixed rows (e.g. budget heads) are always printed; free rows only when filled.
    const rows = tableRows(field, data).filter((r) => fixed || columns.some((sf) => filled(textValue(r, sf.id))));
    if (rows.length === 0 || columns.length === 0) return null;
    const totals = field.showTotals ? tableTotals(field, rows) : null;
    const labelWidth = fixed ? 30 : 0;
    const colWidth = `${(100 - labelWidth) / columns.length}%`;
    const numberCell = (sf: TemplateSubfield) => (sf.type === 'number' ? { textAlign: 'right' as const } : {});
    const last = (i: number) => i === columns.length - 1;

    return (
        <View style={[styles.table, { marginBottom: 10 }]}>
            <View style={[styles.row, { backgroundColor: '#f3f4f6' }]} wrap={false}>
                {fixed && <Text style={[styles.halfLabelCell, { width: `${labelWidth}%` }]}>{field.rowHeader || ''}</Text>}
                {columns.map((sf, i) => (
                    <Text key={sf.id} style={[styles.halfLabelCell, { width: colWidth }, numberCell(sf), last(i) ? { borderRight: 'none' } : {}]}>{sf.pdfLabel || sf.label}</Text>
                ))}
            </View>
            {rows.map((row, ri) => (
                <View key={ri} style={ri === rows.length - 1 && !totals ? styles.lastRow : styles.row} wrap={false}>
                    {fixed && <Text style={[styles.halfLabelCell, { width: `${labelWidth}%` }]}>{textValue(row, TABLE_ROW_LABEL_KEY)}</Text>}
                    {columns.map((sf, i) => (
                        <Text key={sf.id} style={[last(i) ? styles.lastHalfValueCell : styles.halfValueCell, { width: colWidth }, numberCell(sf)]}>{subValue(row, sf)}</Text>
                    ))}
                </View>
            ))}
            {totals && (
                <View style={[styles.lastRow, { backgroundColor: '#f9fafb' }]} wrap={false}>
                    {fixed && <Text style={[styles.halfLabelCell, { width: `${labelWidth}%` }]}>Total</Text>}
                    {columns.map((sf, i) => (
                        <Text key={sf.id} style={[last(i) ? styles.lastHalfValueCell : styles.halfValueCell, { width: colWidth, fontWeight: 'bold' }, numberCell(sf)]}>
                            {sf.type === 'number' ? totals[sf.id] : !fixed && i === 0 ? 'Total' : ''}
                        </Text>
                    ))}
                </View>
            )}
        </View>
    );
}

function FieldBlock({ field, data }: { field: TemplateField; data: ReportValues }) {
    switch (field.type) {
        case 'list':
            return <ListBlock field={field} data={data} />;
        case 'table':
            return (
                <View>
                    {field.label && !field.hideInPdf && <Text style={{ fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>{field.pdfLabel || field.label}</Text>}
                    <TableBlock field={field} data={data} />
                </View>
            );
        case 'photos':
            return (
                <View>
                    {listValue(data, field.id).filter((p) => filled(textValue(p, 'url'))).map((photo, idx) => (
                        <View key={idx} wrap={false} style={{ marginBottom: 15 }}>
                            <Image src={textValue(photo, 'url')} style={styles.activityPhoto} />
                            {filled(textValue(photo, 'caption')) && <Text style={styles.caption}>{textValue(photo, 'caption')}</Text>}
                        </View>
                    ))}
                </View>
            );
        case 'attachments':
            return (
                <View>
                    {listValue(data, field.id).map((file, fIdx) => {
                        const pages = Array.isArray(file.pages) ? file.pages.filter((p): p is string => typeof p === 'string' && filled(p)) : [];
                        const rows = Array.isArray(file.jsonData) ? (file.jsonData as SpreadsheetRow[]) : [];
                        return (
                            <View key={fIdx}>
                                {pages.map((img, pIdx) => <Image key={pIdx} src={img} style={styles.attachmentPhoto} />)}
                                {rows.length > 0 && <ExcelTable rows={rows} />}
                            </View>
                        );
                    })}
                </View>
            );
        case 'preparedBy':
            return (
                <View>
                    {listValue(data, field.id).filter((o) => filled(textValue(o, 'name')) || filled(textValue(o, 'signatureImage'))).map((org, idx) => (
                        <View key={idx} style={{ marginBottom: 10 }} wrap={false}>
                            <LabelValueTable rows={[
                                ...(filled(textValue(org, 'name')) ? [{ label: 'Name', value: textValue(org, 'name') }] : []),
                                ...(filled(textValue(org, 'designation')) ? [{ label: 'Designation', value: textValue(org, 'designation') }] : []),
                                {
                                    label: 'Digital Signature',
                                    value: filled(textValue(org, 'signatureImage'))
                                        ? <Image src={textValue(org, 'signatureImage')} style={styles.signatureImage} />
                                        : <Text style={{ color: 'gray', fontStyle: 'italic' }}>—</Text>,
                                },
                            ]} />
                        </View>
                    ))}
                </View>
            );
        default:
            return null;
    }
}

function attachmentHasContent(field: TemplateField, data: ReportValues): boolean {
    return listValue(data, field.id).some((f) =>
        (Array.isArray(f.pages) && f.pages.some((p) => typeof p === 'string' && filled(p))) || (Array.isArray(f.jsonData) && f.jsonData.length > 0));
}

function SectionBlock({ section, template, data }: { section: TemplateSection; template: ReportTemplate; data: ReportValues }) {
    const fields = section.fields.filter((f) => !f.hideInPdf);
    const hasContent = fields.some((f) => (f.type === 'attachments' ? attachmentHasContent(f, data) : filledCount(f, data) > 0));
    if (!hasContent) return null;

    // Consecutive single-value fields share one label/value table.
    const blocks: React.ReactNode[] = [];
    let pending: { label: string; value: string }[] = [];
    const flush = () => {
        if (pending.length > 0) blocks.push(<View key={`t${blocks.length}`} wrap={false}><LabelValueTable rows={pending} /></View>);
        pending = [];
    };
    for (const field of fields) {
        if (isScalarField(field)) {
            const value = formatFieldValue(field, data);
            if (filled(value)) pending.push({ label: field.pdfLabel || field.label, value });
        } else {
            flush();
            blocks.push(<FieldBlock key={`${field.id}-${blocks.length}`} field={field} data={data} />);
        }
    }
    flush();

    const heading = section.pdfTitle || section.title;
    const subtitle = section.pdfSubtitle ? interpolate(section.pdfSubtitle, template, data) : '';
    if (section.newPage) {
        return (
            <View break>
                <Text style={styles.centeredTitle}>{heading}</Text>
                {filled(subtitle) && <Text style={styles.subtitle}>{subtitle}</Text>}
                {blocks}
            </View>
        );
    }
    // Keep the heading on the same page as the first block of its content.
    return (
        <View style={styles.section}>
            <View wrap={false}>
                <Text style={styles.sectionTitle}>{heading}</Text>
                {filled(subtitle) && <Text style={styles.subtitle}>{subtitle}</Text>}
                {blocks[0]}
            </View>
            {blocks.slice(1)}
        </View>
    );
}

/**
 * The official report PDF, laid out from a report template.
 * `data` must have its storage references resolved to URLs (resolveStorageRefs);
 * images whose URL could not be resolved are empty strings and are skipped.
 */
export const ReportPDF = ({ data, template = DEFAULT_TEMPLATE }: { data: ReportValues; template?: ReportTemplate }) => (
    <Document>
        <Page size="A4" style={styles.page}>
            <View style={styles.headerContainer} wrap={false}>
                {template.header.lines.map((line, i) => (
                    <Text key={i} style={i === 0 ? styles.headerLine0 : i === 1 ? styles.headerLine1 : styles.headerLineN}>{line}</Text>
                ))}
                {filled(template.header.title) && <Text style={styles.reportTitle}>{template.header.title}</Text>}
            </View>

            {template.sections.map((section) => (
                <SectionBlock key={section.id} section={section} template={template} data={data} />
            ))}

            <Text style={styles.footer} render={({ pageNumber }) => `Page ${pageNumber}`} fixed />
        </Page>
    </Document>
);
