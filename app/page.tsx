'use client'

import { useEffect, useState } from 'react'
import { supabase } from './utils/supabase'
import Link from 'next/link'
export default function ParentPortal() {
  const [classes, setClasses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // This function automatically runs when the page loads to fetch your data
    async function fetchClasses() {
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .order('created_at', { ascending: false }) // Shows newest classes first

      if (data) {
        setClasses(data)
      }
      setLoading(false)
    }

    fetchClasses()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-blue-900 mb-2">Higher Ground Learning</h1>
        <h2 className="text-xl font-semibold text-gray-700 mb-8">Available Classes & Registration</h2>

        {loading ? (
          <p className="text-gray-500 animate-pulse">Loading live classes...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {classes.length === 0 ? (
              <p className="text-gray-500">No classes are currently enrolling.</p>
            ) : (
              classes.map((c) => (
                <div key={c.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-6 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full mb-2">
                          {c.school_nickname}
                        </span>
                        <h3 className="text-xl font-bold text-gray-900">{c.class_type}</h3>
                      </div>
                      <span className="text-lg font-bold text-green-600">${c.price}</span>
                    </div>
                    
                    <div className="space-y-2 text-sm text-gray-600 mb-6">
                      <p><strong>Instructor:</strong> {c.instructor_name}</p>
                      <p><strong>Starts:</strong> {new Date(c.start_date).toLocaleDateString()}</p>
                      <p><strong>Capacity:</strong> {c.capacity} students max</p>
                    </div>
                  </div>
                  
                  <Link 
  href={`/register/${c.id}`} 
  className="block text-center w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition"
>
  Register Now
</Link>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
