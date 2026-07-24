export default function SuccessPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-10">
      <div className="bg-white p-10 rounded-lg shadow-lg text-center border-t-8 border-green-500 max-w-lg">
        <div className="text-green-500 text-6xl mb-4">🎉</div>
        <h1 className="text-3xl font-bold text-hgl-slate mb-4">Payment Successful!</h1>
        <p className="text-gray-600 mb-4">
          Your registration is officially confirmed. We have sent a receipt to your email, and your student has been added to the class roster.
        </p>
        {/* PL-124: the "what happens next" expectation — standing copy rule:
            "in the days before class starts", never a day count. */}
        <p className="text-gray-500 text-sm mb-8">
          A confirmation email is on its way, and class details arrive in the days before the
          first session — nothing else to do right now.
        </p>
        {/* Parents are never routed toward admin/dashboard. Revisit this
            destination when the Phase 4 parent portal exists. */}
        <a
          href="https://www.highergroundlearning.com"
          className="bg-hgl-blue text-white font-bold py-3 px-6 rounded hover:bg-hgl-blue-hover transition"
        >
          Back to Higher Ground Learning
        </a>
      </div>
    </div>
  );
}