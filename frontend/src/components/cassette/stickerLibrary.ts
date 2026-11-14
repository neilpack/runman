// Icon stickers for the cassette editor (on top of the 8 hand-drawn doodles in StickerIcon.tsx).
//
// ─── HOW TO ADD A STICKER FROM REICON ─────────────────────────────────────────────────
//  Easiest: run the sticker command from the repo root with the icon's Reicon name
//  (hover an icon in the Reicon panel to see it). It copies the real SVG in for you:
//
//       npm run sticker -- gamepad              Outline version
//       npm run sticker -- gamepad --filled     Filled version
//       npm run sticker -- gamepad headphone    several at once
//       npm run sticker -- --search game        find icon names
//
//  By hand instead: in Reicon pick "SVG Code" + currentColor, copy the icon, and add
//       { id: 'reicon-rocket', label: 'Rocket', svg: `<paste the whole svg here>` },
//  below the marker line at the bottom. Paste the full SVG (it has a long d="..." full of
//  numbers) between backticks, and don't wrap it in outline(); that helper is only for
//  the short hand-written snippets in this file.
//
//  Notes
//  - The sticker's colour comes from `currentColor`, so don't hard-code fill/stroke colours.
//  - Width/height in the SVG don't matter; stickers are scaled with CSS.
//  - Stickers get a white die-cut outline automatically.
//  - Don't rename or delete an `id` that's in use: saved tapes store the id, and a missing
//    id just renders nothing on those tapes.
//  - Only paste SVGs from Reicon or other trusted sources: the markup is injected as-is.
// ──────────────────────────────────────────────────────────────────────────────────────

export interface IconSticker {
  id: string;
  label: string;
  svg: string;
}

