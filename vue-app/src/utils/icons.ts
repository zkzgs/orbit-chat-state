export function historyActionIcon(action: string) {
  const icons: Record<string, string> = {
    config:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>',
    download:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 19h14"></path></svg>',
    'download-all':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 19h14"></path></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="2"></rect><circle cx="7" cy="9" r="1"></circle><path d="m4 16 3.5-3.5 2.5 2.5 2-2 4 4"></path><path d="M19 5v8M15 9h8"></path></svg>',
    favorite:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"></path></svg>',
    audit:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h11a2 2 0 0 1 2 2v13H8a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"></path><path d="M8 4v12a3 3 0 0 0 3 3"></path><path d="M10 9h7M10 13h7"></path></svg>',
    'retry-task':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"></path><path d="M19 12a7 7 0 1 1-2-5l3 5"></path></svg>',
    'reuse-task':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11a4 4 0 0 1 0 8H8"></path><path d="m11 11-4 4 4 4"></path><path d="M4 4v6"></path></svg>',
    default:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 21 5-6a6 6 0 1 0-10 0z"></path><circle cx="12" cy="9" r="2"></circle></svg>',
    rename:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="m16.5 3.5 4 4L9 19l-5 1 1-5z"></path></svg>',
    delete:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"></path></svg>',
  }
  return icons[action] || icons.favorite
}
