// Red Herring pictograms: station-signage line drawings on a 48 x 48 grid.
// One stroke weight (set on the <svg>, inherited by every shape), round caps and joins, ~4px padding.
// Small solid accents use F (fill, no stroke). No colours: everything is currentColor.

const F = { fill: "currentColor", stroke: "none" };

const n = (v) => +v.toFixed(2);

// A star of `points` points, outer radius R, inner radius r.
function star(cx, cy, R, r, points = 5) {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rad = i % 2 ? r : R;
    d += (i ? "L" : "M") + n(cx + rad * Math.cos(a)) + " " + n(cy + rad * Math.sin(a));
  }
  return d + "Z";
}

// A falling drop centred near (cx, cy); s scales it (s = 1 is about 3.4 wide, 4.8 tall).
function drop(cx, cy, s = 1) {
  const w = 1.7 * s;
  return (
    `M${n(cx)} ${n(cy - 2.4 * s)}Q${n(cx + w)} ${n(cy - 0.3 * s)} ${n(cx + w)} ${n(cy + 0.7 * s)}` +
    `A${n(w)} ${n(w)} 0 0 1 ${n(cx - w)} ${n(cy + 0.7 * s)}Q${n(cx - w)} ${n(cy - 0.3 * s)} ${n(cx)} ${n(cy - 2.4 * s)}Z`
  );
}

// A closed ellipse as path data (for even-odd holes).
function oval(cx, cy, rx, ry) {
  return `M${n(cx - rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)}Z`;
}

// A bandit's eye mask across a face at (cx, cy), half-width w, with two eye holes.
function maskBand(cx, cy, w) {
  const band =
    `M${n(cx - w)} ${n(cy - 1.8)}Q${n(cx)} ${n(cy - 4.2)} ${n(cx + w)} ${n(cy - 1.8)}` +
    `L${n(cx + w - 0.6)} ${n(cy + 1.6)}Q${n(cx + w * 0.45)} ${n(cy + 3.4)} ${n(cx + 1.2)} ${n(cy + 2.2)}` +
    `Q${n(cx)} ${n(cy + 1.2)} ${n(cx - 1.2)} ${n(cy + 2.2)}Q${n(cx - w * 0.45)} ${n(cy + 3.4)} ${n(cx - w + 0.6)} ${n(cy + 1.6)}Z`;
  return band + oval(cx - w * 0.42, cy - 0.3, 1.9, 1.25) + oval(cx + w * 0.42, cy - 0.3, 1.9, 1.25);
}

// ---------------------------------------------------------------- rooms

