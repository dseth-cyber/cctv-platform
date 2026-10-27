import { useState, forwardRef } from 'react'
import type { InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/** A password <input> with a show/hide eye-icon toggle. Pass className/style exactly as
 * you would to a plain <input> — this just overlays the toggle button and reserves
 * space for it (extra right padding), it doesn't impose its own border/background. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className = '', ...props },
  ref,
) {
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <input ref={ref} type={show ? 'text' : 'password'} className={`${className} pr-10`} {...props} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
})