const outline = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICON_STICKERS: IconSticker[] = [
  {
    id: 'icon-headphones',
    label: 'Headphones',
    svg: outline(
      '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
    ),
  },
  {
    id: 'icon-microphone',
    label: 'Microphone',
    svg: outline('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>'),
  },
  {
    id: 'icon-boombox',
    label: 'Boombox',
    svg: outline(
      '<rect x="2" y="8" width="20" height="12" rx="2"/><path d="M7 8V5h10v3"/><circle cx="7" cy="14" r="3"/><circle cx="17" cy="14" r="3"/><path d="M11 12h2"/>',
    ),
  },
  {
    id: 'icon-sun',
    label: 'Sun',
    svg: outline(
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    ),
  },
  {
    id: 'icon-moon',
    label: 'Moon',
    svg: outline('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  },
  {
    id: 'icon-flame',
    label: 'Flame',
    svg: outline('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.5 2 1.5 3 2.5 3-1-3 0-6 .5-8.5z"/>'),
  },
  {
    id: 'icon-crown',
    label: 'Crown',
    svg: outline('<path d="M3 8l4 4 5-6 5 6 4-4-2 11H5z"/>'),
  },
  {
    id: 'icon-peace',
    label: 'Peace',
    svg: outline('<circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 12l-6.4 6.4M12 12l6.4 6.4"/>'),
  },

  // ── Paste new Reicon stickers below this line ──
  {
    id: 'reicon-gamepad',
    label: 'Gamepad',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" 
    clip-rule="evenodd" d="M5.65845 3.45374C6.1639 3.27447 6.67734 3.25 7.10257 3.25H7.71504C8.74784 3.25 9.7552 
    3.5704 10.5982 4.16702L11.1001 4.52223C11.3633 4.70844 11.6777 4.80844 12 4.80844C12.3224 4.80844 12.6368 4.70844 
    12.8999 4.52222L13.4018 4.16703C14.2448 3.5704 15.2522 3.25 16.2849 3.25H16.8974C17.3227 3.25 17.8361 3.27447 18.3415 
    3.45373C19.7848 3.96561 20.9262 5.14191 21.6779 7.04514C22.4219 8.92876 22.8039 11.5642 22.7439 15.1153C22.7312 15.8648 
    22.6377 16.7048 22.3495 17.4614C22.0576 18.2279 21.5475 18.9504 20.6893 19.3608C20.2011 19.5943 19.6257 19.75 18.9733 
    19.75C18.1864 19.75 17.5391 19.5233 17.0312 19.1905C16.5588 18.8808 16.1457 18.4805 15.7928 18.1385C15.7498 18.0968 
    15.7077 18.0561 15.6665 18.0164C15.2616 17.6267 14.9212 17.3226 14.5435 17.1267C14.0662 16.8792 13.5365 16.75 12.9989 
    16.75H11.0012C10.4635 16.75 9.93378 16.8792 9.45652 17.1267C9.07878 17.3226 8.73837 17.6267 8.33351 18.0164C8.29232 
    18.0561 8.25024 18.0968 8.20726 18.1385C7.85433 18.4805 7.44123 18.8808 6.96877 19.1905C6.46087 19.5233 5.81363 19.75 
    5.02671 19.75C4.37431 19.75 3.79887 19.5943 3.31066 19.3608C2.45248 18.9504 1.94246 18.2279 1.65049 17.4614C1.36232 
    16.7048 1.26883 15.8648 1.25615 15.1153C1.19607 11.5643 1.57809 8.92876 2.32207 7.04515C3.0738 5.14192 4.2152 3.96561 
    5.65845 3.45374ZM7.10257 4.75C6.71943 4.75 6.41628 4.77651 6.15985 4.86745C5.2204 5.20065 4.35098 5.99156 3.71719 
    7.59618C3.07565 9.22042 2.69746 11.6334 2.75593 15.0899C2.76714 15.7524 2.85078 16.3985 3.05225 16.9275C3.24992 
    17.4465 3.54206 17.8088 3.95781 18.0076C4.26356 18.1538 4.61904 18.25 5.02671 18.25C5.51183 18.25 5.87475 18.114
     6.14651 17.9359C6.49227 17.7093 6.79957 17.4125 7.16871 17.0559C7.20944 17.0165 7.25091 16.9765 7.29328 16.9357C7.69425 
     16.5497 8.1737 16.1022 8.76598 15.7951C9.45661 15.4369 10.2232 15.25 11.0012 15.25H12.9989C13.7768 15.25 14.5434 15.4369 
     15.234 15.7951C15.8263 16.1022 16.3058 16.5497 16.7067 16.9357C16.7491 16.9765 16.7906 17.0165 16.8313 17.0559C17.2004 17.4125 
     17.5077 17.7093 17.8535 17.9359C18.1253 18.114 18.4882 18.25 18.9733 18.25C19.381 18.25 19.7364 18.1538 20.0422 18.0076C20.458 
     17.8088 20.7501 17.4465 20.9478 16.9275C21.1492 16.3985 21.2329 15.7524 21.2441 15.0899C21.3025 11.6334 20.9244 9.22041 20.2828 
     7.59618C19.649 5.99155 18.7796 5.20064 17.8401 4.86745C17.5837 4.77651 17.2806 4.75 16.8974 4.75H16.2849C15.5626 4.75 14.858 
     4.9741 14.2683 5.39141L13.7664 5.74661C13.25 6.11214 12.6328 6.30844 12 6.30844C11.3673 6.30844 10.7501 6.11215 10.2336 
     5.74662L9.73171 5.39142C9.14205 4.97411 8.43744 4.75 7.71504 4.75H7.10257ZM7.5 8.25C7.91422 8.25 8.25 8.58579 8.25 
     9V9.75H9C9.41422 9.75 9.75 10.0858 9.75 10.5C9.75 10.9142 9.41422 11.25 9 11.25H8.25V12C8.25 12.4142 7.91422 12.75 7.5 
     12.75C7.08579 12.75 6.75 12.4142 6.75 12V11.25H6C5.58579 11.25 5.25 10.9142 5.25 10.5C5.25 10.0858 5.58579 9.75 6 9.75H6.75V9C6.75 
     8.58579 7.08579 8.25 7.5 8.25Z" fill="currentColor"/><path d="M19 10.25C19 10.6642 18.6642 11 18.25 11C17.8358 11 17.5 10.6642 
     17.5 10.25C17.5 9.83579 17.8358 9.5 18.25 9.5C18.6642 9.5 19 9.83579 19 10.25Z" fill="currentColor"/><path d="M16 10.25C16 10.6642 
     15.6642 11 15.25 11C14.8358 11 14.5 10.6642 14.5 10.25C14.5 9.83579 14.8358 9.5 15.25 9.5C15.6642 9.5 16 9.83579 16 10.25Z" 
     fill="currentColor"/><path d="M16.75 8C17.1642 8 17.5 8.33579 17.5 8.75C17.5 9.16421 17.1642 9.5 16.75 9.5C16.3358 9.5 16 
     9.16421 16 8.75C16 8.33579 16.3358 8 16.75 8Z" fill="currentColor"/><path d="M16.75 11C17.1642 11 17.5 11.3358 17.5 11.75C17.5 
     12.1642 17.1642 12.5 16.75 12.5C16.3358 12.5 16 12.1642 16 11.75C16 11.3358 16.3358 11 16.75 11Z" fill="currentColor"/></svg>`,
  },
  {
    id: 'reicon-PizzaSlice',
    label: 'PizzaSlice',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="10.6666" cy="12" r="1.3333" fill="currentColor"></circle><path d="M 5 12.6013 c 0.2947 -0.1707 0.636 -0.268 1 -0.268 1.104 0 2 0.896 2 2 s -0.896 2 -2 2 c -0.364 0 -0.7067 -0.0973 -1 -0.268" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="M 5 6.6666 c 5.3053 0 9.936 2.8813 12.4146 7.1653" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="M 9.6666 20.3333 v -0.8733 c 0 -0.5133 -0.556 -0.8333 -1 -0.5773 l -1.6667 0.9627 c -0.8893 0.5133 -2 -0.128 -2 -1.1547 V 4.392 c 0 -0.7893 0.6827 -1.396 1.4707 -1.332 5.5267 0.4467 10.3493 3.3907 13.336 7.7013 0.448 0.648 0.2587 1.5413 -0.4227 1.9347 l -5.0493 2.9147 c -0.8253 0.476 -1.3333 1.3573 -1.3333 2.3093 v 3.7453" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path></svg>'
  },
  {
    id: 'reicon-Dollar',
    label: 'Dollar',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.75C6.89137 2.75 2.75 6.89137 2.75 12C2.75 17.1086 6.89137 21.25 12 21.25C17.1086 21.25 21.25 17.1086 21.25 12C21.25 6.89137 17.1086 2.75 12 2.75ZM1.25 12C1.25 6.06294 6.06294 1.25 12 1.25C17.9371 1.25 22.75 6.06294 22.75 12C22.75 17.9371 17.9371 22.75 12 22.75C6.06294 22.75 1.25 17.9371 1.25 12ZM12 5.25C12.4142 5.25 12.75 5.58579 12.75 6V6.31673C14.3804 6.60867 15.75 7.83361 15.75 9.5C15.75 9.91421 15.4142 10.25 15 10.25C14.5858 10.25 14.25 9.91421 14.25 9.5C14.25 8.82154 13.6859 8.10339 12.75 7.84748V11.3167C14.3804 11.6087 15.75 12.8336 15.75 14.5C15.75 16.1664 14.3804 17.3913 12.75 17.6833V18C12.75 18.4142 12.4142 18.75 12 18.75C11.5858 18.75 11.25 18.4142 11.25 18V17.6833C9.61957 17.3913 8.25 16.1664 8.25 14.5C8.25 14.0858 8.58579 13.75 9 13.75C9.41421 13.75 9.75 14.0858 9.75 14.5C9.75 15.1785 10.3141 15.8966 11.25 16.1525V12.6833C9.61957 12.3913 8.25 11.1664 8.25 9.5C8.25 7.83361 9.61957 6.60867 11.25 6.31673V6C11.25 5.58579 11.5858 5.25 12 5.25ZM11.25 7.84748C10.3141 8.10339 9.75 8.82154 9.75 9.5C9.75 10.1785 10.3141 10.8966 11.25 11.1525V7.84748ZM12.75 12.8475V16.1525C13.6859 15.8966 14.25 15.1785 14.25 14.5C14.25 13.8215 13.6859 13.1034 12.75 12.8475Z" fill="currentColor"/></svg>'
  },
  {
    id: 'reicon-Soundwave',
    label: 'Soundwave',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4L12.75 20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20L11.25 4C11.25 3.58579 11.5858 3.25 12 3.25ZM8 6.25C8.41421 6.25 8.75 6.58579 8.75 7V17C8.75 17.4142 8.41421 17.75 8 17.75C7.58579 17.75 7.25 17.4142 7.25 17V7C7.25 6.58579 7.58579 6.25 8 6.25ZM16 6.25C16.4142 6.25 16.75 6.58579 16.75 7V17C16.75 17.4142 16.4142 17.75 16 17.75C15.5858 17.75 15.25 17.4142 15.25 17V7C15.25 6.58579 15.5858 6.25 16 6.25ZM4 10.25C4.41421 10.25 4.75 10.5858 4.75 11L4.75 13C4.75 13.4142 4.41421 13.75 4 13.75C3.58579 13.75 3.25 13.4142 3.25 13L3.25 11C3.25 10.5858 3.58579 10.25 4 10.25ZM20 10.25C20.4142 10.25 20.75 10.5858 20.75 11V13C20.75 13.4142 20.4142 13.75 20 13.75C19.5858 13.75 19.25 13.4142 19.25 13V11C19.25 10.5858 19.5858 10.25 20 10.25Z" fill="currentColor"/></svg>'
  }
];

const byId = new Map(ICON_STICKERS.map((s) => [s.id, s]));

export function findIconSticker(id: string): IconSticker | undefined {
  return byId.get(id);
}
