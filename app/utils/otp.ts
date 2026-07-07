// Email OTP length — MUST match the Supabase project's Auth setting (email
// OTP length, currently 8). Shared by the login email template (server) and
// the /login code input (client); email.ts itself is server-only, so this
// lives in its own dependency-free module. Verified against the live auth
// API: generateLink({type:'magiclink'}) produces codes of this length and
// verifyOtp({type:'email'}) accepts them.
export const OTP_LENGTH = 8
