// KBO 10 Teams — colors and hat definitions
// Color must be exactly 15 bytes to match "rgb(215,119,87)" length
// Uses leading-zero padding (no spaces) for compatibility

// Format rgb(R,G,B) to exactly 15 chars using leading zeros
function fmtColor(r, g, b) {
  for (let pr = 3; pr >= String(r).length; pr--) {
    for (let pg = 3; pg >= String(g).length; pg--) {
      for (let pb = 3; pb >= String(b).length; pb--) {
        const s = `rgb(${String(r).padStart(pr, "0")},${String(g).padStart(pg, "0")},${String(b).padStart(pb, "0")})`;
        if (s.length === 15) return s;
      }
    }
  }
  throw new Error(`Cannot format rgb(${r},${g},${b}) to 15 chars`);
}

const TEAMS = {
  // Each team's 2-cell pixel logo using quadrant block characters:
  //   ▜▛ = T-shape (top bar + center stem)
  //   ▌▐ = two vertical bars (H-shape)
  //   ▛▜ = inverted T
  //   ▙▟ = V-shape (diagonal)
  //   ▘▝ = two top dots
  //   ▖▗ = two bottom dots
  //   ▀▀ = horizontal top bar
  //   █▌ = full block + left-half
  //   ▌█ = left-half + full block
  //   etc.

  kia: {
    name: "KIA 타이거즈",
    nameEn: "KIA Tigers",
    color: fmtColor(234, 0, 41),
    logo: "T",
    logoPixel: "\\u259C\\u259B", // ▜▛ = T
    logoColor: "rgb(20,20,60)",
  },
  samsung: {
    name: "삼성 라이온즈",
    nameEn: "Samsung Lions",
    color: fmtColor(20, 60, 180),
    logo: "S",
    logoPixel: "\\u259C\\u2599", // ▜▙ = zigzag S
    logoColor: "rgb(255,255,255)",
  },
  lg: {
    name: "LG 트윈스",
    nameEn: "LG Twins",
    color: fmtColor(0, 0, 0),
    logo: "T",
    logoPixel: "\\u259C\\u259B", // ▜▛ = T
    logoColor: "rgb(198,12,48)", // cherry red
    eyeColor: "rgb(230,215,175)",
  },
  doosan: {
    name: "두산 베어스",
    nameEn: "Doosan Bears",
    color: fmtColor(19, 18, 48),
    logo: "D",
    logoPixel: "\\u2588\\u2599", // █▙ = D shape
    logoColor: "rgb(255,255,255)",
    eyeColor: "rgb(230,215,175)", // warm cream eyes for dark body
  },
  kt: {
    name: "KT 위즈",
    nameEn: "KT Wiz",
    color: fmtColor(0, 0, 0),
    logo: "K",
    logoPixel: "\\u258C\\u259E", // ▌▞ = K shape
    logoColor: "rgb(255,255,255)",
    eyeColor: "rgb(230,215,175)", // warm cream eyes for dark body
  },
  ssg: {
    name: "SSG 랜더스",
    nameEn: "SSG Landers",
    color: fmtColor(206, 14, 45),
    logo: "L",
    logoPixel: "\\u2599\\u2584", // ▙▄ = L shape (Landers)
    logoColor: "rgb(255,255,255)",
  },
  nc: {
    name: "NC 다이노스",
    nameEn: "NC Dinos",
    color: fmtColor(49, 82, 136),
    logo: "D",
    logoPixel: "\\u2588\\u2599", // █▙ = D shape
    logoColor: "rgb(200,164,92)", // muted gold
  },
  lotte: {
    name: "롯데 자이언츠",
    nameEn: "Lotte Giants",
    color: fmtColor(4, 30, 66),
    logo: "G",
    logoPixel: "\\u259B\\u258C", // ▛▌ = G shape
    logoColor: "rgb(255,40,40)",
    eyeColor: "rgb(230,215,175)", // warm cream eyes for dark body
  },
  hanwha: {
    name: "한화 이글스",
    nameEn: "Hanwha Eagles",
    color: fmtColor(255, 102, 0),
    logo: "E",
    logoPixel: "\\u2580\\u2580", // ▀▀ = top bar (eagle wing)
    logoColor: "rgb(255,255,255)",
  },
  kiwoom: {
    name: "키움 히어로즈",
    nameEn: "Kiwoom Heroes",
    color: fmtColor(130, 0, 36),
    logo: "K",
    logoPixel: "\\u258C\\u259E", // ▌▞ = K shape
    logoColor: "rgb(255,255,255)",
  },
};

// Original Clawd color
const ORIGINAL_COLOR = "rgb(215,119,87)";

module.exports = { TEAMS, ORIGINAL_COLOR };
