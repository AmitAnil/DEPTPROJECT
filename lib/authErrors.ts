/**
 * Maps Supabase Auth errors to friendly text. The sign-up allow-list trigger
 * (supabase/migrations) surfaces as a generic "Database error saving new user".
 */
export function authErrorMessage(message: string): string {
    if (/database error saving new user|not allowed to sign up|signup_not_allowed/i.test(message)) {
        return 'Sign-ups are restricted to Christ University email addresses. Please contact the department admin if you need access.';
    }
    return message;
}
