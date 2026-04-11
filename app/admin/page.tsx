'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../utils/supabase'

export default function AdminDashboard() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const [rosters, setRosters] = useState<any[]>([])
  const [fetchingRosters, setFetchingRosters] = useState(true)

  useEffect(() => {
    fetchRosters()
  }, [])

  async function fetchRosters() {
    setFetchingRosters(true)
    
    const { data, error } = await supabase
      .from('classes')
      .select(`
        *,
        enrollments (
          id,
          enrolled_at,
          students (
            first_name,
            last_name,
            families (
              parent_email,
              parent_first_name,
              parent_last_name
            )
          )
        )
      `)
      .order('created_at', { ascending: false })

    if (data) {
      setRosters(data)
    }
    setFetchingRosters(false)
  }

  async function handleSubmit(e: any) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const formData = new FormData(e.target)
    const newClass = {
      school_nickname: formData.get('school_nickname'),
      class_type: formData.get('class_type'),
      instructor_name: formData.get('instructor_name'),
      price: formData.get('price'),
      capacity: formData.get('capacity'),
      start_date: formData.get('start_date'),
    }

    const { error } = await supabase.from('classes').insert([newClass])

    if (error) {
      setMessage('Error: ' + error.message)
    } else {
      setMessage('Success! Class officially added to database.')
      e.target.reset() 
      fetchRosters()   
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-6xl mx-auto space-y-10">
        
        {/* 1. CREATE CLASS FORM */}
        <div className="bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-slate">
          <h1 className="text-2xl font-bold text-hgl-slate mb-6">Admin Command Center</h1>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Create a New Group Class</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">School Nickname</label>
                <input type="text" name="school_nickname" required placeholder="e.g. Nido" className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Class Type</label>
                <input type="text" name="class_type" required placeholder="e.g. SAT Prep" className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Instructor Name</label>
                <input type="text" name="instructor_name" required placeholder="e.g. Sarah" className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Start Date</label>
                <input type="date" name="start_date" required className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Price (USD)</label>
                <input type="number" name="price" required placeholder="750" className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Student Capacity</label>
                <input type="number" name="capacity" required placeholder="20" className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition" />
              </div>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="mt-6 w-full bg-hgl-blue text-white font-bold py-3 px-4 rounded-md hover:bg-hgl-blue-hover transition duration-200"
            >
              {loading ? 'Saving to Database...' : 'Create Class'}
            </button>
          </form>

            {message && (
            <div className={`mt-4 p-3 rounded text-center font-semibold ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {message}
            </div>
            )}
        </div>

        {/* 2. LIVE CLASS ROSTERS */}
        <div className="bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
          <h2 className="text-2xl font-bold text-hgl-slate mb-6">Live Class Rosters</h2>
          
          {fetchingRosters ? (
            <p className="text-gray-500 animate-pulse">Loading rosters from database...</p>
          ) : (
            <div className="space-y-8">
              {rosters.length === 0 ? (
                <p className="text-gray-500">No classes exist yet.</p>
              ) : (
                rosters.map((schoolClass) => {
                  const enrolledCount = schoolClass.enrollments?.length || 0;
                  return (
                    <div key={schoolClass.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      
                      <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                        <div>
                          <h3 className="text-lg font-bold text-hgl-slate">
                            {schoolClass.school_nickname} - {schoolClass.class_type}
                          </h3>
                          <p className="text-sm text-gray-600">Instructor: {schoolClass.instructor_name} | Starts: {new Date(schoolClass.start_date).toLocaleDateString()}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-block px-3 py-1 bg-[#00AEEE]/10 text-hgl-blue text-sm font-bold rounded-full">
                            {enrolledCount} / {schoolClass.capacity} Enrolled
                          </span>
                        </div>
                      </div>
                      
                      <div className="p-0 overflow-x-auto">
                        {enrolledCount === 0 ? (
                          <p className="text-sm text-gray-500 p-6 text-center italic">No students registered yet.</p>
                        ) : (
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-100">
                              <tr>
                                <th className="px-6 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">Student Name</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">Billing Contact</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">Contact Email</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">Registered On</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {schoolClass.enrollments.map((enrollment: any) => (
                                <tr key={enrollment.id} className="hover:bg-gray-50 transition">
                                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    {enrollment.students?.first_name} {enrollment.students?.last_name}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {enrollment.students?.families?.parent_first_name} {enrollment.students?.families?.parent_last_name}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-hgl-blue">
                                    {enrollment.students?.families?.parent_email}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {new Date(enrollment.enrolled_at).toLocaleDateString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
        
      </div>
    </div>
  )
}