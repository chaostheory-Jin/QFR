export function BrowserStorageNotice() {
  return <details className="border-b border-slate-200 bg-white px-4 text-xs text-slate-600 lg:px-6">
    <summary className="min-h-10 cursor-pointer py-3 focus-visible:outline-indigo-600"><span className="font-medium text-slate-700">Browser-only storage</span><span className="text-slate-500"> · No cloud backup</span><span className="ml-2 font-medium text-indigo-700">Details</span></summary>
    <p className="max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 mb-3 leading-5 text-amber-900">Uploaded files and review decisions stay on this browser and site address. Clearing site data removes them; download important originals and export reports. AI analysis still sends selected documents to the analysis service.</p>
  </details>
}