const room = {
  library: () => (
    <>
      <path d="M5 38H43" />
      <rect x="8" y="12" width="6" height="26" rx="1" />
      <rect x="14" y="17" width="6" height="21" rx="1" />
      <rect x="20" y="10" width="7" height="28" rx="1" />
      <path d="M8 17H14M8 33H14M20 15H27M20 33H27" />
      <path d="M35.25 38L40.35 35.94L32.1 15.54L27 17.6Z" />
    </>
  ),
  greenhouse: () => (
    <>
      <path d="M5 40H43" />
      <path d="M8 40V22A16 16 0 0 1 40 22V40" />
      <path d="M16 40V8.2M32 40V8.2M8 22H16M32 22H40" />
      <path d="M19.5 40L20.5 34.5H27.5L28.5 40M19 34.5H29" />
      <path d="M24 34.5V21" />
      <path d="M24 30Q18.5 30 18.5 24.5Q24 24.5 24 30Z" />
      <path d="M24 26Q29.5 26 29.5 20.5Q24 20.5 24 26Z" />
    </>
  ),
  kitchen: () => (
    <>
      <path d="M19 14Q17 11.5 19 9.5Q21 7.5 19 5M29 14Q27 11.5 29 9.5Q31 7.5 29 5" />
      <circle cx="24" cy="17.4" r="1.6" />
      <path d="M14.5 24A9.5 5 0 0 1 33.5 24" />
      <path d="M9.5 24H38.5" />
      <path d="M12 24V33Q12 38 17 38H31Q36 38 36 33V24" />
      <path d="M12 28H8.5M36 28H39.5" />
      <path d="M8 42H40" />
    </>
  ),
  ballroom: () => (
    <>
      <path d="M24 4V35" />
      <path d="M9 22Q9 32 24 32Q39 32 39 22" />
      <path d="M17 22Q17 27 24 27Q31 27 31 22" />
      <path d="M9 22V17M17 22V17M31 22V17M39 22V17" />
      <path d="M6.5 22H11.5M14.5 22H19.5M28.5 22H33.5M36.5 22H41.5" />
      <path {...F} d={drop(9, 13.4, 1.05) + drop(17, 13.4, 1.05) + drop(31, 13.4, 1.05) + drop(39, 13.4, 1.05)} />
      <circle {...F} cx="24" cy="37.6" r="2.1" />
    </>
  ),
  cellar: () => (
    <>
      <path d="M5 42H43" />
      <path d="M7 42V22A17 17 0 0 1 41 22V42" />
      <path d="M11 22A13 13 0 0 1 37 22M7 22H11M37 22H41" />
      <path d="M9.28 13.5L12.74 15.5M15.5 7.28L17.5 10.74M24 5V9M32.5 7.28L30.5 10.74M38.72 13.5L35.26 15.5" />
      <path d="M16 22H32Q36 32 32 42H16Q12 32 16 22Z" />
      <path d="M14.5 27H33.5M14.5 37H33.5" />
      <circle {...F} cx="24" cy="32" r="1.5" />
    </>
  ),
  study: () => (
    <>
      <path d="M5 31H43" />
      <path d="M8.5 31V42M39.5 31V42" />
      <path d="M28 31V37H39.5" />
      <circle {...F} cx="33.75" cy="34" r="1.1" />
      <path d="M9.5 31Q9.5 27.5 14 27.5Q18.5 27.5 18.5 31" />
      <path d="M14 27.5L18 17L28.6 11.2" />
      <circle {...F} cx="18" cy="17" r="1.6" />
      <path d="M29 10L37.8 15.3Q34.5 19.5 29.2 20.3Z" />
      <path d="M26 31V27.5H39V31" />
    </>
  ),
  gallery: () => (
    <>
      <path d="M16 13L24 7L32 13" />
      <circle {...F} cx="24" cy="7" r="1.6" />
      <rect x="7" y="13" width="34" height="27" rx="1.5" />
      <rect x="11" y="17" width="26" height="19" rx="0.5" />
      <path d="M11 36L19.5 25.5L25 32L28.5 28L37 36" />
      <circle {...F} cx="30" cy="22.5" r="2.2" />
    </>
  ),
  chapel: () => (
    <>
      <path d="M13 41V24A22 22 0 0 1 24 4.95A22 22 0 0 1 35 24V41" />
      <path d="M10 41H38" />
      <path d="M24 13V33M18.5 19H29.5" />
    </>
  ),
};

// ---------------------------------------------------------------- items

