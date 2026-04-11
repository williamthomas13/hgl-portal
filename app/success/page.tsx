import Link from 'next/link';

export default function SuccessPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-10">
      <div className="bg-white p-10 rounded-lg shadow-lg text-center border-t-8 border-green-500 max-w-lg">
        <div className="text-green-500 text-6xl mb-4">🎉</div>
        <h1 className="text-3xl font-bold text-hgl-slate mb-4">Payment Successful!</h1>
        <p className="text-gray-600 mb-8">
          Your registration is officially confirmed. We have sent a receipt to your email, and your student has been added to the class roster.
        </p>
        <Link 
          href="/" 
          className="bg-hgl-blue text-white font-bold py-3 px-6 rounded hover:bg-hgl-blue-hover transition"
        >
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}