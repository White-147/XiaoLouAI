import { Loader2 } from 'lucide-react'

export default function Spinner({ size = 6 }: { size?: number }) {
  return (
    <div className="flex items-center justify-center">
      <Loader2 className={`animate-spin h-${size} w-${size} text-gray-600`} />
    </div>
  )
}
