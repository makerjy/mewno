export type IconName =
  | "plus"
  | "history"
  | "model"
  | "settings"
  | "chevron"
  | "upload"
  | "file"
  | "arrow"
  | "shield"
  | "sun"
  | "moon"
  | "check"
  | "close"
  | "play"
  | "pause"
  | "copy"
  | "download"
  | "spark"
  | "search"
  | "headphones"
  | "volume"
  | "wave"
  | "paw";
export function Icon({
  name,
  size = 20,
  ...props
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const paths: Record<IconName, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    history: (
      <>
        <path d="M4 5v5h5M4.5 9a8 8 0 1 1-.3 5" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    model: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    settings: (
      <>
        <path d="m10 3-.6 2.2-2 .9-2-.6-2 3.4L5 10.5v3l-1.6 1.6 2 3.4 2-.6 2 .9L10 21h4l.6-2.2 2-.9 2 .6 2-3.4-1.6-1.6v-3l1.6-1.6-2-3.4-2 .6-2-.9L14 3Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H6v18h13V8l-5-5Zm0 0v5h5M9 12h7M9 16h5" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l1.5 1.5m13 13L20 20M4 20l1.5-1.5m13-13L20 4" />
      </>
    ),
    moon: <path d="M20 14a8 8 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    play: <path d="m9 5 11 7-11 7V5Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M15 8V3H3v13h5" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    headphones: (
      <>
        <path d="M4 14v-3a8 8 0 0 1 16 0v3" />
        <rect x="3" y="12" width="4" height="8" rx="2" />
        <rect x="17" y="12" width="4" height="8" rx="2" />
      </>
    ),
    volume: (
      <>
        <path d="M4 9h4l5-4v14l-5-4H4V9Zm12-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
      </>
    ),
    wave: <path d="M4 10v4m4-7v10m4-14v18m4-15v12m4-8v4" />,
    paw: (
      <>
        <ellipse cx="4" cy="8" rx="2" ry="3" transform="rotate(-25 4 8)" />
        <ellipse cx="9" cy="5" rx="2" ry="3" />
        <ellipse cx="15" cy="5" rx="2" ry="3" />
        <ellipse cx="20" cy="9" rx="2" ry="3" transform="rotate(25 20 9)" />
        <path d="M5 18c0-3 4-8 7-8s7 5 7 8c0 5-5 2-7 2s-7 3-7-2Z" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