const item = {
  opener: () => (
    <g transform="rotate(45 24 24)">
      <path d="M24 3Q27 14 26.2 28H21.8Q21 14 24 3Z" />
      <path d="M24 9V24" />
      <path d="M18.5 28.5H29.5" />
      <path d="M22 29Q20.5 32.5 22 35.5Q20.5 38.5 22.2 41H25.8Q27.5 38.5 26 35.5Q27.5 32.5 26 29Z" />
      <path d="M22 35.5H26" />
      <circle cx="24" cy="43.2" r="2" />
    </g>
  ),
  poker: () => (
    <g transform="rotate(35 24 24)">
      <circle cx="24" cy="7" r="3.5" />
      <path d="M24 10.5V11.5" />
      <rect x="21.8" y="11.5" width="4.4" height="9" rx="2.2" />
      <path d="M24 20.5V44" />
      <path d="M24 36.5C28 36 31 37.5 30.5 42" />
    </g>
  ),
  scarf: () => (
    <>
      <path d="M11.5 6C11.5 14.5 15 20 19.5 21.5M36.5 6C36.5 14.5 33 20 28.5 21.5" />
      <path d="M17 6C17 11.5 19 15 21.5 16.6M31 6C31 11.5 29 15 26.5 16.6" />
      <rect x="19.5" y="16.5" width="9" height="9" rx="3.2" />
      <path d="M21 25.5C19 30.5 16.5 35.5 15 42L19 40.2L22.2 42.5C22.5 36.5 23 31.5 23.6 25.5" />
      <path d="M27 25.5C29 29.8 31.5 33 34 37.5L30.6 38L29.2 41.8C28.4 35.8 26.8 31 25.4 25.5" />
    </>
  ),
  watch: () => (
    <>
      <path d="M21 9.8C14.5 7.5 8 11 7 18C6.5 21.5 7.5 24.5 9 26.5" strokeDasharray="0.01 4.2" />
      <circle cx="24" cy="9.2" r="2.9" />
      <path d="M22 15.2V12.5H26V15.2" />
      <circle cx="24" cy="28" r="13" />
      <path d="M24 17.8V19.8M34.2 28H32.2M24 38.2V36.2M13.8 28H15.8" />
      <path d="M24 28L19.5 25.4M24 28L30.9 24" />
      <circle {...F} cx="24" cy="28" r="1.6" />
    </>
  ),
  teacup: () => (
    <>
      <path d="M18.5 18Q16.5 15.5 18.5 13Q20.5 10.5 18.5 8M25.5 18Q23.5 15.5 25.5 13Q27.5 10.5 25.5 8" />
      <path d="M11 22H33V25Q33 36 22 36Q11 36 11 25Z" />
      <path d="M33 25.3C38.5 24.5 39.5 31.5 31 33.3" />
      <path d="M6.5 36.5H41.5Q39 40.5 33 40.5H15Q9 40.5 6.5 36.5Z" />
    </>
  ),
  cane: () => (
    <g transform="rotate(8 24 24)">
      <path d="M31 38V16A8 8 0 0 0 15 16V20" />
      <rect x="29.6" y="38" width="2.8" height="4" rx="1" />
    </g>
  ),
  key: () => (
    <>
      <circle cx="12.5" cy="24" r="7" />
      <circle cx="12.5" cy="24" r="2.6" />
      <path d="M19.5 24H42" />
      <path d="M22.5 21V27M26 21.5V26.5" />
      <path d="M42 24V32H38V29H35V24" />
    </>
  ),
  shears: () => (
    <>
      <path d="M25 21.5L14.5 6Q12.5 16 21 23.5Z" />
      <path d="M23 21.5L33.5 6Q35.5 16 27 23.5Z" />
      <path d="M24 24L17.75 34.24M24 24L30.25 34.24" />
      <rect x="-2.2" y="0" width="4.4" height="9.5" rx="2.2" transform="translate(17.75 34.24) rotate(31.4)" />
      <rect x="-2.2" y="0" width="4.4" height="9.5" rx="2.2" transform="translate(30.25 34.24) rotate(-31.4)" />
      <circle {...F} cx="24" cy="24" r="2.3" />
    </>
  ),
};

// ---------------------------------------------------------------- marks

