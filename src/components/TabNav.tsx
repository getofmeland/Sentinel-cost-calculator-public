import { KeyboardEvent } from 'react'

interface Tab {
  id: string
  label: string
}

interface Props {
  tabs: Tab[]
  activeTab: string
  onChange: (id: string) => void
}

export function TabNav({ tabs, activeTab, onChange }: Props) {
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = tabs.findIndex(t => t.id === activeTab)
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = tabs[(currentIndex + 1) % tabs.length]
      onChange(next.id)
      document.getElementById(`tab-${next.id}`)?.focus()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prev = tabs[(currentIndex - 1 + tabs.length) % tabs.length]
      onChange(prev.id)
      document.getElementById(`tab-${prev.id}`)?.focus()
    }
  }

  return (
    <div
      className="bg-[#252838] rounded-lg p-1 grid sm:flex sm:w-fit gap-1"
      role="tablist"
      onKeyDown={handleKeyDown}
    >
      {tabs.map(tab => (
        <button
          key={tab.id}
          id={`tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`panel-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          className={[
            'px-4 py-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
            activeTab === tab.id
              ? 'bg-primary text-white shadow-sm'
              : 'text-light/60 hover:text-light hover:bg-white/10',
          ].join(' ')}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
