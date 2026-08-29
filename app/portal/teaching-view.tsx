import type { SupabaseClient } from '@supabase/supabase-js'
import InstructorView from './instructor-view'
import TutorView from './tutor-view'
import PortalNav, { type PortalNavItem } from './portal-nav'

// PL-404: the ONE Teaching view body — the section stack plus its left menu
// — shared by the portal page and View-as so they can never render
// differently. A tutor with many classes reaches "My tutoring" in one click
// instead of scrolling the whole class stack; the menu composes only from
// the sections this account actually has.

export default async function TeachingView({
  supabase,
  email,
  teachesClasses,
  doesTutoring,
}: {
  supabase: SupabaseClient
  email: string
  teachesClasses: boolean
  doesTutoring: boolean
}) {
  const items: PortalNavItem[] = [
    ...(teachesClasses ? [{ href: '#portal-classes', label: 'My classes' }] : []),
    ...(doesTutoring
      ? [
          { href: '#portal-tutoring', label: 'My tutoring' },
          { href: '#portal-students', label: 'My students' },
          { href: '#portal-timecards', label: 'Timecards' },
          { href: '#portal-email-prefs', label: 'Email preferences' },
        ]
      : []),
  ]
  return (
    <div className="md:flex md:gap-6 md:items-start">
      <PortalNav items={items} />
      <div className="flex-1 min-w-0 space-y-10">
        {teachesClasses && (
          <section id="portal-classes" style={{ scrollMarginTop: 16 }}>
            <h2 className="text-xl font-bold text-hgl-slate mb-4">My classes</h2>
            <InstructorView supabase={supabase} email={email} />
          </section>
        )}
        {doesTutoring && (
          <section id="portal-tutoring" style={{ scrollMarginTop: 16 }}>
            <h2 className="text-xl font-bold text-hgl-slate mb-4">My tutoring</h2>
            <TutorView supabase={supabase} email={email} />
          </section>
        )}
      </div>
    </div>
  )
}