const mark = {
  mud: () => (
    <>
      <g transform="rotate(-12 24 24)">
        <path d="M24 5C30.5 5 33 10.5 33 15.5C33 21 30 24 29.5 28.5H18.5C18 24 15 21 15 15.5C15 10.5 17.5 5 24 5Z" />
        <path d="M19 13L24 15.5L29 13M19 19L24 21.5L29 19" />
        <path d="M18.5 32H29.5V38.5Q29.5 43 24 43Q18.5 43 18.5 38.5Z" />
        <path d="M21.5 36.5H26.5" />
      </g>
      <circle {...F} cx="37" cy="15" r="1.9" />
      <circle {...F} cx="40" cy="21" r="1.2" />
      <circle {...F} cx="11" cy="34" r="1.6" />
      <circle {...F} cx="8.5" cy="28.5" r="1" />
    </>
  ),
  ink: () => (
    <>
      <path d="M11 44V22A8 8 0 0 1 27 22V44" />
      <path {...F} d="M11.81 18.5A8 8 0 0 1 26.19 18.5Z" />
      <path d="M14.5 33Q19 34.5 23.5 33M14.5 37.5Q19 39 23.5 37.5" />
      <path {...F} d={drop(35, 24, 1.6)} />
      <circle {...F} cx="37.5" cy="33" r="1.3" />
    </>
  ),
  torn: () => (
    <>
      <path d="M10 5L14 17.5M38 5L34 17.5" />
      <path d="M14 17.5L18 15L21.5 18.5L25 15L28.5 18.5L31.5 15.5L34 17.5" />
      <path d="M14.6 22L18 19.8L21.5 23L25 19.8L28.5 23L31.5 20.2L33.4 22" />
      <path d="M14.6 22L15 31M33.4 22L33 31" />
      <rect x="14" y="31" width="20" height="9" rx="1.5" />
      <circle {...F} cx="29" cy="35.5" r="1.3" />
    </>
  ),
  smoke: () => (
    <>
      <path d="M24 35C20 31 28 27.5 24 23C20 18.5 27.5 14 24.5 7.5" />
      <path d="M17 35C13.5 31.5 20 28.5 17 24C14.5 20.5 18 17.5 16 14" />
      <path d="M31 35C34.5 31.5 28 28.5 31 24C33.5 20.5 30 17.5 32 14" />
      <path d="M11 38.5H37Q35 43 30 43H18Q13 43 11 38.5Z" />
    </>
  ),
  scratch: () => (
    <>
      <path d="M17 29V12.5A2.5 2.5 0 0 1 22 12.5V20V9.5A2.5 2.5 0 0 1 27 9.5V20V11A2.5 2.5 0 0 1 32 11V20.5V14.5A2.5 2.5 0 0 1 37 14.5V30C37 37.5 33 43 27.5 43H25C21.5 43 19.5 41.5 17.5 39L11.5 31.5A2.6 2.6 0 0 1 15.4 28.1L17 30" />
      <path d="M24.5 24Q22.8 29.5 20 34.5M29.5 24Q27.8 30 25 35.5M33.5 26Q32.3 30.8 30 35" />
    </>
  ),
  perfume: () => (
    <>
      <rect x="15" y="12.5" width="8" height="5.5" rx="1.2" />
      <path d="M23 15H25.5" />
      <path d="M16 22V18H22V22" />
      <path d="M10 27Q10 22 15 22H23Q28 22 28 27V38Q28 42 24 42H14Q10 42 10 38Z" />
      <rect x="13.5" y="28" width="11" height="8" rx="1" />
      <circle {...F} cx="29.5" cy="15" r="1.3" />
      <circle {...F} cx="33" cy="11.5" r="1.3" />
      <circle {...F} cx="33" cy="18.5" r="1.3" />
      <circle {...F} cx="37" cy="8.5" r="1.3" />
      <circle {...F} cx="37" cy="15" r="1.3" />
      <circle {...F} cx="37" cy="21.5" r="1.3" />
    </>
  ),
  wine: () => (
    <>
      <g transform="rotate(30 20 22)">
        <path d="M13 6H27Q28.5 15.5 20 20Q11.5 15.5 13 6Z" />
        <path d="M20 20V31" />
        <path d="M15 31H25" />
      </g>
      <path {...F} d={drop(35.5, 20, 0.8) + drop(37, 28, 1)} />
      <path {...F} d="M28 40Q28 36.5 32.5 37Q35 35 38 36.5Q42 36.5 41.5 39.5Q42 42.5 37.5 42Q34 43.5 31 42Q28 42.5 28 40Z" />
    </>
  ),
  rain: () => (
    <>
      <path d="M24 10V7.5" />
      <path d="M9 25A15 15 0 0 1 39 25" />
      <path d="M9 25Q14 21.5 19 25Q24 21.5 29 25Q34 21.5 39 25" />
      <path d="M24 10Q18.5 15 19 25M24 10Q29.5 15 29 25" />
      <path d="M24 25V37.5A3 3 0 0 1 18 37.5" />
      <path {...F} d={drop(12, 8, 1.1) + drop(36, 8, 1.1) + drop(7.5, 33, 1.1) + drop(40.5, 33, 1.1)} />
    </>
  ),
};

// ---------------------------------------------------------------- roles

