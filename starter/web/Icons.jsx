import React from 'react';

export default function Icon({ name, size = 18 }) {
  const paths = {
    video: <><rect x="3" y="6" width="12" height="12" rx="3" /><path d="m15 10 6-3v10l-6-3" /></>,
    cameraOff: <><path d="m3 3 18 18M10 6h2a3 3 0 0 1 3 3v3M15 10l6-3v10l-3-1.5M6 6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h6a3 3 0 0 0 2.1-.9" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>,
    micOff: <><path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.1 2.1M9 5a3 3 0 0 1 6 0v6M5 10v2a7 7 0 0 0 12 4.9M19 10v2M12 19v3M8 22h8" /></>,
    phone: <path d="M4 16c-2-2-1-4 1-6 4-4 10-4 14 0 2 2 3 4 1 6l-4-2v-3a14 14 0 0 0-8 0v3l-4 2Z" />,
    expand: <><path d="M14 3h7v7M21 3l-8 8M10 21H3v-7M3 21l8-8" /></>,
    minimize: <path d="M5 12h14" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    float: <><rect x="3" y="3" width="18" height="18" rx="3" /><rect x="11" y="11" width="10" height="10" rx="2" /></>,
    grip: <>{[7, 12, 17].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="currentColor" stroke="none" />))}</>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
