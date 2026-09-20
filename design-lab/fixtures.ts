const svg = (body: string, width: number, height: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`)}`;

// Original geometric fixtures: no external asset, font, network, or image-generation dependency.
const botanical =
  '<rect width="400" height="600" fill="#e3d2da"/><path d="M204 490Q168 334 224 120" fill="none" stroke="#526856" stroke-width="4"/><path d="M201 393Q93 398 105 319Q184 326 201 393M204 278Q289 275 315 195Q226 199 204 278" fill="#88927d"/><g transform="translate(226 156)" fill="#80566a"><ellipse rx="45" ry="81" transform="rotate(8)"/><ellipse rx="45" ry="81" transform="rotate(68)"/><ellipse rx="45" ry="81" transform="rotate(128)"/><circle r="30" fill="#57303f"/></g>';
export const portrait = svg(botanical, 400, 600);
export const landscape = svg(
  '<rect width="600" height="400" fill="#efe5e9"/><path d="M0 330Q165 142 307 261T600 192V400H0" fill="#88927d"/><circle cx="445" cy="117" r="62" fill="#80566a"/>',
  600,
  400,
);
export const poster = svg(
  '<rect width="40" height="60" fill="#6e4052"/><circle cx="20" cy="30" r="12" fill="#fffefb"/>',
  40,
  60,
);
export const animation =
  'data:image/gif;base64,R0lGODlhKAA8AIEAAP/++25AUgAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAGQAAACwAAAAAKAA8AAAIjgADCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJ8iOAkygBmEzJUqXGljBPYoxJ0yLNmxRv6pyoE2fEnjshAvXpcGjQhkaJMkxasyhTmA+fQnUqNWXUqlavYv2J1aXQqjzBhmVqM+nMoRuPcpxasq3bt3Djyp1Lt67du3jz6t1rMSAAIfkEARkAAgAsAAAAACgAPACB//7749LaAAAAAAAACI4AAwgcSLCgwYMIEypcyLChw4cQI0qcSLGixYsYM2rcyLGjx48gQ4ocSfKjgJMoBZhMyVKlxpYwT2KMSdMizZsUb+qcqBNnxJ47IQL16XBo0IZGiTJMWrMoU5gPn0J1KjVl1KpWr2L9idWl0Ko8wYZlajPpzKEbj3KcWrKt27dw48qdS7eu3bt48+rdazEgADs=';
export const smallSvg = svg(
  '<circle cx="150" cy="150" r="113" fill="#e3d2da"/><path d="M150 247V77M150 187Q71 165 91 113Q150 127 150 187M150 140Q220 136 229 80Q168 83 150 140" fill="#526856" stroke="#526856" stroke-width="3"/>',
  300,
  300,
);
