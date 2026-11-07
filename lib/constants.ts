// Single source of truth for institution names shown in the UI and printed in reports.
export const UNIVERSITY_NAME = 'CHRIST (Deemed to be University)';
export const SCHOOL_NAME = 'School of Engineering and Technology';
export const DEPARTMENT_NAME = 'Department of AI & Data Science';

// Upload limits (enforced client-side; storage bucket limits should match, see supabase/migrations).
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB per file
export const MAX_PDF_PAGES = 25; // pages converted to images per uploaded PDF
