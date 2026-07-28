// PL-199: the ONE UI display form of the stored pronoun enum (the PL-69/80
// machinery's sibling for surfaces — the email side lives in pn() /
// studentPronounSet). `name_only` and unset render NOTHING: "rather not say"
// must never become a badge, and unset is not a statement. Leaf module —
// safe in client bundles.
export function pronounsDisplayLabel(p: string | null | undefined): string | null {
  switch (p) {
    case 'she_her':
      return 'she/her'
    case 'he_him':
      return 'he/him'
    case 'they_them':
      return 'they/them'
    default:
      return null
  }
}