const role = {
  detective: () => (
    <g transform="translate(-1 -1)">
      <circle cx="20" cy="20" r="11" />
      <path d="M13.4 17.6A7 7 0 0 1 17.6 13.4" />
      <path d="M27.8 27.8L30.5 30.5" />
      <rect x="-2.6" y="0" width="5.2" height="12" rx="2.6" transform="translate(30.5 30.5) rotate(-45)" />
    </g>
  ),
  killer: () => (
    <>
      <path d="M24 4Q28.5 9 28 30H20Q19.5 9 24 4Z" />
      <path d="M24 10V27" />
      <path d="M15.5 31.5H32.5" />
      <rect x="21.5" y="33" width="5" height="7" rx="1" />
      <circle cx="24" cy="42.6" r="1.9" />
    </>
  ),
  accomplice: () => (
    <>
      <circle cx="33" cy="13" r="6" />
      <path d="M26 25H35.5Q42 25 42 31.5V42" />
      <circle cx="19" cy="20" r="7" />
      <path d="M6 42V38Q6 31 13 31H25Q32 31 32 38V42" />
      <path {...F} fillRule="evenodd" d={maskBand(19, 19.5, 8.5) + maskBand(33, 12.5, 7.5)} />
    </>
  ),
  forensics: () => (
    <>
      <rect x="14" y="4.5" width="9" height="3.5" rx="1" />
      <rect x="15" y="8" width="7" height="15" rx="1" />
      <path d="M16.5 23L17.5 27H19.5L20.5 23" />
      <path d="M11 30H33" />
      <path d="M22 13H26Q32 13 32 20V38" />
      <rect x="10" y="38" width="28" height="4" rx="2" />
    </>
  ),
  witness: () => (
    <>
      <path d="M24 5V8M14.5 7L16 10M33.5 7L32 10" />
      <path d="M5 24C11 14.5 17.5 11 24 11C30.5 11 37 14.5 43 24C37 33.5 30.5 37 24 37C17.5 37 11 33.5 5 24Z" />
      <circle cx="24" cy="24" r="7" />
      <path {...F} fillRule="evenodd" d={oval(24, 24, 3.2, 3.2) + oval(22.9, 22.4, 1, 1)} />
    </>
  ),
  officer: () => (
    <>
      <path d="M24 5C28.5 8 33.5 9.5 39 9.5V22C39 31.5 32.5 38.5 24 43C15.5 38.5 9 31.5 9 22V9.5C14.5 9.5 19.5 8 24 5Z" />
      <path d={star(24, 23, 7.5, 3.1)} />
    </>
  ),
  coroner: () => (
    <g transform="rotate(-12 24 24)">
      <path d="M10 16L16 10H40V30H16L10 24Z" />
      <circle cx="16.5" cy="20" r="2.2" />
      <path d="M14.6 19.5C9 16.5 5.5 21 7 26.5C8.5 31.5 13 33 12 39" />
      <path d="M22 17H34M22 23H30" />
    </g>
  ),
  informant: () => (
    <>
      <rect x="6" y="11" width="36" height="26" rx="2.5" />
      <path d="M7.5 12.5L24 26L40.5 12.5" />
      <path {...F} fillRule="evenodd" d={oval(24, 26, 4.6, 4.6) + oval(24, 26, 2.6, 2.6) + oval(24, 26, 1.1, 1.1)} />
    </>
  ),
  rookie: () => (
    <>
      <rect x="7" y="9" width="24" height="32" rx="2.5" />
      <path d="M12.5 6V12M19 6V12M25.5 6V12" />
      <path d="M12 19H26M12 25H26M12 31H21" />
      <path d="M35 13.5V35L38 41L41 35V13.5Q41 10 38 10Q35 10 35 13.5Z" />
      <path d="M35 15.5H41M35 35H41" />
      <path {...F} d="M36.9 38.8L38 41L39.1 38.8Z" />
    </>
  ),
  reporter: () => (
    <>
      <path d="M15.5 17L18.5 12H29.5L32.5 17" />
      <path d="M10 17V14.5H14V17" />
      <rect x="6" y="17" width="36" height="23" rx="3.5" />
      <circle cx="24" cy="28.5" r="7.5" />
      <circle cx="24" cy="28.5" r="3.2" />
      <path {...F} d="M38.5 4.5Q39.3 8.7 43.5 9.5Q39.3 10.3 38.5 14.5Q37.7 10.3 33.5 9.5Q37.7 8.7 38.5 4.5Z" />
    </>
  ),
};

// ---------------------------------------------------------------- misc

