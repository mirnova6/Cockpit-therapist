/** Minimal inline stroke icon set — consistent 24px grid, no external assets. */

const PATHS: Record<string, string> = {
  'compass': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4-1.5-2.5 6-6 2.5 2.5-6 6-2.5z',
  'search': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  'plus': 'M12 5v14M5 12h14',
  'lock': 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
  'unlock': 'M7 11V8a5 5 0 0 1 9.9-1M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
  'settings': 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8.5 3a8.4 8.4 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a8.6 8.6 0 0 0-2-1.2L15.5 3h-4l-.5 2.6a8.6 8.6 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a8.4 8.4 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a8.6 8.6 0 0 0 2 1.2l.5 2.6h4l.5-2.6a8.6 8.6 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z',
  'shield': 'M12 3l7 3v5c0 4.5-3 8.6-7 10-4-1.4-7-5.5-7-10V6l7-3z',
  'alert': 'M12 3 2.5 19.5h19L12 3zm0 7v4m0 3.5v.5',
  'file': 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4zm0 0v4h4M9 12h6M9 16h6',
  'clock': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 3',
  'chevron-left': 'M14.5 6 9 12l5.5 6',
  'chevron-right': 'M9.5 6 15 12l-5.5 6',
  'user': 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.5 20a7.5 7.5 0 0 1 15 0',
  'users': 'M9 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 19a6.5 6.5 0 0 1 13 0M16 5.5a3.5 3.5 0 0 1 0 6.6M17.5 13.2a6.5 6.5 0 0 1 4 5.8',
  'home': 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1v-8z',
  'list': 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  'calendar': 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm-1 5h16M8 3v4M16 3v4',
  'download': 'M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16',
  'upload': 'M12 15V4m0 0 4.5 4.5M12 4 7.5 8.5M4 19h16',
  'trash': 'M4 7h16M9 7V4h6v3m-8.5 0 1 13h9l1-13M10 11v6M14 11v6',
  'edit': 'M4 20h4l11-11-4-4L4 16v4zM13.5 6.5l4 4',
  'check': 'M4.5 12.5 10 18 19.5 7',
  'x': 'M6 6l12 12M18 6 6 18',
  'archive': 'M4 4h16a1 1 0 0 1 1 1v3H3V5a1 1 0 0 1 1-1zm1 4v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4',
  'eye': 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zm9.5-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  'heart': 'M12 20s-7.5-4.6-9.3-9A5 5 0 0 1 12 7a5 5 0 0 1 9.3 4c-1.8 4.4-9.3 9-9.3 9z',
  'pill': 'M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7l7-7zM7 7l7 7',
  'clipboard': 'M9 4h6v3H9V4zm6 0h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3m0 8h6M9 16h4',
  'activity': 'M3 12h4l2.5-7 5 14L17 12h4',
  'info': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v.5m0 3v5.5',
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
}) {
  const d = PATHS[name] ?? PATHS['info'];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}
