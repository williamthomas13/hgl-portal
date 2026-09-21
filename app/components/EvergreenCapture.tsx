import InterestCapture from './InterestCapture'

// PL-378 B/C: the between-classes interest capture behind an evergreen
// link — feeds the existing class_interest machinery. PL-484: the SAME
// capture component as the class states (names + the Compass opt-in), so
// the interest list has one shape everywhere.
export default function EvergreenCapture({
  schoolId,
  classType,
  heading,
  sub,
  schoolLabel,
}: {
  schoolId: string | null
  classType: string
  heading: string
  sub: string
  schoolLabel?: string
}) {
  return (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8 my-12">
      {/* PL-415: logo on the capture card — explicit dims, no layout shift. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/collateral/hgl-logo-color.png" alt="Higher Ground Learning" width={71} height={40} className="h-10 w-auto mb-4" />
      <h1 className="text-2xl font-bold text-hgl-slate mb-2">{heading}</h1>
      <p className="text-gray-600 mb-3">{sub}</p>
      <InterestCapture evergreen={{ schoolId }} schoolNickname={schoolLabel ?? 'the next'} classType={classType} buttonLabel="Email me when it opens" compact />
    </div>
  )
}
