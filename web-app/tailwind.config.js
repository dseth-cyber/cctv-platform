/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  safelist: [
    // Backgrounds & Gradients
    'bg-gradient-to-br',
    'bg-gradient-to-r',
    'from-slate-900',
    'via-purple-900',
    'to-slate-800',
    'from-gray-950',
    'via-gray-900',
    'to-gray-950',
    'from-gray-50',
    'via-blue-50',
    'to-gray-100',
    'from-cyan-500',
    'via-blue-500',
    'to-indigo-600',
    'from-blue-600',
    'to-blue-700',
    'to-indigo-600',
    'from-cyan-400',
    'to-purple-500',
    'from-blue-600',
    'to-blue-800',
    'from-blue-400',
    
    // Cards
    'bg-indigo-950/30',
    'bg-gray-800/80',
    'bg-white/90',
    
    // Borders
    'border-white/20',
    'border-gray-700',
    'border-gray-200',
    'border-white/30',
    'border-gray-300',
    'border-gray-800',
    'border-white/5',
    'border-b',
    'border-r',
    
    // Text colors
    'text-white',
    'text-gray-200',
    'text-gray-100',
    'text-gray-400',
    'text-gray-900',
    'text-gray-600',
    'text-cyan-300',
    'text-blue-400',
    'text-blue-600',
    'text-cyan-400',
    
    // Hovers
    'hover:from-cyan-400',
    'hover:via-blue-400',
    'hover:to-indigo-500',
    'hover:from-blue-500',
    'hover:to-blue-600',
    'hover:text-cyan-200',
    'hover:text-blue-300',
    'hover:text-blue-700',
    'hover:bg-white/5',
    'hover:bg-gray-800/30',
    'hover:bg-gray-50',
    
    // Inputs & Tables
    'bg-white/10',
    'bg-gray-800/50',
    'bg-white',
    'divide-white/5',
    'divide-gray-800',
    'divide-gray-200',
    
    // Shadows & Blurs
    'backdrop-blur-2xl',
    'backdrop-blur-xl',
    'backdrop-blur-sm',
    'backdrop-blur-md',
    'shadow-xl',
    'shadow-lg',
    'shadow-sm',
    'shadow-cyan-500/20',
    
    // Blobs & Tracks
    'bg-purple-500/30',
    'bg-cyan-500/25',
    'bg-blue-500/30',
    'bg-blue-900/10',
    'bg-gray-800/20',
    'bg-blue-800/10',
    'bg-blue-200/30',
    'bg-indigo-200/30',
    'bg-purple-200/20',
    'bg-white/5',
    'bg-gray-100'
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
