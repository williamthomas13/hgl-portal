// PL-480: HGL's long-standing "class is full" wording — the CODE fallback for
// the ONE editable source, the `waitlist-note` site content block (Settings →
// Class pages). Every surface that says a class is full reads the block via
// class-info / the class page loader and falls back here:
//   register page ② (full, deadline ahead) and ③ (full, deadline just passed),
//   the class page's full banner, the /classes card status line (short form).
// The W-series emails (W1 waitlist confirmation, W2 spot open, WR release,
// CX-W cancellation) are Scarlett's registry copy and are listed, not forced.
export const CLASS_FULL_HEADING = 'This class is currently full'
export const CLASS_FULL_NOTE =
  "When a class is full, we'll try to teach an additional section. Leave us your email and we'll notify you if we're able to open up a place for you!"