const misc = {
  herring: () => (
    <>
      <path d="M5 24.5C10 18.5 19 16.5 26 17.2C30.5 17.7 33.5 20.2 36.5 22.6Q39 18 43.5 15.5Q40.8 20.5 40.5 24.5Q40.8 28.5 43.5 33.5Q39 31 36.5 26.4C33 28.9 29 30.4 24 30.5C17 30.8 9.5 28.8 5 24.5Z" />
      <path d="M19 17.6Q21.5 12.5 27.5 13Q25.8 15.3 26.3 17.2" />
      <path d="M26.5 30.3Q28.5 33.8 32 33.3Q30.5 31.5 30.8 29.6" />
      <path d="M16 18.6Q19.6 24.2 16 29.8" />
      <path d="M21.5 20.8Q24 24.2 21.5 27.6M26.5 20.8Q29 24 26.5 27.2M31.5 21.8Q33.4 24 31.5 26.3" />
      <path d="M5.3 24.6Q7 25.6 8.8 25.2" />
      <circle {...F} cx="11" cy="23" r="1.6" />
    </>
  ),
  moon: () => (
    <>
      <path d="M19.21 10.1A15 15 0 1 0 35.45 29.04A12.5 12.5 0 0 1 19.21 10.1Z" />
      <path {...F} d={star(37, 11, 4.2, 1.8)} />
    </>
  ),
  sun: () => (
    <>
      <path d="M13 30A11 11 0 0 1 35 30" />
      <path d="M11.44 22.75L7.55 20.5M16.75 17.44L14.5 13.55M24 15.5V11M31.25 17.44L33.5 13.55M36.56 22.75L40.45 20.5" />
      <path d="M5 30H43" />
      <path d="M12 35H36M18 40H30" />
    </>
  ),
  body: () => (
    <g transform="translate(1.5 0)">
      <path d="M20.5 15.5H18L10 7.5A1.77 1.77 0 0 0 7.5 10L18 20.5V41A2.25 2.25 0 0 0 22.5 41V31Q23 29.8 23.5 31L31 38.5A2.3 2.3 0 0 0 34.25 35.25L28 29V20.5L34.5 27A1.77 1.77 0 0 0 37 24.5L28 15.5H25.5L25.4 13.3A4.5 4.5 0 1 0 20.6 13.3Z" />
    </g>
  ),
  gavel: () => (
    <>
      <g transform="translate(21 16) rotate(-45)">
        <rect x="-9" y="-4.5" width="18" height="9" rx="2" />
        <path d="M-5 -4.5V4.5M5 -4.5V4.5" />
        <path d="M0 4.5V22" />
      </g>
      <rect x="12" y="33.5" width="12" height="3.5" rx="1" />
      <rect x="9" y="37" width="18" height="5" rx="1.5" />
    </>
  ),
  lab: () => (
    <>
      <path d="M18.5 6H29.5" />
      <path d="M20.5 6V17L10 36.5Q8.5 40 12.5 40H35.5Q39.5 40 38 36.5L27.5 17V6" />
      <path d="M14.6 28Q19 26 24 28Q29 30 33.4 28" />
      <circle cx="23" cy="22.5" r="1.6" />
      <circle cx="25.5" cy="12.5" r="1.3" />
      <circle {...F} cx="19.5" cy="34.5" r="1.4" />
      <circle cx="28" cy="33.5" r="1.8" />
    </>
  ),
  print: () => (
    <>
      <path d="M20.5 31.5V25A3.5 4.5 0 0 1 27.5 25V33.5" />
      <path d="M15.75 37.5V25A8.25 9.75 0 0 1 32.25 25V31.5" />
      <path d="M11 33.5V25A13 14.5 0 0 1 37 25V39.5" />
      <path d="M6.5 31.5V25A17.5 19 0 0 1 32.75 8.55M37 12.29A17.5 19 0 0 1 41.5 25V35.5" />
    </>
  ),
  ledger: () => (
    <>
      <path d="M24 11.5Q16 7.5 6 9.5V35.5Q16 33.5 24 37.5" />
      <path d="M24 11.5Q32 7.5 42 9.5V35.5Q32 33.5 24 37.5" />
      <path d="M24 11.5V37.5" />
      <path d="M6 35.5V38.5Q16 36.5 24 40.5Q32 36.5 42 38.5V35.5" />
      <path d="M10 16.5Q15.5 15 20.5 17M10 22.5Q15.5 21 20.5 23M10 28.5Q15.5 27 20.5 29" />
      <path d="M38 16.5Q32.5 15 27.5 17M38 22.5Q32.5 21 27.5 23M38 28.5Q32.5 27 27.5 29" />
    </>
  ),
  clue: () => (
    <>
      <g transform="rotate(-5 24 24)">
        <path d="M9 11H39V31L32 38H9Z" />
        <path d="M39 31H32V38" />
        <path d="M14 20H34M14 26H30M14 32H24" />
      </g>
      <path {...F} fillRule="evenodd" d={oval(24, 10.5, 3.9, 3.9) + oval(22.8, 9.3, 1.1, 1.1)} />
    </>
  ),
  jail: () => (
    <>
      <rect x="7" y="7" width="34" height="34" rx="2" />
      <path d="M7 21.5H41M7 26.5H41" />
      <path d="M15.5 7V21.5M24 7V21.5M32.5 7V21.5M15.5 26.5V41M24 26.5V41M32.5 26.5V41" />
    </>
  ),
  ghost: () => (
    <>
      <path d="M10 40V20A14 14 0 0 1 38 20V40Q36 37 34 40Q32 43 30 40Q28 37 26 40Q24 43 22 40Q20 37 18 40Q16 43 14 40Q12 37 10 40Z" />
      <path {...F} d={oval(19, 19, 2, 2.8) + oval(29, 19, 2, 2.8)} />
      <path d="M20.5 26Q24 29.5 27.5 26" />
    </>
  ),
  vote: () => (
    <>
      <path d="M17.5 24V9Q17.5 7 19.5 7H28.5Q30.5 7 30.5 9V24" />
      <path d="M20.5 15.5L23 18.5L27.5 12.5" />
      <path d="M5.5 24H42.5" />
      <path d="M8 24V40Q8 42 10 42H38Q40 42 40 40V24" />
      <path d="M18 33H30" />
    </>
  ),
  candle: () => (
    <>
      <path d="M24 5Q28.5 10.5 28.5 13.5A4.5 4.5 0 0 1 19.5 13.5Q19.5 10.5 24 5Z" />
      <path {...F} d="M24 10.5Q26 13 26 14.2A2 2 0 0 1 22 14.2Q22 13 24 10.5Z" />
      <path d="M24 18V21" />
      <path d="M18 40V21H30V40" />
      <path d="M20.5 21V25Q20.5 26.5 22 26.5Q23.5 26.5 23.5 25V21" />
      <path d="M11 40H37Q36 43.5 32 43.5H16Q12 43.5 11 40Z" />
    </>
  ),
  mansion: () => (
    <>
      <path d="M5 42H43" />
      <path d="M5.5 25L10 19.5H17M15.5 19L24 8L32.5 19M31 19.5H38L42.5 25" />
      <path d="M7 24.5V42M17 18.5V42M31 18.5V42M41 24.5V42" />
      <path d="M11 19.5V13H14V19.5M34 19.5V13H37V19.5" />
      <path d="M21 42V35A3 3 0 0 1 27 35V42" />
      <circle cx="24" cy="15" r="1.8" />
      <rect x="19.5" y="22" width="3" height="5" rx="0.5" />
      <rect x="25.5" y="22" width="3" height="5" rx="0.5" />
      <rect x="10" y="29" width="4" height="5" rx="0.5" />
      <rect x="34" y="29" width="4" height="5" rx="0.5" />
    </>
  ),
};

const fallback = () => (
  <>
    <circle cx="24" cy="24" r="17" />
    <path d="M19 19.5A5 5 0 1 1 26.5 23.8Q24 25.2 24 28" />
    <circle {...F} cx="24" cy="33.5" r="1.7" />
  </>
);

const GROUPS = { room, item, mark, role, misc };

// Every drawable id, by group (in display order).
export const ICON_IDS = {
  room: Object.keys(room),
  item: Object.keys(item),
  mark: Object.keys(mark),
  role: Object.keys(role),
  misc: Object.keys(misc),
};

const has = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

// A pictogram by its group and id, e.g. <Pictogram group="room" id="library" />.
export function Pictogram({ group, id, size = 48, strokeWidth = 2.6, className = "", title }) {
  const set = has(GROUPS, group) ? GROUPS[group] : null;
  const draw = has(set, id) ? set[id] : fallback;
  const a11y = title ? { role: "img" } : { "aria-hidden": "true" };
  return (
    <svg
      className={("pictogram " + className).trim()}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {draw()}
    </svg>
  );
}
